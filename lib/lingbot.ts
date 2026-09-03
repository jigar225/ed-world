// LingBot World 2 layered prompt harness.
// The model conditions on ONE prose string, but production scenes are authored
// as layers and recomposed whenever input state changes:
//
//   prompt = base + camera[static|dynamic] + movement[static|dynamic] + heldEvents + vertical
//
// Budgets (encoder truncates ~2000 chars): base ≤600, camera ≤300 each,
// movement ≤350 each, event ≤500. Trim events first — never the contracts.

export interface LingbotEvent {
  key: string; // "1" | "2" | "3" | "4"
  name: string; // labels the key chip in UI
  detail: string; // clause appended while the key is held
}

export interface LingbotScene {
  base: string; // subject + environment + style; pinned landmarks; no motion/camera verbs
  camera_static: string; // idle framing contract (look-input only camera motion)
  camera_dynamic: string; // travel framing contract (rear-view tracking / FP advance)
  movement_static: string; // idle: 2-3 specific micro-motions, never inert
  movement_dynamic: string; // travel verbs, ground contact, environment response
  jump: string; // symmetric arc: launch → airborne → land
  crouch: string; // camera-height move
  events: LingbotEvent[]; // hold-key educational interactions
  seed_image_prompt: string; // derived FROM the layers, 16:9
}

export interface ComposeState {
  moving?: boolean;
  heldEventKeys?: string[];
  vertical?: "jump" | "crouch" | null;
}

function clean(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function cap(s: string, max: number): string {
  const c = clean(s);
  return c.length <= max ? c : c.slice(0, max - 1).trimEnd() + "…";
}

/** Full composed prompt for a given input state. This is what set_prompt receives. */
export function composePrompt(scene: LingbotScene, state: ComposeState): string {
  const parts: string[] = [
    cap(scene.base, 600),
    cap(state.moving ? scene.camera_dynamic : scene.camera_static, 300),
    cap(state.moving ? scene.movement_dynamic : scene.movement_static, 350),
  ];

  const held = new Set(state.heldEventKeys ?? []);
  for (const ev of scene.events) {
    if (held.has(ev.key)) parts.push(cap(ev.detail, 500));
  }

  if (state.vertical === "jump") parts.push(cap(scene.jump, 300));
  if (state.vertical === "crouch") parts.push(cap(scene.crouch, 300));

  return clean(parts.join(" ")).slice(0, 1990);
}

/** The idle composition — also the exact prompt the seed image must agree with. */
export function composeIdlePrompt(scene: LingbotScene): string {
  return composePrompt(scene, { moving: false });
}

/** Derive the seed-image prompt from the layers (per LingBot's own guide):
 *  base nouns + pinned landmarks, framing recast from camera.static as a still,
 *  pose from movement.static, use-ready props visible. Image disagrees = artifacts. */
export function deriveSeedImagePrompt(scene: LingbotScene): string {
  return clean(scene.seed_image_prompt).slice(0, 600);
}
