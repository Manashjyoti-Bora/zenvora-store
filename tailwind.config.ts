import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Zenvora brand palette (Forest green → Deep green) ──
        brand: {
          50:  '#edf5f0',
          100: '#d4e8dc',
          200: '#a8d1b9',
          300: '#72b48e',
          400: '#4a9669',
          500: '#2d7a4f',
          600: '#20623e',
          700: '#174B3A',   // Forest green — primary brand
          800: '#10392D',   // Deep green — strongest brand
          900: '#0c2b22',
          950: '#071a14',
        },
        // ── Champagne accent (warm metallic, used sparingly) ──
        accent: {
          50:  '#fcf8f0',
          100: '#f7eedb',
          200: '#eedcb6',
          300: '#E2C78D',
          400: '#C6A66B',   // Champagne — primary accent
          500: '#b08e4a',
          600: '#957538',
          700: '#7a5e2c',
          800: '#604924',
          900: '#4a381c',
        },
        // ── Ink palette (warm black / deep neutral greens) ──
        ink: {
          50:  '#F5F6F5',
          100: '#E6E9E7',
          200: '#CDD2CF',
          300: '#9BA39D',
          400: '#6B726C',   // Muted text
          500: '#4A524B',
          600: '#374039',
          700: '#292F2B',
          800: '#1E2320',
          900: '#181A18',   // Ink black — primary text
          950: '#0D0F0D',
        },
        // ── Warm ivory / cream surfaces ──
        cream: {
          50:  '#F8F7F2',   // Warm ivory — primary background
          100: '#F1EFEA',
          200: '#E6E3DA',
          300: '#D5D1C4',
          400: '#B7B19E',
          500: '#958F7D',
        },
        // ── Brass/champagne metallic (heritage accent) ──
        brass: {
          50:  '#FBF8EE',
          100: '#F4ECD2',
          200: '#E7D9AE',
          300: '#D8C287',
          400: '#C6A66B',   // Champagne accent
          500: '#A98B45',
          600: '#8A7038',
          700: '#6E582B',
        },
        // ── Soft sage (secondary surfaces, tags, subtle highlights) ──
        sage: {
          50:  '#F4F8F5',
          100: '#EAF2EC',   // Soft sage — secondary surface
          200: '#D5E5D9',
          300: '#B4D1BC',
          400: '#8BB899',
          500: '#6A9E7A',
        },
      },
      fontFamily: {
        sans: [
          'var(--font-inter)',
          'Inter',
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
      fontSize: {
        // Refined heading scale with tight tracking for editorial feel
        'display-xl': ['3.35rem',  { lineHeight: '1.06', letterSpacing: '-0.028em', fontWeight: '800' }],
        'display-lg': ['2.5rem',   { lineHeight: '1.1',  letterSpacing: '-0.026em', fontWeight: '800' }],
        'display':    ['1.85rem',  { lineHeight: '1.12', letterSpacing: '-0.024em', fontWeight: '800' }],
      },
      letterSpacing: {
        display: '-0.024em',
        eyebrow: '0.14em',
        tight:   '-0.02em',
        snug:    '-0.01em',
      },
      boxShadow: {
        hair:  'inset 0 0 0 1px rgba(24, 26, 24, 0.06)',
        soft:  '0 1px 2px rgba(24, 26, 24, 0.04), 0 6px 16px -6px rgba(24, 26, 24, 0.08)',
        lift:  '0 2px 6px rgba(24, 26, 24, 0.05), 0 18px 32px -12px rgba(24, 26, 24, 0.14)',
        glow:  '0 0 0 1px rgba(198, 166, 107, 0.3), 0 14px 36px -12px rgba(24, 26, 24, 0.3)',
        card:  '0 1px 3px rgba(24, 26, 24, 0.04), 0 8px 24px -8px rgba(24, 26, 24, 0.1)',
      },
      transitionTimingFunction: {
        zenvora: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          from: { transform: 'translateX(-100%)' },
          to:   { transform: 'translateX(100%)' },
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
