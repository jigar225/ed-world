"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LingbotWorld2Provider,
  LingbotWorld2MainVideoView,
  useLingbotWorld2,
  useLingbotWorld2State,
  useLingbotWorld2CommandError,
} from "@reactor-models/lingbot-world-2";
import { composePrompt, composeIdlePrompt } from "@/lib/lingbot";
import { LingbotLessonPlan, saveWorld } from "@/lib/worlds";
import LoadingUniverse from "@/components/LoadingUniverse";

interface Props {
  jwt: string;
  plan: LingbotLessonPlan;
  onExit: () => void;
}

export default function LingbotExperience({ jwt, plan, onExit }: Props) {
  return (
    <LingbotWorld2Provider jwtToken={jwt} connectOptions={{ autoConnect: true }}>
      <div className="experience">
        <LingbotWorld2MainVideoView className="world-video" videoObjectFit="cover" muted />
        <div className="vignette" />
        <Controller plan={plan} onExit={onExit} />
        <div className="control-pill">
          <span>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> move
          </span>
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd>
            <kbd>↑</kbd>
            <kbd>↓</kbd> look
          </span>
          <span>
            <kbd>1</kbd>–<kbd>4</kbd> events
          </span>
          <span>
            <kbd>Space</kbd> jump
          </span>
        </div>
      </div>
    </LingbotWorld2Provider>
  );
}

function Controller({ plan, onExit }: { plan: LingbotLessonPlan; onExit: () => void }) {
  const {
    status,
    uploadFile,
    setImage,
    setPrompt,
    setRotationSpeedDeg,
    start,
    disconnect,
    setMoveLongitudinal,
    setMoveLateral,
    setLookHorizontal,
    setLookVertical,
  } = useLingbotWorld2();

  const scene = plan.scene;

  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [flowStage, setFlowStage] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [done, setDone] = useState<boolean[]>(() => plan.missions.map(() => false));
  const [heldEvents, setHeldEvents] = useState<Set<string>>(new Set());

  const stagedRef = useRef(false);
  const savedRef = useRef(false);
  const t0Ref = useRef(Date.now());
  const movingRef = useRef(false);
  const verticalRef = useRef<"jump" | "crouch" | null>(null);
  const heldRef = useRef<Set<string>>(new Set());
  const lastPromptRef = useRef<string>("");

  const log = useCallback((msg: string) => {
    const s = ((Date.now() - t0Ref.current) / 1000).toFixed(1);
    const line = `[${s}s] ${msg}`;
    console.log(`[lingbot] ${line}`);
    setLogs((l) => [...l.slice(-7), line]);
  }, []);

  // Model state snapshots drive the "live" flag.
  useLingbotWorld2State((s) => {
    setLive(s.running);
  });
  useLingbotWorld2CommandError((e) => {
    log(`command_error — ${e.command}: ${e.reason}`);
  });

  /** Recompose the layered prompt for the CURRENT input state and hot-swap it. */
  const recompose = useCallback(() => {
    const prompt = composePrompt(scene, {
      moving: movingRef.current,
      heldEventKeys: [...heldRef.current],
      vertical: verticalRef.current,
    });
    if (prompt === lastPromptRef.current) return;
    lastPromptRef.current = prompt;
    void setPrompt({ prompt }).catch(() => {});
  }, [scene, setPrompt]);

  // Stage the world once the session is ready: seed image → prompt → start.
  useEffect(() => {
    if (status !== "ready" || stagedRef.current) return;
    stagedRef.current = true;
    log("session ready — staging world");

    (async () => {
      try {
        // 1. Seed image (REQUIRED for LingBot) — derived from the scene layers.
        setFlowStage(1);
        log("painting seed frame from scene layers…");
        const tImg = Date.now();
        const ir = await fetch(
          `/api/image?prompt=${encodeURIComponent(plan.seed_image_prompt)}`
        );
        if (!ir.ok) throw new Error(`seed image failed (HTTP ${ir.status})`);
        const blob = await ir.blob();
        const provider = ir.headers.get("X-Image-Provider") ?? "unknown";
        log(
          `seed ready in ${((Date.now() - tImg) / 1000).toFixed(1)}s — ${Math.round(blob.size / 1024)} KB via ${provider}`
        );

        // 2. Anchor the world: image + idle-composed prompt.
        setFlowStage(2);
        log("anchoring world (set_image + set_prompt)…");
        const ref = await uploadFile(blob);
        await setImage({ image: ref });
        log("image anchored");
        await setRotationSpeedDeg({ rotation_speed_deg: 8 });
        const idle = composeIdlePrompt(scene);
        lastPromptRef.current = idle;
        await setPrompt({ prompt: idle });

        // 3. Ignite.
        setFlowStage(3);
        log("starting generation…");
        await start();
        log("stream igniting 🟢");

        if (!savedRef.current) {
          savedRef.current = true;
          saveWorld({
            id: `lingbot:${plan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${Date.now()}`,
            engine: "lingbot",
            plan,
            createdAt: Date.now(),
          });
        }
      } catch (e) {
        stagedRef.current = false;
        log(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Event hold/release — shared by keyboard and on-screen chips.
  const holdEvent = useCallback(
    (key: string) => {
      if (!scene.events.some((e) => e.key === key)) return;
      heldRef.current.add(key);
      setHeldEvents(new Set(heldRef.current));
      recompose();
    },
    [scene, recompose]
  );
  const releaseEvent = useCallback(
    (key: string) => {
      heldRef.current.delete(key);
      setHeldEvents(new Set(heldRef.current));
      recompose();
    },
    [recompose]
  );

  // Keyboard controls — persistent axes + prompt recomposition per the harness.
  useEffect(() => {
    if (!live) return;

    const pressedMove = new Set<string>();

    const isTyping = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

    const updateMoving = () => {
      const moving = pressedMove.size > 0;
      if (moving !== movingRef.current) {
        movingRef.current = moving;
        recompose();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const key = e.key.toLowerCase();
      if (key === "w" || key === "s") {
        e.preventDefault();
        pressedMove.add(key);
        void setMoveLongitudinal({
          move_longitudinal: key === "w" ? "forward" : "back",
        });
        updateMoving();
      } else if (key === "a" || key === "d") {
        e.preventDefault();
        pressedMove.add(key);
        void setMoveLateral({
          move_lateral: key === "a" ? "strafe_left" : "strafe_right",
        });
        updateMoving();
      } else if (key === "arrowleft" || key === "arrowright") {
        e.preventDefault();
        void setLookHorizontal({ look_horizontal: key === "arrowleft" ? "left" : "right" });
      } else if (key === "arrowup" || key === "arrowdown") {
        e.preventDefault();
        void setLookVertical({ look_vertical: key === "arrowup" ? "up" : "down" });
      } else if (/^[1-9]$/.test(key)) {
        e.preventDefault();
        holdEvent(key);
      } else if (key === " ") {
        e.preventDefault();
        verticalRef.current = "jump";
        recompose();
      } else if (key === "c") {
        e.preventDefault();
        verticalRef.current = "crouch";
        recompose();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "w" || key === "s") {
        pressedMove.delete(key);
        void setMoveLongitudinal({ move_longitudinal: "idle" });
        updateMoving();
      } else if (key === "a" || key === "d") {
        pressedMove.delete(key);
        void setMoveLateral({ move_lateral: "idle" });
        updateMoving();
      } else if (key === "arrowleft" || key === "arrowright") {
        void setLookHorizontal({ look_horizontal: "idle" });
      } else if (key === "arrowup" || key === "arrowdown") {
        void setLookVertical({ look_vertical: "idle" });
      } else if (/^[1-9]$/.test(key)) {
        releaseEvent(key);
      } else if (key === " " || key === "c") {
        verticalRef.current = null;
        recompose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      void setMoveLongitudinal({ move_longitudinal: "idle" }).catch(() => {});
      void setMoveLateral({ move_lateral: "idle" }).catch(() => {});
      void setLookHorizontal({ look_horizontal: "idle" }).catch(() => {});
      void setLookVertical({ look_vertical: "idle" }).catch(() => {});
    };
  }, [
    live,
    recompose,
    holdEvent,
    releaseEvent,
    setMoveLongitudinal,
    setMoveLateral,
    setLookHorizontal,
    setLookVertical,
  ]);

  const buildSteps = [
    "Linking to the world engine",
    "Painting the seed frame",
    "Anchoring the world",
    "Igniting the stream",
  ];

  const showLoading = !error && !live;

  return (
    <>
      {showLoading && (
        <LoadingUniverse
          title={plan.title}
          subtitle="Staging your world · LingBot eco engine"
          steps={buildSteps}
          activeIndex={Math.min(flowStage, buildSteps.length - 1)}
          logs={logs}
        />
      )}

      {error && (
        <div className="overlay">
          <h2>⚠️ Something went wrong</h2>
          <p className="subtitle">{error}</p>
          <button className="btn ghost" onClick={onExit}>
            Back
          </button>
        </div>
      )}

      {live && (
        <aside className="hud">
          <div className="hud-header">
            <h3>{plan.title}</h3>
            <span className="clock">ECO</span>
          </div>

          <div className="hud-missions">
            <h4>Event keys — hold to trigger</h4>
            <div className="event-keys">
              {scene.events.map((ev) => (
                <button
                  key={ev.key}
                  className={`event-chip ${heldEvents.has(ev.key) ? "active" : ""}`}
                  onMouseDown={() => holdEvent(ev.key)}
                  onMouseUp={() => releaseEvent(ev.key)}
                  onMouseLeave={() => heldRef.current.has(ev.key) && releaseEvent(ev.key)}
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
            <button
              className="btn ghost small"
              onClick={async () => {
                try {
                  await disconnect();
                } catch {
                  /* already gone */
                }
                onExit();
              }}
            >
              End session
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
