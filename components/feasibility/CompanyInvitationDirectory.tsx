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
  const [receiving, setReceiving] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const stop = new AbortController();
    async function load(action: string, set: (value: boolean) => void) {
      const params = new URLSearchParams({ action, organization });
      try {
        const response = await fetch(endpoint + '?' + params, { cache: 'no-store', signal: stop.signal });
        if (response.status === 403) return;
        if (!response.ok) throw Error();
        const value = await response.json();
        if (!stop.signal.aborted) set(value);
      } catch {
        if (!stop.signal.aborted) setError(true);
      }
    }
    void load('directory_status', setVisible);
    void load('reception_status', setReceiving);
    return () => stop.abort();
  }, [organization]);

  async function update(setting: 'directory' | 'reception', enabled: boolean) {
    setBusy(true);
    setError(false);
    const change = setting === 'directory'
      ? { action: enabled ? 'directory_enable' : 'directory_disable' }
      : { action: 'reception_update', enabled };
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...change, organization }) });
      if (!response.ok) throw Error();
      const value = await response.json();
      (setting === 'directory' ? setVisible : setReceiving)(value);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (visible === undefined && receiving === undefined && !error) return null;
  return <div className="fs-panel">
    {visible !== undefined && <label className="fs-field">
      <input type="checkbox" checked={visible} disabled={busy} onChange={event => void update('directory', event.target.checked)}/>
      {ar ? 'إظهار المؤسسة في دليل المشاركة' : 'List this organization in the sharing directory'}
    </label>}
    {receiving !== undefined && <label className="fs-field">
      <input type="checkbox" checked={receiving} disabled={busy} onChange={event => void update('reception', event.target.checked)}/>
      {ar ? 'السماح باستقبال دعوات المشاركة' : 'Allow incoming sharing invitations'}
    </label>}
    {error && <p role="alert">{ar ? 'تعذر تحميل إعدادات المشاركة أو تحديثها.' : 'Could not load or update sharing settings.'}</p>}
  </div>;
}
