'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { UnifiedInvoiceRegister } from '@/components/unified-invoice-register';
import { organizationDisplayName } from '@/lib/organization-display';
import '../vat/vat.css';
import './register.css';
type Organization = { id: string; name: string; organization_kind?: 'HOLDING' | 'SUBSIDIARY'; parent_organization_id?: string | null };
export default function InvoiceRegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const ar = locale === 'ar';
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    void fetch('/api/organizations', {signal:controller.signal,cache:'no-store'}).then(async response => {
      if (!response.ok) throw new Error('ORGANIZATIONS_LOAD_FAILED');
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error('ORGANIZATIONS_LOAD_FAILED');
      if (!controller.signal.aborted) { setOrganizations(body); setOrganizationId(current => body.some((org: Organization) => org.id === current) ? current : body[0]?.id || ''); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  return <main className="vat-page vat-unified-page" dir={ar?'rtl':'ltr'}><header className="vat-header"><div><span className="vat-eyebrow">{ar?'الفواتير':'INVOICES'}</span><h1>{ar?'سجل الفواتير الموحد':'Unified invoice register'}</h1><p>{ar?'صفحة مستقلة تجمع مستندات الشركة وحالاتها المحاسبية والإصدار والسداد.':'A separate page showing company documents, accounting, issuance and payment states.'}</p></div><Link className="vat-button secondary" href={`/${locale}/vat?section=invoices`}>{ar?'فتح شاشة الفواتير الحالية':'Open existing invoice workspace'}</Link></header>
    {loading ? <p role="status">{ar?'جارٍ تحميل الشركات…':'Loading companies…'}</p> : error ? <div role="alert"><p>{ar?'تعذر تحميل الشركات.':'Could not load companies.'}</p><button type="button" className="vat-button secondary" onClick={() => setRevision(v => v + 1)}>{ar?'إعادة المحاولة':'Retry'}</button></div> : organizations.length === 0 ? <p>{ar?'لا توجد شركات مرتبطة بحسابك.':'No companies are linked to your account.'}</p> : <><label className="vat-unified-company">{ar?'الشركة':'Company'}<select value={organizationId} onChange={event => setOrganizationId(event.target.value)}>{organizations.map(org => <option key={org.id} value={org.id}>{organizationDisplayName(org.name,ar)}</option>)}</select></label>{organizationId && <UnifiedInvoiceRegister key={organizationId} organizationId={organizationId} ar={ar} refresh={revision} />}</>}
  </main>;
}
