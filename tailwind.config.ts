import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Heritage primary — Zenvora deep botanical green (used across storefront + admin).
        brand: {
          50: '#eef7f2',
          100: '#d7ecdf',
          200: '#b1d9c2',
          300: '#82c09e',
          400: '#55a47a',
          500: '#35885d',
          600: '#266d49',
          700: '#20573c',
          800: '#1c4632',
          900: '#173a29',
          950: '#0b2016',
        },
        // Deal/savings accent (used sparingly on real discount moments).
        accent: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
        // Zenvora identity surfaces: warm botanical ink + paper cream + restrained brass.
        ink: {
          50: '#F3F5F4',
          100: '#E4E9E6',
          200: '#C7D1CC',
          300: '#8A978F',
          400: '#5F7268',
          500: '#3D5148',
          600: '#31443B',
          700: '#24352D',
          800: '#182620',
          900: '#101B16',
          950: '#0A130F',
        },
        cream: {
          50: '#FAF8F3',
          100: '#F5F1E7',
          200: '#EAE4D4',
          300: '#D9D1BC',
          400: '#B8AE96',
          500: '#948A73',
        },
        brass: {
          50: '#FBF8EE',
          100: '#F4ECD2',
          200: '#E7D9AE',
          300: '#D8C287',
          400: '#C6A75C',
          500: '#A98B45',
          600: '#8A7038',
          700: '#6E582B',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans',
          'sans-serif',
        ],
      },
      letterSpacing: {
        display: '-0.024em',
        eyebrow: '0.14em',
      },
      boxShadow: {
        // Layered, low-elevation warm depth system (no heavy cool-gray drop shadows).
        hair: 'inset 0 0 0 1px rgba(16, 27, 22, 0.06)',
        soft: '0 1px 2px rgba(16, 27, 22, 0.05), 0 6px 16px -6px rgba(16, 27, 22, 0.09)',
        lift: '0 2px 6px rgba(16, 27, 22, 0.06), 0 18px 32px -12px rgba(16, 27, 22, 0.16)',
        glow: '0 0 0 1px rgba(216, 194, 135, 0.35), 0 14px 36px -12px rgba(16, 27, 22, 0.35)',
      },
      transitionTimingFunction: {
        /* The Zenvora ease: fast start, long gentle settle. One signature curve
           for reveals, hovers, zoom and fades (see ZENVORA_DESIGN_LANGUAGE.md §9). */
        zenvora: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
