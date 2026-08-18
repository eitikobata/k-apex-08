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
        panel: '#000000',
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
