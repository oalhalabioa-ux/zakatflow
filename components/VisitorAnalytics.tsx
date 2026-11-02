'use client';

import { useEffect } from 'react';

/** Load Vercel Web Analytics only on the verified Vercel-hosted production domain. */
export default function VisitorAnalytics() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || window.location.hostname !== 'app.yaqeenbiz.com') return;
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
