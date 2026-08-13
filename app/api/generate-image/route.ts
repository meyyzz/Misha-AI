import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const prompt = searchParams.get("prompt");

    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: "Prompt gambar kosong." },
        { status: 400 }
      );
    }

    const url =
      `https://gen.pollinations.ai/image/` +
      `${encodeURIComponent(prompt)}` +
      `?model=flux`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Pollinations error:", await response.text());

      return NextResponse.json(
        { error: "Gagal membuat gambar." },
        { status: response.status }
      );
    }

    const image = await response.arrayBuffer();

    return new Response(image, {
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Generate image error:", error);

    return NextResponse.json(
      { error: "Terjadi kesalahan saat membuat gambar." },
      { status: 500 }
    );
  }
}