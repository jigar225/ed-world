"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import WorldExperience from "@/components/WorldExperience";
import LoadingUniverse from "@/components/LoadingUniverse";
import {
  LessonPlan,
  SavedWorld,
  listWorlds,
  removeWorld,
} from "@/lib/worlds";

const Scene = dynamic(() => import("@/components/Scene"), { ssr: false });

type Stage =
  | { name: "home" }
  | { name: "planning" }
  | { name: "planned"; plan: LessonPlan }
  | { name: "world"; plan: LessonPlan; jwt: string; worldId?: string };

const EXAMPLES = ["Gravity on the Moon", "DNA replication", "The water cycle", "Photosynthesis"];

const MARQUEE_TOPICS = [
  "Gravity", "DNA Replication", "Black Holes", "Photosynthesis", "The Water Cycle",
  "Volcanoes", "The Solar System", "Neurons", "Plate Tectonics", "Ocean Currents",
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function Home() {
  const [stage, setStage] = useState<Stage>({ name: "home" });
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [worlds, setWorlds] = useState<SavedWorld[]>([]);

  useEffect(() => {
    setWorlds(listWorlds());
  }, [stage.name]);

  async function planLesson(chosenTopic: string) {
    setError(null);
    setStage({ name: "planning" });
    try {
      const r = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: chosenTopic }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to plan lesson");
      setStage({ name: "planned", plan: data as LessonPlan });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setStage({ name: "home" });
    }
  }

  async function enterWorld(plan: LessonPlan, worldId?: string) {
    setError(null);
    try {
      const r = await fetch("/api/token", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to get session token");
      setStage({ name: "world", plan, jwt: data.jwt, worldId });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-dot" />
          <span className="brand-name">EduWorld</span>
          <span className="brand-tag">the explorable classroom</span>
        </div>
        {stage.name !== "home" && (
          <button className="btn ghost small" onClick={() => setStage({ name: "home" })}>
            ← New lesson
          </button>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}

      <AnimatePresence mode="wait">
        {stage.name === "home" && (
          <motion.section
            key="home"
            className="hero"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.25 } }}
          >
            <div className="hero-canvas">
              <Scene />
            </div>

            <div className="hero-content">
              <motion.div className="hero-eyebrow" variants={fadeUp} initial="hidden" animate="show" custom={0}>
                The explorable classroom
              </motion.div>

              <motion.h1 variants={fadeUp} initial="hidden" animate="show" custom={1}>
                Don&apos;t read the lesson.
                <br />
                <span className="accent">Walk into it.</span>
              </motion.h1>

              <motion.p className="subtitle" variants={fadeUp} initial="hidden" animate="show" custom={2}>
                Type any topic. Our agent builds a living 3D world with guided missions —
                rendered in real time, explored like a game.
              </motion.p>

              <motion.form
                className="topic-form"
                variants={fadeUp}
                initial="hidden"
                animate="show"
                custom={3}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (topic.trim()) planLesson(topic.trim());
                }}
              >
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="I want to understand gravity…"
                  autoFocus
                />
                <button className="btn primary" type="submit" disabled={!topic.trim()}>
                  Build my world →
                </button>
              </motion.form>

              <motion.div className="chips" variants={fadeUp} initial="hidden" animate="show" custom={4}>
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="chip" onClick={() => planLesson(ex)}>
                    {ex}
                  </button>
                ))}
              </motion.div>
            </div>

            <motion.div
              className="marquee"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.8 }}
            >
              <div className="marquee-track">
                {[0, 1].map((dup) => (
                  <span key={dup} aria-hidden={dup === 1}>
                    {MARQUEE_TOPICS.map((t) => (
                      <span key={`${dup}-${t}`}>
                        {t} <i>◆</i>
                      </span>
                    ))}
                  </span>
                ))}
              </div>
            </motion.div>
          </motion.section>
        )}

        {stage.name === "planning" && (
          <motion.section
            key="planning"
            className="loading-stage"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.25 } }}
          >
            <LoadingUniverse
              title="Designing your lesson"
              subtitle={topic ? `“${topic}”` : undefined}
              steps={[
                "Reading your curiosity",
                "Dreaming the world blueprint",
                "Writing your missions",
              ]}
            />
          </motion.section>
        )}

        {stage.name === "planned" && (
          <motion.section
            key="planned"
            className="plan-stage"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, transition: { duration: 0.25 } }}
          >
            <div className="briefing-tag">Mission briefing</div>
            <h1>{stage.plan.title}</h1>
            <p className="subtitle">{stage.plan.summary}</p>

            <div className="plan-grid">
              <div className="panel">
                <h3>Your missions</h3>
                <ol className="mission-list">
                  {stage.plan.missions.map((m, i) => (
                    <li key={i}>
                      <strong>{m.title}</strong>
                      <p>{m.description}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="panel">
                <h3>The world we built for you</h3>
                <p className="world-prompt">{stage.plan.world_prompt}</p>
              </div>
            </div>

            <motion.button
              className="btn primary big"
              onClick={() => enterWorld(stage.plan)}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
            >
              Step inside →
            </motion.button>
          </motion.section>
        )}
      </AnimatePresence>

      {stage.name === "world" && (
        <WorldExperience
          jwt={stage.jwt}
          plan={stage.plan}
          worldId={stage.worldId}
          onExit={() => setStage({ name: "home" })}
        />
      )}

      {stage.name === "home" && (
        <>
          <section className="how">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="section-label">How it works</div>
              <h2 className="section-title">From curiosity to a world in about a minute.</h2>
            </motion.div>
            <div className="steps">
              {[
                {
                  num: "01",
                  title: "Tell the agent",
                  desc: "Describe anything you want to learn in plain words. No format, no setup — curiosity is the only input.",
                },
                {
                  num: "02",
                  title: "The world is built",
                  desc: "Kimi writes a world blueprint plus guided missions. A real-time world model renders it live, frame by frame.",
                },
                {
                  num: "03",
                  title: "Explore & remember",
                  desc: "Walk, jump, observe, complete missions. The world stays yours — re-enter it forever, for free.",
                },
              ].map((s, i) => (
                <motion.div
                  key={s.num}
                  className="step"
                  initial={{ opacity: 0, y: 32 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.6, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="step-ghost">{s.num}</div>
                  <div className="step-line" />
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                  {i < 2 && <div className="step-arrow">→</div>}
                </motion.div>
              ))}
            </div>
          </section>

          {worlds.length > 0 && (
            <section className="library">
              <div className="section-label">Persistent worlds</div>
              <h2>Your world library</h2>
              <p className="library-note">
                Generated once — re-entering never costs another world generation.
              </p>
              <div className="library-grid">
                {worlds.map((w) => (
                  <div key={w.id} className="world-card">
                    <div className="world-card-title">{w.plan.title}</div>
                    <div className="world-card-topic">{w.plan.topic}</div>
                    <div className="world-card-actions">
                      <button className="btn primary small" onClick={() => enterWorld(w.plan, w.id)}>
                        Re-enter
                      </button>
                      <button
                        className="btn ghost small"
                        onClick={() => {
                          removeWorld(w.id);
                          setWorlds(listWorlds());
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <footer className="footer">
            <span>
              <span className="footer-accent">EduWorld</span> — agent-designed worlds
            </span>
            <span>Kimi × Reactor HappyOyster</span>
          </footer>
        </>
      )}
    </main>
  );
}
