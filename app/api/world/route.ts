import { NextResponse } from "next/server";
import { validateSpec } from "@/lib/codeworld";

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
  try {
    const body = await req.json();
    topic = String(body?.topic ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });

  const t0 = Date.now();
  console.log(`[world] architect start — topic="${topic}"`);

  async function callArchitect(feedback?: string): Promise<unknown> {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
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

    return NextResponse.json({
      topic,
      engine: "codeworld",
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
