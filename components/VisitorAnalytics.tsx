'use client';

import { useEffect } from 'react';

/** Load Web Analytics only in production, never in local or preview builds. */
export default function VisitorAnalytics() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_VERCEL_ENV !== 'production') return;
    if (document.querySelector('script[data-yaqeen-analytics]')) return;
    const script = document.createElement('script');
    script.defer = true;
    script.dataset.yaqeenAnalytics = 'true';
    script.src = '/_vercel/insights/script.js';
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, []);
  return null;
}
