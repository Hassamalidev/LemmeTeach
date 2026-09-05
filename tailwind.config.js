/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // App chrome (§16). The board itself is themed in CSS variables so it
        // can switch surface without a re-render.
        chrome: {
          DEFAULT: '#0E1113',
          raised: '#171B1F',
          line: '#262C31',
          text: '#E7EAEC',
          dim: '#98A2A9',
        },
        subject: {
          math: '#4C6EF5',
          physics: '#E8590C',
          chemistry: '#0CA678',
          cs: '#7048E8',
          biology: '#C2255C',
        },
      },
      fontFamily: {
        sans: ['Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      fontSize: {
        // The single scale from §16: 48 / 32 / 24 / 18 / 15.
        'board-1': ['48px', { lineHeight: '1.1', letterSpacing: '-0.01em' }],
        'board-2': ['32px', { lineHeight: '1.2' }],
        'board-3': ['24px', { lineHeight: '1.3' }],
        'board-4': ['18px', { lineHeight: '1.45' }],
        'board-5': ['15px', { lineHeight: '1.5' }],
      },
    },
  },
  plugins: [],
};
