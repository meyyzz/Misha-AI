// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TAVILY_URL = "https://api.tavily.com/search";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
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

async function askGroq(query: string, context: TavilyResult[]) {
  const contextText = context
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`)
    .join("\n\n");

  const systemPrompt = `You are a helpful assistant. Use the following web search results to answer the user's question. Cite sources using [1], [2], etc. where relevant.\n\n${contextText}`;

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
      temperature: 0.4,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export async function POST(req: NextRequest) {
  try {
    if (!GROQ_API_KEY || !TAVILY_API_KEY) {
      return NextResponse.json(
        { error: "Missing GROQ_API_KEY or TAVILY_API_KEY in environment variables." },
        { status: 500 }
      );
    }

    const { query } = await req.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Missing 'query' in request body." }, { status: 400 });
    }

    const searchResults = await searchTavily(query);
    const answer = await askGroq(query, searchResults);

    return NextResponse.json({
      answer,
      sources: searchResults.map((r) => ({ title: r.title, url: r.url })),
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
}