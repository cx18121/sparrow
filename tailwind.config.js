/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1B6EF3',
          50: '#EBF2FE',
          100: '#D6E5FD',
          200: '#ADCAFB',
          300: '#85AFF9',
          400: '#5C94F7',
          500: '#1B6EF3',
          600: '#1058C7',
          700: '#0B429B',
          800: '#062B6F',
          900: '#031543',
        },
        dark: '#0B1D33',
        muted: '#5E7B97',
        surface: '#F4F7FB',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(11,29,51,0.08), 0 1px 2px -1px rgba(11,29,51,0.06)',
        modal: '0 20px 60px -10px rgba(11,29,51,0.3)',
      },
    },
  },
  plugins: [],
}
