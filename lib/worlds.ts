// Client-side world library (localStorage).
// Worlds are permanent on the Reactor account — we just save the
// encrypted_world_id so a world is generated ONCE and reused forever
// (this is our big cost saver: no regeneration per student).

import type { LingbotScene } from "@/lib/lingbot";
import type { CWMission, CWSpec } from "@/lib/codeworld";

export interface Mission {
  title: string;
  description: string;
  hint: string;
  event_key?: string;
}

export interface LessonPlan {
  topic: string;
  engine?: "happy-oyster";
  title: string;
  summary: string;
  world_prompt: string;
  image_prompt: string;
  missions: Mission[];
}

export interface LingbotLessonPlan {
  topic: string;
  engine: "lingbot";
  title: string;
  summary: string;
  scene: LingbotScene;
  idle_prompt: string;
  seed_image_prompt: string;
  missions: Mission[];
}

export interface CodeworldPlan {
  topic: string;
  engine: "codeworld";
  title: string;
  summary: string;
  spec: CWSpec;
  missions: CWMission[];
}

// RealWorld (P1 "Moon Runtime 2.0") — same spec-as-data as CodeWorld,
// rendered by the photoreal WebGPU runtime instead of the Lab look.
export interface RealworldPlan {
  topic: string;
  engine: "realworld";
  title: string;
  summary: string;
  spec: CWSpec;
  missions: CWMission[];
}

export type AnyPlan = LessonPlan | LingbotLessonPlan | CodeworldPlan | RealworldPlan;

export function isLingbotPlan(plan: AnyPlan): plan is LingbotLessonPlan {
  return (plan as LingbotLessonPlan).engine === "lingbot";
}

export function isCodeworldPlan(plan: AnyPlan): plan is CodeworldPlan {
  return (plan as CodeworldPlan).engine === "codeworld";
}

export function isRealworldPlan(plan: AnyPlan): plan is RealworldPlan {
  return (plan as RealworldPlan).engine === "realworld";
}

export interface SavedWorld {
  id: string; // encrypted_world_id (happy-oyster) or scene/spec key
  engine?: "happy-oyster" | "lingbot" | "codeworld" | "realworld";
  plan: AnyPlan;
  createdAt: number;
}

const KEY = "edworld_worlds_v1";

export function listWorlds(): SavedWorld[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedWorld[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveWorld(entry: SavedWorld) {
  if (!entry.id) return;
  const worlds = listWorlds().filter((w) => w.id !== entry.id);
  worlds.unshift(entry);
  window.localStorage.setItem(KEY, JSON.stringify(worlds.slice(0, 50)));
}

export function removeWorld(id: string) {
  const worlds = listWorlds().filter((w) => w.id !== id);
  window.localStorage.setItem(KEY, JSON.stringify(worlds));
}
