/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0a0a0a', 2: '#4b5563', 3: '#6b7280' },
        plane: '#fafafa',
        surface: '#ffffff',
        line: '#e5e7eb',
        // "navy" is the app's interactive scale: near-black primary + bright blue accent
        navy: { 50: '#eff6ff', 100: '#dbeafe', 500: '#2563eb', 600: '#1d4ed8', 700: '#111827', 800: '#030712', 900: '#0a0a0a' },
        accent: { DEFAULT: '#2563eb', soft: '#eff6ff' },
        good: '#0ca30c',
        goodText: '#006300',
        warn: '#fab219',
        serious: '#ec835a',
        critical: '#d03b3b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(10,10,10,0.04)',
        btn: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 1px 2px rgba(10,10,10,0.25), 0 0 0 1px #0a0a0a',
        btnBlue: 'inset 0 1px 0 rgba(255,255,255,0.2), 0 1px 2px rgba(37,99,235,0.35), 0 0 0 1px #1d4ed8',
        pop: '0 8px 24px -6px rgba(10,10,10,0.12), 0 0 0 1px rgba(10,10,10,0.06)',
      },
      letterSpacing: { tightest: '-0.035em' },
    },
  },
  plugins: [],
};
