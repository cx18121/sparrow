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
        // Slightly warmer surface tone for layering — KPI rows, table
        // headers, hover surfaces — without leaving the parchment family.
        'panel-deep': '#F0E6D2',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 18px 50px rgba(44,31,16,0.08)',
        modal: '0 32px 90px rgba(44,31,16,0.20)',
        // Subtle warm shadow for compact controls (replaces shadow-sm).
        subtle: '0 1px 2px rgba(44,31,16,0.06)',
        // Green halo used by active sidebar/nav, segmented active state,
        // primary buttons. Used to be inlined as a raw rgba shadow.
        active: '0 10px 24px rgba(85,122,87,0.18)',
        // Tighter green halo for the brand badge / send-icon chip.
        brand: '0 4px 12px rgba(85,122,87,0.22)',
        // Inverted shadow for the mobile bottom-nav lift.
        rail: '0 -10px 30px rgba(44,31,16,0.08)',
        // Two-layer warm drop shadow for the white workspace panel.
        // Tighter than `card` so the lift reads as "object on parchment".
        lift: '0 8px 24px rgba(44,31,16,0.10), 0 2px 6px rgba(44,31,16,0.06)',
        // Landing-hero primary CTA: louder than `shadow-active` because
        // it's the page's marquee call to action and carries brand weight
        // at hero scale. The cream-tinted inset is a subtle specular
        // highlight on the green button surface.
        cta: '0 14px 36px rgba(85,122,87,0.32), inset 0 1px 0 rgba(255,255,255,0.18)',
        'cta-hover': '0 20px 44px rgba(85,122,87,0.40), inset 0 1px 0 rgba(255,255,255,0.22)',
      },
    },
  },
  plugins: [],
}
