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
   {selectedView?<ReportCard title={t('المركز المالي الافتتاحي — من المسودة المحفوظة','Opening financial position — saved draft')} icon="balance">
    <div className="ob-draft-table-scroll"><table className="ob-draft-table"><thead><tr><th>{t('الحساب','Account')}</th><th>{t('مدين','Debit')}</th><th>{t('دائن','Credit')}</th></tr></thead><tbody>
     {report.rows.map(row=><tr key={row.code}><th>{row.code} · {en?row.en:row.ar}{row.pending>0&&<small> · {t('غير مكتمل','Incomplete')}</small>}</th><td>{format(row.debit)}</td><td>{format(row.credit)}</td></tr>)}
     <tr className="ob-draft-total"><th>{t('ميزان مراجعة المسودة','Draft trial balance')}</th><td>{format(report.debit)}</td><td>{format(report.credit)}</td></tr>
    </tbody></table></div>
    <p className="ob-draft-balance">{balancedFunding?t('الأصول = الالتزامات + حقوق الملكية (للأرصدة المدخلة).','Assets = liabilities + equity (entered balances only).'):t('يوجد اختلاف في تصنيف الحسابات؛ راجع الدليل قبل اعتماد القائمة.','Account classification mismatch; review the chart before approving the statement.')}</p>
   </ReportCard>:<ReportCard title={view==='income'?t('قائمة الدخل','Income statement'):t('التدفقات النقدية','Cash flow statement')} icon="file"><p>{t('الأرصدة الافتتاحية وحدها لا تُنشئ إيرادات أو مصروفات أو تدفقات خلال الفترة. هذه المعاينة تعرض رصيد البداية فقط، وتظل حركات السنة مرتبطة بالتقارير الرسمية بحسب حالة اعتمادها.','Opening balances alone do not create period income, expenses or cash movements. This preview shows the starting balance only; in-year activity remains subject to the official reporting workflow.')}</p></ReportCard>}
  </>}
  <p className="ob-draft-foot"><Link href={openingLink}>{t('مراجعة المسودة واستكمال الاعتماد','Review saved draft and complete approval')}</Link></p>
 </section>;
}
