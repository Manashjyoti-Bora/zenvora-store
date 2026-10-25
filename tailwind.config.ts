import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Zenvora palette (Petrol & Porcelain, 2026-10) ────────────────
        // Chosen after a measured comparison of two directions (see
        // docs/DESIGN_SYSTEM.md §2): the existing app icon is already a deep
        // petrol-green field with a champagne "Z", so this direction keeps the
        // brand recognisable while measuring better than the violet system.
        //
        // Midnight Ink     #111820 — primary text, branding / dark surfaces
        // Porcelain Mist   #F6F5F0 — shopping canvas
        // Deep Petrol      #174A50 — primary actions, links (9.9:1 on white)
        // Iridescent Teal  #77C9C1 — rare accent; on dark surfaces only (never
        //                             text on light: 1.9:1 on white)
        // Muted Champagne  #C6AD7A — decorative rule / icon on dark (8.2:1 on
        //                             Midnight; 2.2:1 on white → never text)
        // Slate Text       #59636B — secondary text (5.6:1 on Porcelain)
        // Pale Sage        #E2ECE5 — success / calm surfaces, never text
        // Success #347455 (5.6:1) · Error #B33A42 (5.8:1) · Border #DCE1DE
        brand: {
          50:  '#F0F8F7',
          100: '#E1F2F0',
          200: '#C9EAE6',
          300: '#A6DCD6',
          400: '#77C9C1',   // Iridescent Teal — accent on dark surfaces / focus on dark
          500: '#1F5A60',   // focus ring on light surfaces, large UI text (7.9:1)
          600: '#174A50',   // Deep Petrol — primary action fill (white text 9.9:1)
          700: '#113C41',   // link / eyebrow text on light surfaces
          800: '#0F363B',
          900: '#0B282C',
          950: '#071A1D',
        },
        // ── Muted Champagne (warm metallic, used sparingly) ──
        accent: {
          50:  '#FCFAF3',
          100: '#F6F0DF',
          200: '#ECE0BE',
          300: '#DECB97',
          400: '#C6AD7A',   // Muted Champagne
          500: '#AD925A',
          600: '#917745',
          700: '#745F36',
          800: '#5B4A2B',
          900: '#453820',
        },
        // ── Ink palette (Midnight neutrals) ──
        ink: {
          50:  '#F3F4F5',
          100: '#E6E8EA',
          200: '#CDD1D5',
          300: '#A1A8AE',
          400: '#59636B',   // Slate Text (5.6:1 on Porcelain)
          500: '#48515A',
          600: '#38404A',
          700: '#283039',
          800: '#1B222B',
          900: '#111820',   // Midnight Ink — primary text / dark surfaces
          950: '#0B1016',
        },
        // ── Porcelain surfaces ──
        cream: {
          50:  '#F6F5F0',   // Porcelain Mist — primary background
          100: '#F0EFE9',
          200: '#DCE1DE',   // Subtle Border
          300: '#CBD1CD',
          400: '#AEB5B0',
          500: '#8C938E',
        },
        // ── Brass alias (legacy class names → Muted Champagne) ──
        brass: {
          50:  '#FCFAF3',
          100: '#F6F0DF',
          200: '#ECE0BE',
          300: '#DECB97',
          400: '#C6AD7A',
          500: '#AD925A',
          600: '#917745',
          700: '#745F36',
        },
        // ── Pale Sage (success / calm surfaces; not for text contrast) ──
        sage: {
          50:  '#F0F6F2',
          100: '#E2ECE5',   // Pale Sage — surface
          200: '#C8DCCF',
          300: '#A7C8B3',
          400: '#7FAD92',
          500: '#578C6E',
          600: '#347455',   // success text/icon (5.6:1 on white)
        },
        // ── Semantic text/icon colours. Existing components use Tailwind's
        //    emerald/red scales; the 600/700 steps are re-pointed to the
        //    semantic tokens so success/error read consistently store-wide.
        success: { 50: '#F0F6F2', 600: '#347455', 700: '#2A5E45' },
        danger:  { 50: '#FBEFF0', 600: '#B33A42', 700: '#942F36' },
        emerald: { 600: '#347455', 700: '#2A5E45' },
        red:     { 600: '#B33A42', 700: '#942F36' },
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
        hair:  'inset 0 0 0 1px rgba(17, 24, 32, 0.06)',
        soft:  '0 1px 2px rgba(17, 24, 32, 0.04), 0 6px 16px -6px rgba(17, 24, 32, 0.08)',
        lift:  '0 2px 6px rgba(17, 24, 32, 0.05), 0 18px 32px -12px rgba(17, 24, 32, 0.14)',
        glow:  '0 0 0 1px rgba(198, 173, 122, 0.3), 0 14px 36px -12px rgba(17, 24, 32, 0.3)',
        card:  '0 1px 3px rgba(17, 24, 32, 0.04), 0 8px 24px -8px rgba(17, 24, 32, 0.1)',
        focus: '0 0 0 3px rgba(31, 90, 96, 0.35)',
      },
      transitionDuration: {
        micro: '120ms',
        fast: '160ms',
        normal: '220ms',
        slow: '240ms',
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
        'fade-in': 'fade-in 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 0.18s cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
