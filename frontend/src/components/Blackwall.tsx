'use client';

import { useEffect, useRef } from 'react';

export type ThreatLevel = 'CALM' | 'ACTIVE' | 'ROGUE_AI';

interface IntrusionPoint {
  x: number;
  y: number;
  bornAt: number; // ms, animation-clock time
  lifeMs: number;
  maxStrength: number; // px of pull at envelope peak
  radius: number; // falloff radius, px
}

const CELL = 30; // spacing of the diamond lattice, px (pre-DPR)
const SAMPLE_STEP = 10; // px along each mesh line between displacement samples

// Per-threat-level tuning for how the mesh gets probed.
const LEVEL_CONFIG: Record<ThreatLevel, { maxConcurrent: number; spawnChance: number; strength: number; radius: number; lifeMs: [number, number] }> = {
  CALM: { maxConcurrent: 0, spawnChance: 0, strength: 0, radius: 0, lifeMs: [0, 0] },
  ACTIVE: { maxConcurrent: 1, spawnChance: 0.006, strength: 22, radius: 90, lifeMs: [1400, 2200] },
  ROGUE_AI: { maxConcurrent: 3, spawnChance: 0.03, strength: 48, radius: 150, lifeMs: [900, 1600] },
};

/**
 * The console's signature visual — an animated representation of KMC's
 * perimeter defense (the brief's "Black Wall"). Redesigned from the
 * original vertical-streak version (read as generic radio-wave static, not
 * a barrier) into a diamond/lozenge lattice — two families of crossing
 * diagonal lines. Distortion is now LOCAL, not global: "intrusion points"
 * spawn at random spots on the mesh and pull nearby lattice points toward
 * them (like something pressing/pulling at a membrane from behind), with a
 * radial falloff so the rest of the grid stays undisturbed. Not
 * decoration — the intrusion rate and strength are a direct read of
 * system state:
 *   CALM     — zero intrusions. Flat, static lattice.
 *   ACTIVE   — one occasional, mild probe. Normal LATCH/SPLICE noise.
 *   ROGUE_AI — up to three aggressive, fast-moving probes at once, with
 *              a white-hot flash at each point's peak pull.
 */
export function Blackwall({ threatLevel }: { threatLevel: ThreatLevel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const levelRef = useRef<ThreatLevel>(threatLevel);
  const intrusionsRef = useRef<IntrusionPoint[]>([]);

  useEffect(() => {
    levelRef.current = threatLevel;
  }, [threatLevel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;
    const ctx = canvasCtx; // non-null alias so nested closures below stay narrowed

    // ResizeObserver, not window.resize — a CSS/layout change (e.g. the
    // dashboard row heights) resizes this panel without the browser window
    // itself changing size, and window.resize never fires for that.
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const DANGER_RGB = '232, 63, 107';
    const SIGNAL_RGB = '63, 208, 232';
    const HOT_RGB = '255, 255, 255';

    let startTime: number | null = null;

    /** How far (px) a point at (px,py) is currently being pulled, this frame. */
    function displacement(px: number, py: number, now: number): { dx: number; dy: number; heat: number } {
      let dx = 0;
      let dy = 0;
      let heat = 0;
      for (const p of intrusionsRef.current) {
        const ddx = p.x - px;
        const ddy = p.y - py;
        const dist = Math.hypot(ddx, ddy) || 0.001;
        const u = Math.min(1, Math.max(0, (now - p.bornAt) / p.lifeMs));
        const envelope = Math.sin(u * Math.PI); // ramps up, peaks mid-life, ramps down
        const strength = envelope * p.maxStrength;
        const falloff = strength * Math.exp(-(dist * dist) / (2 * p.radius * p.radius));
        dx += (ddx / dist) * falloff;
        dy += (ddy / dist) * falloff;
        heat = Math.max(heat, falloff / Math.max(1, p.maxStrength));
      }
      return { dx, dy, heat };
    }

    function maybeSpawnIntrusion(w: number, h: number, now: number) {
      const cfg = LEVEL_CONFIG[levelRef.current];
      if (cfg.maxConcurrent === 0) return;
      if (intrusionsRef.current.length >= cfg.maxConcurrent) return;
      if (Math.random() >= cfg.spawnChance) return;
      const [lo, hi] = cfg.lifeMs;
      intrusionsRef.current.push({
        x: Math.random() * w,
        y: Math.random() * h,
        bornAt: now,
        lifeMs: lo + Math.random() * (hi - lo),
        maxStrength: cfg.strength * (0.7 + Math.random() * 0.6),
        radius: cfg.radius * (0.8 + Math.random() * 0.4),
      });
    }

    function drawLineFamily(w: number, h: number, now: number, slope: 1 | -1) {
      // slope +1: lines where (y - x) is constant. slope -1: (y + x) constant.
      const span = slope === 1 ? h + w : w + h;
      const cOffset = slope === 1 ? -h : 0;
      for (let c = cOffset; c <= span + cOffset; c += CELL) {
        const points: { x: number; y: number; heat: number }[] = [];
        let maxHeat = 0;
        for (let x = -CELL; x <= w + CELL; x += SAMPLE_STEP) {
          const y = slope === 1 ? x + c : c - x;
          if (y < -CELL || y > h + CELL) continue;
          const { dx, dy, heat } = displacement(x, y, now);
          maxHeat = Math.max(maxHeat, heat);
          points.push({ x: x + dx, y: y + dy, heat });
        }
        if (points.length < 2) continue;

        const rgb = maxHeat > 0.55 ? HOT_RGB : maxHeat > 0.15 ? SIGNAL_RGB : DANGER_RGB;
        const baseAlpha = levelRef.current === 'CALM' ? 0.16 : 0.22;
        ctx.strokeStyle = `rgba(${rgb}, ${Math.min(1, baseAlpha + maxHeat * 0.7)})`;
        ctx.lineWidth = maxHeat > 0.55 ? 1.8 : 1;
        ctx.beginPath();
        points.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
        ctx.stroke();
      }
    }

    const draw = (now: number) => {
      if (startTime === null) startTime = now;

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      intrusionsRef.current = intrusionsRef.current.filter((p) => now - p.bornAt < p.lifeMs);
      maybeSpawnIntrusion(w, h, now);

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#050506';
      ctx.fillRect(0, 0, w, h);

      drawLineFamily(w, h, now, 1);
      drawLineFamily(w, h, now, -1);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full block" aria-label="Perimeter defense status" />;
}
