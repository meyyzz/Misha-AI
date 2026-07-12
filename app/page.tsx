// app/page.tsx
"use client";

import { useState, useRef, useEffect, type ReactNode, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/AuthContext";

type Role = "user" | "assistant";

interface Message {
  role: Role;
  content: string;
  image?: string; // data URL gambar yang dilampirkan (kalau ada)
  file?: { name: string; content: string }; // file teks yang dilampirkan (kalau ada)
  sources?: { title: string; url: string }[];
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
}

type GroqContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface GroqMessage {
  role: Role;
  content: string | GroqContentPart[];
}

const MAX_HISTORY_MESSAGES = 20;
const MAX_INPUT_CHARS = 3000;
const STORAGE_KEY = "misha-ai-conversations";

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content: "Halo 👋 Aku Misha AI. Tanyakan apa saja, atau kirim gambar buat aku analisis 😊",
};

function createNewConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "Percakapan baru",
    messages: [WELCOME_MESSAGE],
  };
}

// Ubah history jadi format yang dikirim ke backend.
// Gambar & isi file cuma disertakan penuh untuk pesan TERAKHIR, biar payload tidak membengkak.
const MAX_FILE_CHARS = 15000;

function toGroqHistory(messages: Message[]): GroqMessage[] {
  return messages.map((m, i, arr) => {
    const isLast = i === arr.length - 1;

    // Susun teks: kalau ada file, sisipkan isinya sebelum pesan user
    let textContent = m.content;
    if (m.file && isLast) {
      const truncated = m.file.content.slice(0, MAX_FILE_CHARS);
      textContent = `Berikut isi file "${m.file.name}":\n\n${truncated}\n\n---\n\nPertanyaan/instruksi user: ${m.content || "Tolong jelaskan isi file ini."}`;
    } else if (m.file && !isLast) {
      textContent = `${m.content} [file terlampir: ${m.file.name}]`;
    }

    if (m.image && isLast) {
      const parts: GroqContentPart[] = [];
      if (textContent) parts.push({ type: "text", text: textContent });
      parts.push({ type: "image_url", image_url: { url: m.image } });
      return { role: m.role, content: parts };
    }

    if (m.image && !isLast) {
      return { role: m.role, content: `${textContent} [gambar terlampir]` };
    }

    return { role: m.role, content: textContent };
  });
}

// ===== Markdown renderer ringan (tanpa dependency eksternal) =====
// Mendukung: **bold**, *italic*, `inline code`, code block ```, heading #/##/###,
// list "- " / "1. ", dan paragraf biasa. Cukup untuk kebutuhan jawaban chat AI.

function parseInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // urutan: inline code, bold, italic
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code key={`${keyPrefix}-${i++}`} className="inline-code">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`${keyPrefix}-${i++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={`${keyPrefix}-${i++}`}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function renderMarkdown(content: string): ReactNode[] {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block ```
    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // lewati baris penutup ```
      blocks.push(
        <pre key={`code-${blockKey++}`} className="md-code-block">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const key = `h-${blockKey++}`;
      if (level === 1) blocks.push(<h3 key={key} className="md-heading">{parseInline(text, key)}</h3>);
      else if (level === 2) blocks.push(<h4 key={key} className="md-heading">{parseInline(text, key)}</h4>);
      else blocks.push(<h5 key={key} className="md-heading">{parseInline(text, key)}</h5>);
      i++;
      continue;
    }

    // List (unordered atau ordered), kumpulkan baris berurutan
    if (/^(\s*[-*]\s+)/.test(line) || /^(\s*\d+\.\s+)/.test(line)) {
      const isOrdered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (
        i < lines.length &&
        (isOrdered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*]\s+/.test(lines[i]))
      ) {
        const itemText = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "");
        items.push(itemText);
        i++;
      }
      const key = `list-${blockKey++}`;
      const ListTag = isOrdered ? "ol" : "ul";
      blocks.push(
        <ListTag key={key} className="md-list">
          {items.map((item, idx) => (
            <li key={`${key}-${idx}`}>{parseInline(item, `${key}-${idx}`)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    // Baris kosong
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraf biasa: gabungkan baris berurutan sampai ketemu baris kosong/blok lain
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    const key = `p-${blockKey++}`;
    blocks.push(<p key={key} className="md-paragraph">{parseInline(paraLines.join(" "), key)}</p>);
  }

  return blocks;
}

function MarkdownContent({ text }: { text: string }) {
  return <div className="md-content">{renderMarkdown(text)}</div>;
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<{ name: string; content: string } | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [openSources, setOpenSources] = useState<Set<number>>(new Set());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);

  // Redirect ke /login kalau belum login
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  // Load preferensi tema (localStorage, fallback ke preferensi sistem)
  useEffect(() => {
    const saved = localStorage.getItem("misha-ai-theme");
    const initial =
      saved === "dark" || saved === "light"
        ? saved
        : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("misha-ai-theme", next);
  }

  // ===== Voice input (Web Speech API bawaan browser) =====
  useEffect(() => {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setSpeechSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "id-ID";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript).slice(0, MAX_INPUT_CHARS));
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  }, []);

  function toggleVoiceInput() {
    if (!speechSupported || !recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    }
  }

  const storageKey = user ? `${STORAGE_KEY}-${user.uid}` : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed: Conversation[] = JSON.parse(saved);
        if (parsed.length > 0) {
          setConversations(parsed);
          setActiveId(parsed[0].id);
          setInitializing(false);
          return;
        }
      }
    } catch {
      // abaikan, lanjut buat percakapan baru
    }
    const fresh = createNewConversation();
    setConversations([fresh]);
    setActiveId(fresh.id);
    setInitializing(false);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || conversations.length === 0) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(conversations));
    } catch {
      // storage penuh/tidak tersedia
    }
  }, [conversations, storageKey]);

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation?.messages.length, loading]);

  function updateConversationMessages(id: string, messages: Message[]) {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, messages } : c)));
  }

  function updateConversationTitle(id: string, title: string) {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }

  function handleNewChat() {
    const fresh = createNewConversation();
    setConversations((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
    setInput("");
    setPendingImage(null);
  }

  function handleSelectConversation(id: string) {
    setActiveId(id);
  }

  function handleDeleteConversation(id: string, e: MouseEvent) {
    e.stopPropagation();
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (filtered.length === 0) {
        const fresh = createNewConversation();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (activeId === id) setActiveId(filtered[0].id);
      return filtered;
    });
  }

  function handlePickImage() {
    setAttachMenuOpen(false);
    fileInputRef.current?.click();
  }

  function handlePickFile() {
    setAttachMenuOpen(false);
    docInputRef.current?.click();
  }

  function handleImageSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setPendingImage(reader.result as string);
    };
    reader.readAsDataURL(file);

    e.target.value = "";
  }

  function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert("Ukuran file terlalu besar (maks 2MB). Coba file yang lebih kecil.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      // Deteksi kasar: kalau hasil baca banyak karakter aneh, kemungkinan file biner (PDF/DOCX/dll)
      const isLikelyBinary = /[\x00-\x08\x0E-\x1F]/.test(content.slice(0, 1000));
      if (isLikelyBinary) {
        alert(
          "File ini sepertinya bukan file teks biasa (misalnya PDF/DOCX). Untuk saat ini hanya file teks (.txt, .md, .csv, .json, .js, .py, dll) yang didukung."
        );
        return;
      }
      setPendingFile({ name: file.name, content });
    };
    reader.readAsText(file);

    e.target.value = "";
  }

  function handleRemovePendingFile() {
    setPendingFile(null);
  }

  function handleRemovePendingImage() {
    setPendingImage(null);
  }

  async function handleCopy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((prev) => (prev === index ? null : prev)), 1500);
    } catch {
      // clipboard tidak tersedia
    }
  }

  function toggleSources(index: number) {
    setOpenSources((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function submitMessages(conversationId: string, updatedMessages: Message[]) {
    setLoading(true);
    try {
      const historyToSend = toGroqHistory(updatedMessages.slice(-MAX_HISTORY_MESSAGES));
      const idToken = user ? await user.getIdToken() : null;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ messages: historyToSend }),
      });

      const data = await res.json();

      const assistantMessage: Message = !res.ok
        ? { role: "assistant", content: `⚠️ Error: ${data.error ?? "Terjadi kesalahan."}` }
        : { role: "assistant", content: data.answer, sources: data.sources };

      updateConversationMessages(conversationId, [...updatedMessages, assistantMessage]);
    } catch {
      updateConversationMessages(conversationId, [
        ...updatedMessages,
        { role: "assistant", content: "⚠️ Gagal terhubung ke server." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    const query = input.trim();
    if ((!query && !pendingImage && !pendingFile) || loading || !activeConversation) return;

    const conversationId = activeConversation.id;
    const newUserMessage: Message = {
      role: "user",
      content: query,
      image: pendingImage ?? undefined,
      file: pendingFile ?? undefined,
    };
    const updatedMessages: Message[] = [...activeConversation.messages, newUserMessage];
    updateConversationMessages(conversationId, updatedMessages);

    if (activeConversation.title === "Percakapan baru") {
      const titleSource = query || pendingFile?.name || "Gambar";
      updateConversationTitle(
        conversationId,
        titleSource.length > 40 ? titleSource.slice(0, 40) + "..." : titleSource
      );
    }

    setInput("");
    setPendingImage(null);
    setPendingFile(null);

    await submitMessages(conversationId, updatedMessages);
  }

  function handleStartEdit(index: number, currentText: string) {
    if (loading) return;
    setEditingIndex(index);
    setEditingText(currentText);
  }

  function handleCancelEdit() {
    setEditingIndex(null);
    setEditingText("");
  }

  async function handleSaveEdit(index: number) {
    const newText = editingText.trim();
    if (!newText || !activeConversation) return;

    const conversationId = activeConversation.id;
    const originalMessage = activeConversation.messages[index];

    // Potong semua pesan setelah pesan yang diedit, lalu ganti isi pesan itu
    const editedMessage: Message = { ...originalMessage, content: newText };
    const updatedMessages: Message[] = [
      ...activeConversation.messages.slice(0, index),
      editedMessage,
    ];

    updateConversationMessages(conversationId, updatedMessages);
    setEditingIndex(null);
    setEditingText("");

    await submitMessages(conversationId, updatedMessages);
  }

  async function handleRegenerate(assistantIndex: number) {
    if (!activeConversation || loading) return;

    // Cari pesan user tepat sebelum balasan AI ini, lalu potong dari situ dan minta jawaban baru
    const userIndex = assistantIndex - 1;
    if (userIndex < 0 || activeConversation.messages[userIndex].role !== "user") return;

    const conversationId = activeConversation.id;
    const truncatedMessages = activeConversation.messages.slice(0, assistantIndex);

    updateConversationMessages(conversationId, truncatedMessages);
    await submitMessages(conversationId, truncatedMessages);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") sendMessage();
  }

  if (authLoading || !user || initializing || !activeConversation) {
    return (
      <div className="splash-screen">
        <span className="splash-emoji">🌸</span>
        <div className="splash-text">Memuat Misha AI...</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-header">
          <button className="new-chat-btn" onClick={handleNewChat}>
            + Percakapan baru
          </button>
        </div>
        <div className="sidebar-list">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`sidebar-item ${c.id === activeId ? "active" : ""}`}
              onClick={() => handleSelectConversation(c.id)}
            >
              <span className="sidebar-item-title">{c.title}</span>
              <button
                className="sidebar-item-delete"
                onClick={(e) => handleDeleteConversation(c.id, e)}
                aria-label="Hapus percakapan"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <span className="sidebar-user-email" title={user.email ?? ""}>
            {user.email}
          </span>
          <button
            className="sidebar-logout-btn"
            onClick={async () => {
              await logout();
              router.push("/login");
            }}
            aria-label="Keluar"
            title="Keluar"
          >
            <LogoutIcon />
          </button>
        </div>
      </aside>

      <div className="chat-main">
        <header className="chat-header">
          <button
            className="menu-toggle-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Buka/tutup riwayat chat"
          >
            ☰
          </button>
          <span style={{ fontSize: "1.5rem" }}>🌸</span>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.15rem" }}>Misha AI</h1>
            <p style={{ margin: 0, fontSize: "0.75rem" }}>Powered by Groq + Tavily</p>
          </div>
          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Ganti ke dark mode" : "Ganti ke light mode"}
            title={theme === "light" ? "Dark mode" : "Light mode"}
          >
            {theme === "light" ? <MoonIcon /> : <SunIcon />}
          </button>
        </header>

        <div className="chat-scroll">
          {activeConversation.messages.map((m, i) => (
            <div key={i} className={`bubble-row ${m.role}`}>
              <div className="bubble-wrap">
                {editingIndex === i ? (
                  <div className="bubble-edit-box">
                    <input
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit(i);
                        if (e.key === "Escape") handleCancelEdit();
                      }}
                      autoFocus
                    />
                    <div className="bubble-edit-actions">
                      <button className="btn-ghost" onClick={handleCancelEdit}>
                        Batal
                      </button>
                      <button className="btn" onClick={() => handleSaveEdit(i)}>
                        Kirim ulang
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={`bubble ${m.role}`}>
                      {m.image && (
                        <img src={m.image} alt="Lampiran gambar" className="bubble-image" />
                      )}
                      {m.file && (
                        <div className="bubble-file-chip">
                          <FileIcon /> {m.file.name}
                        </div>
                      )}
                      {m.role === "assistant" ? <MarkdownContent text={m.content} /> : m.content}

                      {m.sources && m.sources.length > 0 && (
                        <div className="bubble-sources-toggle-wrap">
                          <button
                            className="bubble-sources-toggle"
                            onClick={() => toggleSources(i)}
                          >
                            Sumber ({m.sources.length}) <ChevronIcon open={openSources.has(i)} />
                          </button>
                          {openSources.has(i) && (
                            <div className="bubble-sources">
                              {m.sources.map((s, j) => (
                                <a key={j} href={s.url} target="_blank" rel="noopener noreferrer">
                                  {s.title}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="bubble-actions">
                      {m.role === "user" && (
                        <button
                          className="copy-icon-btn"
                          onClick={() => handleStartEdit(i, m.content)}
                          aria-label="Edit pesan"
                          title="Edit"
                        >
                          <EditIcon />
                        </button>
                      )}
                      {m.role === "assistant" &&
                        i === activeConversation.messages.length - 1 && (
                          <button
                            className="copy-icon-btn"
                            onClick={() => handleRegenerate(i)}
                            aria-label="Jawab ulang"
                            title="Regenerate"
                          >
                            <RegenerateIcon />
                          </button>
                        )}
                      <button
                        className="copy-icon-btn"
                        onClick={() => handleCopy(m.content, i)}
                        aria-label="Salin pesan"
                        title="Salin"
                      >
                        {copiedIndex === i ? <CheckIcon /> : <CopyIcon />}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="bubble-row assistant">
              <div className="bubble-wrap">
                <div className="bubble assistant">
                  <span className="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="chat-input-bar">
          <div className="chat-input-bar-inner">
            {pendingImage && (
              <div className="pending-image-preview">
                <img src={pendingImage} alt="Preview gambar" />
                <button onClick={handleRemovePendingImage} aria-label="Hapus gambar">
                  ✕
                </button>
              </div>
            )}
            {pendingFile && (
              <div className="pending-file-preview">
                <FileIcon />
                <span>{pendingFile.name}</span>
                <button onClick={handleRemovePendingFile} aria-label="Hapus file">
                  ✕
                </button>
              </div>
            )}
            <div className="chat-input-row">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelected}
                style={{ display: "none" }}
              />
              <input
                ref={docInputRef}
                type="file"
                accept=".txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.xml,.log,.yaml,.yml"
                onChange={handleFileSelected}
                style={{ display: "none" }}
              />

              <div className="attach-menu-wrap">
                <button
                  className="attach-btn"
                  onClick={() => setAttachMenuOpen((v) => !v)}
                  aria-label="Lampirkan file"
                  title="Lampirkan"
                  disabled={loading}
                >
                  <PlusIcon />
                </button>

                {attachMenuOpen && (
                  <>
                    <div
                      className="attach-menu-backdrop"
                      onClick={() => setAttachMenuOpen(false)}
                    />
                    <div className="attach-menu">
                      <button onClick={handlePickImage}>
                        <ImageIcon /> Upload Gambar
                      </button>
                      <button onClick={handlePickFile}>
                        <FileIcon /> Upload File
                      </button>
                    </div>
                  </>
                )}
              </div>

              {speechSupported && (
                <button
                  className={`mic-btn ${isListening ? "mic-btn-active" : ""}`}
                  onClick={toggleVoiceInput}
                  aria-label={isListening ? "Berhenti merekam" : "Input suara"}
                  title={isListening ? "Berhenti merekam" : "Input suara"}
                  disabled={loading}
                  type="button"
                >
                  <MicIcon />
                </button>
              )}

              <div className="chat-input-field-wrap">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_CHARS))}
                  onKeyDown={handleKeyDown}
                  placeholder={isListening ? "Mendengarkan..." : "Tanyakan apa saja..."}
                  disabled={loading}
                  maxLength={MAX_INPUT_CHARS}
                />
                {input.length > MAX_INPUT_CHARS * 0.8 && (
                  <span
                    className={`char-counter ${
                      input.length >= MAX_INPUT_CHARS ? "char-counter-limit" : ""
                    }`}
                  >
                    {input.length}/{MAX_INPUT_CHARS}
                  </span>
                )}
              </div>
              <button className="btn" onClick={sendMessage} disabled={loading}>
                Kirim
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}