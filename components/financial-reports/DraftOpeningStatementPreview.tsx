'use client';

import Link from 'next/link';
import Decimal from 'decimal.js';
import {Icon} from './FinancialReportsPilot';
import {Metric} from './ReportPages';
import {ReportCard} from './ReportCharts';
import type {DraftOpeningReport} from '../../lib/financial-draft-opening-report';
import type {StatementHubView} from '../../lib/financial-statement-summary';

const Money=Decimal.clone({precision:50});
const format=(value:string)=>{const n=new Money(value),[whole,fraction]=n.abs().toFixed(2).split('.');const display=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+fraction;return n.isNegative()?'('+display+')':display};

export default function DraftOpeningStatementPreview({report,view,en}:{report:DraftOpeningReport;view:StatementHubView;en:boolean}){
 const t=(ar:string,english:string)=>en?english:ar;
 const balancedFunding=new Money(report.assets).eq(new Money(report.liabilities).plus(report.equity));
 const openingLink=`/${en?'en':'ar'}/opening-balances?organization=${encodeURIComponent(report.organizationId)}&fiscalStart=${encodeURIComponent(report.fiscalStart)}`;
 const selectedView=['overview','statements','position','kpis'].includes(view);
 return <section className="ob-statement-draft" data-opening-draft-preview={report.draftId}>
  <div className="ob-draft-banner" role="status"><Icon name="file" size={20}/><div><strong>{t('معاينة مالية من مسودة الأرصدة الافتتاحية — غير معتمدة','Financial preview from saved opening draft — not approved')}</strong><p>{t('هذه الأرقام للعرض والمراجعة فقط. لا تُرحَّل إلى الأستاذ ولا تُغيّر القوائم الرسمية.','These numbers are for review only. No ledger posting or change to official statements occurs.')}</p><small>{t('إصدار المسودة','Draft version')} {report.draftVersion} · {report.fiscalStart} · {report.currency}</small></div></div>
  {(report.sourceChanged||!report.balanced||report.pending>0||report.sourceIssues>0)&&<p className="ob-draft-warning" role="alert">{report.sourceChanged?t('تغيّرت المصادر منذ حفظ المسودة. حدّث الأرصدة الافتتاحية وأعد حفظها قبل الاعتماد على هذه المعاينة.','Sources changed after the draft was saved. Refresh and save the openings before relying on this preview.'):!report.balanced?t('المسودة غير متوازنة. لا تعتمد هذه المعاينة كتقرير مالي.','The draft is unbalanced. This is not a financial statement.'):t('المعاينة جزئية: حسابات دون رصيد مؤكد: ','Partial preview — unconfirmed items: ')+report.pending+t('؛ مصادر بحاجة إلى مراجعة: ','; sources requiring review: ')+report.sourceIssues}</p>}
  {!report.sourceChanged&&report.balanced&&<>
   <div className="fs-metrics four ob-draft-metrics">
    <Metric label={t('الأصول الافتتاحية','Opening assets')} value={format(report.assets)} unit={report.currency} icon="layers" change={null}/>
    <Metric label={t('الالتزامات الافتتاحية','Opening liabilities')} value={format(report.liabilities)} unit={report.currency} icon="file" change={null}/>
    <Metric label={t('حقوق الملكية الافتتاحية','Opening equity')} value={format(report.equity)} unit={report.currency} icon="crown" change={null}/>
    <Metric label={t('النقد الافتتاحي','Opening cash')} value={format(report.cash)} unit={report.currency} icon="coins" change={null}/>
   </div>
   {selectedView?<div className="fs-statement-layout fs-position-layout"><ReportCard title={t('قائمة المركز المالي — مسودة افتتاحية','Financial position — opening draft')} icon="file">
    <div className="fs-table-scroll fs-source-statement-table fs-position-table"><table className="fs-table"><thead><tr><th>{t('البند','Item')}</th><th>{t('إيضاح','Note')}</th><th>{t('الفترة الحالية','Current period')}</th><th>{t('الفترة السابقة','Previous period')}</th><th>{t('التغير','Change')}</th><th>{t('نسبة التغير','Change %')}</th></tr></thead><tbody>
     {(['ASSET','LIABILITY','EQUITY'] as const).flatMap(kind=>[
      <tr key={kind} className="fs-row-section"><th scope="row">{kind==='ASSET'?t('الأصول','Assets'):kind==='LIABILITY'?t('الالتزامات','Liabilities'):t('حقوق الملكية','Equity')}</th><td>—</td><td dir="ltr">{format(kind==='ASSET'?report.assets:kind==='LIABILITY'?report.liabilities:report.equity)}</td><td>—</td><td>—</td><td>—</td></tr>,
      ...report.rows.filter(row=>row.kind===kind).map(row=><tr key={row.code} className="fs-row-child"><th scope="row"><span className="fs-statement-row-label">{en?row.en:row.ar}{row.pending>0&&<small> · {t('غير مكتمل','Incomplete')}</small>}</span></th><td>—</td><td dir="ltr">{format(new Money(row.debit).minus(row.credit).times(kind==='ASSET'?1:-1).toFixed(4))}</td><td>—</td><td>—</td><td>—</td></tr>)
     ])}
    </tbody></table></div>
    {balancedFunding?<div className="fs-success"><Icon name="check"/>{t('توازن المسودة','Draft balanced')} · <bdi dir="ltr">{format(report.assets)} = {format(report.liabilities)} + {format(report.equity)}</bdi></div>:<p role="alert">{t('يوجد اختلاف في تصنيف الحسابات؛ راجع الدليل قبل الاعتماد.','Account classification mismatch; review the chart before approval.')}</p>}
   </ReportCard><div className="fs-stack"><ReportCard title={t('مراجعة المركز المالي','Financial position review')} icon="target"><p>{t('هذه معاينة رصيد بداية السنة فقط، ولا تشمل حركات الفترة أو مقارنات السنة السابقة.','This opening-only preview excludes in-year movements and prior-period comparison.')}</p></ReportCard></div></div>:<ReportCard title={view==='income'?t('قائمة الدخل','Income statement'):t('التدفقات النقدية','Cash flow statement')} icon="file"><p>{t('الأرصدة الافتتاحية وحدها لا تُنشئ إيرادات أو مصروفات أو تدفقات خلال الفترة.','Opening balances alone do not create period income or cash movements.')}</p></ReportCard>}
  </>}
  <p className="ob-draft-foot"><Link href={openingLink}>{t('مراجعة المسودة واستكمال الاعتماد','Review saved draft and complete approval')}</Link></p>
 </section>;
}
