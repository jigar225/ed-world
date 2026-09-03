// Client-side world library (localStorage).
// Worlds are permanent on the Reactor account — we just save the
// encrypted_world_id so a world is generated ONCE and reused forever
// (this is our big cost saver: no regeneration per student).

import type { LingbotScene } from "@/lib/lingbot";

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

export type AnyPlan = LessonPlan | LingbotLessonPlan;

export function isLingbotPlan(plan: AnyPlan): plan is LingbotLessonPlan {
  return (plan as LingbotLessonPlan).engine === "lingbot";
}

export interface SavedWorld {
  id: string; // encrypted_world_id (happy-oyster) or lingbot scene key
  engine?: "happy-oyster" | "lingbot";
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
