/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#2563EB', hover: '#1d4ed8', light: '#dbeafe', glow: 'rgba(37,99,235,0.15)' },
        teal: { DEFAULT: '#0D9488', light: '#ccfbf1' },
        surface: '#FFFFFF',
        border: '#E2E8F0',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"DM Mono"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '14px',
        xl: '20px',
      },
    },
  },
  plugins: [],
}
