'use client';

import { useEffect, useRef } from 'react';

export type ThreatLevel = 'CALM' | 'ACTIVE' | 'ROGUE_AI';

interface StreakConfig {
  x: number; // base horizontal position, 0..1 of canvas width
  phase: number; // random phase offset for the sway
  hue: 'danger' | 'signal'; // most streaks are danger (magenta-red), a few are signal (cyan)
  seed: number; // per-streak randomness for spark timing
}

const STREAK_COUNT = 72;

/**
 * The console's signature visual — an animated representation of KMC's
 * perimeter defense (the brief's "Black Wall"). Not decoration: the
 * distortion level is a direct read of system state.
 *   CALM     — steady, near-static streaks. Nothing's attacking.
 *   ACTIVE   — mild sway and occasional flicker. Normal LATCH/SPLICE noise.
 *   ROGUE_AI — violent, chaotic motion with white/cyan sparks. Something
 *              is actively trying to get through.
 */
export function Blackwall({ threatLevel }: { threatLevel: ThreatLevel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streaksRef = useRef<StreakConfig[]>([]);
  const rafRef = useRef<number>(0);
  const levelRef = useRef<ThreatLevel>(threatLevel);

  useEffect(() => {
    levelRef.current = threatLevel;
  }, [threatLevel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (streaksRef.current.length === 0) {
      streaksRef.current = Array.from({ length: STREAK_COUNT }, (_, i) => {
        const x = i / STREAK_COUNT;
        // Middle third of the canvas mixes in a lot more cyan — the rest
        // stays mostly magenta-red. Echoes the reference imagery (a cooler
        // band bleeding through the center of an otherwise hot wall).
        const isMiddleBand = Math.abs(x - 0.5) < 0.22;
        const cyanChance = isMiddleBand ? 0.55 : 0.1;
        return {
          x,
          phase: Math.random() * Math.PI * 2,
          hue: (Math.random() < cyanChance ? 'signal' : 'danger') as StreakConfig['hue'],
          seed: Math.random(),
        };
      });
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const DANGER_RGB = '232, 63, 107';
    const SIGNAL_RGB = '63, 208, 232';

    let startTime: number | null = null;

    const draw = (now: number) => {
      if (startTime === null) startTime = now;
      const t = (now - startTime) / 1000;

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const level = levelRef.current;

      const amplitude = level === 'CALM' ? 2 : level === 'ACTIVE' ? 9 : 26;
      const speed = level === 'CALM' ? 0.25 : level === 'ACTIVE' ? 0.7 : 2.4;
      const freqBase = level === 'CALM' ? 1.2 : level === 'ACTIVE' ? 1.8 : 3.2;
      const sparkChance = level === 'ROGUE_AI' ? 0.02 : level === 'ACTIVE' ? 0.003 : 0;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#050506';
      ctx.fillRect(0, 0, w, h);

      for (const streak of streaksRef.current) {
        const baseX = streak.x * w;
        const isSpark = sparkChance > 0 && Math.sin(t * 40 + streak.seed * 1000) > 1 - sparkChance * 50;

        ctx.beginPath();
        const segments = 24;
        for (let s = 0; s <= segments; s += 1) {
          const yFrac = s / segments;
          const y = yFrac * h;
          // sway grows toward the bottom, echoing the radiating look in the reference images
          const growth = 0.3 + yFrac * 1.4;
          const sway =
            Math.sin(yFrac * freqBase * Math.PI * 2 + streak.phase + t * speed) * amplitude * growth;
          const x = baseX + sway;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        const rgb = isSpark ? '255, 255, 255' : streak.hue === 'danger' ? DANGER_RGB : SIGNAL_RGB;
        const baseAlpha = level === 'CALM' ? 0.35 : level === 'ACTIVE' ? 0.45 : 0.6;
        const flicker =
          level === 'CALM'
            ? 1
            : 0.7 + 0.3 * Math.sin(t * (level === 'ROGUE_AI' ? 9 : 4) + streak.seed * 30);

        ctx.strokeStyle = `rgba(${rgb}, ${Math.min(1, baseAlpha * flicker)})`;
        ctx.lineWidth = isSpark ? 2.2 : 1;
        ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full block" aria-label="Perimeter defense status" />;
}
