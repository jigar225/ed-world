import { NextResponse } from "next/server";
import { composeIdlePrompt, deriveSeedImagePrompt, LingbotScene } from "@/lib/lingbot";

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

const LINGBOT_SYSTEM_PROMPT = `You are the scene architect for an educational app where students explore AI-generated interactive 3D worlds. You write LAYERED scenes for the LingBot World 2 world model.

Given a student's topic, output ONLY valid JSON (no markdown) with this exact shape:

{
  "title": "short lesson title, max 6 words",
  "summary": "2-3 friendly sentences about what the student will learn",
  "base": "max 550 chars",
  "camera_static": "max 280 chars",
  "camera_dynamic": "max 280 chars",
  "movement_static": "max 330 chars",
  "movement_dynamic": "max 330 chars",
  "jump": "one sentence, symmetric arc: launch, airborne, landing",
  "crouch": "one sentence, camera lowers as viewpoint crouches",
  "events": [ { "key": "1", "name": "2-4 word label", "detail": "max 450 chars" } ],
  "seed_image_prompt": "max 550 chars",
  "missions": [ { "title": "short", "description": "1-2 sentences", "hint": "1 sentence", "event_key": "1" } ]
}

== HARD RULES (violating these produces broken worlds) ==
1. LAYERS OWN AXES. base = WHAT the world is (subject, environment, style). camera = how it is framed. movement = what the viewpoint does. events = what just happened. Never leak one layer's axis into another (no motion verbs in base, no camera verbs in events).
2. FIRST-PERSON scenes around a named foreground ANCHOR (the educational centerpiece, e.g. "the colossal rotating DNA double helix"). camera.static: anchor centered, only arrow-key look-input orbits it, nothing moves on its own. camera.dynamic: "Strict first-person view, the [anchor] holding steady at the centre of the frame as the viewpoint advances through the scene; look-input becomes the heading changing."
3. PIN 2-4 landmark objects in base with blunt counts: "The world contains EXACTLY ONE ... at a fixed position AND EXACTLY ONE ...". Landmarks = the educational objects (nucleus, mitochondria, replication fork...). Texture (mist, dust) stays unpinned.
4. NEVER negations ("no people", "empty", "nothing"). Describe what IS present.
5. movement.static = idle with 2-3 SPECIFIC micro-motions (drifting motes, pulsing membrane, slow rotation). Never "everything is static".
6. movement.dynamic = travel: ground/space contact, environment responding to motion.
7. EVENTS are hold-key clauses = THE EDUCATIONAL INTERACTIONS (3-5 of them): "the double helix unzips down the middle as two new strands assemble", "a hammer and a feather drop side by side, falling at the same slow rate". Definite references only ("the helix", then "it"), never re-describe the subject. Each event must END SETTLED (returns to a stable state). Each must make sense next to any other event. Stage them along the view axis, frameable.
8. seed_image_prompt: derived FROM the layers — every base noun + pinned landmarks in stated positions + atmosphere; recast camera.static framing as a still ("A first-person still frame of ..."); recast movement.static pose as plain description; 16:9 wide; no humans, no text, no watermark; end with "photorealistic, high detail, cinematic color grading".
9. missions: 4-6, ordered simple→deep, each tied to an event_key the student must hold or a landmark to find.`;

interface Mission {
  title: string;
  description: string;
  hint: string;
  event_key?: string;
}

interface LessonPlan {
  title: string;
  summary: string;
  world_prompt: string;
  image_prompt: string;
  missions: Mission[];
}

interface LingbotPlan {
  title: string;
  summary: string;
  base: string;
  camera_static: string;
  camera_dynamic: string;
  movement_static: string;
  movement_dynamic: string;
  jump: string;
  crouch: string;
  events: { key: string; name: string; detail: string }[];
  seed_image_prompt: string;
  missions: Mission[];
}

function extractJson<T>(text: string): T {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model output");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
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
  let engine: string;
  try {
    const body = await req.json();
    topic = String(body?.topic ?? "").trim();
    engine = String(body?.engine ?? "happy-oyster").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const t0 = Date.now();
  console.log(`[plan] start — topic="${topic}" engine=${engine} model=${model} @ ${baseUrl}`);

  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: engine === "lingbot" ? LINGBOT_SYSTEM_PROMPT : SYSTEM_PROMPT,
        },
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
    if (engine === "lingbot") {
      const plan = extractJson<LingbotPlan>(content);
      if (!plan.base || !plan.camera_static || !Array.isArray(plan.events)) {
        throw new Error("Missing LingBot scene layers");
      }
      const scene: LingbotScene = {
        base: plan.base,
        camera_static: plan.camera_static,
        camera_dynamic: plan.camera_dynamic,
        movement_static: plan.movement_static,
        movement_dynamic: plan.movement_dynamic,
        jump: plan.jump,
        crouch: plan.crouch,
        events: plan.events,
        seed_image_prompt: plan.seed_image_prompt,
      };
      const idle_prompt = composeIdlePrompt(scene);
      console.log(
        `[plan] ✓ lingbot scene in ${Date.now() - t0}ms — "${plan.title}", ${plan.events.length} events, idle prompt ${idle_prompt.length} chars`
      );
      return NextResponse.json({
        topic,
        engine,
        title: plan.title,
        summary: plan.summary,
        scene,
        idle_prompt,
        seed_image_prompt: deriveSeedImagePrompt(scene),
        missions: plan.missions,
      });
    }

    const plan = extractJson<LessonPlan>(content);
    if (!plan.world_prompt || !Array.isArray(plan.missions)) {
      throw new Error("Missing world_prompt or missions");
    }
    plan.world_prompt = plan.world_prompt.slice(0, 1900);
    plan.image_prompt = (plan.image_prompt ?? plan.world_prompt).slice(0, 600);
    console.log(
      `[plan] ✓ done in ${Date.now() - t0}ms — "${plan.title}", ${plan.missions.length} missions`
    );
    return NextResponse.json({ topic, engine, ...plan });
  } catch (e) {
    console.warn(`[plan] ✗ parse failed in ${Date.now() - t0}ms:`, e);
    return NextResponse.json(
      { error: `Could not parse lesson plan from model output: ${String(e)}`, raw: content },
      { status: 502 }
    );
  }
}
