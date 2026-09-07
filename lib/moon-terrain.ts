// Moon Terrain — deterministic lunar heightfield (P1 Runtime 2.0).
// Seeded value-noise fbm + "bombing pattern" crater generator (worley-style
// jittered grid, ring-falloff rim, parabolic bowl, faint ejecta skirt).
// The SAME height function drives CPU vertex displacement AND player/prop
// ground collision → physics always matches the visuals. $0, no downloads.

export interface Crater {
  x: number;
  z: number;
  r: number; // radius (m)
  depth: number; // bowl depth (m)
  rim: number; // rim height (m)
}

export interface LunarHeightfield {
  height: (x: number, z: number) => number;
  // Smooth silhouette-only variant for the far horizon ring: big swells +
  // basins (+ real DTM where present), NO cell/micro craters. On the ring's
  // coarse tessellation, crater-scale detail aliases into vertical fins
  // (the "picket fence" artifact).
  heightFar: (x: number, z: number) => number;
  craters: Crater[];
  seed: number;
}

// Real NASA elevation tile (NAC_DTM_APOLLO15 crop, public/terrain/moon-dem.*).
// When present it REPLACES the procedural macro terrain inside its extent —
// real craters, real rille-adjacent mare. Procedural stays as fallback and
// for the far horizon ring beyond the tile.
export interface LunarDEM {
  data: Uint16Array; // row-major, north-up
  width: number;
  height: number;
  meters: number; // tile covers meters x meters, centered on origin
  minHeight: number;
  maxHeight: number;
}

// ── Seeded PRNG ───────────────────────────────────────────────────────────
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 2D value noise (deterministic, integer-lattice hashed) ───────────────
function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}

export function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm; // -1..1
}

// ── Crater field ──────────────────────────────────────────────────────────
// Craters live on a jittered grid so runtime lookup is O(1): query the 3×3
// cells around a point instead of scanning every crater.
const CELL = 64; // one potential crater per 64m cell

function craterForCell(cx: number, cz: number, seed: number): Crater | null {
  const roll = hash2(cx, cz, seed ^ 0x5f3a);
  if (roll < 0.42) return null; // 58% of cells are empty
  const rand = mulberry32((hash2(cx, cz, seed) * 4294967295) | 0);
  const r = 3 + Math.pow(rand(), 2.2) * 34; // 3–37m, many small / few big
  const depth = r * (0.17 + rand() * 0.13); // real crater depth/diameter ≈ 0.2
  const rim = depth * (0.22 + rand() * 0.2);
  return {
    x: (cx + 0.15 + rand() * 0.7) * CELL,
    z: (cz + 0.15 + rand() * 0.7) * CELL,
    r,
    depth,
    rim,
  };
}

/** Classic crater profile: raised gaussian rim + parabolic bowl + ejecta fade. */
function craterProfile(c: Crater, x: number, z: number): number {
  const dx = x - c.x;
  const dz = z - c.z;
  const d = Math.sqrt(dx * dx + dz * dz) / c.r;
  if (d > 3) return 0;
  let h = 0;
  if (d < 1) {
    // bowl (cosine-shaped depression, slightly flattened floor)
    h -= c.depth * (0.55 + 0.45 * Math.cos(Math.PI * Math.pow(d, 1.6)));
  }
  // rim ring at d ≈ 1
  const rimG = Math.exp(-Math.pow((d - 1) * 4.2, 2));
  h += c.rim * rimG;
  // faint ejecta blanket 1 < d < 3
  if (d > 1) {
    const f = (d - 1) / 2;
    h += c.rim * 0.28 * (1 - f) * (1 - f);
  }
  return h;
}

// ── Micro-craters (1.5–6m) ────────────────────────────────────────────────
// The real DTM is 2m/px — it can't hold craters this small, so this octave
// rides on top of BOTH the DTM and the procedural fallback. Small-cell grid,
// same O(1) jittered-cell lookup as the big craters.
const MICRO_CELL = 11;

function microCraterForCell(cx: number, cz: number, seed: number): Crater | null {
  const roll = hash2(cx, cz, seed ^ 0x71c9);
  if (roll < 0.55) return null; // 45% of cells hold a micro crater
  const rand = mulberry32((hash2(cx, cz, seed ^ 0x1b3f) * 4294967295) | 0);
  const r = 0.75 + Math.pow(rand(), 1.9) * 2.6; // 0.75–3.35m
  const depth = r * (0.14 + rand() * 0.08); // simple craters: shallower
  const rim = depth * (0.18 + rand() * 0.15);
  return {
    x: (cx + 0.2 + rand() * 0.6) * MICRO_CELL,
    z: (cz + 0.2 + rand() * 0.6) * MICRO_CELL,
    r,
    depth,
    rim,
  };
}

/**
 * Build the lunar heightfield. `seed` makes the whole moon deterministic —
 * same lesson topic ⇒ same moon, every load, every judge's laptop.
 * Pass `dem` (real NASA tile) to swap the procedural macro terrain for real
 * Apollo 15 topography inside the tile extent (blend band at the edge).
 */
export function createLunarHeightfield(seed = 1337, dem?: LunarDEM | null): LunarHeightfield {
  // A few hand-scattered BIG basins for silhouette variety at distance.
  const rand = mulberry32(seed ^ 0x9e37);
  const basins: Crater[] = [];
  for (let i = 0; i < 26; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = 120 + rand() * 2000;
    const r = 40 + Math.pow(rand(), 1.6) * 160; // 40–200m monsters
    basins.push({
      x: Math.cos(ang) * dist,
      z: Math.sin(ang) * dist,
      r,
      depth: r * (0.08 + rand() * 0.06),
      rim: r * 0.02 * (0.5 + rand()),
    });
  }

  const cellCache = new Map<string, Crater | null>();
  const cell = (cx: number, cz: number): Crater | null => {
    const k = `${cx},${cz}`;
    if (!cellCache.has(k)) cellCache.set(k, craterForCell(cx, cz, seed));
    return cellCache.get(k)!;
  };
  const microCache = new Map<string, Crater | null>();
  const microCell = (cx: number, cz: number): Crater | null => {
    const k = `${cx},${cz}`;
    if (!microCache.has(k)) microCache.set(k, microCraterForCell(cx, cz, seed));
    return microCache.get(k)!;
  };

  // ── Real DTM sampler (bilinear, world metres) ──
  let demHeight: ((x: number, z: number) => number) | null = null;
  let demHalf = 0;
  if (dem) {
    demHalf = dem.meters / 2;
    const { data, width, height: dh, minHeight, maxHeight } = dem;
    const range = maxHeight - minHeight;
    demHeight = (x: number, z: number) => {
      // world → grid: x east→col, z SOUTH→row (row 0 = north edge = -z)
      const gx = ((x + demHalf) / dem.meters) * (width - 1);
      const gz = ((-z + demHalf) / dem.meters) * (dh - 1);
      const x0 = Math.max(0, Math.min(width - 2, Math.floor(gx)));
      const z0 = Math.max(0, Math.min(dh - 2, Math.floor(gz)));
      const fx = Math.max(0, Math.min(1, gx - x0));
      const fz = Math.max(0, Math.min(1, gz - z0));
      const i00 = data[z0 * width + x0];
      const i10 = data[z0 * width + x0 + 1];
      const i01 = data[(z0 + 1) * width + x0];
      const i11 = data[(z0 + 1) * width + x0 + 1];
      const v =
        i00 + (i10 - i00) * fx + (i01 - i00) * fz + (i00 - i10 - i01 + i11) * fx * fz;
      return minHeight + (v / 65535) * range;
    };
  }

  const height = (x: number, z: number): number => {
    // fine grain rides on everything (DTM is 2m/px — sub-2m detail is ours)
    let h = fbm(x / 7.5, z / 7.5, seed + 13, 2) * 0.22;
    h += fbm(x / 1.9, z / 1.9, seed + 29, 2) * 0.055; // sub-meter regolith grain

    // micro-craters from the 3×3 neighbourhood of small jittered cells
    const mcx = Math.floor(x / MICRO_CELL);
    const mcz = Math.floor(z / MICRO_CELL);
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const c = microCell(mcx + i, mcz + j);
        if (c) h += craterProfile(c, x, z);
      }
    }

    // macro terrain: REAL DTM inside its extent, procedural elsewhere,
    // 80m blend band so the far ring never shows a seam
    const cheby = Math.max(Math.abs(x), Math.abs(z));
    const BAND = 80;
    if (!demHeight || cheby >= demHalf) {
      h += fbm(x / 260, z / 260, seed, 4) * 7.5;
      h += fbm(x / 46, z / 46, seed + 7, 3) * 1.35;
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const c = cell(cx + i, cz + j);
          if (c) h += craterProfile(c, x, z);
        }
      }
      for (const b of basins) h += craterProfile(b, x, z);
    } else if (cheby <= demHalf - BAND) {
      h += demHeight(x, z);
    } else {
      const t = (cheby - (demHalf - BAND)) / BAND;
      const s = t * t * (3 - 2 * t);
      let proc = fbm(x / 260, z / 260, seed, 4) * 7.5;
      proc += fbm(x / 46, z / 46, seed + 7, 3) * 1.35;
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const c = cell(cx + i, cz + j);
          if (c) proc += craterProfile(c, x, z);
        }
      }
      h += demHeight(x, z) * (1 - s) + proc * s;
    }
    return h;
  };

  // Far-ring variant: macro silhouette only (see LunarHeightfield.heightFar).
  const heightFar = (x: number, z: number): number => {
    const swells = fbm(x / 260, z / 260, seed, 4) * 7.5 + fbm(x / 46, z / 46, seed + 7, 3) * 1.35;
    let basinH = 0;
    for (const b of basins) basinH += craterProfile(b, x, z);
    if (!demHeight) return swells + basinH;
    const cheby = Math.max(Math.abs(x), Math.abs(z));
    const BAND = 80;
    if (cheby <= demHalf - BAND) return demHeight(x, z);
    if (cheby >= demHalf) return swells + basinH;
    const t = (cheby - (demHalf - BAND)) / BAND;
    const s = t * t * (3 - 2 * t);
    return demHeight(x, z) * (1 - s) + (swells + basinH) * s;
  };

  return { height, heightFar, craters: basins, seed };
}

// ── Geometry builders (plain three geometry — runtime displaces on CPU) ───
import * as THREE from "three";

/** High-detail walkable terrain: `size` metres across, heightfield-displaced. */
export function buildTerrainGeometry(
  hf: LunarHeightfield,
  size = 420,
  segments = 300
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2); // XZ plane, +Y up
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, hf.height(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Low-detail far ring (inner → outer radius) so the horizon never ends. */
export function buildFarTerrainGeometry(
  hf: LunarHeightfield,
  inner = 200,
  outer = 2600
): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(inner, outer, 128, 14);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, hf.heightFar(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// ── Rock scatter (P1.5b) ─────────────────────────────────────────────────
// The Moon is COVERED in rocks (ejecta). Two instanced tiers: pebbles you
// crunch past by the thousand, boulders that cast real shadows. Placement is
// seeded-deterministic, slope-rejected, half-buried — physics-free dressing.

/** Deformed icosahedron: seeded radial jitter + vertical squash. */
export function buildRockGeometry(seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.5, 1); // unit-ish, radius 0.5
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const rand = mulberry32(seed);
  const jitters = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos
      .getZ(i)
      .toFixed(4)}`;
    if (!jitters.has(key)) jitters.set(key, 0.72 + rand() * 0.56);
    const k = jitters.get(key)!;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.78, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export interface RockTransform {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  tint: number; // 0.7..1.1 grey multiplier
}

/** Seeded rock placement over the near field. Skips steep crater walls. */
export function scatterRocks(
  hf: LunarHeightfield,
  seed: number,
  count: number,
  minR: number,
  maxR: number,
  radius: number
): RockTransform[] {
  const rand = mulberry32(seed);
  const out: RockTransform[] = [];
  let guard = count * 8;
  while (out.length < count && guard-- > 0) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * radius; // uniform density
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const scale = minR + Math.pow(rand(), 2.6) * (maxR - minR); // many small
    // slope rejection — rocks rest on flats, not crater walls
    const e = Math.max(0.6, scale);
    const hx = hf.height(x + e, z) - hf.height(x - e, z);
    const hz = hf.height(x, z + e) - hf.height(x, z - e);
    if (Math.max(Math.abs(hx), Math.abs(hz)) / (2 * e) > 0.42) continue;
    out.push({
      x,
      y: hf.height(x, z) + scale * 0.18, // half-buried
      z,
      scale,
      rotY: rand() * Math.PI * 2,
      tint: 0.72 + rand() * 0.38,
    });
  }
  return out;
}

/**
 * Low-frequency RGBA noise texture for macro-variation albedo breakup —
 * kills the "tiling texture" giveaway at distance (expert fix #2).
 */
export function makeMacroNoiseTexture(seed = 42): THREE.DataTexture {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // tileable-ish: sample on a torus by wrapping lattice coords
      const u = x / S;
      const v = y / S;
      const r = fbm(Math.sin(u * Math.PI * 2) * 3 + 10, Math.cos(v * Math.PI * 2) * 3 + 10, seed, 4);
      const g = fbm(Math.cos(u * Math.PI * 2) * 6 + 40, Math.sin(v * Math.PI * 2) * 6 + 40, seed + 5, 3);
      data[i] = Math.round((r * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((g * 0.5 + 0.5) * 255);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
