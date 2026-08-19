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
      // slope +1: lines where (y - x) is constant, i.e. y = x + c.
      // slope -1: lines where (y + x) is constant, i.e. y = c - x.
      // NOTE (bugfix): the old version sampled x from -CELL to w+CELL for
      // EVERY line and threw away any sample landing outside [0,h] — for a
      // wide, short panel (Perimeter Defense is ~6:1) that meant most
      // samples for most lines got discarded, and however many survived
      // depended on slope in an asymmetric way (a 45° line's visible
      // portion is capped at roughly `h` long regardless of `w`, so wide
      // canvases waste most of the sampling range). Net effect: one
      // diagonal family ended up visibly sparser than the other instead
      // of a symmetric crosshatch. Fixed by computing each line's exact
      // clipped x-range against the rectangle up front (simple 45°
      // line/box clipping) and only ever sampling within that — every
      // line that intersects the canvas draws its full length, evenly,
      // regardless of aspect ratio or which family it belongs to.
      const span = w + h;
      for (let c = slope === 1 ? -w : 0; c <= (slope === 1 ? h : span); c += CELL) {
        const xStart = Math.max(0, slope === 1 ? -c : c - h);
        const xEnd = Math.min(w, slope === 1 ? h - c : c);
        if (xEnd - xStart < 1) continue;

        const points: { x: number; y: number; heat: number }[] = [];
        let maxHeat = 0;
        for (let x = xStart; x <= xEnd; x += SAMPLE_STEP) {
          const y = slope === 1 ? x + c : c - x;
          const { dx, dy, heat } = displacement(x, y, now);
          maxHeat = Math.max(maxHeat, heat);
          points.push({ x: x + dx, y: y + dy, heat });
        }
        // Always include the exact endpoint — SAMPLE_STEP rarely divides
        // (xEnd - xStart) evenly, so without this every line falls a
        // little short of the edge it's supposed to touch.
        if (points.length === 0 || points[points.length - 1].x < xEnd) {
          const y = slope === 1 ? xEnd + c : c - xEnd;
          const { dx, dy, heat } = displacement(xEnd, y, now);
          maxHeat = Math.max(maxHeat, heat);
          points.push({ x: xEnd + dx, y: y + dy, heat });
        }
        if (points.length < 2) continue;

        const rgb = maxHeat > 0.55 ? HOT_RGB : maxHeat > 0.15 ? SIGNAL_RGB : DANGER_RGB;
        const baseAlpha = levelRef.current === 'CALM' ? 0.26 : 0.34;
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
