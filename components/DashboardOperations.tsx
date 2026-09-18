'use client';

import {useEffect, useRef, type ReactNode} from 'react';

/** Keep existing customization/closing operations, without duplicating the overview. */
export default function DashboardOperations({children, label}: {children: ReactNode; label: string}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const node = ref.current, shell = node?.closest('.corp-shell');
    if (!node || !shell) return;
    let lastElegant: boolean | undefined;
    const sync = () => {
      const elegant = shell.classList.contains('theme-elegant');
      if (lastElegant !== elegant) node.open = !elegant;
      lastElegant = elegant;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(shell, {attributes: true, attributeFilter: ['class']});
    return () => observer.disconnect();
  }, []);
  return <details ref={ref} className="dashboard-operations" open><summary>{label}</summary>{children}</details>;
}
