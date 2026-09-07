import { NextResponse } from "next/server";
import { forgeProp, slugify } from "@/lib/foundry";

// P2 Prop Foundry — ad-hoc prop compiler.
//   POST { "prompt": "Apollo lunar lander…", "slug"?: "lunar_lander" }
//   → { ok, slug, url: "/props/<slug>.glb", bytes, ms, cached }
// The world route also calls forgeProp() directly at plan time (Director step).

export const maxDuration = 900; // Modal cold start ~2.5min + forge ~5min

export async function POST(req: Request) {
  let prompt: string;
  let slug: string | undefined;
  try {
    const body = await req.json();
    prompt = String(body?.prompt ?? "").trim();
    slug = body?.slug ? slugify(String(body.slug)) : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  const t0 = Date.now();
  console.log(`[foundry] start — "${prompt}"`);
  try {
    const result = await forgeProp(prompt, slug);
    console.log(
      `[foundry] ✓ ${result.slug} — ${Math.round(result.bytes / 1024)}KB, ` +
        `${result.cached ? "cached" : `compiled in ${Date.now() - t0}ms`}`
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.warn(`[foundry] ✗ failed in ${Date.now() - t0}ms:`, e);
    return NextResponse.json({ error: `Foundry failed: ${String(e)}` }, { status: 502 });
  }
}
