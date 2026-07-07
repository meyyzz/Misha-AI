// app/page.tsx
"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: { title: string; url: string }[];
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Halo 👋 Aku Misha AI. Tanyakan apa saja 😊" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const query = input.trim();
    if (!query || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `⚠️ Error: ${data.error ?? "Terjadi kesalahan."}` },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.answer, sources: data.sources },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ Gagal terhubung ke server." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") sendMessage();
  }

  return (
    <main
      style={{
        maxWidth: "640px",
        margin: "0 auto",
        padding: "2rem 1rem",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.25rem" }}>
        <span style={{ fontSize: "1.75rem" }}>🌸</span>
        <h1 style={{ margin: 0 }}>Misha AI</h1>
      </header>
      <p style={{ marginBottom: "1.5rem", fontSize: "0.9rem" }}>Powered by Groq + Tavily</p>

      <div
        className="card"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          marginBottom: "1rem",
          minHeight: "300px",
          maxHeight: "60vh",
          overflowY: "auto",
        }}
      >
        {messages.map((m, i) => (
          <div key={i}>
            <strong style={{ fontSize: "0.85rem" }}>
              {m.role === "user" ? "Kamu" : "🌸 Misha AI"}
            </strong>
            <p style={{ margin: "0.25rem 0 0 0", color: "var(--color-text)" }}>{m.content}</p>
            {m.sources && m.sources.length > 0 && (
              <ul style={{ marginTop: "0.5rem", paddingLeft: "1.2rem", fontSize: "0.8rem" }}>
                {m.sources.map((s, j) => (
                  <li key={j}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {loading && <p style={{ fontStyle: "italic" }}>Misha sedang mengetik...</p>}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: "0.6rem" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tanyakan apa saja..."
          disabled={loading}
        />
        <button className="btn" onClick={sendMessage} disabled={loading}>
          Kirim
        </button>
      </div>
    </main>
  );
}
