'use client';
import {useEffect,useState} from 'react';
import type {FinancialSetupReadiness} from '@/lib/financial-setup-readiness';
import type {FiscalManagementContext} from '@/lib/financial-fiscal-years';
type Account={kind:string;isActive:boolean;isPostable:boolean};
const groups:Record<string,[string,string]>={ASSET:['الأصول','Assets'],LIABILITY:['الالتزامات','Liabilities'],EQUITY:['حقوق الملكية','Equity'],REVENUE:['الإيرادات','Revenue'],INCOME:['الإيرادات','Income'],EXPENSE:['المصروفات','Expenses'],COGS:['تكلفة المبيعات','Cost of sales'],OPEX:['المصروفات التشغيلية','Operating expenses'],FINANCE:['تكاليف التمويل','Finance costs'],TAX:['الزكاة والضريبة','Zakat & tax']};
export default function FinancialSetupOverview({locale,organization,readiness,onEdit}:{locale:string;organization:string;readiness:FinancialSetupReadiness|null;onEdit:(section:string)=>void}){
 const ar=locale==='ar',t=(a:string,e:string)=>ar?a:e;
 const [fiscal,setFiscal]=useState<FiscalManagementContext|null>(null),[accounts,setAccounts]=useState<Account[]|null>(null),[loading,setLoading]=useState(true),[errors,setErrors]=useState<string[]>([]);
 useEffect(()=>{
  const controller=new AbortController();setFiscal(null);setAccounts(null);setErrors([]);setLoading(true);
  async function read(path:string){const response=await fetch(path,{cache:'no-store',signal:controller.signal});const data=await response.json();if(!response.ok||data.organizationId!==organization)throw Error('UNAVAILABLE');return data;}
  void Promise.allSettled([
   read('/api/financial-reporting/fiscal?'+new URLSearchParams({action:'management',organization})),
   read('/api/financial-reporting/chart?'+new URLSearchParams({organization})),
  ]).then(([calendar,chart])=>{
   if(controller.signal.aborted)return;
   if(calendar.status==='fulfilled')setFiscal(calendar.value);if(chart.status==='fulfilled'&&Array.isArray(chart.value.accounts))setAccounts(chart.value.accounts);
   setErrors([calendar.status==='rejected'?'fiscal':'',chart.status==='rejected'?'chart':''].filter(Boolean));setLoading(false);
  });return()=>controller.abort();
 },[organization]);
 const counts=new Map<string,number>();accounts?.filter(a=>a.isActive&&a.isPostable).forEach(a=>counts.set(a.kind,(counts.get(a.kind)??0)+1));
 const posting=readiness?.posting,closure=fiscal?.closures.find(c=>c.start===fiscal.period?.start&&c.status==='CLOSED');
 const approval=posting?.approvalStatus==='APPROVED'?t('معتمد','Approved'):posting?.approvalStatus==='DRAFT'?t('مسودة','Draft'):t('غير معتمد','Not approved');
 return <section className="settings-financial-overview" data-financial-overview-ready={!loading} aria-busy={loading}>
  <div className="settings-financial-overview-grid">
   <article className="settings-card"><h3>{t('إعداد السنة المالية','Fiscal year configuration')}</h3><p>{t('تقويم المؤسسة المستخدم في الافتتاحي والفترات والقوائم.','The organization calendar used by opening balances, periods and statements.')}</p>
    {loading?<p role="status">{t('جارٍ قراءة التقويم…','Reading calendar…')}</p>:errors.includes('fiscal')?<p role="alert">{t('تعذر قراءة السنة المالية.','Fiscal year unavailable.')}</p>:<dl className="settings-overview-facts">
     <div><dt>{t('بداية السنة','Year start')}</dt><dd><bdi>{fiscal?.calendar?fiscal.period?.start:'—'}</bdi></dd></div>
     <div><dt>{t('نهاية السنة المحسوبة','Calculated year end')}</dt><dd><bdi>{fiscal?.calendar?fiscal.period?.end:'—'}</bdi></dd></div>
     <div><dt>{t('حساب الأرباح المحتجزة','Retained earnings account')}</dt><dd><bdi>{fiscal?.calendar?.retained_earnings_account??'—'}</bdi></dd></div>
     <div><dt>{t('حالة السنة','Year status')}</dt><dd>{!fiscal?.calendar?t('غير محددة','Not configured'):closure?t('مقفلة','Closed'):t('مفتوحة','Open')}</dd></div>
    </dl>}
    <button type="button" className="btn secondary" onClick={()=>onEdit('fiscal')}>{t('إدارة السنة المالية','Manage fiscal year')}</button>
   </article>
   <article className="settings-card"><h3>{t('معاينة دليل الحسابات','Chart of accounts preview')}</h3><p>{t('الحسابات النشطة القابلة للترحيل من دليل المؤسسة المحفوظ.','Active posting accounts from the saved organization chart.')}</p>
    {loading?<p role="status">{t('جارٍ قراءة الدليل…','Reading chart…')}</p>:errors.includes('chart')?<p role="alert">{t('تعذر قراءة دليل الحسابات.','Chart unavailable.')}</p>:<table className="settings-chart-preview"><thead><tr><th>{t('مجموعة الحسابات','Account group')}</th><th>{t('عدد الحسابات','Accounts')}</th></tr></thead><tbody>{[...counts].map(([kind,count])=><tr key={kind}><td>{groups[kind]?.[ar?0:1]??kind}</td><td><bdi>{count}</bdi></td></tr>)}{!counts.size&&<tr><td colSpan={2}>{t('لا توجد حسابات نشطة قابلة للترحيل.','No active posting accounts.')}</td></tr>}</tbody></table>}
    <button type="button" className="btn secondary" onClick={()=>onEdit('chart')}>{t('إدارة دليل الحسابات','Manage chart of accounts')}</button>
   </article>
   <article className="settings-card"><h3>{t('قواعد الترحيل','Posting rules')}</h3><p>{t('حالة الربط من فحص المصادر والاعتماد الفعلي.','Mapping status from source checks and actual approval.')}</p>
    <dl className="settings-overview-facts"><div><dt>{t('القواعد المحفوظة','Saved rules')}</dt><dd><bdi>{posting?.ruleCount??'—'}</bdi></dd></div>
     <div><dt>{t('السطور المربوطة / المصدر','Mapped / source lines')}</dt><dd><bdi>{posting?posting.mappedLines+' / '+posting.sourceLines:'—'}</bdi></dd></div>
     <div><dt>{t('السطور غير المربوطة','Unmapped lines')}</dt><dd><bdi>{posting?.missingLines??'—'}</bdi></dd></div>
     <div><dt>{t('الربط الملتبس','Ambiguous mappings')}</dt><dd><bdi>{posting?.ambiguousLines??'—'}</bdi></dd></div>
     <div><dt>{t('الاعتماد النهائي','Approval')}</dt><dd>{readiness?approval:t('لم يتم التحقق','Not verified')}</dd></div></dl>
    <button type="button" className="btn secondary" onClick={()=>onEdit('posting')}>{t('إدارة قواعد الترحيل','Manage posting rules')}</button>
   </article>
  </div>
  <div className="settings-financial-overview-lower"><article className="settings-card"><h3>{t('النقد والبنوك والأرصدة الافتتاحية','Cash, banks & opening balances')}</h3><p>{t('إدارة الحسابات البنكية والصناديق من سجلها الأصلي، ومراجعة أرصدة بداية السنة في الافتتاحي.','Manage bank and cash accounts at their source; review start-of-year balances in the opening workspace.')}</p><div className="settings-overview-actions"><button type="button" className="btn secondary" onClick={()=>onEdit('banking')}>{t('إدارة النقد والبنوك','Manage cash & banks')}</button><button type="button" className="btn secondary" onClick={()=>onEdit('opening')}>{t('مراجعة الأرصدة الافتتاحية','Review opening balances')}</button></div></article>
   <aside className="settings-financial-guidance"><h3>{t('إرشاد مهم','Important guidance')}</h3><p>{t('قد تبدأ المؤسسة الجديدة دون أرصدة سابقة. تحدد رحلة الإعداد الحاجة إلى الافتتاحي وفق نوع البداية والمصادر المسجلة، ولا يُنسخ الرصيد البنكي الحالي إلى الافتتاحي تلقائيًا.','A new organization may start without prior balances. The setup journey checks opening requirements against the starting mode and recorded sources; current bank balances are never automatically copied into opening balances.')}</p></aside></div>
 </section>;
}
