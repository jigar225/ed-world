import { NextResponse } from "next/server";
import { validateSpec } from "@/lib/codeworld";
import { forgeProp, foundryConfigured, listCachedProps, peekCachedProp, slugify } from "@/lib/foundry";

export const maxDuration = 900; // realworld: Kimi ~90s + serial forges through a
                                // possibly-cold Modal service. NOTE: prop cap is OFF
                                // — Vercel deploys must set FOUNDRY_MAX_PROPS (900s
                                // fits ~3 forges) or raise this. Local dev ignores it.

// CodeWorld engine: TWO agents in one route.
//   1. ARCHITECT (Kimi) — authors a world spec for the topic.
//   2. CRITIC — validates the spec; on failure, feeds the error back to the
//      architect for one repair pass. The runtime never sees invalid data.

const SYSTEM_PROMPT = `You are the ARCHITECT agent of a generative education engine. You design interactive 3D world SPECS (JSON data, not code) that a deterministic Three.js runtime renders with real physics.

Given a student's topic, output ONLY valid JSON with this exact shape:

{
  "title": "short lesson title, max 6 words",
  "summary": "2-3 friendly sentences",
  "sky": "space|day|sunset|night|nebula|underwater|cell",
  "ground": "moon|grass|sand|water|grid|none",
  "fog_color": "#hex matching the mood",
  "gravity": 1.6,
  "ambient": 0.4,
  "sun": 1.2,
  "objects": [
    {
      "id": "snake_case_id",
      "shape": "box|sphere|cylinder|cone|torus|capsule",
      "label": "short label shown in world (max 30 chars)",
      "color": "#hex",
      "position": [x, y, z],
      "scale": [sx, sy, sz],
      "emissive": true,
      "float": { "amp": 0.3, "speed": 1 },
      "spin": 0.5,
      "falls": true
    }
  ],
  "events": [
    { "key": "1", "name": "2-4 word label", "action": "drop|launch|pulse|orbit|toggle", "target": "object id or all", "speed": 1 }
  ],
  "missions": [
    { "title": "short", "description": "1-2 sentences", "hint": "1 sentence", "event_key": "1" }
  ]
}

RULES:
1. PHYSICAL TRUTH FIRST. The runtime simulates REAL gravity from your "gravity" value and objects with "falls": true actually fall when a "drop" event triggers. Set gravity truthfully for the topic (Moon 1.6, Earth 9.8, Jupiter 24.8, space cell 0.5). Design the hero experiment around it (e.g. hammer + feather side by side, both "falls": true, one "drop" event — they MUST land together on the Moon).
2. Compose the scene: 8-20 objects. A clear centerpiece (big, at/near origin), 3-6 landmarks around it (educational stations), decorative depth (distant small objects). Positions in a radius of 4-30 units, y >= 0.5.
3. The concept must be VISIBLE: sizes, colors, labels and layout must teach (a DNA lesson = a tall twisted ladder of two colored cylinder strands + sphere bases; a solar lesson = star center + orbiting planets with honest relative sizes).
4. events: 3-5, they ARE the interactions. "drop" makes falls:true objects fall with world gravity; "launch" flings the target up; "pulse" makes the target glow/scale-pulse; "orbit" spins the target around the center; "toggle" hides/shows. Give every event a target that exists in objects (or "all").
5. Every object id referenced by an event must exist. Keys are "1".."5".
6. missions: 4-6, ordered simple to deep, each tied to an event_key or a labeled landmark.
7. Use float (bobbing) and spin for ambient life. emissive for things that glow (stars, cores, reactors, enzymes).`;

// REALWORLD engine addendum (photoreal lunar runtime) — overrides the generic
// composition rules above. The runtime already owns the sky and the terrain;
// the LLM plans WALKABLE SURFACE CONTENT in 2D and the runtime owns heights.
const REALWORLD_RULES = `
REALWORLD MODE (photoreal Moon surface runtime) — these rules OVERRIDE rules 2 and 3 above:
R1. THE SKY ALREADY EXISTS. The runtime renders black space, stars, the Sun and planet Earth at their real positions, plus real lunar terrain. NEVER create the Earth, the Moon, the Sun, stars, "space", a sky dome, a ground plane, or any celestial object. Objects are ONLY things a mission crew could place ON the surface: landers, rovers, flags, antennas, experiment rigs, sample containers, habitats, telescopes, signs, crates.
R2. Every object MUST have "category": "ground" (it stands on the surface — the runtime snaps it onto the terrain, your y value is IGNORED) or "air" (it hovers or starts in the air — y = height above ground in meters; ONLY for drones, balloons, or "falls": true drop-experiment objects).
R3. Layout: place x,z within 5..70m of the origin. NO two objects closer than 4m to each other. The centerpiece within 15m of the origin. Spread landmarks around the center so a WALKING visitor discovers them one by one. This is a walkable place, not a floating diorama — NOTHING floats above the ground unless it is category "air".
R4. Real-world plausible sizes: a flag ~1.5m, a rover 2-3m, a lander 4-7m, a habitat 6-10m. Nothing under 0.4m or over 40m tall.
R5. Believable equipment colors only: white, aluminium grey, gold foil, matte black, safety orange, dusty tan. NO candy/neon colors.
R6. 8-16 objects. Everything teaches — but it teaches by being a believable lunar surface installation, not by being a sculpture.`;

export async function POST(req: Request) {
  const baseUrl = (process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1").replace(/\/$/, "");
  const model = process.env.KIMI_MODEL ?? "kimi-k3";

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
    return NextResponse.json({ error: "No Kimi credentials set" }, { status: 500 });
  }

  let topic: string;
  let engine: "codeworld" | "realworld" = "codeworld";
  try {
    const body = await req.json();
    topic = String(body?.topic ?? "").trim();
    if (body?.engine === "realworld") engine = "realworld";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });

  const t0 = Date.now();
  console.log(`[world] architect start — topic="${topic}"`);

  // CACHE-AWARE ARCHITECT: the foundry cache key is the object "id", and
  // Kimi invents FRESH ids every run (temp 0.7) — so repeat topics re-forge
  // props we already have on disk (~4 GPU-min each). Hand the architect the
  // existing prop slugs so it reuses them as ids whenever they fit.
  // (test_* slugs are foundry machinery artifacts — reusable via cache peek,
  // but never advertised to the architect as scene-worthy props)
  const cachedProps =
    engine === "realworld" && foundryConfigured()
      ? (await listCachedProps()).filter((s) => !s.startsWith("test"))
      : [];
  const cacheRules =
    cachedProps.length > 0
      ? `\nPROP CACHE — these 3D models are ALREADY FORGED and reusable at $0 (ids): ${cachedProps
          .slice(0, 80)
          .join(
            ", "
          )}. R7. If an object you want matches one of these, set its "id" to EXACTLY that slug (label, position and scale stay yours). Invent a fresh snake_case id ONLY for objects NOT in this list — every new id triggers a real GPU forge.`
      : "";

  async function callArchitect(feedback?: string): Promise<unknown> {
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
            content:
              engine === "realworld"
                ? SYSTEM_PROMPT + REALWORLD_RULES + cacheRules
                : SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: feedback
              ? `Student topic: "${topic}"\n\nCRITIC FEEDBACK — your previous spec failed validation: ${feedback}. Fix it and output the corrected JSON.`
              : `Student topic: "${topic}"`,
          },
        ],
      }),
    });
    if (!r.ok) throw new Error(`Kimi HTTP ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const cleaned = content
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    return JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1));
  }

  // Agent 1 builds, agent 2 (validator) checks, one repair pass allowed.
  try {
    let spec;
    try {
      spec = validateSpec(await callArchitect());
      console.log(`[world] ✓ architect+critic passed first try in ${Date.now() - t0}ms`);
    } catch (firstErr) {
      console.warn(`[world] critic rejected first draft: ${String(firstErr)} — repair pass`);
      spec = validateSpec(await callArchitect(String(firstErr)));
      console.log(`[world] ✓ repaired spec passed in ${Date.now() - t0}ms`);
    }

    // ── P2 DIRECTOR → FOUNDRY: compile real GLB props for hero objects ──
    // RealWorld plans only. ALL labeled objects are forged, biggest first
    // (no cap — owner call 2026-09-05: forge whatever the world wants).
    // FOUNDRY_MAX_PROPS, if explicitly set, still caps it (0 disables).
    // Compile-once: GLBs land in public/props/ and are served from cache
    // forever after. Failures leave the object as a primitive — the runtime
    // never breaks over a prop.
    if (engine === "realworld" && foundryConfigured()) {
      const maxPropsEnv = process.env.FOUNDRY_MAX_PROPS;
      const maxProps =
        maxPropsEnv === undefined ? Infinity : Math.max(0, Number(maxPropsEnv));
      const heroes = [...spec.objects]
        .filter((o) => o.label)
        .sort(
          (a, b) =>
            Math.max(...(b.scale ?? [1, 1, 1])) - Math.max(...(a.scale ?? [1, 1, 1]))
        )
        .slice(0, maxProps);
      if (heroes.length > 0) {
        console.log(`[world] foundry compile — heroes: ${heroes.map((o) => o.id).join(", ")}`);
        // SERIAL, not parallel: free ref-image providers (Pollinations) 429 on
        // simultaneous calls, and parallel Modal cold-starts waste spend.
        for (const o of heroes) {
          try {
            // Cache-first: Kimi invents fresh ids per run, so check BOTH the
            // id and the slugified label against public/props before paying
            // for a forge. The label is the stable key for repeat topics
            // (id "apollo_hammer", label "Hammer" → reuses hammer.glb).
            const labelSlug = o.label ? slugify(o.label) : "";
            const r =
              (await peekCachedProp([o.id, labelSlug])) ??
              (await forgeProp(`${o.label}, high quality detailed 3D model`, o.id));
            o.model = r.url;
            console.log(
              `[world] ✓ forged "${o.id}" → ${r.slug} (${Math.round(r.bytes / 1024)}KB, ${
                r.cached ? "cached" : `${r.ms}ms`
              })`
            );
          } catch (e) {
            console.warn(`[world] ✗ forge failed for "${o.id}" (stays primitive):`, e);
          }
        }
      }
    }

    return NextResponse.json({
      topic,
      engine,
      title: spec.title,
      summary: spec.summary,
      spec,
      missions: spec.missions,
    });
  } catch (e) {
    console.warn(`[world] ✗ failed in ${Date.now() - t0}ms:`, e);
    return NextResponse.json(
      { error: `World architect failed: ${String(e)}` },
      { status: 502 }
    );
  }
}
