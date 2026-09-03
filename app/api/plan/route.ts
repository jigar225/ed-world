import { NextResponse } from "next/server";

// Turns a student's topic ("I want to understand gravity") into:
//  1. an optimized HappyOyster world prompt (follows the official prompt guide)
//  2. a set of in-world missions that teach the concept
// Powered by Kimi through an OpenAI-compatible chat completions endpoint.

const SYSTEM_PROMPT = `You are the lesson-planning brain of an educational app where students EXPLORE AI-generated interactive 3D worlds to learn.

Given a student's learning topic, output ONLY valid JSON (no markdown, no commentary) with this exact shape:

{
  "title": "short lesson title, max 6 words",
  "summary": "2-3 friendly sentences explaining what the student will learn",
  "world_prompt": "the world generation prompt (max 1800 chars)",
  "image_prompt": "reference image prompt (max 600 chars)",
  "missions": [
    { "title": "short mission name", "description": "1-2 sentences", "hint": "1 sentence" }
  ]
}

== IMAGE_PROMPT RULES (paints the world's opening frame for a 1664x960 image model; it becomes the visual anchor of the generated world) ==
- A photorealistic, wide-angle ESTABLISHING SHOT of the exact scene the student starts in — what the camera sees in the first second.
- Compose like a film still: a strong foreground element, a layered midground, an epic background; rule of thirds; clear depth.
- Describe the same 3-6 anchors from world_prompt, with concrete light, weather, and surface textures.
- Always include camera + light language: "shot on 35mm lens, wide establishing shot, volumetric light" — then the mood (golden hour glow / cold blue mist / neon reflections — whatever fits the topic).
- Always end with quality cues: "high detail, sharp focus, cinematic color grading".
- The scene must be an environment only: landscape, interior, or microscopic vista. No humans, no faces, no text, no watermark, no UI.

== WORLD_PROMPT RULES (the engine builds a persistent, explorable, first-person 3D world from this one prompt; its effect is permanent) ==

Write it in this exact structure:
1. REGISTER — camera/realism vocabulary for a first-person exploration (e.g. "photorealistic first-person exploration", or a fitting stylized look for the topic).
2. SUBJECT — cast the student in SECOND PERSON: "You are ..." with concrete physical detail and a role tied to the topic (e.g. for gravity: "You are a student astronaut on a lunar test range, gloved hands and a white suit"). Never describe the subject from the outside.
3. WORLD — terrain, landmarks, sky, weather staged AROUND the subject. Commit to 3-6 recurring anchor elements, named early and referred back to. Place the educational objects as visible landmarks the student can walk up to.
4. DYNAMICS — things that move on their own (drifts, ripples, pulses, orbits, falls, floats, glows) so the world is alive before any input. The CORE CONCEPT must be visibly happening in the world (gravity: objects falling slowly, dust arcs, a floating vs dropped hammer; DNA: a rotating double helix, an unzipping replication fork).
5. STYLE — close with one short line of concrete photographic descriptors: light quality, weather, surface textures. Never quality words like "epic", "8K", "cinematic masterpiece".

HARD RULES:
- NEVER use negations ("no people", "empty", "without"): a negation still places its noun in the world's attention. Describe what OCCUPIES each region instead.
- Give the subject a simple objective or curiosity hook so there is a reason to move.
- 3-6 named anchors, repeated; no one-off detail lists.
- Max 1800 characters.

== MISSION RULES ==
- 4 to 6 missions the student performs INSIDE the world: walk to X, observe Y, compare Z, trigger/interact with something.
- Order them from basic observation to deeper understanding of the topic.
- Reference ONLY things that exist in the world_prompt.
- Each mission teaches one idea; together they teach the whole topic.`;

interface Mission {
  title: string;
  description: string;
  hint: string;
}

interface LessonPlan {
  title: string;
  summary: string;
  world_prompt: string;
  image_prompt: string;
  missions: Mission[];
}

function extractJson(text: string): LessonPlan {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model output");
  return JSON.parse(cleaned.slice(start, end + 1)) as LessonPlan;
}

export async function POST(req: Request) {
  const baseUrl = (process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1").replace(/\/$/, "");
  const model = process.env.KIMI_MODEL ?? "kimi-k3";

  // Two auth styles supported:
  //  1. Modal proxy auth (KIMI_MODAL_KEY ak-... + KIMI_MODAL_SECRET as-...)
  //  2. Plain Bearer token (KIMI_API_KEY) for OpenAI-compatible endpoints
  const modalKey = process.env.KIMI_MODAL_KEY;
  const modalSecret = process.env.KIMI_MODAL_SECRET;
  const apiKey = process.env.KIMI_API_KEY;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (modalKey && modalSecret) {
    headers["Modal-Key"] = modalKey;
    headers["Modal-Secret"] = modalSecret;
  } else if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    return NextResponse.json(
      { error: "No Kimi credentials set — set KIMI_MODAL_KEY/KIMI_MODAL_SECRET (Modal) or KIMI_API_KEY" },
      { status: 500 }
    );
  }

  let topic: string;
  try {
    const body = await req.json();
    topic = String(body?.topic ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const t0 = Date.now();
  console.log(`[plan] start — topic="${topic}" model=${model} @ ${baseUrl}`);

  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Student topic: "${topic}"` },
      ],
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    console.warn(`[plan] ✗ Kimi HTTP ${r.status} in ${Date.now() - t0}ms`);
    return NextResponse.json(
      { error: `Kimi request failed (${r.status}): ${text}` },
      { status: 502 }
    );
  }

  console.log(`[plan] Kimi responded in ${Date.now() - t0}ms`);
  const data = await r.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";

  try {
    const plan = extractJson(content);
    if (!plan.world_prompt || !Array.isArray(plan.missions)) {
      throw new Error("Missing world_prompt or missions");
    }
    plan.world_prompt = plan.world_prompt.slice(0, 1900);
    plan.image_prompt = (plan.image_prompt ?? plan.world_prompt).slice(0, 600);
    console.log(
      `[plan] ✓ done in ${Date.now() - t0}ms — "${plan.title}", ${plan.missions.length} missions`
    );
    return NextResponse.json({ topic, ...plan });
  } catch (e) {
    console.warn(`[plan] ✗ parse failed in ${Date.now() - t0}ms:`, e);
    return NextResponse.json(
      { error: `Could not parse lesson plan from model output: ${String(e)}`, raw: content },
      { status: 502 }
    );
  }
}
