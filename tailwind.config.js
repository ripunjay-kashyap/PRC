/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0b0b0b', 2: '#52514e', 3: '#898781' },
        plane: '#f4f4f1',
        surface: '#fcfcfb',
        line: '#e1e0d9',
        navy: { 50: '#eef3f9', 100: '#d9e4f1', 500: '#2a5d93', 600: '#1f4a78', 700: '#1f3a5f', 800: '#172c48', 900: '#0f1e33' },
        accent: { DEFAULT: '#eb6834', soft: '#fdebe3' },
        good: '#0ca30c',
        goodText: '#006300',
        warn: '#fab219',
        serious: '#ec835a',
        critical: '#d03b3b',
      },
      fontFamily: { sans: ['system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(11,11,11,0.05), 0 0 0 1px rgba(11,11,11,0.06)' },
    },
  },
  plugins: [],
};
