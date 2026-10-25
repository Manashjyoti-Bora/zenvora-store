import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Zenvora palette (2026 refresh) ──────────────────────────────
        // Obsidian Black  #101114  — branding / dark surfaces / primary text
        // Pearl White     #F7F6F2  — shopping surfaces (canvas)
        // Champagne Gold  #C6A56B  — sparingly, on dark surfaces or as a rule
        // Electric Violet #7965F2  — primary actions & focus
        // Sage Mint       #DDEDE4  — success / calm surfaces (never text)
        // Semantic: muted text #62636A · success #47765C · error #B93838 ·
        //           borders #E3E0D8
        //
        // Contrast (measured, WCAG 2.2): brand-600 on white 5.7:1 (AA text);
        // brand-500 on white 4.2:1 (UI/large text only — never body copy);
        // ink-400 on Pearl 5.5:1; success-600 on white 5.2:1; error-600 on
        // white 5.7:1; gold on Obsidian 8.1:1 (gold on white 2.3:1 — decorative
        // only).
        brand: {
          50:  '#F4F2FE',
          100: '#E8E4FD',
          200: '#D2CBFB',
          300: '#B3A8F8',
          400: '#9484F5',
          500: '#7965F2',   // Electric Violet — accents, rings, large text
          600: '#6350D9',   // primary action fill (white text AA)
          700: '#5140B8',   // link / eyebrow text on light surfaces
          800: '#403392',
          900: '#30276D',
          950: '#1C1744',
        },
        // ── Champagne Gold (warm metallic, used sparingly) ──
        accent: {
          50:  '#FCF9F1',
          100: '#F6EEDB',
          200: '#ECDDB7',
          300: '#DFC893',
          400: '#C6A56B',   // Champagne Gold
          500: '#AE8C50',
          600: '#92733D',
          700: '#765C2F',
          800: '#5C4725',
          900: '#46361C',
        },
        // ── Ink palette (Obsidian neutrals) ──
        ink: {
          50:  '#F4F4F5',
          100: '#E7E7EA',
          200: '#CFCFD4',
          300: '#A3A4AC',
          400: '#62636A',   // Muted text (5.5:1 on Pearl)
          500: '#4C4D54',
          600: '#3A3B42',
          700: '#2A2B31',
          800: '#1C1D22',
          900: '#101114',   // Obsidian Black — primary text / dark surfaces
          950: '#0B0B0E',
        },
        // ── Pearl surfaces ──
        cream: {
          50:  '#F7F6F2',   // Pearl White — primary background
          100: '#F1EFE9',
          200: '#E3E0D8',   // Border
          300: '#D3CFC3',
          400: '#B5AF9E',
          500: '#938D7B',
        },
        // ── Brass alias (legacy class names → Champagne Gold) ──
        brass: {
          50:  '#FCF9F1',
          100: '#F6EEDB',
          200: '#ECDDB7',
          300: '#DFC893',
          400: '#C6A56B',
          500: '#AE8C50',
          600: '#92733D',
          700: '#765C2F',
        },
        // ── Sage Mint (success / calm surfaces; not for text contrast) ──
        sage: {
          50:  '#EEF6F1',
          100: '#DDEDE4',   // Sage Mint — surface
          200: '#C4DFD0',
          300: '#A3CBB5',
          400: '#7FB298',
          500: '#5E967B',
          600: '#47765C',   // success text/icon (5.2:1 on white)
        },
        // ── Semantic text/icon colours. Existing components use Tailwind's
        //    emerald/red scales; the 600/700 steps are re-pointed to the
        //    semantic tokens so success/error read consistently store-wide.
        success: { 50: '#EEF6F1', 600: '#47765C', 700: '#3A6049' },
        danger:  { 50: '#FBEFEF', 600: '#B93838', 700: '#9A2E2E' },
        emerald: { 600: '#47765C', 700: '#3A6049' },
        red:     { 600: '#B93838', 700: '#9A2E2E' },
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
        hair:  'inset 0 0 0 1px rgba(16, 17, 20, 0.06)',
        soft:  '0 1px 2px rgba(16, 17, 20, 0.04), 0 6px 16px -6px rgba(16, 17, 20, 0.08)',
        lift:  '0 2px 6px rgba(16, 17, 20, 0.05), 0 18px 32px -12px rgba(16, 17, 20, 0.14)',
        glow:  '0 0 0 1px rgba(198, 165, 107, 0.3), 0 14px 36px -12px rgba(16, 17, 20, 0.3)',
        card:  '0 1px 3px rgba(16, 17, 20, 0.04), 0 8px 24px -8px rgba(16, 17, 20, 0.1)',
        focus: '0 0 0 3px rgba(121, 101, 242, 0.35)',
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
