'use client';

import { use, useEffect, useState } from 'react';
import Link from '@/components/WorkspaceLink';
import {useWorkspaceScope} from '@/hooks/useWorkspaceScope';
import {lotWorkspaceQuery} from '@/lib/lot-workspace-scope';
import TopbarOrganizationControls from '@/components/TopbarOrganizationControls';
import WorkspaceOrganizationPicker from '@/components/WorkspaceOrganizationPicker';

export default function Lots({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  const ar = locale === 'ar';

  const [scope]=useWorkspaceScope(),[org,setOrg]=useState(''),[group,setGroup]=useState(false),[organizations,setOrganizations]=useState<any[]>([]);
  const query=lotWorkspaceQuery(scope,org,group);
  const [snapshot,setSnapshot]=useState<{query:string;rows:any[]}|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const rows=snapshot?.query===query?snapshot.rows:[];
  useEffect(()=>{
    const controller=new AbortController();setError('');setLoading(Boolean(query));
    if(query)fetch('/api/lots?'+query,{cache:'no-store',signal:controller.signal}).then(async response=>{
      const data=await response.json();if(!response.ok)throw Error(data.error??'LOT_LOAD_FAILED');
      if(!controller.signal.aborted)setSnapshot({query,rows:data});
    }).catch(()=>{if(!controller.signal.aborted)setError(ar?'تعذر تحميل دفعات النطاق المحدد. راجع المؤسسة والصلاحيات ثم أعد المحاولة.':'Unable to load lots for this workspace. Check the company and permissions, then retry.')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[query,ar]);

  useEffect(()=>{const c=new AbortController();fetch('/api/assets/catalog',{signal:c.signal}).then(r=>r.ok?r.json():null).then(d=>{if(d&&!c.signal.aborted)setOrganizations(d.organizations)}).catch(()=>{});return()=>c.abort()},[]);
  return (
    <main className="container">{scope==='ORGANIZATION'&&<TopbarOrganizationControls><WorkspaceOrganizationPicker ar={ar} organizations={organizations} value={org} onChange={setOrg} group={group} onGroupChange={setGroup}/></TopbarOrganizationControls>}
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

      {error&&<p role="alert">{error}</p>}
      {loading&&<p role="status">{ar?'جارٍ تحميل دفعات النطاق…':'Loading workspace lots…'}</p>}
      {scope==='ORGANIZATION'&&!org&&<p>{ar?'اختر مؤسسة مصرحًا بها من البنر لعرض دفعاتها.':'Choose an authorized organization from the banner to view its lots.'}</p>}
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

            {!loading&&!error&&query&&rows.length === 0 && (
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
