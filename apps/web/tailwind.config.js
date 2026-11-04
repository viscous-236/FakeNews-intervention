/**
 * Tailwind theme — tokens from the dealt app sheet (framed-sheet, light).
 * One ground, one ink, one accent; status hues reserved for data and labels.
 * See apps/web/DESIGN.md for the rationale behind every value.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    fontFamily: {
      sans: ['"IBM Plex Sans"', 'Inter', 'system-ui', 'sans-serif'],
      mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
    },
    extend: {
      colors: {
        // Chrome
        frame: '#eef3f6', // the tinted L-frame: one low-chroma step of the accent hue
        ground: '#f9fbfc',
        surface: '#ffffff',
        raised: '#f4f6f8',
        active: '#e6ebee',
        border: '#e8eaec',
        rule: '#f0f1f2',
        control: '#cdced1',
        // Ink
        ink: '#131416',
        muted: '#5d5f60',
        faint: '#6b6b6b',
        // The one hue, and the status hues (data only)
        accent: { DEFAULT: '#1b6c80', ink: '#0f4d5c', tint: '#e3f1f4' },
        positive: { DEFAULT: '#1e7b4f', bg: '#dcfae5', ink: '#04250e' },
        negative: { DEFAULT: '#c4242a', bg: '#ffedea', ink: '#831c1e' },
        warning: { DEFAULT: '#92400e', bg: '#fffbeb', ink: '#92400e', edge: '#fde68a' },
        neutralpill: { bg: '#ebedee', ink: '#353736' },
        primary: { DEFAULT: '#1d1f20', hover: '#2b2e30', ink: '#ffffff' },
        chart: { 1: '#1b6c80', 2: '#2f70bb', 3: '#a86f0c' },
      },
      fontSize: {
        title: ['22px', { lineHeight: '28px', fontWeight: '600' }],
        section: ['16px', { lineHeight: '24px', fontWeight: '600' }],
        kpi: ['28px', { lineHeight: '34px', fontWeight: '400' }],
        body: ['14px', { lineHeight: '20px' }],
        small: ['12px', { lineHeight: '16px' }],
        prose: ['16px', { lineHeight: '26px' }],
      },
      borderRadius: {
        card: '8px',
        control: '6px',
        sheet: '16px',
        chip: '4px',
      },
      spacing: {
        sidebar: '228px',
        topbar: '48px',
        rail: '384px',
        control: '32px',
        row: '48px',
      },
      maxWidth: {
        reading: '72ch',
        sheet: '1152px',
      },
      transitionDuration: {
        DEFAULT: '160ms',
      },
    },
  },
  plugins: [],
};
