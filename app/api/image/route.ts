import { NextResponse } from "next/server";

// Reference-image generation with a quality-first provider chain:
//   1. FAL_KEY set          -> fal.ai FLUX.1 [dev]   (best quality, ~$0.025/img)
//   2. GEMINI_API_KEY set   -> gemini-2.5-flash-image (great quality, free tier)
//   3. otherwise            -> Pollinations Flux      (free fallback, enhanced)
// The image anchors the world model: HappyOyster (firstFrameImage) or
// LingBot World 2 (set_image). Target: 1664x960 landscape.

const WIDTH = 1664;
const HEIGHT = 960;

async function generateWithFal(prompt: string, key: string): Promise<ArrayBuffer> {
  const model = process.env.FAL_IMAGE_MODEL ?? "fal-ai/flux/dev";
  const r = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_size: { width: WIDTH, height: HEIGHT },
      num_inference_steps: 28,
      guidance_scale: 3.5,
      num_images: 1,
      enable_safety_checker: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`fal.ai failed (${r.status}): ${await r.text()}`);
  const data = await r.json();
  const url: string | undefined = data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no image");
  const img = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!img.ok) throw new Error(`fal.ai image download failed (${img.status})`);
  return img.arrayBuffer();
}

async function generateWithGemini(prompt: string, key: string): Promise<ArrayBuffer> {
  const model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Generate a single wide 16:9 landscape image (1664x960). ${prompt}`,
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    }
  );
  if (!r.ok) throw new Error(`Gemini failed (${r.status}): ${await r.text()}`);
  const data = await r.json();
  const parts: Array<{ inlineData?: { data: string } }> =
    data?.candidates?.[0]?.content?.parts ?? [];
  const b64 = parts.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) throw new Error("Gemini returned no image");
  return Buffer.from(b64, "base64").buffer as ArrayBuffer;
}

async function generateWithPollinations(prompt: string): Promise<ArrayBuffer> {
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt.slice(0, 600)
  )}?width=${WIDTH}&height=${HEIGHT}&nologo=true&seed=${seed}&model=flux&enhance=true`;
  const r = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`Pollinations failed (${r.status})`);
  return r.arrayBuffer();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const prompt = searchParams.get("prompt")?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const falKey = process.env.FAL_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const providers: Array<{ name: string; run: () => Promise<ArrayBuffer> }> = [];
  if (falKey) providers.push({ name: "fal", run: () => generateWithFal(prompt, falKey) });
  if (geminiKey)
    providers.push({ name: "gemini", run: () => generateWithGemini(prompt, geminiKey) });
  providers.push({ name: "pollinations", run: () => generateWithPollinations(prompt) });

  console.log(`[image] start — providers: ${providers.map((p) => p.name).join(" → ")}`);
  const t0 = Date.now();
  let lastError: unknown = null;
  for (const p of providers) {
    const tp = Date.now();
    try {
      const buf = await p.run();
      console.log(
        `[image] ✓ ${p.name} in ${Date.now() - tp}ms (${Math.round(buf.byteLength / 1024)} KB, total ${Date.now() - t0}ms)`
      );
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=3600",
          "X-Image-Provider": p.name,
        },
      });
    } catch (e) {
      console.warn(`[image] ✗ ${p.name} failed in ${Date.now() - tp}ms:`, e);
      lastError = e;
    }
  }

  return NextResponse.json(
    { error: `All image providers failed: ${String(lastError)}` },
    { status: 502 }
  );
}
