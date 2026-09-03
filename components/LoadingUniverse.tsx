"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface Props {
  title: string;
  subtitle?: string;
  steps: string[];
  /** 0-based index of the in-progress step. Omit to auto-advance on a timer. */
  activeIndex?: number;
  autoAdvanceMs?: number;
  hint?: string;
  /** Live terminal log lines, latest last. */
  logs?: string[];
}

const TIPS = [
  "Your brain stores 3D places like real memories — that's why this beats re-reading.",
  "This world is being generated live by a real-time world model. No two visits are identical.",
  "NASA trains astronauts in simulated worlds. You're getting one for homework.",
  "The world being built is yours forever — re-enter it anytime, for free.",
  "Hold Shift to sprint. Space to jump. Arrows to look. You're welcome.",
  "Every mission you finish rewires this topic into long-term memory.",
];

const COLORS = ["#6cffc2", "#8aa2ff", "#a78bfa"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
}

export default function LoadingUniverse({
  title,
  subtitle,
  steps,
  activeIndex,
  autoAdvanceMs = 1800,
  hint = "Move your mouse — bend gravity while we build · click for a shockwave",
  logs,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tipIndex, setTipIndex] = useState(0);
  const [autoIdx, setAutoIdx] = useState(0);

  const idx = activeIndex ?? autoIdx;
  const pct = Math.min(
    97,
    Math.round((idx / Math.max(1, steps.length - 1)) * 100)
  );

  // Auto-advance steps when no external progress is provided.
  useEffect(() => {
    if (activeIndex !== undefined) return;
    const id = setInterval(
      () => setAutoIdx((i) => Math.min(i + 1, steps.length - 1)),
      autoAdvanceMs
    );
    return () => clearInterval(id);
  }, [activeIndex, autoAdvanceMs, steps.length]);

  // Rotate learning tips.
  useEffect(() => {
    const id = setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), 4200);
    return () => clearInterval(id);
  }, []);

  // Interactive gravity particle field.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;
    const particles: Particle[] = [];
    const pulses: { x: number; y: number; r: number; a: number }[] = [];
    const mouse = { x: -9999, y: -9999 };

    const spawn = () => {
      particles.length = 0;
      const count = Math.min(170, Math.floor((w * h) / 11000));
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          size: 1 + Math.random() * 2.2,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        });
      }
    };

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      spawn();
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };
    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pulses.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, r: 0, a: 1 });
    };

    const tick = () => {
      // trail fade
      ctx.fillStyle = "rgba(4, 4, 7, 0.22)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      // shockwaves
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.r += 9;
        p.a *= 0.94;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(108, 255, 194, ${p.a * 0.35})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (p.a < 0.02) pulses.splice(i, 1);
      }

      for (const pt of particles) {
        // mouse gravity well
        const dx = mouse.x - pt.x;
        const dy = mouse.y - pt.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 260 * 260 && d2 > 16) {
          const d = Math.sqrt(d2);
          const f = (1 - d / 260) * 0.35;
          pt.vx += (dx / d) * f;
          pt.vy += (dy / d) * f;
        }
        // shockwave kick
        for (const p of pulses) {
          const pdx = pt.x - p.x;
          const pdy = pt.y - p.y;
          const pd = Math.hypot(pdx, pdy);
          if (Math.abs(pd - p.r) < 30 && pd > 1) {
            pt.vx += (pdx / pd) * 2.2 * p.a;
            pt.vy += (pdy / pd) * 2.2 * p.a;
          }
        }

        pt.vx *= 0.96;
        pt.vy *= 0.96;
        pt.x += pt.vx;
        pt.y += pt.vy;

        if (pt.x < -10) pt.x = w + 10;
        if (pt.x > w + 10) pt.x = -10;
        if (pt.y < -10) pt.y = h + 10;
        if (pt.y > h + 10) pt.y = -10;

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fillStyle = pt.color;
        ctx.globalAlpha = 0.75;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
    };
  }, []);

  return (
    <div className="loading-universe">
      <canvas ref={canvasRef} className="lu-canvas" />
      <div className="lu-content">
        <motion.div
          key={title}
          className="lu-title"
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.028 } },
          }}
          aria-label={title}
        >
          {title.split("").map((ch, i) => (
            <motion.span
              key={i}
              style={{ display: "inline-block", whiteSpace: "pre" }}
              variants={{
                hidden: { opacity: 0, y: 22, rotateX: -50, filter: "blur(6px)" },
                show: {
                  opacity: 1,
                  y: 0,
                  rotateX: 0,
                  filter: "blur(0px)",
                  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
                },
              }}
            >
              {ch}
            </motion.span>
          ))}
        </motion.div>
        {subtitle && <div className="lu-subtitle">{subtitle}</div>}

        <div className="lu-progress">
          <div className="lu-progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="lu-pct">{pct}%</div>

        <ul className="lu-steps">
          {steps.map((s, i) => (
            <li
              key={s}
              className={i < idx ? "done" : i === idx ? "active" : ""}
            >
              <span className="lu-dot" />
              <span className="lu-step-text">{s}</span>
            </li>
          ))}
        </ul>

        <div className="lu-tip-wrap">
          <AnimatePresence mode="wait">
            <motion.div
              key={tipIndex}
              className="lu-tip"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4 }}
            >
              💡 {TIPS[tipIndex]}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="lu-hint">{hint}</div>

        {logs && logs.length > 0 && (
          <div className="lu-log">
            {logs.map((l, i) => (
              <div key={i} className="lu-log-line">
                <span>›</span> {l}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
