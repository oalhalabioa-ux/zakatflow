'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';

export default function Lots({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  const ar = locale === 'ar';

  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/lots')
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows);
  }, []);

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Lots & {ar ? 'الحول' : 'Hawl'}</h1>
          <p className="muted">
            {ar
              ? 'كل دفعة مرتبطة بمصدرها وحولها وتخصيصاتها.'
              : 'Every lot is traceable to its source, Hawl and allocations.'}
          </p>
        </div>
      </div>

      <div className="card section">
        <table className="table">
          <thead>
            <tr>
              <th>{ar ? 'الأصل' : 'Asset'}</th>
              <th>{ar ? 'المتبقي' : 'Remaining'}</th>
              <th>{ar ? 'بداية الحول' : 'Hawl Start'}</th>
              <th>{ar ? 'الاستحقاق' : 'Due'}</th>
              <th>{ar ? 'الحالة' : 'Status'}</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.asset_accounts?.name || r.asset_account_id}</td>
                <td>{r.remaining_quantity}</td>
                <td>{r.hawl_start_date}</td>
                <td>{r.computed_hawl_due_date || r.hawl_due_date}</td>
                <td>
                  <span className="pill">{r.status}</span>
                </td>
                <td>
                  <Link
                    className="btn secondary"
                    href={`/${locale}/lots/${r.id}`}
                  >
                    {ar ? 'تفاصيل' : 'Details'}
                  </Link>
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {ar ? 'لا توجد دفعات بعد.' : 'No lots yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
