import type { Config } from 'tailwindcss';

// Color tokens reference the CSS variables defined in globals.css.
// Themes (dark/light) flip those variables via [data-theme="..."] on <html>.
// Brand colors (neon green + magenta) stay hardcoded — visual identity,
// readable on either background.
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: 'var(--cp-bg)',
          elevated: 'var(--cp-bg-elevated)',
          card: 'var(--cp-bg-card)',
          'card-strong': 'var(--cp-bg-card-strong)',
        },
        neon: {
          green: '#00F708',
          magenta: '#E600FF',
        },
        border: {
          DEFAULT: 'var(--cp-border)',
          hover: 'var(--cp-border-hover)',
        },
        muted: {
          DEFAULT: 'var(--cp-bg-card)',
          foreground: 'var(--cp-fg-muted)',
        },
        foreground: {
          DEFAULT: 'var(--cp-fg)',
          muted: 'var(--cp-fg-muted)',
          subtle: 'var(--cp-fg-subtle)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        'neon-green': '0 0 12px rgba(0,247,8,0.45), 0 0 32px rgba(0,247,8,0.18)',
        'neon-magenta': '0 0 12px rgba(230,0,255,0.45), 0 0 32px rgba(230,0,255,0.18)',
        glass: '0 4px 30px rgba(0,0,0,0.45)',
      },
      backgroundImage: {
        'grid-fade':
          'radial-gradient(circle at 20% 0%, rgba(0,247,8,0.08), transparent 40%), radial-gradient(circle at 80% 100%, rgba(230,0,255,0.10), transparent 45%)',
      },
      borderRadius: {
        xl: '14px',
        '2xl': '20px',
      },
      animation: {
        'pulse-slow': 'pulse 4s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
