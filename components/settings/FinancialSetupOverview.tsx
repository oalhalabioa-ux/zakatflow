'use client';
import SettingsIcon from './SettingsIcon';
import type {CashAccount} from '@/lib/financial-register';
import {useEffect,useState} from 'react';
import type {FinancialSetupReadiness} from '@/lib/financial-setup-readiness';
import type {FiscalManagementContext} from '@/lib/financial-fiscal-years';
type Account={kind:string;isActive:boolean;isPostable:boolean};
const groups:Record<string,[string,string]>={ASSET:['الأصول','Assets'],LIABILITY:['الالتزامات','Liabilities'],EQUITY:['حقوق الملكية','Equity'],REVENUE:['الإيرادات','Revenue'],INCOME:['الإيرادات','Income'],EXPENSE:['المصروفات','Expenses'],COGS:['تكلفة المبيعات','Cost of sales'],OPEX:['المصروفات التشغيلية','Operating expenses'],FINANCE:['تكاليف التمويل','Finance costs'],TAX:['الزكاة والضريبة','Zakat & tax']};
export default function FinancialSetupOverview({locale,organization,readiness,onEdit}:{locale:string;organization:string;readiness:FinancialSetupReadiness|null;onEdit:(section:string)=>void}){
 const ar=locale==='ar',t=(a:string,e:string)=>ar?a:e;
 const [cash,setCash]=useState<CashAccount[]|null>(null);
 const [fiscal,setFiscal]=useState<FiscalManagementContext|null>(null),[accounts,setAccounts]=useState<Account[]|null>(null),[loading,setLoading]=useState(true),[errors,setErrors]=useState<string[]>([]);
 useEffect(()=>{
  const controller=new AbortController();setFiscal(null);setAccounts(null);setCash(null);setErrors([]);setLoading(true);
  async function read(path:string){const response=await fetch(path,{cache:'no-store',signal:controller.signal});const data=await response.json();if(!response.ok||data.organizationId!==organization)throw Error('UNAVAILABLE');return data;}
  void Promise.allSettled([
   read('/api/financial-reporting/fiscal?'+new URLSearchParams({action:'management',organization})),
   read('/api/financial-reporting/chart?'+new URLSearchParams({organization})),
   fetch('/api/financial-register?'+new URLSearchParams({scope:'ORGANIZATION',organization_id:organization}),{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const d=await r.json();if(!Array.isArray(d.organizationIds)||!d.organizationIds.includes(organization)||!Array.isArray(d.accounts))throw Error();return d.accounts.filter((a:CashAccount)=>a.organizationId===organization);}),
  ]).then(([calendar,chart,banks])=>{
   if(controller.signal.aborted)return;
   if(calendar.status==='fulfilled')setFiscal(calendar.value);if(chart.status==='fulfilled'&&Array.isArray(chart.value.accounts))setAccounts(chart.value.accounts);
   if(banks.status==='fulfilled')setCash(banks.value);
   setErrors([calendar.status==='rejected'?'fiscal':'',chart.status==='rejected'||!Array.isArray(chart.value.accounts)?'chart':''].filter(Boolean));setLoading(false);
  });return()=>controller.abort();
 },[organization]);
 const counts=new Map<string,number>();accounts?.filter(a=>a.isActive&&a.isPostable).forEach(a=>{const kind=['COGS','OPEX','FINANCE','TAX','EXPENSE'].includes(a.kind)?'EXPENSE':a.kind==='INCOME'?'REVENUE':a.kind;counts.set(kind,(counts.get(kind)??0)+1);});
 const primaryGroups=['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'];
 const visibleGroups=[...primaryGroups,...[...counts.keys()].filter(k=>!primaryGroups.includes(k))];
 const posting=readiness?.posting,closure=fiscal?.closures.find(c=>c.start===fiscal.period?.start&&c.status==='CLOSED');
 const approval=posting?.approvalStatus==='APPROVED'?t('معتمد','Approved'):posting?.approvalStatus==='DRAFT'?t('مسودة','Draft'):t('غير معتمد','Not approved');
 return <section className="settings-financial-overview" data-financial-overview-ready={!loading} aria-busy={loading}>
  <div className="settings-financial-overview-grid">
   <article className="settings-card"><h3><SettingsIcon name="calendar"/>{t('إعداد السنة المالية','Fiscal year configuration')}</h3><p>{t('تقويم المؤسسة المستخدم في الافتتاحي والفترات والقوائم.','The organization calendar used by opening balances, periods and statements.')}</p>
    {loading?<p role="status">{t('جارٍ قراءة التقويم…','Reading calendar…')}</p>:errors.includes('fiscal')?<p role="alert">{t('تعذر قراءة السنة المالية.','Fiscal year unavailable.')}</p>:<dl className="settings-overview-facts">
     <div><dt>{t('بداية السنة','Year start')}</dt><dd><bdi>{fiscal?.calendar?fiscal.period?.start:'—'}</bdi></dd></div>
     <div><dt>{t('نهاية السنة المحسوبة','Calculated year end')}</dt><dd><bdi>{fiscal?.calendar?fiscal.period?.end:'—'}</bdi></dd></div>
     <div><dt>{t('حساب الأرباح المحتجزة','Retained earnings account')}</dt><dd><bdi>{fiscal?.calendar?.retained_earnings_account??'—'}</bdi></dd></div>
     <div><dt>{t('حالة السنة','Year status')}</dt><dd>{!fiscal?.calendar?t('غير محددة','Not configured'):closure?t('مقفلة','Closed'):t('مفتوحة','Open')}</dd></div>
    </dl>}
    <button type="button" className="btn secondary" onClick={()=>onEdit('fiscal')}>{t('إدارة السنة المالية','Manage fiscal year')}</button>
   </article>
   <article className="settings-card"><h3><SettingsIcon name="chart"/>{t('معاينة دليل الحسابات','Chart of accounts preview')}</h3><p>{t('الحسابات النشطة القابلة للترحيل من دليل المؤسسة المحفوظ.','Active posting accounts from the saved organization chart.')}</p>
    {loading?<p role="status">{t('جارٍ قراءة الدليل…','Reading chart…')}</p>:errors.includes('chart')?<p role="alert">{t('تعذر قراءة دليل الحسابات.','Chart unavailable.')}</p>:<table className="settings-chart-preview"><thead><tr><th>{t('مجموعة الحسابات','Account group')}</th><th>{t('عدد الحسابات','Accounts')}</th></tr></thead><tbody>{visibleGroups.map(kind=><tr key={kind}><td>{groups[kind]?.[ar?0:1]??kind}</td><td><bdi>{counts.get(kind)??0}</bdi></td></tr>)}</tbody></table>}
    <button type="button" className="btn secondary" onClick={()=>onEdit('chart')}>{t('إدارة دليل الحسابات','Manage chart of accounts')}</button>
   </article>
   <article className="settings-card"><h3><SettingsIcon name="posting"/>{t('قواعد الترحيل','Posting rules')}</h3><p>{t('حالة الربط من فحص المصادر والاعتماد الفعلي.','Mapping status from source checks and actual approval.')}</p>
    <dl className="settings-overview-facts"><div><dt>{t('القواعد المحفوظة','Saved rules')}</dt><dd><bdi>{posting?.ruleCount??'—'}</bdi></dd></div>
     <div><dt>{t('السطور المربوطة / المصدر','Mapped / source lines')}</dt><dd><bdi>{posting?posting.mappedLines+' / '+posting.sourceLines:'—'}</bdi></dd></div>
     <div><dt>{t('السطور غير المربوطة','Unmapped lines')}</dt><dd><bdi>{posting?.missingLines??'—'}</bdi></dd></div>
     <div><dt>{t('الربط الملتبس','Ambiguous mappings')}</dt><dd><bdi>{posting?.ambiguousLines??'—'}</bdi></dd></div>
     <div><dt>{t('الاعتماد النهائي','Approval')}</dt><dd>{posting?approval:t('لم يتم التحقق','Not verified')}</dd></div></dl>
    <button type="button" className="btn secondary" onClick={()=>onEdit('posting')}>{t('إدارة قواعد الترحيل','Manage posting rules')}</button>
   </article>
  </div>
  <div className="settings-financial-overview-lower"><article className="settings-card"><h3><SettingsIcon name="bank"/>{t('النقد والبنوك والأرصدة الافتتاحية','Cash, banks & opening balances')}</h3><p>{t('إدارة الحسابات البنكية والصناديق من سجلها الأصلي، ومراجعة أرصدة بداية السنة في الافتتاحي.','Manage bank and cash accounts at their source; review start-of-year balances in the opening workspace.')}</p>{cash===null?<p role="status">{loading?t('جارٍ قراءة الحسابات…','Reading accounts…'):t('تعذر التحقق من الحسابات النقدية.','Cash accounts unavailable.')}</p>:<div className="settings-table-scroll"><table className="settings-data-table"><thead><tr><th>{t('الحساب','Account')}</th><th>{t('النوع','Type')}</th><th>{t('العملة','Currency')}</th></tr></thead><tbody>{cash.map(a=><tr key={a.id}><td>{a.name}</td><td>{a.type==='BANK'?t('بنك','Bank'):a.type==='CASH'?t('صندوق','Cash'):a.type==='WALLET'?t('محفظة','Wallet'):a.type}</td><td><bdi>{a.currency}</bdi></td></tr>)}{!cash.length&&<tr><td colSpan={3}>{t('لم تُضف حسابات نقدية بعد.','No cash accounts added yet.')}</td></tr>}</tbody></table></div>}<div className="settings-overview-actions"><button type="button" className="btn secondary" onClick={()=>onEdit('banking')}>{t('إدارة النقد والبنوك','Manage cash & banks')}</button><button type="button" className="btn secondary" onClick={()=>onEdit('opening')}>{t('مراجعة الأرصدة الافتتاحية','Review opening balances')}</button></div></article>
   <aside className="settings-financial-guidance"><h3><SettingsIcon name="info"/>{t('إرشاد مهم','Important guidance')}</h3><p>{t('قد تبدأ المؤسسة الجديدة دون أرصدة سابقة. تحدد رحلة الإعداد الحاجة إلى الافتتاحي وفق نوع البداية والمصادر المسجلة، ولا يُنسخ الرصيد البنكي الحالي إلى الافتتاحي تلقائيًا.','A new organization may start without prior balances. The setup journey checks opening requirements against the starting mode and recorded sources; current bank balances are never automatically copied into opening balances.')}</p></aside></div>
 </section>;
}
