import { promises as fs } from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────
// 🔨 P2 Prop Foundry — compile-once, cache-forever prop compiler.
//
//   prompt → reference image (square, isolated, white background)
//          → TRELLIS image-to-3D → textured GLB → public/props/<slug>.glb
//
// The runtime upgrades spec objects from primitives to real GLBs when
// obj.model is set. Compiled GLBs are plain files in git — generated ONCE,
// served at $0 forever (the whole point of the foundry).
//
// Providers (FOUNDRY_PROVIDER):
//   "modal" — SELF-HOSTED TRELLIS.2-4B on our Modal L4 (default when
//             TRELLIS_MODAL_URL is set; FAL_KEY is empty so this is the
//             primary). Ref image chain: FAL → Gemini → Pollinations.
//   "fal"   — legacy hosted path (FLUX ref + fal-ai/trellis). Kept as
//             fallback if FAL_KEY ever returns.
// ─────────────────────────────────────────────────────────────────────────

const PROPS_DIR = path.join(process.cwd(), "public", "props");

export interface ForgeResult {
  slug: string;
  url: string; // "/props/<slug>.glb"
  bytes: number;
  ms: number;
  cached: boolean;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "prop"
  );
}

/** Is a foundry provider fully configured? (Director step gates on this.) */
export function foundryConfigured(): boolean {
  const provider = (
    process.env.FOUNDRY_PROVIDER ?? (process.env.TRELLIS_MODAL_URL ? "modal" : "fal")
  ).toLowerCase();
  if (provider === "modal")
    return Boolean(process.env.TRELLIS_MODAL_URL && process.env.FOUNDRY_SHARED_SECRET);
  return Boolean(process.env.FAL_KEY);
}

// Reference image: a SINGLE object, isolated — TRELLIS hates scenes/clutter.
async function falImage(prompt: string, key: string): Promise<string> {
  const model = process.env.FAL_IMAGE_MODEL ?? "fal-ai/flux/dev";
  const r = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: `A single ${prompt}, centered, fully visible, isolated on a plain pure white background, studio product photograph, soft even lighting, no background shadows, no text, no watermark`,
      image_size: { width: 1024, height: 1024 },
      num_inference_steps: 28,
      guidance_scale: 3.5,
      num_images: 1,
      enable_safety_checker: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`fal image failed (${r.status}): ${await r.text()}`);
  const data = await r.json();
  const url: string | undefined = data?.images?.[0]?.url;
  if (!url) throw new Error("fal image returned no url");
  return url;
}

// TRELLIS image-to-3D → textured GLB (budget: 1024px texture, 95% simplify
// per the expert asset rules — mid-distance props, not hero 4K).
async function falTrellis(imageUrl: string, key: string): Promise<ArrayBuffer> {
  const r = await fetch("https://fal.run/fal-ai/trellis", {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      mesh_simplify: 0.95,
      texture_size: 1024,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!r.ok) throw new Error(`trellis failed (${r.status}): ${await r.text()}`);
  const data = await r.json();
  const url: string | undefined = data?.model_mesh?.url;
  if (!url) throw new Error("trellis returned no mesh");
  const glb = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!glb.ok) throw new Error(`glb download failed (${glb.status})`);
  return glb.arrayBuffer();
}

// ── Modal provider: self-hosted TRELLIS.2-4B (modal/trellis2_app.py) ──────

// One isolated object on white — TRELLIS hates scenes/clutter. Square 1024.
const REF_PROMPT = (prompt: string) =>
  `A single ${prompt}, centered, fully visible, isolated on a plain pure white background, studio product photograph, soft even lighting, no background shadows, no text, no watermark, square format`;

async function geminiRefImage(prompt: string, key: string): Promise<Buffer> {
  const model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: REF_PROMPT(prompt) }] }],
      }),
      signal: AbortSignal.timeout(120_000),
    }
  );
  if (!r.ok) throw new Error(`Gemini ref image failed (${r.status}): ${await r.text()}`);
  const data = await r.json();
  const parts: Array<{ inlineData?: { data: string } }> =
    data?.candidates?.[0]?.content?.parts ?? [];
  const b64 = parts.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) throw new Error("Gemini returned no image");
  return Buffer.from(b64, "base64");
}

async function pollinationsRefImage(prompt: string): Promise<Buffer> {
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    REF_PROMPT(prompt).slice(0, 600)
  )}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux&enhance=true`;
  const r = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`Pollinations ref image failed (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

// Reference image for the Modal path: FAL → Gemini → Pollinations (first
// configured wins). Returns raw image bytes for the TRELLIS POST.
async function refImage(prompt: string): Promise<Buffer> {
  const falKey = process.env.FAL_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const providers: Array<{ name: string; run: () => Promise<Buffer> }> = [];
  if (falKey)
    providers.push({
      name: "fal",
      run: async () => {
        const url = await falImage(prompt, falKey);
        const img = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!img.ok) throw new Error(`fal image download failed (${img.status})`);
        return Buffer.from(await img.arrayBuffer());
      },
    });
  if (geminiKey)
    providers.push({ name: "gemini", run: () => geminiRefImage(prompt, geminiKey) });
  providers.push({ name: "pollinations", run: () => pollinationsRefImage(prompt) });

  let lastError: unknown = null;
  for (const p of providers) {
    try {
      const buf = await p.run();
      console.log(`[foundry] ref image ✓ ${p.name} (${Math.round(buf.length / 1024)}KB)`);
      return buf;
    } catch (e) {
      console.warn(`[foundry] ref image ✗ ${p.name}:`, e);
      lastError = e;
    }
  }
  throw new Error(`All ref-image providers failed: ${String(lastError)}`);
}

// TRELLIS.2-4B on our own Modal L4: image bytes → GLB bytes.
// Cold-start tolerant: scale-to-zero means the first call boots a container
// (~2.5 min model load) before forging (~4-5 min). Budget 10 min.
async function modalTrellis(image: Buffer): Promise<ArrayBuffer> {
  const url = process.env.TRELLIS_MODAL_URL;
  const key = process.env.FOUNDRY_SHARED_SECRET;
  if (!url) throw new Error("TRELLIS_MODAL_URL not set — deploy modal/trellis2_app.py first");
  if (!key) throw new Error("FOUNDRY_SHARED_SECRET not set — foundry endpoint auth missing");
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Foundry-Key": key },
    body: JSON.stringify({ image_b64: image.toString("base64") }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!r.ok) throw new Error(`modal trellis failed (${r.status}): ${await r.text()}`);
  return r.arrayBuffer();
}

/** Slugs of every compiled prop currently in the cache (no .glb extension). */
export async function listCachedProps(): Promise<string[]> {
  try {
    const files = await fs.readdir(PROPS_DIR);
    return files.filter((f) => f.endsWith(".glb")).map((f) => f.slice(0, -4));
  } catch {
    return [];
  }
}

/**
 * Cache-only lookup: return the first candidate slug that already has a GLB
 * on disk, or null. NEVER touches a GPU — used to reuse props when the LLM
 * invents a fresh id for an object we already forged under another name.
 */
export async function peekCachedProp(
  candidates: string[]
): Promise<ForgeResult | null> {
  for (const slug of candidates) {
    if (!slug) continue;
    try {
      const stat = await fs.stat(path.join(PROPS_DIR, `${slug}.glb`));
      if (stat.size > 0)
        return { slug, url: `/props/${slug}.glb`, bytes: stat.size, ms: 0, cached: true };
    } catch {
      /* not on disk — try the next candidate */
    }
  }
  return null;
}

/** Compile a prop to GLB (or return the cached one). Throws on failure. */
export async function forgeProp(prompt: string, slug = slugify(prompt)): Promise<ForgeResult> {
  const t0 = Date.now();
  await fs.mkdir(PROPS_DIR, { recursive: true });
  const file = path.join(PROPS_DIR, `${slug}.glb`);
  const url = `/props/${slug}.glb`;

  try {
    const stat = await fs.stat(file);
    if (stat.size > 0) {
      return { slug, url, bytes: stat.size, ms: Date.now() - t0, cached: true };
    }
  } catch {
    /* not cached — compile it */
  }

  const provider = (
    process.env.FOUNDRY_PROVIDER ?? (process.env.TRELLIS_MODAL_URL ? "modal" : "fal")
  ).toLowerCase();

  if (provider === "modal") {
    try {
      const image = await refImage(prompt);
      const glb = await modalTrellis(image);
      await fs.writeFile(file, Buffer.from(glb));
      return { slug, url, bytes: glb.byteLength, ms: Date.now() - t0, cached: false };
    } catch (e) {
      if (!process.env.FAL_KEY) throw e;
      console.warn("[foundry] modal provider failed, falling back to FAL:", e);
    }
  }

  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not set — foundry has no provider");

  const imageUrl = await falImage(prompt, key);
  const glb = await falTrellis(imageUrl, key);
  await fs.writeFile(file, Buffer.from(glb));
  return { slug, url, bytes: glb.byteLength, ms: Date.now() - t0, cached: false };
}
