'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { proposalReviewHref } from '@/lib/feasibility/share-proposals';

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
}

export default function Notifications({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  const ar = locale === 'ar';

  const [rows, setRows] = useState<any[]>([]);

  const load = () =>
    fetch('/api/notifications')
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows);

  useEffect(() => {
    load();
  }, []);

  async function read(id: string) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    load();
  }

  return (
    <main className="container">
      <h1>{ar ? 'الإشعارات' : 'Notifications'}</h1>

      <p className="muted">
        {ar
          ? 'تنبيهات الحول والاستحقاقات وحالة النظام.'
          : 'Hawl, due-date and system notifications.'}
      </p>

      <div className="card section">
        {rows.map((n) => (
          <div
            key={n.id}
            className={n.read_at ? 'notice' : 'success'}
            style={{ marginBottom: 10 }}
          >
            <strong>{n.title}</strong>
            <p>{n.body}</p>
            <small>{n.scheduled_for || ''}</small>
            {n.type === 'feasibility_share_proposal' && isId(n.metadata?.organization)
              && isId(n.metadata?.project) && isId(n.metadata?.proposal) && <p>
              <Link href={proposalReviewHref(locale, n.metadata.organization, n.metadata.project, n.metadata.proposal)}>
                {ar ? 'مراجعة التعديلات' : 'Review changes'}
              </Link>
            </p>}

            {!n.read_at && (
              <button
                className="btn secondary"
                style={{ marginInlineStart: 10 }}
                onClick={() => read(n.id)}
              >
                {ar ? 'تمت القراءة' : 'Mark read'}
              </button>
            )}
          </div>
        ))}

        {!rows.length && (
          <p className="muted">
            {ar ? 'لا توجد إشعارات.' : 'No notifications.'}
          </p>
        )}
      </div>
    </main>
  );
}
