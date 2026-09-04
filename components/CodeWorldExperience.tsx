"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars, Html } from "@react-three/drei";
import * as THREE from "three";
import type { CWEvent, CWObject, CWSpec } from "@/lib/codeworld";
import type { CodeworldPlan } from "@/lib/worlds";
import { saveWorld } from "@/lib/worlds";

// ── Sky / ground palettes ────────────────────────────────────────────────
const SKY_BG: Record<CWSpec["sky"], string> = {
  space: "#020208",
  day: "#87b5e8",
  sunset: "#2a1630",
  night: "#060a18",
  nebula: "#12041f",
  underwater: "#06283f",
  cell: "#1a0b2e",
};
const GROUND_COLOR: Record<string, string> = {
  moon: "#8d8d94",
  grass: "#2f6b3a",
  sand: "#d0ba82",
  water: "#16406e",
  grid: "#0b0e18",
  none: "#0b0e18",
};
const STAR_SKIES = new Set(["space", "night", "nebula", "cell"]);

interface Sim {
  vy: number;
  disturbed: boolean;
  angle: number;
  hidden: boolean;
}

function SimObject({
  obj,
  spec,
  heldRef,
}: {
  obj: CWObject;
  spec: CWSpec;
  heldRef: React.MutableRefObject<Set<string>>;
}) {
  const mesh = useRef<THREE.Mesh>(null!);
  const sim = useRef<Sim>({ vy: 0, disturbed: false, angle: 0, hidden: false });
  const base = obj.position;
  const scl = obj.scale ?? [1, 1, 1];
  const baseRadius = Math.hypot(base[0], base[2]) || 6;

  const geometry = useMemo(() => {
    switch (obj.shape) {
      case "sphere":
        return new THREE.SphereGeometry(0.5, 32, 32);
      case "cylinder":
        return new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
      case "cone":
        return new THREE.ConeGeometry(0.5, 1, 24);
      case "torus":
        return new THREE.TorusGeometry(0.5, 0.2, 16, 40);
      case "capsule":
        return new THREE.CapsuleGeometry(0.4, 0.6, 8, 16);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [obj.shape]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state, dtRaw) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const s = sim.current;
    const held = heldRef.current;

    // Which events affect this object right now?
    const active = spec.events.filter(
      (e) => held.has(e.key) && (e.target === obj.id || e.target === "all")
    );
    const has = (a: CWEvent["action"]) => active.some((e) => e.action === a);
    const speedOf = (a: CWEvent["action"]) =>
      active.find((e) => e.action === a)?.speed ?? 1;

    // ── Physics: drop / launch (real gravity from the spec) ──
    const groundY = scl[1] / 2;
    if (has("drop") && !s.disturbed) {
      s.disturbed = true;
      s.vy = 0;
    }
    if (has("launch") && !s.disturbed) {
      s.disturbed = true;
      s.vy = 7 * speedOf("launch");
    }
    if (s.disturbed) {
      s.vy -= spec.gravity * dt;
      m.position.y += s.vy * dt;
      if (m.position.y <= groundY && s.vy < 0) {
        m.position.y = groundY;
        s.vy = 0;
      }
    }
    // Reset when every drop/launch key affecting us is released.
    if (!has("drop") && !has("launch") && s.disturbed) {
      s.disturbed = false;
      s.vy = 0;
    }
    if (!s.disturbed) {
      // Idle float + ease back to base
      const targetY = base[1] + (obj.float ? Math.sin(t * obj.float.speed) * obj.float.amp : 0);
      m.position.y = THREE.MathUtils.lerp(m.position.y, targetY, 1 - Math.exp(-4 * dt));
    }

    // ── Orbit around world center ──
    if (has("orbit")) {
      s.angle += dt * 0.9 * speedOf("orbit");
      m.position.x = Math.cos(s.angle) * baseRadius;
      m.position.z = Math.sin(s.angle) * baseRadius;
    } else {
      m.position.x = THREE.MathUtils.lerp(m.position.x, base[0], 1 - Math.exp(-3 * dt));
      m.position.z = THREE.MathUtils.lerp(m.position.z, base[2], 1 - Math.exp(-3 * dt));
      s.angle = Math.atan2(base[2], base[0]);
    }

    // ── Pulse: glow + heartbeat scale ──
    const mat = m.material as THREE.MeshStandardMaterial;
    if (has("pulse")) {
      const k = 1 + 0.18 * Math.sin(t * 6);
      m.scale.set(scl[0] * k, scl[1] * k, scl[2] * k);
      mat.emissiveIntensity = 1.6 + Math.sin(t * 6);
    } else {
      m.scale.set(scl[0], scl[1], scl[2]);
      mat.emissiveIntensity = obj.emissive ? 1.1 : 0;
    }

    // ── Toggle visibility ──
    m.visible = !has("toggle");

    // ── Ambient spin ──
    if (obj.spin) m.rotation.y += obj.spin * dt;
  });

  return (
    <mesh
      ref={mesh}
      position={base}
      scale={[scl[0], scl[1], scl[2]]}
      geometry={geometry}
      castShadow
    >
      <meshStandardMaterial
        color={obj.color}
        emissive={obj.emissive ? obj.color : "#000000"}
        emissiveIntensity={obj.emissive ? 1.1 : 0}
        roughness={0.55}
        metalness={0.15}
      />
      {obj.label && (
        <Html center distanceFactor={26} position={[0, scl[1] / 2 + 0.7, 0]}>
          <div className="cw-label">{obj.label}</div>
        </Html>
      )}
    </mesh>
  );
}

function CodeWorldScene({
  spec,
  heldRef,
}: {
  spec: CWSpec;
  heldRef: React.MutableRefObject<Set<string>>;
}) {
  return (
    <>
      <color attach="background" args={[SKY_BG[spec.sky]]} />
      <fog attach="fog" args={[spec.fog_color, 35, 140]} />
      {STAR_SKIES.has(spec.sky) && (
        <Stars radius={90} depth={40} count={2600} factor={3} saturation={0} fade speed={0.6} />
      )}

      <ambientLight intensity={spec.ambient} />
      <directionalLight position={[18, 30, 12]} intensity={spec.sun} castShadow />

      {spec.ground !== "none" && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <circleGeometry args={[90, 64]} />
          <meshStandardMaterial color={GROUND_COLOR[spec.ground]} roughness={0.95} />
        </mesh>
      )}
      {spec.ground === "grid" && <gridHelper args={[120, 60, "#2a3355", "#171d33"]} />}

      {spec.objects.map((o) => (
        <SimObject key={o.id} obj={o} spec={spec} heldRef={heldRef} />
      ))}

      <OrbitControls
        makeDefault
        target={[0, 2.5, 0]}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={4}
        maxDistance={70}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
}

export default function CodeWorldExperience({
  plan,
  onExit,
}: {
  plan: CodeworldPlan;
  onExit: () => void;
}) {
  const spec = plan.spec;
  const [done, setDone] = useState<boolean[]>(() => plan.missions.map(() => false));
  const [held, setHeld] = useState<Set<string>>(new Set());
  const heldRef = useRef<Set<string>>(new Set());
  const savedRef = useRef(false);

  useEffect(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    saveWorld({
      id: `codeworld:${plan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${Date.now()}`,
      engine: "codeworld",
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

  return (
    <div className="experience">
      <Canvas
        camera={{ position: [15, 9, 17], fov: 55 }}
        dpr={[1, 2]}
        shadows
        style={{ position: "absolute", inset: 0 }}
      >
        <CodeWorldScene spec={spec} heldRef={heldRef} />
      </Canvas>
      <div className="vignette" />

      <aside className="hud">
        <div className="hud-header">
          <h3>{plan.title}</h3>
          <span className="clock">FREE ♾️</span>
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
            🧪 Deterministic physics · g = {spec.gravity} m/s² · zero credits burned
          </p>
          <button className="btn ghost small" onClick={onExit}>
            End session
          </button>
        </div>
      </aside>

      <div className="control-pill">
        <span>
          <kbd>Drag</kbd> orbit
        </span>
        <span>
          <kbd>Scroll</kbd> zoom
        </span>
        <span>
          <kbd>1</kbd>–<kbd>5</kbd> events
        </span>
      </div>
    </div>
  );
}
