import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Reviva - Restore and colorize old photos',
  description: 'Bring your old, faded, and black-and-white photos back to life. Restore faces, upscale, and add natural color in seconds.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
