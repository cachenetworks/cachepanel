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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
