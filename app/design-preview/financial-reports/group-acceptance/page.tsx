import {notFound} from 'next/navigation';
import {requireUser} from '@/services/auth';
import {groupAcceptanceScenario} from './scenario';
import '@/components/financial-reports/financial-reports-suite.css';
import '@/components/financial-reports/financial-reporting-source.css';

export const dynamic='force-dynamic';
export const metadata={title:'QA V2 | Financial consolidation',robots:{index:false,follow:false}};

export default async function Page({searchParams}:{searchParams:Promise<{lang?:string}>}){
 if(process.env.VERCEL_ENV!=='preview'&&(process.env.VERCEL_ENV||process.env.NODE_ENV!=='development'))notFound();
 try{await requireUser();}catch{notFound();}
 const en=(await searchParams).lang==='en';
 const t=(ar:string,english:string)=>en?english:ar;
 const r=groupAcceptanceScenario();
 const row=(rows:{key:string;before:string;after:string;adjustment:string}[],key:string)=>rows.find(item=>item.key===key)!;
 const sections=[
  {title:t('الإلغاءات البينية','Intercompany eliminations'),rows:[
   ['assets-before',t('الأصول قبل الاستبعادات بعد إدراج 100٪ من التابعة','Assets before eliminations after including 100% of the subsidiary'),row(r.position,'assets').before],
   ['receivables',t('استبعاد الذمم المدينة','Receivables eliminated'),row(r.position,'assets').adjustment],
   ['payables',t('استبعاد الذمم الدائنة','Payables eliminated'),row(r.position,'liabilities').adjustment],
   ['revenue',t('استبعاد الإيراد البيني','Intercompany revenue eliminated'),row(r.income,'revenue').adjustment],
   ['expense',t('استبعاد المصروف البيني','Intercompany expense eliminated'),row(r.income,'operatingExpenses').adjustment],
   ['internal-cash',t('استبعاد المقبوضات البينية','Internal receipts eliminated'),row(r.cash,'financing').adjustment],
   ['cash-closing',t('النقد الختامي بعد الاستبعاد','Closing cash after elimination'),row(r.cash,'closing').after],
  ]},
  {title:t('الملكية وحقوق غير المسيطرين','Ownership and non-controlling interests'),rows:[
   ['ownership',t('حصة الشركة الأم','Parent interest'),r.ownership+'%'],
   ['nci',t('حصة غير المسيطرين','Non-controlling interest'),r.nci.nciPercent+'%'],
   ['nci-profit',t('حصة غير المسيطرين من نتيجة الفترة','NCI share of profit or loss'),r.nci.profit.nci],
   ['nci-oci',t('حصة غير المسيطرين من فرق الترجمة','NCI share of translation difference'),r.nci.nciOtherComprehensiveIncome],
   ['nci-closing',t('حقوق غير المسيطرين الختامية','Closing non-controlling interests'),r.nci.closingNci],
  ]},
  {title:t('ترجمة USD إلى SAR','USD to SAR translation'),rows:[
   ['mixed-guard',t('الجمع دون ترجمة','Aggregation before translation'),r.mixedCurrencyBlocked?t('محظور','Blocked'):t('فشل الفحص','Check failed')],
   ['income-fx',t('نتيجة الفترة بسعر تاريخ الحركة','Period result at the transaction-date rate'),r.translated.netProfit],
   ['position-fx',t('صافي الأصول بسعر الإقفال','Net assets at the closing rate'),r.translated.position.closingEquity],
   ['translation-difference',t('فرق ترجمة صافي الأصول','Net asset translation difference'),r.translated.position.translationDifference],
   ['cash-rate-effect',t('أثر الصرف على النقد','Exchange-rate effect on cash'),r.translated.cash.exchangeRateEffect],
   ...r.translated.rates.map(({date,rate})=>['rate-'+date,t('سعر الصرف في ','Exchange rate on ')+date,rate]),
  ]},
 ];
 return <main className="fs-page" dir={en?'ltr':'rtl'} data-group-acceptance="synthetic">
  <h1>{t('قبول التجميع المالي على QA V2','QA V2 financial consolidation acceptance')}</h1>
  <p>{t('بيانات اصطناعية لاختبار ورقة المراجعة. أسعار الصرف والمستندات في هذه الصفحة مخصصة للاختبار.','Synthetic records for worksheet acceptance. Rates and documents on this page are test fixtures.')}</p>
  <p><a href="?lang=ar" lang="ar">العربية</a> · <a href="?lang=en" lang="en">English</a></p>
  {sections.map(section=><section className="fs-source-statements" key={section.title}>
   <h2>{section.title}</h2>
   <div className="fs-table-scroll"><table className="fs-table"><thead><tr><th scope="col">{t('البند','Item')}</th><th scope="col">{t('نتيجة الاختبار','Test result')}</th></tr></thead>
    <tbody>{section.rows.map(([key,label,value])=><tr key={key} data-group-check={key}><th scope="row">{label}</th><td><bdi>{value}</bdi></td></tr>)}</tbody>
   </table></div>
  </section>)}
 </main>;
}
