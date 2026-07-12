// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../lib/AuthContext";

export const metadata: Metadata = {
  title: "Misha AI",
  description: "Aplikasi dengan tema soft pink",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}