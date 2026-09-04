// CodeWorld — the spec-driven generative world engine.
// An LLM agent authors a compact world SPEC (JSON); our Three.js runtime
// executes it with deterministic physics. No credits, no GPU rental,
// no generated code ever executed — specs are data, validated and repaired.

export type CWSky = "space" | "day" | "sunset" | "night" | "nebula" | "underwater" | "cell";
export type CWGround = "moon" | "grass" | "sand" | "water" | "grid" | "none";
export type CWShape =
  | "box"
  | "sphere"
  | "cylinder"
  | "cone"
  | "torus"
  | "capsule";

export interface CWObject {
  id: string;
  shape: CWShape;
  label?: string;
  color: string;
  position: [number, number, number];
  scale?: [number, number, number];
  emissive?: boolean;
  float?: { amp: number; speed: number };
  spin?: number;
  falls?: boolean;
}

export type CWEventAction = "drop" | "launch" | "pulse" | "orbit" | "toggle";

export interface CWEvent {
  key: string; // "1".."5"
  name: string;
  action: CWEventAction;
  target: string; // object id, or "all"
  speed?: number;
}

export interface CWMission {
  title: string;
  description: string;
  hint: string;
  event_key?: string;
}

export interface CWSpec {
  title: string;
  summary: string;
  sky: CWSky;
  ground: CWGround;
  fog_color: string;
  gravity: number; // m/s^2 — drives REAL physics in the runtime
  ambient: number; // 0..2
  sun: number; // 0..3
  objects: CWObject[];
  events: CWEvent[];
  missions: CWMission[];
}

const SKIES: CWSky[] = ["space", "day", "sunset", "night", "nebula", "underwater", "cell"];
const GROUNDS: CWGround[] = ["moon", "grass", "sand", "water", "grid", "none"];
const SHAPES: CWShape[] = ["box", "sphere", "cylinder", "cone", "torus", "capsule"];
const ACTIONS: CWEventAction[] = ["drop", "launch", "pulse", "orbit", "toggle"];

const num = (v: unknown, d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : d;

const str = (v: unknown, d: string): string => (typeof v === "string" && v ? v : d);

function vec3(v: unknown, d: [number, number, number]): [number, number, number] {
  if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number")) {
    return [v[0], v[1], v[2]];
  }
  return d;
}

/** Validate + repair a raw LLM response into a safe CWSpec. Throws if unfixable. */
export function validateSpec(raw: unknown): CWSpec {
  if (typeof raw !== "object" || raw === null) throw new Error("spec is not an object");
  const r = raw as Record<string, unknown>;

  const objectsRaw = Array.isArray(r.objects) ? r.objects.slice(0, 24) : [];
  if (objectsRaw.length === 0) throw new Error("spec has no objects");

  const objects: CWObject[] = objectsRaw.map((o, i) => {
    const obj = (typeof o === "object" && o !== null ? o : {}) as Record<string, unknown>;
    const id = str(obj.id, `obj_${i}`).replace(/[^a-zA-Z0-9_-]/g, "_");
    const shapeRaw = str(obj.shape, "box") as CWShape;
    return {
      id,
      shape: SHAPES.includes(shapeRaw) ? shapeRaw : "box",
      label: typeof obj.label === "string" ? obj.label.slice(0, 40) : undefined,
      color: str(obj.color, "#8aa2ff"),
      position: vec3(obj.position, [0, 1, 0]),
      scale: obj.scale ? vec3(obj.scale, [1, 1, 1]) : undefined,
      emissive: obj.emissive === true,
      float:
        typeof obj.float === "object" && obj.float !== null
          ? {
              amp: num((obj.float as Record<string, unknown>).amp, 0.3),
              speed: num((obj.float as Record<string, unknown>).speed, 1),
            }
          : undefined,
      spin: typeof obj.spin === "number" ? obj.spin : undefined,
      falls: obj.falls === true,
    };
  });

  const ids = new Set(objects.map((o) => o.id));

  const eventsRaw = Array.isArray(r.events) ? r.events.slice(0, 5) : [];
  const events: CWEvent[] = eventsRaw
    .map((e, i) => {
      const ev = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>;
      const actionRaw = str(ev.action, "pulse") as CWEventAction;
      const target = str(ev.target, "all");
      return {
        key: str(ev.key, String(i + 1)),
        name: str(ev.name, `Event ${i + 1}`).slice(0, 30),
        action: ACTIONS.includes(actionRaw) ? actionRaw : "pulse",
        target: target === "all" || ids.has(target) ? target : "all",
        speed: typeof ev.speed === "number" ? ev.speed : undefined,
      };
    })
    .filter((e, i, arr) => arr.findIndex((x) => x.key === e.key) === i)
    .slice(0, 5);

  const missionsRaw = Array.isArray(r.missions) ? r.missions.slice(0, 6) : [];
  const missions: CWMission[] = missionsRaw.map((m, i) => {
    const mi = (typeof m === "object" && m !== null ? m : {}) as Record<string, unknown>;
    return {
      title: str(mi.title, `Mission ${i + 1}`).slice(0, 60),
      description: str(mi.description, "").slice(0, 240),
      hint: str(mi.hint, "").slice(0, 120),
      event_key: typeof mi.event_key === "string" ? mi.event_key : undefined,
    };
  });
  if (missions.length === 0) {
    missions.push({
      title: "Explore the world",
      description: "Look around and find the main landmark.",
      hint: "Drag to orbit, scroll to zoom.",
    });
  }

  const skyRaw = str(r.sky, "space") as CWSky;
  const groundRaw = str(r.ground, "grid") as CWGround;

  return {
    title: str(r.title, "Generated World").slice(0, 60),
    summary: str(r.summary, "").slice(0, 400),
    sky: SKIES.includes(skyRaw) ? skyRaw : "space",
    ground: GROUNDS.includes(groundRaw) ? groundRaw : "grid",
    fog_color: str(r.fog_color, "#050505"),
    gravity: Math.min(30, Math.max(0, num(r.gravity, 9.8))),
    ambient: Math.min(2, Math.max(0, num(r.ambient, 0.4))),
    sun: Math.min(3, Math.max(0, num(r.sun, 1.2))),
    objects,
    events,
    missions,
  };
}
