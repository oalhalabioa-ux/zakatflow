import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'يقين الأعمال | Yaqeen Business',
    short_name: 'يقين الأعمال',
    description: 'منصة الإدارة المالية والأعمال الذكية',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#102d46',
    theme_color: '#102d46',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
