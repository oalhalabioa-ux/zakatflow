'use client';

import { use } from 'react';
import Link from 'next/link';

export default function Reports({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  const ar = locale === 'ar';

  async function download(type: string) {
    const r = await fetch(`/api/reports?type=${type}`);
    if (!r.ok) return;

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `zakatflow-${type}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  }

  const reports = [
    ['assessments', ar ? 'الاحتسابات' : 'Assessments'],
    ['transactions', ar ? 'المعاملات' : 'Transactions'],
    ['lots', 'Lots'],
    ['payments', ar ? 'المدفوعات' : 'Payments'],
  ];

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>{ar ? 'التقارير' : 'Reports'}</h1>

          <p className="muted">
            {ar
              ? 'تقارير تشغيلية قابلة للتدقيق والتصدير.'
              : 'Auditable operational reports with CSV export.'}
          </p>
        </div>

        <Link
          className="btn secondary"
          href={`/${locale}/reports/print`}
        >
          {ar ? 'تقرير للطباعة' : 'Printable report'}
        </Link>
      </div>

      <div className="cards section">
        {reports.map(([type, label]) => (
          <div className="card" key={type}>
            <h3>{label}</h3>

            <button
              className="btn secondary"
              onClick={() => download(type)}
            >
              CSV
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
