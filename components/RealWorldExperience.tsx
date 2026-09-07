"use client";

// ─────────────────────────────────────────────────────────────────────────
// 🌕 RealWorld Experience — P1 "Moon Runtime 2.0" (photoreal-by-code, $0)
//
// THREE.WebGPURenderer + TSL (auto-fallback to WebGL2). Deterministic lunar
// heightfield terrain (lib/moon-terrain.ts), triplanar regolith shading,
// macro-variation breakup, RNM detail normals, hard vacuum shadows, sheen,
// star dome + Earth in the sky, pointer-lock FPS cam + head-bob, and the
// expert post chain in EXACT order:
//   GTAO → SSR → bloom(0.87) → DOF → ACESFilmic → grade → vignette/grain → SMAA
//
// Reuses CodeWorld's spec-as-data pattern: CWSpec in, deterministic physics
// (spec.gravity is real), event keys 1-5, mission HUD. No credits, ever.
// ─────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import {
  pass,
  mrt,
  output,
  normalView,
  roughness,
  metalness,
  positionWorld,
  normalWorld,
  cameraPosition,
  texture,
  uniform,
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  mix,
  smoothstep,
  clamp,
  dot,
  normalize,
  luminance,
  uv,
  sRGBTransferOETF,
  toneMapping,
  triplanarTexture,
  normalMap,
  convertToTexture,
} from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { ssr } from "three/addons/tsl/display/SSRNode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { CWEvent, CWObject } from "@/lib/codeworld";
import type { RealworldPlan } from "@/lib/worlds";
import { saveWorld } from "@/lib/worlds";
import {
  createLunarHeightfield,
  buildTerrainGeometry,
  buildFarTerrainGeometry,
  makeMacroNoiseTexture,
  buildRockGeometry,
  scatterRocks,
  mulberry32,
  type LunarHeightfield,
  type LunarDEM,
  type RockTransform,
} from "@/lib/moon-terrain";

// ── TSL shader helpers ────────────────────────────────────────────────────

// Reoriented Normal Mapping — blend macro + micro detail normals.
const rnmBlend = Fn(([a, b]: [any, any]) => {
  const t = a.mul(2).sub(1).add(vec3(0, 0, 1));
  const u = b.mul(2).sub(1).mul(vec3(-1, -1, 1));
  return t.mul(dot(t, u).div(t.z.add(0.0001))).sub(u);
});

// Colour grade (the "LUT" stage): gentle saturation, contrast pivot,
// cool shadows → warm highlights split-tone.
const gradeFn = Fn(([c]: [any]) => {
  const lum = luminance(c);
  const sat = mix(vec3(lum), c, float(1.07));
  const con = sat.sub(0.18).mul(1.05).add(0.18);
  const t = smoothstep(0.05, 0.75, lum);
  const tint = mix(vec3(0.97, 0.99, 1.05), vec3(1.04, 1.01, 0.96), t);
  return clamp(con.mul(tint), 0.0, 1.0);
});

const vignetteFn = Fn(([c]: [any]) => {
  const d = uv().sub(vec2(0.5, 0.5)).length();
  // was 0.42/0.58 — gentler; a dark scene can't carry a heavy vignette
  const v = smoothstep(0.32, 0.86, d).oneMinus().mul(0.28).add(0.72);
  return c.mul(v);
});

/** Triplanar sample helper (world-space, kills stretching on crater walls). */
const tri = (tex: THREE.Texture, tileMeters: number) =>
  triplanarTexture(
    texture(tex),
    texture(tex),
    texture(tex),
    float(1 / tileMeters),
    positionWorld,
    normalWorld
  );

function makeRegolithMaterial(
  albedoTex: THREE.Texture,
  normalTex: THREE.Texture,
  roughTex: THREE.Texture,
  macroTex: THREE.DataTexture
): THREE.MeshPhysicalNodeMaterial {
  const mat = new THREE.MeshPhysicalNodeMaterial();
  mat.metalness = 0;

  // ── Albedo: triplanar near (2.6m tiles) → mid (26m) distance blend ──
  const nearAlb = tri(albedoTex, 2.6);
  const midAlb = tri(albedoTex, 26);
  const camDist = positionWorld.sub(cameraPosition).length();
  const alb = mix(nearAlb, midAlb, smoothstep(24.0, 80.0, camDist));

  // Lunar grey: Ground054 is brownish — desaturate HARD toward regolith.
  // Real regolith albedo is DARK (~0.12) — pull brightness down too.
  const grey = luminance(alb.rgb);
  let col = mix(vec3(grey), alb.rgb, float(0.16)) as any;
  col = col.mul(vec3(0.62, 0.61, 0.6));

  // ── Macro-variation breakup (the anti-tiling fix), 2 octaves ──
  const macro = texture(macroTex, positionWorld.xz.mul(1 / 420)).r;
  const macro2 = texture(macroTex, positionWorld.xz.mul(1 / 55)).g;
  col = col.mul(mix(0.82, 1.06, macro)).mul(mix(0.9, 1.06, macro2));
  // ── Crater-wall shading: steep slopes shed bright dust → darker compacted
  // soil. Reads the normal (geometry-agnostic) so EVERY crater pops — this
  // is what makes craters read as craters and not smooth dunes.
  const slope = normalWorld.y.oneMinus();
  col = col.mul(mix(1.0, 0.68, smoothstep(0.1, 0.45, slope)));
  mat.colorNode = col;

  // ── RNM detail normals: macro (2.6m) + micro (0.3m), tangent-space ──
  // (uv-tiled so normalMap's derivative-TBN stays correct on the plane)
  const n1 = texture(normalTex, uv().mul(160.0)).rgb;
  const n2 = texture(normalTex, uv().mul(1400.0)).rgb;
  const blended = normalize(rnmBlend(n1, n2)).mul(0.5).add(0.5);
  mat.normalNode = normalMap(blended, vec2(1.0, 1.0));

  // ── Roughness from map, pinned to regolith range 0.84–0.97 ──
  const rgh = texture(roughTex, uv().mul(160.0)).r;
  mat.roughnessNode = mix(0.84, 0.97, rgh) as any;

  // Powdery dust scatter (expert: sheen ~0.05)
  mat.sheen = 0.05;
  mat.sheenRoughness = 0.85;
  mat.sheenColor = new THREE.Color(0.85, 0.87, 0.95);
  return mat;
}

// ── Procedural sky assets ─────────────────────────────────────────────────

// The env map is what PBR props REFLECT — a black starfield starves them
// (that's why forged GLBs looked plastic here but premium in gltf-viewer's
// studio HDRI). So this equirect encodes REAL lunar illumination: black sky
// + stars up top, regolith-bounce gradient below, an HDR sun spot (the key
// reflection) and a faint cool Earthlight patch.
function makeStarEnvTexture(seed: number, sunDir: THREE.Vector3): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000004";
  ctx.fillRect(0, 0, w, h);

  // 1 · regolith bounce — lower hemisphere gradient (brightest at horizon)
  const ground = ctx.createLinearGradient(0, h * 0.5, 0, h);
  ground.addColorStop(0, "#3d3d42");
  ground.addColorStop(0.3, "#222226");
  ground.addColorStop(1, "#0b0b0d");
  ctx.fillStyle = ground;
  ctx.fillRect(0, h * 0.5, w, h * 0.5);

  // 2 · sun spot — equirect projection of the sun direction
  const dirToUV = (d: THREE.Vector3): [number, number] => [
    (Math.atan2(d.z, d.x) / (Math.PI * 2) + 0.5) * w,
    (Math.acos(Math.max(-1, Math.min(1, d.y))) / Math.PI) * h,
  ];
  const [su, sv] = dirToUV(sunDir);
  const sunBlob = ctx.createRadialGradient(su, sv, 0, su, sv, 26);
  sunBlob.addColorStop(0, "rgba(255,252,240,1)");
  sunBlob.addColorStop(0.25, "rgba(255,244,214,0.55)");
  sunBlob.addColorStop(1, "rgba(255,244,214,0)");
  ctx.fillStyle = sunBlob;
  ctx.fillRect(su - 26, sv - 26, 52, 52);

  // 3 · earthlight patch — faint cool glow from Earth's sky position
  const earthDir = new THREE.Vector3(-420, 300, -1250).normalize();
  const [eu, ev] = dirToUV(earthDir);
  const earthBlob = ctx.createRadialGradient(eu, ev, 0, eu, ev, 44);
  earthBlob.addColorStop(0, "rgba(120,155,215,0.5)");
  earthBlob.addColorStop(1, "rgba(120,155,215,0)");
  ctx.fillStyle = earthBlob;
  ctx.fillRect(eu - 44, ev - 44, 88, 88);

  // 4 · stars (sky hemisphere only — no stars below the horizon)
  const rand = mulberry32(seed);
  for (let i = 0; i < 1100; i++) {
    const x = rand() * w;
    const y = rand() * h * 0.5;
    const m = Math.pow(rand(), 3) * 0.9 + 0.08;
    ctx.fillStyle = `rgba(${200 + rand() * 55},${205 + rand() * 50},${215 + rand() * 40},${m})`;
    ctx.fillRect(x, y, rand() < 0.12 ? 2 : 1, rand() < 0.12 ? 2 : 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeStarPoints(seed: number, count: number, radius: number, band: boolean) {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    let x: number, y: number, z: number;
    if (band) {
      // milky band: cluster around a tilted great circle
      const a = rand() * Math.PI * 2;
      const spread = () => (rand() + rand() + rand() - 1.5) * 0.24;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const tilt = 0.42;
      x = ca + spread();
      y = sa * Math.sin(tilt) + spread() * 1.6;
      z = sa * Math.cos(tilt) + spread();
    } else {
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      x = s * Math.cos(a);
      y = u;
      z = s * Math.sin(a);
    }
    const len = Math.hypot(x, y, z) || 1;
    positions[i * 3] = (x / len) * radius;
    positions[i * 3 + 1] = (y / len) * radius;
    positions[i * 3 + 2] = (z / len) * radius;
    const warm = rand();
    const b = band ? 0.16 + rand() * 0.3 : 0.45 + rand() * 0.55;
    colors[i * 3] = b * (0.9 + warm * 0.15);
    colors[i * 3 + 1] = b * (0.92 + warm * 0.1);
    colors[i * 3 + 2] = b * (1.0 + warm * 0.05);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: band ? 1.1 : 1.7,
    sizeAttenuation: false,
    vertexColors: true,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

function makeLabelPlane(text: string): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(8,9,12,0.32)"; // was 0.55 — a subtle plate, not a billboard
  ctx.beginPath();
  ctx.roundRect(76, 40, 360, 48, 24);
  ctx.fill();
  ctx.font = "500 30px 'Space Grotesk', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#c3ccd8"; // was #e8f4ff — dimmed
  ctx.fillText(text.slice(0, 30), 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicNodeMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  });
  // Distance fade: labels exist to be read up close, not to billboard the
  // horizon. 22m→70m smooth fade kills the "game HUD" look at range.
  const camDist = positionWorld.sub(cameraPosition).length();
  mat.opacityNode = smoothstep(22.0, 70.0, camDist).oneMinus().mul(0.92);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.42), mat);
  mesh.renderOrder = 10;
  return mesh;
}

function shapeGeometry(obj: CWObject): THREE.BufferGeometry {
  switch (obj.shape) {
    case "sphere":
      return new THREE.SphereGeometry(0.5, 48, 32);
    case "cylinder":
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    case "cone":
      return new THREE.ConeGeometry(0.5, 1, 32);
    case "torus":
      return new THREE.TorusGeometry(0.5, 0.2, 24, 64);
    case "capsule":
      return new THREE.CapsuleGeometry(0.4, 0.6, 8, 24);
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

// ── Prop sim state (mirrors CodeWorld's deterministic physics) ───────────
interface PropSim {
  mesh: THREE.Object3D; // primitive Mesh OR foundry GLB wrapper Group
  label: THREE.Mesh | null;
  obj: CWObject;
  base: THREE.Vector3;
  baseScale: THREE.Vector3; // pulse scales relative to this
  mats: THREE.MeshStandardMaterial[]; // pulse targets (GLB = many)
  vy: number;
  disturbed: boolean;
  angle: number;
  baseRadius: number;
}

interface PlayerState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  vy: number;
  grounded: boolean;
  yaw: number;
  pitch: number;
  bobPhase: number;
}

const EYE = 1.7;

// ═════════════════════════════════════════════════════════════════════════
export default function RealWorldExperience({
  plan,
  onExit,
}: {
  plan: RealworldPlan;
  onExit: () => void;
}) {
  const spec = plan.spec;
  const mountRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState<boolean[]>(() => plan.missions.map(() => false));
  const [held, setHeld] = useState<Set<string>>(new Set());
  const heldRef = useRef<Set<string>>(new Set());
  const savedRef = useRef(false);

  // Persist to the world library (spec-as-data — re-entry is free)
  useEffect(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    saveWorld({
      id: `realworld:${plan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${Date.now()}`,
      engine: "realworld",
      plan,
      createdAt: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hold = (key: string) => {
    if (!spec.events.some((e) => e.key === key)) return;
    heldRef.current.add(key);
    setHeld(new Set(heldRef.current));
  };
  const release = (key: string) => {
    heldRef.current.delete(key);
    setHeld(new Set(heldRef.current));
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (/^[1-9]$/.test(e.key)) hold(e.key);
    };
    const up = (e: KeyboardEvent) => {
      if (/^[1-9]$/.test(e.key)) release(e.key);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  // ══ The runtime ═══════════════════════════════════════════════════════
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    const disposers: Array<() => void> = [];
    let renderer: THREE.WebGPURenderer | null = null;

    (async () => {
      try {
        (THREE as any).Node.captureStackTrace = true; // TEMP: debug TSL errors
        // ── Renderer: WebGPU with automatic WebGL2 fallback ──
        const hasWebGPU =
          typeof navigator !== "undefined" && "gpu" in navigator;
        renderer = new THREE.WebGPURenderer({
          antialias: false, // SMAA handles AA at the end of the chain
          forceWebGL: !hasWebGPU,
          requiredPowerPreference: "high-performance",
        } as any);
        await renderer.init();
        if (cancelled) return;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap; // hard vacuum shadows
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
        // NO FOG — vacuum. (expert rule: moon has no scattering)

        const camera = new THREE.PerspectiveCamera(
          66,
          mount.clientWidth / mount.clientHeight,
          0.1,
          5000
        );
        camera.rotation.order = "YXZ";

        // ── Deterministic moon: REAL NASA DTM tile when the asset is on
        // disk (NAC_DTM_APOLLO15, 2m/px, real craters + mare), procedural
        // heightfield as fallback + for the horizon ring beyond the tile ──
        const dem: LunarDEM | null = await (async () => {
          try {
            const metaR = await fetch("/terrain/moon-dem.json");
            if (!metaR.ok) return null;
            const meta = await metaR.json();
            const binR = await fetch("/terrain/moon-dem.bin");
            if (!binR.ok) return null;
            const buf = await binR.arrayBuffer();
            if (buf.byteLength !== meta.width * meta.height * 2) return null;
            return {
              data: new Uint16Array(buf),
              width: meta.width,
              height: meta.height,
              meters: meta.meters,
              minHeight: meta.minHeight,
              maxHeight: meta.maxHeight,
            } as LunarDEM;
          } catch {
            return null; // offline/missing → full procedural, never breaks
          }
        })();
        if (cancelled) return;
        const hf: LunarHeightfield = createLunarHeightfield(1337, dem);

        // ── Lighting: brutal sun + whisper of earthshine ──
        // sun from behind-right of the spawn view → faces we see are lit
        const sunDir = new THREE.Vector3(0.5, 0.58, 0.62).normalize();
        const sun = new THREE.DirectionalLight(0xfff8ef, spec.sun * 2.2);
        sun.castShadow = true;
        sun.shadow.mapSize.set(4096, 4096);
        sun.shadow.camera.left = -70;
        sun.shadow.camera.right = 70;
        sun.shadow.camera.top = 70;
        sun.shadow.camera.bottom = -70;
        sun.shadow.camera.near = 10;
        sun.shadow.camera.far = 520;
        sun.shadow.bias = -0.00012;
        sun.shadow.normalBias = 0.04;
        scene.add(sun, sun.target);
        const fill = new THREE.HemisphereLight(0x8fa3c7, 0x1a1a20, spec.ambient * 0.45 + 0.14);
        scene.add(fill);
        // Earthlight — the real second light source on the Moon: cool, dim
        // (~1/40 of the sun), coming from where Earth actually hangs.
        const earthlight = new THREE.DirectionalLight(0x9db8e8, 0.12);
        earthlight.position.set(-420, 300, -1250);
        scene.add(earthlight);

        // ── Environment: lunar-illumination equirect → PMREM ──
        // (sky + regolith bounce + sun spot + earthlight patch — see maker)
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envTex = makeStarEnvTexture(77, sunDir);
        const envRT = pmrem.fromEquirectangular(envTex);
        scene.environment = envRT.texture;
        scene.environmentIntensity = 0.9; // was 0.3 — env now has real content
        disposers.push(() => {
          envRT.dispose();
          envTex.dispose();
          pmrem.dispose();
        });

        // ── Sky dome: stars + milky band + Earth + HDR sun disc ──
        const stars = makeStarPoints(9001, 5200, 1600, false);
        const band = makeStarPoints(4242, 3400, 1550, true);
        scene.add(stars, band);

        const loader = new THREE.TextureLoader();
        const loadTex = (url: string, srgb: boolean) =>
          loader
            .loadAsync(url)
            .then((t) => {
              t.wrapS = t.wrapT = THREE.RepeatWrapping;
              t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
              t.anisotropy = (renderer as any).capabilities.getMaxAnisotropy();
              return t;
            })
            .catch(() => null);

        const [albedoTex, normalTex, roughTex, earthTex] = await Promise.all([
          loadTex("/textures/moon/albedo.jpg", true),
          loadTex("/textures/moon/normal.jpg", false),
          loadTex("/textures/moon/roughness.jpg", false),
          loadTex("/textures/moon/earth.jpg", true),
        ]);
        if (cancelled) return;

        // Earth hanging in the black — the hero shot.
        if (earthTex) {
          earthTex.wrapS = earthTex.wrapT = THREE.ClampToEdgeWrapping;
          const earth = new THREE.Mesh(
            new THREE.SphereGeometry(52, 48, 32),
            new THREE.MeshBasicNodeMaterial({ map: earthTex })
          );
          (earth.material as any).fog = false;
          earth.position.set(-420, 300, -1250);
          scene.add(earth);
          disposers.push(() => {
            earth.geometry.dispose();
            (earth.material as THREE.Material).dispose();
          });
        }
        // Sun disc — HDR values so bloom flares it naturally.
        const sunDisc = new THREE.Mesh(
          new THREE.CircleGeometry(30, 32),
          new THREE.MeshBasicNodeMaterial()
        );
        (sunDisc.material as any).colorNode = vec3(42.0, 39.0, 33.0);
        sunDisc.position.copy(sunDir).multiplyScalar(1800);
        sunDisc.lookAt(0, 0, 0);
        scene.add(sunDisc);
        disposers.push(() => {
          sunDisc.geometry.dispose();
          (sunDisc.material as THREE.Material).dispose();
        });

        // ── Terrain: near field (walkable) + far ring (horizon) ──
        const macroTex = makeMacroNoiseTexture(42);
        // per-slot fallbacks — a normal map MUST be flat (128,128,255)
        const mkFallback = (r: number, g: number, b: number) => {
          const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
          t.needsUpdate = true;
          return t;
        };
        const fallbackAlbedo = mkFallback(140, 140, 142);
        const fallbackNormal = mkFallback(128, 128, 255);
        const fallbackRough = mkFallback(235, 235, 235);
        const regolith = makeRegolithMaterial(
          albedoTex ?? fallbackAlbedo,
          normalTex ?? fallbackNormal,
          roughTex ?? fallbackRough,
          macroTex
        );
        const terrainGeo = buildTerrainGeometry(hf, 420, 420); // 1m grid — holds micro-craters
        const terrain = new THREE.Mesh(terrainGeo, regolith);
        terrain.receiveShadow = true;
        scene.add(terrain);
        const farGeo = buildFarTerrainGeometry(hf, 200, 2600);
        const farTerrain = new THREE.Mesh(farGeo, regolith);
        farTerrain.receiveShadow = true;
        scene.add(farTerrain);
        disposers.push(() => {
          terrainGeo.dispose();
          farGeo.dispose();
          regolith.dispose();
          macroTex.dispose();
          [fallbackAlbedo, fallbackNormal, fallbackRough].forEach((t) => t.dispose());
          [albedoTex, normalTex, roughTex, earthTex].forEach((t) => t?.dispose());
        });

        // ── Rock scatter field (P1.5b — the Moon is covered in ejecta) ──
        // Seeded-deterministic, slope-rejected, half-buried. Two pebble tiers
        // (cheap, no shadow casting) + one boulder tier (real shadows).
        const rockMat = new THREE.MeshStandardNodeMaterial();
        rockMat.color = new THREE.Color(0x8b8a86);
        rockMat.roughness = 0.93;
        rockMat.metalness = 0.0;
        const rockTiers: Array<{ rocks: RockTransform[]; geo: THREE.BufferGeometry; shadow: boolean }> = [
          { rocks: scatterRocks(hf, 5001, 6500, 0.05, 0.3, 210), geo: buildRockGeometry(101), shadow: false },
          { rocks: scatterRocks(hf, 6001, 4500, 0.05, 0.26, 210), geo: buildRockGeometry(202), shadow: false },
          { rocks: scatterRocks(hf, 7001, 420, 0.3, 2.4, 200), geo: buildRockGeometry(303), shadow: true },
        ];
        {
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          const e = new THREE.Euler();
          const v = new THREE.Vector3();
          const s = new THREE.Vector3();
          const tint = new THREE.Color();
          for (const tier of rockTiers) {
            const im = new THREE.InstancedMesh(tier.geo, rockMat, tier.rocks.length);
            tier.rocks.forEach((r, i) => {
              e.set(0, r.rotY, 0);
              q.setFromEuler(e);
              v.set(r.x, r.y, r.z);
              s.setScalar(r.scale);
              m.compose(v, q, s);
              im.setMatrixAt(i, m);
              tint.setScalar(r.tint);
              im.setColorAt(i, tint);
            });
            im.castShadow = tier.shadow;
            im.receiveShadow = true;
            im.instanceMatrix.needsUpdate = true;
            if (im.instanceColor) im.instanceColor.needsUpdate = true;
            scene.add(im);
            disposers.push(() => {
              im.dispose();
              tier.geo.dispose();
            });
          }
        }
        disposers.push(() => rockMat.dispose());

        // ── Props from the spec (PBR, cast shadows, terrain-draped) ──
        // P2: objects with a compiled foundry GLB (obj.model) load the real
        // asset — normalized so bbox height == spec scale.y with the bbox
        // center at the node origin (ALL physics math stays identical to
        // primitives). Load failure → primitive fallback, never a break.
        const gltfLoader = new GLTFLoader();
        const buildPropNode = async (
          obj: CWObject,
          scl: [number, number, number]
        ): Promise<{
          node: THREE.Object3D;
          mats: THREE.MeshStandardMaterial[];
          baseScale: THREE.Vector3;
        }> => {
          if (obj.model) {
            try {
              const gltf = await gltfLoader.loadAsync(obj.model);
              const inner = gltf.scene;
              const bbox = new THREE.Box3().setFromObject(inner);
              const size = bbox.getSize(new THREE.Vector3());
              const center = bbox.getCenter(new THREE.Vector3());
              const k = scl[1] / Math.max(size.y, 1e-4);
              inner.scale.setScalar(k);
              inner.position.set(-center.x * k, -center.y * k, -center.z * k);
              const mats: THREE.MeshStandardMaterial[] = [];
              inner.traverse((c) => {
                const m = c as THREE.Mesh;
                if (m.isMesh) {
                  m.castShadow = true;
                  m.receiveShadow = true;
                  const mm = m.material as
                    | THREE.MeshStandardMaterial
                    | THREE.MeshStandardMaterial[];
                  (Array.isArray(mm) ? mm : [mm]).forEach((x) => x && mats.push(x));
                }
              });
              const wrapper = new THREE.Group();
              wrapper.add(inner);
              return { node: wrapper, mats, baseScale: new THREE.Vector3(1, 1, 1) };
            } catch (e) {
              console.warn(`[RealWorld] GLB failed for "${obj.id}" — primitive fallback`, e);
            }
          }
          const geo = shapeGeometry(obj);
          const mat = new THREE.MeshStandardNodeMaterial();
          mat.color = new THREE.Color(obj.color);
          // was roughness 0.38 / metalness 0.35 — glossy toy plastic in a
          // near-black env. Real lunar-surface objects are dielectric + matte.
          mat.roughness = 0.82;
          mat.metalness = 0.05;
          if (obj.emissive) {
            mat.emissive = new THREE.Color(obj.color);
            mat.emissiveIntensity = 1.4;
          } else {
            // mute candy saturation 30% toward luminance — keeps the color's
            // identity, kills the toy look
            const c = mat.color;
            const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
            c.r = l + (c.r - l) * 0.7;
            c.g = l + (c.g - l) * 0.7;
            c.b = l + (c.b - l) * 0.7;
          }
          const mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.scale.set(scl[0], scl[1], scl[2]);
          return {
            node: mesh,
            mats: [mat as unknown as THREE.MeshStandardMaterial],
            baseScale: new THREE.Vector3(scl[0], scl[1], scl[2]),
          };
        };

        // Placement semantics: "ground" objects are GROUND-SNAPPED — both
        // primitives and GLB wrappers are center-origin, so resting contact =
        // terrain height + half height. The LLM's y is ignored for them (LLMs
        // can't know terrain heights — this kills the "everything floats /
        // Earth sitting on the surface" bug class). "air" keeps y as height
        // above ground (drones, drop experiments). Legacy specs (no category)
        // resolve: falls/float → "air" (old y-offset behavior), else "ground".
        const isAirborne = (obj: CWObject) =>
          (obj.category ?? (obj.falls || obj.float ? "air" : "ground")) === "air";
        const restY = (obj: CWObject, x: number, z: number, halfH: number) =>
          hf.height(x, z) +
          (isAirborne(obj) ? Math.max(obj.position[1], halfH + 0.05) : halfH);

        const props: PropSim[] = [];
        for (const obj of spec.objects) {
          const scl = obj.scale ?? [1, 1, 1];
          const { node, mats, baseScale } = await buildPropNode(obj, scl);
          const base = new THREE.Vector3(
            obj.position[0],
            restY(obj, obj.position[0], obj.position[2], scl[1] / 2),
            obj.position[2]
          );
          node.position.copy(base);
          scene.add(node);

          let label: THREE.Mesh | null = null;
          if (obj.label) {
            label = makeLabelPlane(obj.label);
            label.position.set(base.x, base.y + scl[1] / 2 + 0.9, base.z);
            scene.add(label);
          }
          props.push({
            mesh: node,
            label,
            obj,
            base,
            baseScale,
            mats,
            vy: 0,
            disturbed: false,
            angle: Math.atan2(base.z, base.x),
            baseRadius: Math.hypot(base.x, base.z) || 6,
          });
          disposers.push(() => {
            node.traverse((c) => {
              const m = c as THREE.Mesh;
              if (m.isMesh) {
                m.geometry.dispose();
                const mm = m.material as
                  | THREE.MeshStandardMaterial
                  | THREE.MeshStandardMaterial[];
                (Array.isArray(mm) ? mm : [mm]).forEach((x) => {
                  x?.map?.dispose();
                  x?.dispose();
                });
              }
            });
            if (label) {
              label.geometry.dispose();
              ((label.material as THREE.MeshBasicNodeMaterial).map as THREE.Texture)?.dispose();
              (label.material as THREE.Material).dispose();
            }
          });
        }

        // ── Player: pointer-lock FPS rig ──
        const player: PlayerState = {
          pos: new THREE.Vector3(0, hf.height(0, 18) + EYE, 18),
          vel: new THREE.Vector3(),
          vy: 0,
          grounded: true,
          yaw: 0,
          pitch: -0.06,
          bobPhase: 0,
        };
        const keys = new Set<string>();
        const canvas = renderer.domElement;
        const onMouseMove = (e: MouseEvent) => {
          if (document.pointerLockElement !== canvas) return;
          player.yaw -= e.movementX * 0.0021;
          player.pitch = THREE.MathUtils.clamp(
            player.pitch - e.movementY * 0.0021,
            -1.45,
            1.45
          );
        };
        const onLockChange = () =>
          setLocked(document.pointerLockElement === canvas);
        const onClick = () => {
          if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
        };
        const onKeyDown = (e: KeyboardEvent) => keys.add(e.code);
        const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("pointerlockchange", onLockChange);
        canvas.addEventListener("click", onClick);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        disposers.push(() => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("pointerlockchange", onLockChange);
          canvas.removeEventListener("click", onClick);
          window.removeEventListener("keydown", onKeyDown);
          window.removeEventListener("keyup", onKeyUp);
          if (document.pointerLockElement === canvas) document.exitPointerLock();
        });

        // ── Post chain — EXACT expert order ──
        // GTAO → SSR → bloom → DOF → ACESFilmic → grade(LUT) → vignette/grain → SMAA → sRGB
        const exposure = uniform(1.0); // was 0.88 — lifted the murk for the dark scene
        const post = new THREE.RenderPipeline(renderer);
        post.outputColorTransform = false; // we encode sRGB ourselves, last

        const scenePass = pass(scene, camera);
        scenePass.setMRT(mrt({ output, normal: normalView, roughness, metalness }));
        const sceneColor = scenePass.getTextureNode("output");
        const sceneDepth = scenePass.getTextureNode("depth");
        const sceneNormal = scenePass.getTextureNode("normal");
        const sceneViewZ = scenePass.getViewZNode();

        // 1 · GTAO (half-res is plenty) — NEAR FIELD ONLY.
        // AO is a contact-shadow effect, but GTAO ray-marches the DEPTH
        // buffer — and past a few tens of metres our DEM + micro-crater
        // detail approaches sub-pixel scale, so the marched "occlusion"
        // turns to noise that perspective stretches into vertical stripes
        // (the "picket fence" horizon artifact, e2e-hunted 2026-09-07).
        // Fade AO to 1 (no occlusion) from 18→45m — contact shadows live
        // in that band anyway; far terrain + sky stay clean.
        // (viewZ is negative in front of the camera → negate for distance.)
        const aoPass = ao(sceneDepth, sceneNormal, camera);
        aoPass.resolutionScale = 0.5;
        const aoFade = smoothstep(18, 45, sceneViewZ.negate());
        const aoFactor = mix(aoPass.getTextureNode().r, 1.0, aoFade);
        let col: any = sceneColor.mul(vec4(vec3(aoFactor), 1.0));

        // 2 · SSR — metals only; dielectric regolith early-outs (≈free here)
        // (ssr() samples its color input → TextureNode required. And it
        // DISCARDS non-metal/background pixels → additive overlay, not replace)
        const ssrOverlay = ssr(convertToTexture(col), sceneDepth, sceneNormal as any, {
          camera, // explicit — derived color nodes can't be camera-inferred
          metalnessNode: scenePass.getTextureNode("metalness") as any,
          roughnessNode: scenePass.getTextureNode("roughness") as any,
          reflectNonMetals: false,
        });
        col = col.add(ssrOverlay);

        // 3 · bloom — threshold 0.87 so only the sun/HDR glints flare
        col = col.add(bloom(col, 0.5, 0.4, 0.87));

        // 4 · depth of field (was bokeh 1.3 @ 9m → tilt-shift TOY look;
        // now farther focus + half blur — subtle for a walking sim)
        col = dof(col, sceneViewZ, 12, 26, 0.7);

        // 5 · ACESFilmic — the #1 realism lever
        let rgb: any = toneMapping(THREE.ACESFilmicToneMapping, exposure, col);
        // 6 · grade (LUT stage)
        rgb = gradeFn(rgb);
        // 7 · vignette + animated grain
        rgb = vignetteFn(rgb);
        const grained = film(vec4(rgb.rgb, 1.0), float(0.035)); // was 0.06 — noisy in shadows
        // 8 · SMAA (before sRGB, per its docs)
        const aa = smaa(grained);
        // 9 · encode to sRGB ourselves (outputColorTransform is off)
        post.outputNode = sRGBTransferOETF(aa as any) as any;
        disposers.push(() => post.dispose());

        // ── Resize ──
        const onResize = () => {
          camera.aspect = mount.clientWidth / mount.clientHeight;
          camera.updateProjectionMatrix();
          renderer!.setSize(mount.clientWidth, mount.clientHeight);
        };
        window.addEventListener("resize", onResize);
        disposers.push(() => window.removeEventListener("resize", onResize));

        // ── Frame loop ──
        let prevT = performance.now();
        let elapsed = 0;
        const walkSpeed = 5.4;
        const sprintMul = 1.85;

        const updatePlayer = (dt: number) => {
          const f = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
          const r = new THREE.Vector3(-f.z, 0, f.x);
          const wish = new THREE.Vector3();
          if (keys.has("KeyW")) wish.add(f);
          if (keys.has("KeyS")) wish.sub(f);
          if (keys.has("KeyD")) wish.add(r);
          if (keys.has("KeyA")) wish.sub(r);
          const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
          const speed = walkSpeed * (sprint ? sprintMul : 1);
          if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
          const k = 1 - Math.exp(-10 * dt);
          player.vel.x = THREE.MathUtils.lerp(player.vel.x, wish.x, k);
          player.vel.z = THREE.MathUtils.lerp(player.vel.z, wish.z, k);

          if (keys.has("Space") && player.grounded) {
            player.vy = 4.6;
            player.grounded = false;
          }
          player.vy -= spec.gravity * dt; // REAL gravity — moon hops are floaty

          player.pos.x += player.vel.x * dt;
          player.pos.z += player.vel.z * dt;
          // stay on the near field
          player.pos.x = THREE.MathUtils.clamp(player.pos.x, -195, 195);
          player.pos.z = THREE.MathUtils.clamp(player.pos.z, -195, 195);
          player.pos.y += player.vy * dt;
          const groundY = hf.height(player.pos.x, player.pos.z) + EYE;
          if (player.pos.y <= groundY) {
            player.pos.y = groundY;
            player.vy = 0;
            player.grounded = true;
          }

          // head-bob
          const hSpeed = Math.hypot(player.vel.x, player.vel.z);
          let bobY = 0;
          let roll = 0;
          if (player.grounded && hSpeed > 0.4) {
            player.bobPhase += dt * hSpeed * 1.55;
            bobY = Math.sin(player.bobPhase * 2) * 0.034 * Math.min(1, hSpeed / walkSpeed);
            roll = Math.sin(player.bobPhase) * 0.005;
          }
          camera.position.set(player.pos.x, player.pos.y + bobY, player.pos.z);
          camera.rotation.set(player.pitch, player.yaw, roll);
        };

        const updateProps = (dt: number, t: number) => {
          const heldKeys = heldRef.current;
          for (const p of props) {
            const { mesh, obj } = p;
            const scl = obj.scale ?? [1, 1, 1];
            const active = spec.events.filter(
              (e: CWEvent) =>
                heldKeys.has(e.key) && (e.target === obj.id || e.target === "all")
            );
            const has = (a: CWEvent["action"]) => active.some((e) => e.action === a);
            const speedOf = (a: CWEvent["action"]) =>
              active.find((e) => e.action === a)?.speed ?? 1;

            // drop / launch with REAL spec gravity on real terrain
            const groundY = hf.height(mesh.position.x, mesh.position.z) + scl[1] / 2;
            if (has("drop") && !p.disturbed) {
              p.disturbed = true;
              p.vy = 0;
            }
            if (has("launch") && !p.disturbed) {
              p.disturbed = true;
              p.vy = 7 * speedOf("launch");
            }
            if (p.disturbed) {
              p.vy -= spec.gravity * dt;
              mesh.position.y += p.vy * dt;
              if (mesh.position.y <= groundY && p.vy < 0) {
                mesh.position.y = groundY;
                p.vy = 0;
              }
            }
            if (!has("drop") && !has("launch") && p.disturbed) {
              p.disturbed = false;
              p.vy = 0;
            }
            if (!p.disturbed) {
              const targetY =
                p.base.y + (obj.float ? Math.sin(t * obj.float.speed) * obj.float.amp : 0);
              mesh.position.y = THREE.MathUtils.lerp(
                mesh.position.y,
                targetY,
                1 - Math.exp(-4 * dt)
              );
            }

            // orbit
            if (has("orbit")) {
              p.angle += dt * 0.9 * speedOf("orbit");
              mesh.position.x = Math.cos(p.angle) * p.baseRadius;
              mesh.position.z = Math.sin(p.angle) * p.baseRadius;
              mesh.position.y = restY(obj, mesh.position.x, mesh.position.z, scl[1] / 2);
            } else {
              mesh.position.x = THREE.MathUtils.lerp(
                mesh.position.x,
                p.base.x,
                1 - Math.exp(-3 * dt)
              );
              mesh.position.z = THREE.MathUtils.lerp(
                mesh.position.z,
                p.base.z,
                1 - Math.exp(-3 * dt)
              );
              p.angle = Math.atan2(p.base.z, p.base.x);
            }

            // pulse
            if (has("pulse")) {
              const s = 1 + 0.18 * Math.sin(t * 6);
              mesh.scale.set(p.baseScale.x * s, p.baseScale.y * s, p.baseScale.z * s);
              for (const m of p.mats) m.emissiveIntensity = 1.6 + Math.sin(t * 6);
            } else {
              mesh.scale.set(p.baseScale.x, p.baseScale.y, p.baseScale.z);
              for (const m of p.mats) m.emissiveIntensity = obj.emissive ? 1.4 : 0;
            }

            // toggle + ambient spin
            mesh.visible = !has("toggle");
            if (obj.spin) mesh.rotation.y += obj.spin * dt;

            if (p.label) {
              const distSq = camera.position.distanceToSquared(mesh.position);
              p.label.visible = mesh.visible && distSq < 70 * 70; // hide far labels
              p.label.position.set(
                mesh.position.x,
                mesh.position.y + scl[1] / 2 + 0.9,
                mesh.position.z
              );
              p.label.lookAt(camera.position);
            }
          }
        };

        renderer.setAnimationLoop(() => {
          const now = performance.now();
          const dt = Math.min((now - prevT) / 1000, 0.05);
          prevT = now;
          elapsed += dt;
          const t = elapsed;
          updatePlayer(dt);
          updateProps(dt, t);
          // shadow frustum follows the player (hard shadows, always crisp)
          sun.position.copy(player.pos).addScaledVector(sunDir, 210);
          sun.target.position.copy(player.pos);
          post.render();
        });

        setReady(true);
      } catch (err) {
        console.error("[RealWorld] init failed:", err);
        if (!cancelled) setFailed(String(err instanceof Error ? err.message : err));
      }
    })();

    return () => {
      cancelled = true;
      if (renderer) {
        renderer.setAnimationLoop(null);
        disposers.forEach((d) => {
          try {
            d();
          } catch {
            /* already gone */
          }
        });
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ══ HUD (same design system as CodeWorld) ═════════════════════════════
  return (
    <div className="experience">
      <div ref={mountRef} className="rw-canvas" />
      <div className="vignette" />

      {/* crosshair */}
      {ready && locked && <div className="rw-crosshair" />}

      {/* click-to-walk / loading overlay */}
      {(!ready || !locked) && !failed && (
        <div
          className="rw-lock"
          onClick={() => {
            if (!ready) return;
            const canvas = mountRef.current?.querySelector("canvas");
            canvas?.requestPointerLock();
          }}
        >
          <div className="rw-lock-card">
            {!ready ? (
              <>
                <div className="rw-spinner" />
                <h3>Compiling the Moon…</h3>
                <p>WebGPU shaders · real LROC terrain · photoreal post chain</p>
              </>
            ) : (
              <>
                <h3>🌕 {plan.title}</h3>
                <p>Click to step onto the surface</p>
                <small>
                  WASD move · <kbd>Space</kbd> hop (g = {spec.gravity} m/s²) ·{" "}
                  <kbd>Shift</kbd> sprint · <kbd>1</kbd>–<kbd>5</kbd> events ·{" "}
                  <kbd>ESC</kbd> release cursor
                </small>
              </>
            )}
          </div>
        </div>
      )}

      {failed && (
        <div className="rw-lock">
          <div className="rw-lock-card">
            <h3>⚠️ Runtime 2.0 failed to start</h3>
            <p>{failed}</p>
            <button className="btn ghost small" onClick={onExit}>
              Back to safety
            </button>
          </div>
        </div>
      )}

      <aside className="hud">
        <div className="hud-header">
          <h3>{plan.title}</h3>
          <span className="clock">RT2.0 · FREE ♾️</span>
        </div>

        <div className="hud-missions">
          <h4>Event keys — hold to trigger</h4>
          <div className="event-keys">
            {spec.events.map((ev) => (
              <button
                key={ev.key}
                className={`event-chip ${held.has(ev.key) ? "active" : ""}`}
                onMouseDown={() => hold(ev.key)}
                onMouseUp={() => release(ev.key)}
                onMouseLeave={() => heldRef.current.has(ev.key) && release(ev.key)}
              >
                <kbd>{ev.key}</kbd> {ev.name}
              </button>
            ))}
          </div>
        </div>

        <div className="hud-missions">
          <h4>🎯 Missions</h4>
          <ul>
            {plan.missions.map((m, i) => (
              <li key={i} className={done[i] ? "done" : ""}>
                <label>
                  <input
                    type="checkbox"
                    checked={done[i]}
                    onChange={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))}
                  />
                  <span>
                    <strong>
                      {m.event_key && <kbd className="mission-key">{m.event_key}</kbd>} {m.title}
                    </strong>
                    <small>{m.description}</small>
                    <em>💡 {m.hint}</em>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="hud-controls">
          <p>
            🌕 Photoreal-by-code · g = {spec.gravity} m/s² · zero credits burned
          </p>
          <button className="btn ghost small" onClick={onExit}>
            End session
          </button>
        </div>
      </aside>

      <div className="control-pill">
        <span>
          <kbd>WASD</kbd> move
        </span>
        <span>
          <kbd>Space</kbd> hop
        </span>
        <span>
          <kbd>Shift</kbd> sprint
        </span>
        <span>
          <kbd>1</kbd>–<kbd>5</kbd> events
        </span>
      </div>
    </div>
  );
}
