/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: { wide: '1180px', xwide: '1500px' },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Deep navy scale (kept under the "ink" name so every component follows the theme).
        ink: {
          950: '#030812',
          900: '#06101e',
          850: '#091629',
          800: '#0c1c33',
          750: '#10233e',
          700: '#152b4a',
          600: '#1d3758',
          500: '#2b4a70',
          400: '#6782a3',
          300: '#94aac4',
          200: '#bccbdd',
          100: '#e4ecf6',
        },
        accent: { DEFAULT: '#22d3ee', bright: '#67e8f9', soft: '#0e7490', dim: '#082f3a' },
        threat: { DEFAULT: '#ef4444', bright: '#f87171', soft: '#b91c1c', dim: '#3a0d14' },
        caution: { DEFAULT: '#f59e0b', bright: '#fbbf24', soft: '#b45309', dim: '#36240a' },
        clear: { DEFAULT: '#2dd4bf', bright: '#5eead4', soft: '#0f766e', dim: '#0a2e2c' },
        info: { DEFAULT: '#38bdf8', bright: '#7dd3fc', soft: '#0369a1', dim: '#0a2540' },
      },
      fontSize: { '2xs': ['10px', '14px'] },
      boxShadow: {
        glow: '0 0 0 1px rgba(34,211,238,0.10), 0 8px 32px -12px rgba(0,0,0,0.8), inset 0 1px 0 rgba(148,197,255,0.05)',
        'glow-cyan': '0 0 18px -4px rgba(34,211,238,0.55)',
        'glow-red': '0 0 22px -4px rgba(239,68,68,0.65)',
        'glow-green': '0 0 16px -4px rgba(45,212,191,0.6)',
      },
    },
  },
  plugins: [],
};
