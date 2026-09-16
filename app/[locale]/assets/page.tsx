'use client';

import { useEffect, useState } from 'react';

export default function Assets() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({
    asset_type: 'CASH',
    name: '',
    currency: 'SAR',
    unit: 'unit',
  });
  const [msg, setMsg] = useState('');

  const load = async () => {
    const r = await fetch('/api/assets');
    const data = r.ok ? await r.json() : [];
    setRows(data);
  };

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    const r = await fetch('/api/assets', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...form,
        is_zakatable: true,
      }),
    });

    if (r.ok) {
      setMsg('تم حفظ الأصل.');
      setForm({
        ...form,
        name: '',
      });

      await load();
    } else {
      const data = await r.json();
      setMsg(data.error || 'خطأ');
    }
  }

  return (
    <main className="container">
      <h1>الأصول</h1>

      <p className="muted">
        الحسابات التي ستغذي سجل المعاملات والـLots.
      </p>

      <div className="card section">
        <div className="form-grid">
          <label>
            النوع
            <select
              value={form.asset_type}
              onChange={(e) =>
                setForm({
                  ...form,
                  asset_type: e.target.value,
                })
              }
            >
              {[
                'CASH',
                'BANK',
                'GOLD',
                'SILVER',
                'STOCK',
                'INVENTORY',
                'RECEIVABLE',
                'REAL_ESTATE',
                'OTHER',
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>

          <label>
            اسم الأصل
            <input
              value={form.name}
              onChange={(e) =>
                setForm({
                  ...form,
                  name: e.target.value,
                })
              }
              placeholder="الحساب / الذهب / المحفظة"
            />
          </label>

          <label>
            العملة
            <input
              value={form.currency}
              onChange={(e) =>
                setForm({
                  ...form,
                  currency: e.target.value.toUpperCase(),
                })
              }
            />
          </label>
        </div>

        <button className="btn" onClick={save}>
          حفظ الأصل
        </button>

        {msg && <p className="muted">{msg}</p>}
      </div>

      <div className="card section">
        <table className="table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>النوع</th>
              <th>العملة</th>
              <th>زكوي؟</th>
              <th>الحالة</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.asset_type}</td>
                <td>{r.currency}</td>
                <td>{r.is_zakatable ? 'نعم' : 'لا'}</td>
                <td>
                  <span className="pill">{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
