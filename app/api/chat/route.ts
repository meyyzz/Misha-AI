// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TAVILY_URL = "https://api.tavily.com/search";

// Model teks biasa (llama-3.3-70b-versatile sudah deprecated per Juni 2026)
const TEXT_MODEL = "openai/gpt-oss-120b";
// Model vision (masih berstatus preview di Groq, cek console.groq.com/docs/vision
// kalau suatu saat model ini juga di-deprecate)
const VISION_MODEL = "qwen/qwen3.6-27b";

const MAX_HISTORY_MESSAGES = 20;

// ===== Rate limiting sederhana (in-memory, per IP) =====
// Catatan: ini reset tiap kali server restart/cold start. Untuk skala besar/production
// yang serius, idealnya pakai Redis/Upstash. Tapi untuk penggunaan personal ini cukup
// buat mencegah spam kasar ke API key kamu.
const RATE_LIMIT_MAX_REQUESTS = 15; // maksimal request
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // per 1 menit

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count += 1;
  return { allowed: true };
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

type ChatRole = "system" | "user" | "assistant";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[];
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

const SYSTEM_PROMPT = `Kamu adalah Misha AI, asisten yang ramah, jelas, dan membantu. Jawab dalam Bahasa Indonesia kecuali diminta lain.

PENTING: Pengetahuanmu punya batas waktu (training cutoff) dan bisa jadi sudah usang, terutama untuk hal-hal seperti pejabat yang sedang menjabat, berita terbaru, harga, atau peristiwa terkini. Jika ada hasil pencarian web yang diberikan dalam percakapan ini, WAJIB gunakan informasi tersebut sebagai sumber utama dan UTAMAKAN itu dibanding pengetahuan internal kamu yang mungkin sudah tidak akurat lagi. Jangan menolak atau meragukan hasil pencarian web hanya karena berbeda dari yang kamu "ingat".

ATURAN GAYA JAWABAN (WAJIB DIIKUTI):
- JANGAN pernah menulis penanda sitasi seperti [1], [2], [3], dst di dalam jawaban. Tulis jawabannya secara alami tanpa penanda apa pun. Daftar sumbernya akan ditampilkan terpisah oleh sistem.
- Jawab seringkas mungkin. Untuk pertanyaan sederhana, cukup 1 paragraf pendek atau bahkan 1-2 kalimat.
- Untuk pertanyaan yang butuh penjelasan lebih, maksimal 2-3 paragraf pendek.
- Jangan mengulang pertanyaan user di awal jawaban, langsung ke jawabannya.
- Jika user mengirim gambar, deskripsikan dan analisis isinya dengan jelas dan relevan sesuai pertanyaan user.

Jika tidak ada hasil pencarian yang relevan, jawab sebisanya dan katakan dengan jujur kalau informasi tersebut mungkin sudah tidak update.`;

function messageHasImage(message: ChatMessage): boolean {
  return (
    Array.isArray(message.content) &&
    message.content.some((part) => part.type === "image_url")
  );
}

function extractText(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ");
}

async function searchTavily(query: string): Promise<TavilyResult[]> {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.results ?? [];
}

function buildContextMessage(results: TavilyResult[]): ChatMessage | null {
  if (results.length === 0) return null;

  const contextText = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`)
    .join("\n\n");

  return {
    role: "system",
    content: `Berikut hasil pencarian web yang relevan untuk pesan terakhir user:\n\n${contextText}`,
  };
}

function buildGroqMessages(
  history: ChatMessage[],
  searchContext: ChatMessage | null
): ChatMessage[] {
  const conversation = history.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );

  const trimmedConversation = conversation.slice(-MAX_HISTORY_MESSAGES);

  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

  if (searchContext) {
    messages.push(searchContext);
  }

  messages.push(...trimmedConversation);

  return messages;
}

function stripThinkTags(text: string): string {
  // Jaga-jaga: buang tag <think>...</think> kalau masih kebawa dari model reasoning
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function askGroq(messages: ChatMessage[], model: string): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
      max_tokens: 1024,
      reasoning_format: "hidden",
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const rawAnswer = data.choices?.[0]?.message?.content ?? "";
  return stripThinkTags(rawAnswer);
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Terlalu banyak request. Coba lagi dalam ${rateCheck.retryAfterSec} detik.`,
        },
        { status: 429 }
      );
    }

    if (!GROQ_API_KEY || !TAVILY_API_KEY) {
      return NextResponse.json(
        { error: "Missing GROQ_API_KEY or TAVILY_API_KEY in environment variables." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const messages: ChatMessage[] = body.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Body harus berisi 'messages' berupa array non-kosong." },
        { status: 400 }
      );
    }

    const lastMessage = messages[messages.length - 1];
    const hasImage = lastMessage ? messageHasImage(lastMessage) : false;

    let searchResults: TavilyResult[] = [];
    let searchContext: ChatMessage | null = null;

    // Kalau ada gambar, lewati pencarian web (fokus ke analisis gambar saja)
    if (!hasImage) {
      const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
      if (lastUserMessage) {
        try {
          searchResults = await searchTavily(extractText(lastUserMessage));
        } catch (searchErr) {
          console.error("Tavily search failed:", searchErr);
        }
      }
      searchContext = buildContextMessage(searchResults);
    }

    const groqMessages = buildGroqMessages(messages, searchContext);
    const model = hasImage ? VISION_MODEL : TEXT_MODEL;
    const answer = await askGroq(groqMessages, model);

    return NextResponse.json({
      answer,
      sources: searchResults.map((r) => ({ title: r.title, url: r.url })),
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
}