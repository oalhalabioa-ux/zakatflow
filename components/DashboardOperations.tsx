'use client';

import {useEffect, useRef, type ReactNode} from 'react';

/** Keep existing customization/closing operations, without duplicating the overview. */
export default function DashboardOperations({children, label}: {children: ReactNode; label: string}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const node = ref.current, shell = node?.closest('.corp-shell');
    if (!node || !shell) return;
    let lastTheme: string | undefined;
    const sync = () => {
      const theme = shell.classList.contains('theme-elegant') ? 'elegant' : shell.classList.contains('theme-modern') ? 'modern' : shell.classList.contains('theme-yaqeen-business') ? 'yaqeen-business' : 'classic';
      if (lastTheme !== theme) node.open = theme === 'classic';
      lastTheme = theme;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(shell, {attributes: true, attributeFilter: ['class']});
    return () => observer.disconnect();
  }, []);
  return <details ref={ref} className="dashboard-operations" open><summary>{label}</summary>{children}</details>;
}
