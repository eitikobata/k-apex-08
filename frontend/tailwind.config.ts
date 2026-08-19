import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // KMC console palette — functional, not decorative. Each color
        // maps to a real signal in the system (see brief: threat tiers,
        // system vs alert state), not chosen for looks alone.
        void: '#000000',
        // NOTE (second attempt — first bump to 0.93 wasn't visibly enough).
        // Pushed much further this round (0.78 — ~22% see-through). If the
        // ambient background STILL doesn't show at all (not even faintly)
        // after this, it's very likely a real render bug, not a subtlety
        // problem, and worth checking in DevTools: Elements panel, search
        // for class "bg-columns" — does the node exist? Does it have
        // non-zero width/height? That'll tell us which half of the
        // problem we're actually looking at.
        panel: 'rgba(3, 3, 4, 0.78)',
        grid: '#181c22', // hairlines / dividers
        signal: {
          DEFAULT: '#3fd0e8', // cold cyan — system/LATCH/nominal
          dim: '#1d5c68',
        },
        warn: {
          DEFAULT: '#e8a63f', // amber — SPLICE/caution
          dim: '#6b5423',
        },
        danger: {
          DEFAULT: '#e21c38', // pushed hard toward pure red — this IS the fixed visual identity now
          dim: '#661019',
        },
        ash: {
          DEFAULT: '#8b93a1', // muted body text
          bright: '#d5dae2',
        },
      },
      fontFamily: {
        display: ['var(--font-rajdhani)', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
