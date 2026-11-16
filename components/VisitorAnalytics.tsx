'use client';

import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/next';
import { shouldTrackVisitor } from '../lib/analytics/visitor-tracking';

/** Mount official Vercel Analytics only for the approved production app hostname. */
export default function VisitorAnalytics() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(shouldTrackVisitor(window.location.hostname, process.env.NODE_ENV === 'production'));
  }, []);

  return enabled ? <Analytics /> : null;
}
