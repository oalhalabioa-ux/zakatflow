'use client';

import { use, useEffect, useState } from 'react';

export default function Organizations({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  const ar = locale === 'ar';

  const [orgs, setOrgs] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [entities, setEntities] = useState<any[]>([]);
  const [entity, setEntity] = useState('');

  const load = async () => {
    const r = await fetch('/api/organizations');
    if (r.ok) setOrgs(await r.json());
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!name) return;

    await fetch('/api/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    setName('');
    load();
  };

  const choose = async (o: any) => {
    setSelected(o);

    const r = await fetch(
      '/api/organizations/entities?organization_id=' + o.id
    );

    if (r.ok) setEntities(await r.json());
  };

  const add = async () => {
    if (!entity || !selected) return;

    await fetch('/api/organizations/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: selected.id,
        name: entity,
      }),
    });

    setEntity('');
    choose(selected);
  };

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>
            {ar ? 'المؤسسات والعائلات' : 'Organizations & Families'}
          </h1>

          <p className="muted">
            {ar
              ? 'إدارة عدة كيانات ومحافظ ضمن مساحة واحدة.'
              : 'Manage multiple entities and portfolios in one workspace.'}
          </p>
        </div>
      </div>

      <section className="grid">
        <div className="card">
          <h2>{ar ? 'إنشاء مساحة' : 'Create workspace'}</h2>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={ar ? 'اسم المؤسسة أو العائلة' : 'Organization name'}
          />

          <button className="btn" onClick={create}>
            {ar ? 'إنشاء' : 'Create'}
          </button>

          <div className="list">
            {orgs.map((o) => (
              <button
                className="listrow"
                key={o.id}
                onClick={() => choose(o)}
              >
                {o.name}
                <span>{o.entity_type}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>
            {selected
              ? selected.name
              : ar
                ? 'اختر مساحة'
                : 'Select a workspace'}
          </h2>

          {selected && (
            <>
              <div className="row">
                <input
                  value={entity}
                  onChange={(e) => setEntity(e.target.value)}
                  placeholder={ar ? 'اسم الكيان' : 'Entity name'}
                />

                <button className="btn" onClick={add}>
                  {ar ? 'إضافة كيان' : 'Add entity'}
                </button>
              </div>

              <div className="list">
                {entities.map((e) => (
                  <div className="listrow" key={e.id}>
                    {e.name}
                    <span>{e.entity_type}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
