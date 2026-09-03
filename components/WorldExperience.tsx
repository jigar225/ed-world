"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HappyOysterProvider,
  HappyOysterVideo,
  useHappyOyster,
} from "@reactor-models/happy-oyster/react";
import { LessonPlan, saveWorld } from "@/lib/worlds";
import LoadingUniverse from "@/components/LoadingUniverse";

interface Props {
  jwt: string;
  plan: LessonPlan;
  worldId?: string; // when set, re-enter an existing world instead of generating
  onExit: () => void;
}

export default function WorldExperience({ jwt, plan, worldId, onExit }: Props) {
  return (
    <HappyOysterProvider mode="adventure" jwt={jwt} autoConnect>
      <div className="experience">
        <HappyOysterVideo autoPlay muted playsInline className="world-video" />
        <div className="vignette" />
        <Controller plan={plan} worldId={worldId} onExit={onExit} />
        <div className="control-pill">
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</span>
          <span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> look</span>
          <span><kbd>Space</kbd> jump</span>
          <span><kbd>Shift</kbd> sprint</span>
        </div>
      </div>
    </HappyOysterProvider>
  );
}

const MOVE_KEYS: Record<string, string> = {
  w: "Front",
  s: "Back",
  a: "Left",
  d: "Right",
};
const LOOK_KEYS: Record<string, string> = {
  arrowup: "Mouse_Up",
  arrowdown: "Mouse_Down",
  arrowleft: "Mouse_Left",
  arrowright: "Mouse_Right",
};

function Controller({
  plan,
  worldId,
  onExit,
}: {
  plan: LessonPlan;
  worldId?: string;
  onExit: () => void;
}) {
  const {
    phase,
    worldState,
    travelState,
    maxExperienceTimeSec,
    createWorld,
    attachWorld,
    startTravel,
    endTravelSession,
    move,
    look,
    interact,
    hold,
    release,
    stop,
  } = useHappyOyster();

  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<boolean[]>(() => plan.missions.map(() => false));
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [flowStage, setFlowStage] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const startedRef = useRef(false);
  const travelStartRef = useRef<number | null>(null);
  const savedRef = useRef(false);
  const t0Ref = useRef(Date.now());

  const log = useCallback((msg: string) => {
    const s = ((Date.now() - t0Ref.current) / 1000).toFixed(1);
    const line = `[${s}s] ${msg}`;
    console.log(`[world] ${line}`);
    setLogs((l) => [...l.slice(-7), line]);
  }, []);

  // Create (or re-attach) the world once connected, then start traveling.
  useEffect(() => {
    if (phase !== "connected" || startedRef.current) return;
    startedRef.current = true;
    log("session connected to world engine");
    (async () => {
      try {
        setFlowStage(1);
        log(worldId ? "re-opening saved world…" : "creating world on Happy Oyster (this is the slow part)…");
        const tWorld = Date.now();
        const world = worldId
          ? await attachWorld(worldId)
          : await createWorld({
              prompt: plan.world_prompt,
              perspective: "first_person",
            });
        log(`world ready in ${((Date.now() - tWorld) / 1000).toFixed(1)}s — id ${world.encrypted_world_id?.slice(0, 14)}…`);
        setFlowStage(2);
        if (world.encrypted_world_id && !savedRef.current) {
          savedRef.current = true;
          saveWorld({
            id: world.encrypted_world_id,
            plan,
            createdAt: Date.now(),
          });
        }
        log("starting travel — going live…");
        await startTravel();
        log("stream should be live 🟢");
      } catch (e) {
        startedRef.current = false;
        log(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const traveling = worldState?.phase === "traveling";
  const travelStatus = travelState?.status;

  // Travel clock.
  useEffect(() => {
    if (traveling && maxExperienceTimeSec) {
      travelStartRef.current = Date.now();
      const id = setInterval(() => {
        const elapsed = (Date.now() - (travelStartRef.current ?? Date.now())) / 1000;
        setSecondsLeft(Math.max(0, Math.round(maxExperienceTimeSec - elapsed)));
      }, 500);
      return () => clearInterval(id);
    }
    setSecondsLeft(null);
  }, [traveling, maxExperienceTimeSec]);

  // Keyboard controls: WASD move, arrows look, Space jump, Shift sprint.
  useEffect(() => {
    if (!traveling) return;

    let currentMove: string | null = null;
    let currentLook: string | null = null;
    let sprinting = false;

    const isTyping = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const key = e.key.toLowerCase();
      if (MOVE_KEYS[key]) {
        e.preventDefault();
        const value = MOVE_KEYS[key];
        if (currentMove !== value) {
          currentMove = value;
          void move(value as never);
        }
      } else if (LOOK_KEYS[key]) {
        e.preventDefault();
        const value = LOOK_KEYS[key];
        if (currentLook !== value) {
          currentLook = value;
          void look(value as never);
        }
      } else if (key === " ") {
        e.preventDefault();
        void interact("Jump" as never);
        setTimeout(() => void release({ interaction: true }), 300);
      } else if (key === "shift" && !sprinting) {
        sprinting = true;
        void hold({ interaction: "Sprint" as never });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (MOVE_KEYS[key] && currentMove === MOVE_KEYS[key]) {
        currentMove = null;
        void move("None" as never);
      } else if (LOOK_KEYS[key] && currentLook === LOOK_KEYS[key]) {
        currentLook = null;
        void look("None" as never);
      } else if (key === "shift") {
        sprinting = false;
        void release({ interaction: true });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      void stop();
    };
  }, [traveling, move, look, interact, hold, release, stop]);

  const continueExploring = useCallback(async () => {
    try {
      await startTravel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [startTravel]);

  const buildSteps = worldId
    ? [
        "Linking to the world engine",
        "Re-opening your saved world",
        "Stepping inside",
      ]
    : [
        "Linking to the world engine",
        "Sculpting terrain · light · physics",
        "Charging the portal",
      ];

  const showLoading =
    !error && worldState?.phase !== "traveling" && travelStatus !== "completed";

  return (
    <>
      {showLoading && (
        <LoadingUniverse
          title={plan.title}
          subtitle="Building your world"
          steps={buildSteps}
          activeIndex={Math.min(flowStage, buildSteps.length - 1)}
          logs={logs}
        />
      )}

      {travelStatus === "completed" && (
        <div className="overlay">
          <h2>⏱️ Travel session ended</h2>
          <p className="subtitle">Your world is saved — jump back in anytime.</p>
          <button className="btn primary big" onClick={continueExploring}>
            ▶ Continue exploring
          </button>
        </div>
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

      <aside className="hud">
        <div className="hud-header">
          <h3>{plan.title}</h3>
          {secondsLeft !== null && (
            <span className="clock">
              {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
            </span>
          )}
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
                    onChange={() =>
                      setDone((d) => d.map((v, j) => (j === i ? !v : v)))
                    }
                  />
                  <span>
                    <strong>{m.title}</strong>
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
                await endTravelSession();
              } catch {
                /* session may already be over */
              }
              onExit();
            }}
          >
            End session
          </button>
        </div>
      </aside>
    </>
  );
}
