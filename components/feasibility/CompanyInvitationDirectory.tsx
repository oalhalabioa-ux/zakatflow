'use client';

import { useEffect, useState } from 'react';

const endpoint = '/api/feasibility/company-invitations';

export function CompanyDirectorySearch({ ar, organization, onChoose }: {
  ar: boolean; organization: string; onChoose: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [matches, setMatches] = useState<{ id: string; name: string }[]>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(false);

  async function search() {
    setSearching(true);
    setError(false);
    setMatches(undefined);
    try {
      const params = new URLSearchParams({ action: 'directory_search', organization, name: name.trim() });
      const response = await fetch(endpoint + '?' + params, { cache: 'no-store' });
      if (!response.ok) throw Error();
      setMatches(await response.json());
    } catch {
      setError(true);
    } finally {
      setSearching(false);
    }
  }

  return <div className="fs-field">
    <label className="fs-field">{ar ? 'اسم المؤسسة في دليل المشاركة' : 'Organization name in the sharing directory'}
      <input value={name} maxLength={100} disabled={searching} onChange={event => { setName(event.target.value); setMatches(undefined); }}/>
    </label>
    <button type="button" className="fs-btn fs-btn--secondary" onClick={() => void search()}
      disabled={searching || name.trim().length < 2}>{ar ? 'بحث' : 'Search'}</button>
    {error && <p role="alert">{ar ? 'تعذر البحث في دليل المشاركة.' : 'Could not search the sharing directory.'}</p>}
    {matches?.length === 0 && <p role="status">{ar ? 'لم تُعثر على مؤسسات مطابقة في الدليل.' : 'No matching organizations in the directory.'}</p>}
    {!!matches?.length && <ul>{matches.map(org => <li key={org.id}>
      <button type="button" className="fs-btn fs-btn--secondary" onClick={() => { onChoose(org.id); setName(org.name); setMatches(undefined); }}>
        <bdi>{org.name}</bdi>
      </button>
    </li>)}</ul>}
  </div>;
}

export function CompanyDirectoryVisibility({ ar, organization }: { ar: boolean; organization: string }) {
  const [visible, setVisible] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const stop = new AbortController();
    const params = new URLSearchParams({ action: 'directory_status', organization });
    fetch(endpoint + '?' + params, { cache: 'no-store', signal: stop.signal })
      .then(async response => {
        if (response.ok && !stop.signal.aborted) setVisible(await response.json());
      }).catch(() => { if (!stop.signal.aborted) setError(true); });
    return () => stop.abort();
  }, [organization]);

  async function update() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: visible ? 'directory_disable' : 'directory_enable', organization }) });
      if (!response.ok) throw Error();
      setVisible(await response.json());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (visible === undefined && !error) return null;
  return <div className="fs-panel">
    {visible !== undefined && <label>
      <input type="checkbox" checked={visible} disabled={busy} onChange={() => void update()}/>
      {' '}{ar ? 'إظهار المؤسسة في دليل المشاركة' : 'List this organization in the sharing directory'}
    </label>}
    {error && <p role="alert">{ar ? 'تعذر تغيير الظهور. يستطيع مالك المؤسسة تحديث هذا الخيار.' : 'Could not update visibility. The organization owner can change this setting.'}</p>}
  </div>;
}
