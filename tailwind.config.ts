import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#050505',
          elevated: '#0b0b0f',
        },
        neon: {
          green: '#00F708',
          magenta: '#E600FF',
        },
        border: 'rgba(255,255,255,0.08)',
        muted: {
          DEFAULT: 'rgba(255,255,255,0.06)',
          foreground: 'rgba(255,255,255,0.55)',
        },
        foreground: '#f5f5f5',
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
