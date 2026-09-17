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
//             primary). References also use Modal FLUX; no external fallback.
//   "fal"   — legacy hosted path (FLUX ref + fal-ai/trellis). Kept as
//             explicit legacy provider only; never a fallback from Modal.
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
    return Boolean(process.env.TRELLIS_MODAL_URL && process.env.FLUX_MODAL_URL && process.env.FOUNDRY_SHARED_SECRET);
  return provider === "fal" && Boolean(process.env.FAL_KEY);
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

// Phase C: OUR OWN FLUX.2-klein-4B on Modal (modal/flux_ref_app.py) —
// Apache 2.0, ~1-3s per 1024² image, no 429s, parallel-safe. This is the
// Only reference-image provider on the Modal foundry path.
async function modalFluxRefImage(prompt: string): Promise<Buffer> {
  const url = process.env.FLUX_MODAL_URL;
  const key = process.env.FOUNDRY_SHARED_SECRET;
  if (!url) throw new Error("FLUX_MODAL_URL not set — deploy modal/flux_ref_app.py first");
  if (!key) throw new Error("FOUNDRY_SHARED_SECRET not set — foundry endpoint auth missing");
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Foundry-Key": key },
    body: JSON.stringify({ prompt: REF_PROMPT(prompt) }),
    signal: AbortSignal.timeout(300_000), // cold-start tolerant (boot+load ~1-2 min)
  });
  if (!r.ok) throw new Error(`modal flux failed (${r.status}): ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer()); // raw PNG bytes
}

// Modal-only reference generation: a failure must not disclose prompts to another provider.
async function refImage(prompt: string): Promise<Buffer> {
  return modalFluxRefImage(prompt);
}

// TRELLIS.2-4B on our own Modal L4: image bytes → GLB bytes.
// Cold-start tolerant: scale-to-zero means the first call boots a container
// (~2.5 min model load) before forging (~4-5 min). Budget 10 min.
async function modalTrellis(image: Buffer): Promise<ArrayBuffer> {
  const url = process.env.TRELLIS_MODAL_URL;
  const key = process.env.FOUNDRY_SHARED_SECRET;
  if (!url) throw new Error("TRELLIS_MODAL_URL not set — deploy modal/trellis2_app.py first");
  if (!key) throw new Error("FOUNDRY_SHARED_SECRET not set — foundry endpoint auth missing");
  const body = JSON.stringify({ image_b64: image.toString("base64") });
  for (let attempt=0;attempt<2;attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Foundry-Key": key },
      body,
      signal: AbortSignal.timeout(600_000),
    });
    if (r.ok) return r.arrayBuffer();
    const detail=await r.text();
    // Observed during demo QA: Modal can lose a queued cold-start invocation.
    // Retry that explicit failure once, retaining the already-generated image.
    // Do not retry timeouts: those may still be expensive jobs running remotely.
    if (attempt===0 && (r.status===503 || r.status===502 || (r.status===500 && detail.includes("lost track of input")))) {
      console.warn(`[foundry] transient Modal ${r.status}; retrying the same reference image once`);
      await new Promise(resolve=>setTimeout(resolve,2000));
      continue;
    }
    throw new Error(`modal trellis failed (${r.status}): ${detail}`);
  }
  throw new Error("Modal forge retry exhausted");
}

function validateGLB(data:ArrayBuffer) {
  if(data.byteLength<20)throw new Error("Foundry returned an empty model");
  const header=new DataView(data);
  if(header.getUint32(0,true)!==0x46546c67 || header.getUint32(4,true)!==2 || header.getUint32(8,true)!==data.byteLength)
    throw new Error("Foundry returned an invalid GLB; it was not cached");
}

async function publishGLB(file:string,data:ArrayBuffer) {
  validateGLB(data);
  const temp=`${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp,Buffer.from(data));
  await fs.rename(temp,file);
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
    const image = await refImage(prompt);
    const glb = await modalTrellis(image);
    await publishGLB(file, glb);
    return { slug, url, bytes: glb.byteLength, ms: Date.now() - t0, cached: false };
  }
  if (provider !== "fal") throw new Error("Unsupported foundry provider");

  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not set — foundry has no provider");

  const imageUrl = await falImage(prompt, key);
  const glb = await falTrellis(imageUrl, key);
  await publishGLB(file,glb);
  return { slug, url, bytes: glb.byteLength, ms: Date.now() - t0, cached: false };
}
