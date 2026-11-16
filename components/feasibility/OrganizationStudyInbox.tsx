'use client';

import Link from 'next/link';
import { useRouter,useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { rememberedOrganization,type WorkspaceOrganization } from '@/lib/workspace-organization';
import WorkspaceOrganizationPicker from '@/components/WorkspaceOrganizationPicker';
import TopbarOrganizationControls from '@/components/TopbarOrganizationControls';
import { cloudDraftWrite } from '@/lib/feasibility/draft-schema';
import type { FeasibilityStudy } from '@/lib/feasibility/engine';
import FeasibilityReport from './FeasibilityReport';

type Share = { project_id: string; title: string; source_name: string; source_revision: number; expires_at: string };

export default function OrganizationStudyInbox({ locale,organizations }: { locale: string;organizations:WorkspaceOrganization[] }) {
  const ar = locale === 'ar';
  const params = useSearchParams();
  const router=useRouter();
  const selected = params.get('project') ?? '';
  const queryOrg = params.get('organization') ?? '';
  const [rememberedOrg, setRememberedOrg] = useState('');
  const organization = queryOrg || rememberedOrg;
  const [result, setResult] = useState<{ key: string; items: Share[]; study?: FeasibilityStudy; expiresAt?: string; error?: boolean }>();
  const requestKey = organization + ':' + selected;

  useEffect(() => {
    const update = () => setRememberedOrg(rememberedOrganization() || '');
    update();
    window.addEventListener('zf-organization-selection', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('zf-organization-selection', update);
      window.removeEventListener('popstate', update);
    };
  }, [queryOrg]);

  useEffect(() => {
    if (!organization) return;
    const controller = new AbortController();
    let latest = 0;
    const refresh = async () => {
      const version = ++latest;
      const q = new URLSearchParams({ organization, action: selected ? 'open' : 'inbox' });
      if (selected) q.set('project', selected);
      try {
        const response = await fetch('/api/feasibility/organization-shares?' + q, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw Error();
        const data = await response.json();
        if (controller.signal.aborted || version !== latest) return;
        if (!selected && Array.isArray(data)) setResult({ key: requestKey, items: data });
        else {
          const parsed = cloudDraftWrite.safeParse({ study: data.study });
          if (!parsed.success || parsed.data.study.id !== selected || typeof data.expires_at !== 'string') throw Error();
          setResult({ key: requestKey, items: [], study: parsed.data.study, expiresAt: data.expires_at });
        }
      } catch {
        if (!controller.signal.aborted && version === latest) setResult({ key: requestKey, items: [], error: true });
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => { controller.abort(); clearInterval(interval); window.removeEventListener('focus', focus); };
  }, [organization, requestKey, selected]);

  useEffect(() => {
    if (!result?.expiresAt) return;
    const wait = Math.min(2_147_483_647, Math.max(0, Date.parse(result.expiresAt) - Date.now()));
    const timer = window.setTimeout(() => {
      if (Date.parse(result.expiresAt!) <= Date.now()) {
        setResult(current => current === result ? { key: result.key, items: [], error: true } : current);
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [result]);

  const current = result?.key === requestKey ? result : undefined;
  const base = '/' + locale + '/feasibility/shared';
  return <main className="container fs-page" dir={ar ? 'rtl' : 'ltr'}>
    <TopbarOrganizationControls>
      <WorkspaceOrganizationPicker ar={ar} organizations={organizations} value={organization} restore={false}
        onChange={id=>router.replace(base+'?'+new URLSearchParams({organization:id}),{scroll:false})}/>
    </TopbarOrganizationControls>
    <header className="fs-head"><h1>{ar ? 'الدراسات المشتركة مع المؤسسة' : 'Studies shared with the organization'}</h1></header>
    {!organization && <p>{ar ? 'اختر المؤسسة من البنر الرئيسي.' : 'Select an organization in the top bar.'}</p>}
    {organization && <section className="card fs-panel">
      <p>{ar ? 'معرّف مؤسستك للمشاركة' : 'Your organization ID for sharing'} <code dir="ltr">{organization}</code></p>
      {selected && <Link href={base + '?' + new URLSearchParams({ organization })}>{ar ? 'عرض كل الدراسات المشتركة' : 'All shared studies'}</Link>}
      {!current && <p role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>}
      {current?.error && <p role="alert">{ar ? 'الدراسة غير متاحة أو انتهى الوصول.' : 'The study is unavailable or access ended.'}</p>}
      {current?.study && <><h2>{current.study.title}</h2><p>{ar ? 'النسخة المشتركة للقراءة حتى' : 'Shared revision available until'}{' '}
        <time dateTime={current.expiresAt}>{new Date(current.expiresAt!).toLocaleString(locale)}</time></p>
        <FeasibilityReport study={current.study} locale={locale} allowExport={false}/>
      </>}
      {current && !current.error && !selected && (current.items.length ? <ul>
        {current.items.map(share => <li key={share.project_id}>
          <Link href={base + '?' + new URLSearchParams({ organization, project: share.project_id })}>{share.title}</Link>
          {' · '}{share.source_name}{' · '}<time dateTime={share.expires_at}>{new Date(share.expires_at).toLocaleString(locale)}</time>
        </li>)}
      </ul> : <p>{ar ? 'لا توجد دراسات مشتركة متاحة.' : 'No shared studies are available.'}</p>)}
    </section>}
  </main>;
}
