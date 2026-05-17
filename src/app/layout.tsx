import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/layout/providers';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'CachePanel',
  description: 'Secure server control, the Cache way.',
  applicationName: 'CachePanel',
  icons: {
    icon: '/favicon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#050505',
  width: 'device-width',
  initialScale: 1,
};

// Inline script runs before React hydrates so the right theme paints on
// first frame — no flash of dark/light when the user has the other one set.
const THEME_BOOT = `(function(){try{var s=localStorage.getItem('cachepanel.theme');var t=s||((window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
