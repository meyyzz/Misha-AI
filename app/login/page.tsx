// app/login/page.tsx
"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/AuthContext";

export default function LoginPage() {
  useEffect(() => {
    const saved = localStorage.getItem("misha-ai-theme");
    const initial =
      saved === "dark" || saved === "light"
        ? saved
        : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  const router = useRouter();
  const { signIn, signUp, signInWithGoogle } = useAuth();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function friendlyError(code: string): string {
    if (code.includes("auth/invalid-email")) return "Format email tidak valid.";
    if (code.includes("auth/user-not-found") || code.includes("auth/wrong-password") || code.includes("auth/invalid-credential"))
      return "Email atau password salah.";
    if (code.includes("auth/email-already-in-use")) return "Email ini sudah terdaftar. Coba login.";
    if (code.includes("auth/weak-password")) return "Password terlalu lemah (minimal 6 karakter).";
    if (code.includes("auth/popup-closed-by-user")) return "Login Google dibatalkan.";
    return "Terjadi kesalahan. Coba lagi.";
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
      router.push("/");
    } catch (err: any) {
      setError(friendlyError(err?.code ?? ""));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      router.push("/");
    } catch (err: any) {
      setError(friendlyError(err?.code ?? ""));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <span style={{ fontSize: "2rem" }}>🌸</span>
          <h1>Misha AI</h1>
          <p>{mode === "login" ? "Masuk ke akun kamu" : "Buat akun baru"}</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            disabled={loading}
          />

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="btn" disabled={loading}>
            {loading ? "Memproses..." : mode === "login" ? "Masuk" : "Daftar"}
          </button>
        </form>

        <div className="login-divider">
          <span>atau</span>
        </div>

        <button className="google-btn" onClick={handleGoogle} disabled={loading} type="button">
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5h-1.9V20.4H24v7.2h11.3c-1.6 4.6-6 7.9-11.3 7.9-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.1-5.1C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5Z"/>
            <path fill="#FF3D00" d="m6.3 14.7 5.9 4.3C13.8 15.4 18.5 12.4 24 12.4c3.1 0 5.9 1.2 8 3.1l5.1-5.1C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7Z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.6 2.3-7.2 2.3-5.3 0-9.7-3.3-11.3-7.9l-6.1 4.7C9.7 39.6 16.3 44 24 44Z"/>
            <path fill="#1976D2" d="M43.6 20.5h-1.9V20.4H24v7.2h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.2 5.2C40.9 35.5 44 30.2 44 24c0-1.2-.1-2.4-.4-3.5Z"/>
          </svg>
          Lanjutkan dengan Google
        </button>

        <p className="login-toggle">
          {mode === "login" ? "Belum punya akun?" : "Sudah punya akun?"}{" "}
          <button
            type="button"
            className="login-toggle-link"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Daftar di sini" : "Masuk di sini"}
          </button>
        </p>
      </div>
    </div>
  );
}