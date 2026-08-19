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
        // NOTE (bugfix): was pure opaque #000000, identical to the fixed
        // z-index:-1 ambient background layer (BackgroundColumns) sitting
        // behind everything. An opaque panel fully occludes whatever's
        // behind it — the scrolling background text could only ever show
        // through the ~20px gaps BETWEEN panels, which is too thin to read
        // at all. A hair of transparency lets it bleed through faintly
        // under panel content too (matches the brief: "always visible,
        // dim gray, behind the panels" — not "only in the cracks").
        // Readability isn't at risk: panel text uses signal/danger/ash,
        // all high-contrast against near-black regardless.
        panel: 'rgba(3, 3, 4, 0.93)',
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
