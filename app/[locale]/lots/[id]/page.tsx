'use client';
import {Money,CurrencyScope} from '@/components/DisplayCurrency';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import RecordWorkspaceNotice from '@/components/RecordWorkspaceNotice';
import {useRecordWorkspace} from '@/hooks/useRecordWorkspace';
import {recordWorkspaceHref} from '@/lib/record-workspace-scope';

export default function LotDetail() {
  const params = useParams<{ locale: string; id: string }>();
  const locale = params.locale;
  const id = params.id;
  const ar = locale === 'ar';

  const {data:x,owner,selection,loading,error,matches}=useRecordWorkspace('lots',id);
  if (loading) {
    return (
      <main className="container">
        <p role="status">{ar?'جارٍ تحميل الدفعة والتحقق من نطاقها…':'Loading and checking the lot workspace…'}</p>
      </main>
    );
  }
  if(error||!matches||!owner||!selection)return <main className="container"><RecordWorkspaceNotice {...{locale,id,owner,selection,error}} collection="lots"/></main>;
  const baseCurrency=x.transactions?.base_currency??x.asset_accounts?.currency??'SAR';

  return (
    <main className="container">
      <CurrencyScope currency={baseCurrency} organizationId={owner.organizationId??undefined}/>
      <div className="page-head">
        <div>
          <h1>{ar ? 'تفاصيل الدفعة' : 'Lot Detail'}</h1>
          <p className="muted">{x.id}</p>
        </div>

        <Link className="btn secondary" href={recordWorkspaceHref(locale,'lots',selection)}>
          {ar ? 'عودة' : 'Back'}
        </Link>
      </div>

      <div className="grid">
        <Card t={ar ? 'الأصل' : 'Asset'} v={x.asset_accounts?.name} />
        <Card
          t={ar ? 'القيمة المتبقية' : 'Remaining Value'}
          v={<Money value={x.remaining_value_base} currency={baseCurrency} organizationId={owner.organizationId}/>}
        />
        <Card
          t={ar ? 'بداية الحول' : 'Hawl Start'}
          v={x.hawl_start_date}
        />
        <Card
          t={ar ? 'استحقاق الحول' : 'Hawl Due'}
          v={x.hawl_due_date}
        />
      </div>

      <section className="card section">
        <h3>{ar ? 'المعاملة المصدر' : 'Source Transaction'}</h3>
        <pre className="pre">
          {JSON.stringify(x.transactions, null, 2)}
        </pre>
      </section>

      <section className="card section">
        <h3>{ar ? 'التخصيصات' : 'Allocations'}</h3>

        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>{ar ? 'الكمية' : 'Qty'}</th>
              <th>{ar ? 'القيمة' : 'Value'}</th>
              <th>{ar ? 'الطريقة' : 'Method'}</th>
            </tr>
          </thead>

          <tbody>
            {(x.transaction_allocations || []).map((a: any) => (
              <tr key={a.id}>
                <td>{a.transaction_id}</td>
                <td>{a.quantity}</td>
                <td><Money value={a.value_base} currency={baseCurrency} organizationId={owner.organizationId}/></td>
                <td>{a.allocation_method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card section">
        <h3>{ar ? 'سجل الاحتساب' : 'Assessment Lines'}</h3>

        <table className="table">
          <thead>
            <tr>
              <th>{ar ? 'التاريخ' : 'Date'}</th>
              <th>{ar ? 'الحالة' : 'Status'}</th>
              <th>{ar ? 'المبلغ' : 'Zakat'}</th>
              <th>{ar ? 'التفسير' : 'Explanation'}</th>
            </tr>
          </thead>

          <tbody>
            {(x.assessment_lines || []).map((a: any) => (
              <tr key={a.id}>
                <td>{a.zakat_assessments?.assessment_date}</td>
                <td>{a.eligibility_status}</td>
                <td><Money value={a.zakat_amount} currency={a.zakat_assessments?.currency || baseCurrency} organizationId={owner.organizationId}/></td>
                <td>{a.explanation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Card({ t, v }: { t: string; v: any }) {
  return (
    <div className="card">
      <div className="muted">{t}</div>
      <div className="metric">{v ?? '—'}</div>
    </div>
  );
}
