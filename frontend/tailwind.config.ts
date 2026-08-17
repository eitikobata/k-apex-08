import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // KMC console palette — functional, not decorative. Each color
        // maps to a real signal in the system (see brief: threat tiers,
        // system vs alert state), not chosen for looks alone.
        void: '#0b0c0e', // dirty near-black background, not pure #000
        panel: '#121418', // panel surface, one step up from void
        grid: '#1c2027', // hairlines / dividers
        signal: {
          DEFAULT: '#3fd0e8', // cold cyan — system/LATCH/nominal
          dim: '#1d5c68',
        },
        warn: {
          DEFAULT: '#e8a63f', // amber — SPLICE/caution
          dim: '#6b5423',
        },
        danger: {
          DEFAULT: '#e83f6b', // magenta-red — SHATTER/critical
          dim: '#6b1d34',
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
