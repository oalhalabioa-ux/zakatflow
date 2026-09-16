'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';

export default function TxDetail({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = use(params);
  const ar = locale === 'ar';

  const [x, setX] = useState<any>();
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch(`/api/transactions/${id}`)
      .then((r) => r.json())
      .then(setX);
  }, [id]);

  async function reverse() {
    if (!confirm(ar ? 'تأكيد عكس المعاملة؟' : 'Reverse this transaction?')) {
      return;
    }

    const r = await fetch(`/api/transactions/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reverse' }),
    });

    const j = await r.json();

    setMsg(
      r.ok
        ? ar
          ? 'تم إنشاء القيد العكسي'
          : 'Reversal created'
        : j.error
    );
  }

  if (!x) {
    return <main className="container">Loading…</main>;
  }

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>{ar ? 'تفاصيل المعاملة' : 'Transaction Detail'}</h1>
          <p className="muted">{x.id}</p>
        </div>

        <div>
          <Link
            className="btn secondary"
            href={`/${locale}/transactions`}
          >
            {ar ? 'عودة' : 'Back'}
          </Link>{' '}

          <button className="btn danger" onClick={reverse}>
            {ar ? 'عكس المعاملة' : 'Reverse'}
          </button>
        </div>
      </div>

      {msg && <div className="success">{msg}</div>}

      <div className="grid section">
        <Card t="Type" v={x.transaction_type} />
        <Card t="Date" v={x.transaction_date} />
        <Card t="Value" v={`${x.base_value} ${x.base_currency}`} />
        <Card t="Asset" v={x.asset_accounts?.name} />
      </div>

      <section className="card section">
        <h3>{ar ? 'التخصيصات' : 'Lot Allocations'}</h3>

        <table className="table">
          <thead>
            <tr>
              <th>Lot</th>
              <th>Qty</th>
              <th>Value</th>
              <th>Method</th>
            </tr>
          </thead>

          <tbody>
            {(x.transaction_allocations || []).map((a: any) => (
              <tr key={a.id}>
                <td>
                  <Link href={`/${locale}/lots/${a.lot_id}`}>
                    {a.lot_id}
                  </Link>
                </td>
                <td>{a.quantity}</td>
                <td>{a.value_base}</td>
                <td>{a.allocation_method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card section">
        <h3>{ar ? 'ملاحظات' : 'Notes'}</h3>
        <p className="muted">{x.notes || '—'}</p>
      </section>
    </main>
  );
}

function Card({ t, v }: { t: string; v: any }) {
  return (
    <div className="card">
      <div className="muted">{t}</div>
      <div className="metric">{v || '—'}</div>
    </div>
  );
}
