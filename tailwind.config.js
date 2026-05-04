/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#557A57',
          50:  '#EEF5EE',
          100: '#D2E8D3',
          200: '#A8CFA9',
          300: '#7DB480',
          400: '#629D65',
          500: '#557A57',
          600: '#426145',
          700: '#334B34',
          800: '#223323',
          900: '#121B13',
        },
        accent: {
          DEFAULT: '#A8845C',
          50:  '#FAF3EB',
          100: '#F0DCBF',
          200: '#DCB98A',
          300: '#C99B60',
          400: '#BB8B4E',
          500: '#A8845C',
          600: '#896748',
          700: '#6A4F36',
          800: '#4A3624',
          900: '#2B1E13',
        },
        // Warm neutral scale — replaces cold grays/stones throughout
        warm: {
          50:  '#FDFAF5',
          100: '#F5EFE4',
          200: '#E8DDD0',
          300: '#D4C5B4',
          400: '#B8A591',
          500: '#9A876F',
          600: '#7D6B55',
          700: '#60503E',
          800: '#433628',
          900: '#261D14',
        },
        dark: '#2C1F10',
        muted: '#7A6651',
        surface: '#F5F0E8',
        panel: '#F8F4ED',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 18px 50px rgba(44,31,16,0.08)',
        modal: '0 32px 90px rgba(44,31,16,0.20)',
      },
    },
  },
  plugins: [],
}
