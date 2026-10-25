/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: { wide: '1180px' },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: {
          950: '#07090d',
          900: '#0b0f15',
          850: '#0f141c',
          800: '#131a23',
          750: '#18202b',
          700: '#1e2733',
          600: '#2a3542',
          500: '#3a4757',
          400: '#5b6879',
          300: '#8693a3',
          200: '#b3bdc9',
          100: '#dde3ea',
        },
        threat: { DEFAULT: '#c2555a', soft: '#8e3f45', dim: '#4a2529' },
        caution: { DEFAULT: '#d6a243', soft: '#9c7631', dim: '#3f321a' },
        clear: { DEFAULT: '#3fb39a', soft: '#2c7d6c', dim: '#173a33' },
        info: { DEFAULT: '#6b9bd1', soft: '#4a6e96', dim: '#1b2a3c' },
      },
      fontSize: { '2xs': ['10px', '14px'] },
    },
  },
  plugins: [],
};
