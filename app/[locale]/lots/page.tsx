'use client';

import { use, useEffect, useState } from 'react';
import Link from '@/components/WorkspaceLink';
import {useWorkspaceScope} from '@/hooks/useWorkspaceScope';
import {organizationScopeIds} from '@/lib/workspace-organization';
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
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/lots')
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows);
  }, []);

  useEffect(()=>{const c=new AbortController();fetch('/api/assets/catalog',{signal:c.signal}).then(r=>r.ok?r.json():null).then(d=>{if(d&&!c.signal.aborted)setOrganizations(d.organizations)}).catch(()=>{});return()=>c.abort()},[]);
  const ids=organizationScopeIds(organizations,org,group),visible=rows.filter(row=>scope==='PERSONAL'?!row.asset_accounts?.organization_id:ids.has(row.asset_accounts?.organization_id));
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
            {visible.map((r) => (
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
