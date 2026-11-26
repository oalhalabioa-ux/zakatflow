import {notFound} from 'next/navigation';
import {requireUser} from '@/services/auth';
import {groupAcceptanceScenario} from './scenario';
import {verifiedGroupScenario} from './verified-scenario';
import {samaGroupRatePublication} from '@/lib/financial-group-reporting-rates';
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
 const {trade,translation,equity,cash,disposal}=verifiedGroupScenario();
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
  {title:t('إلغاءات بين دفاتر باليورو والريال','Eliminations between EUR and SAR books'),rows:[
   ['mixed-guard',t('الجمع دون ترجمة','Aggregation before translation'),r.mixedCurrencyBlocked?t('محظور','Blocked'):t('فشل الفحص','Check failed')],
   ['fx-opening',t('سعر افتتاح اليورو','Opening EUR rate')+' '+translation.rates[0].date,translation.rates[0].rate],
   ['fx-transaction',t('سعر تاريخ العملية','Transaction-date rate')+' '+trade.transactionDate,trade.rates[0].rate],
   ['fx-closing',t('سعر الإقفال','Closing rate')+' '+trade.closingDate,trade.rates[1].rate],
   ['fx-receivable',t('الذمم المدينة المستبعدة عند الإقفال','Receivable eliminated at closing'),trade.receivableEliminated],
   ['fx-payable',t('الذمم الدائنة المستبعدة عند الإقفال','Payable eliminated at closing'),trade.payableEliminated],
   ['fx-revenue',t('الإيراد البيني المستبعد','Internal revenue eliminated'),trade.revenueEliminated],
   ['fx-expense',t('المصروف البيني المستبعد','Internal expense eliminated'),trade.expenseEliminated],
   ['fx-link',t('ربط إعادة التقييم بالذمة والمستند وتاريخ القطع','Remeasurement linked to the obligation, document and cutoff'),trade.remeasurementBindings[0].cutoff],
   ['fx-profit',t('فرق الصرف المتبقي في نتيجة المجموعة','Exchange loss retained in group profit'),trade.profitAfterElimination],
   ['translation-difference',t('فرق ترجمة صافي أصول التابعة','Subsidiary net asset translation difference'),translation.position.translationDifference],
   ['cash-rate-effect',t('أثر الصرف على النقد','Exchange-rate effect on cash'),translation.cash.exchangeRateEffect],
  ]},
  {title:t('إلغاء التدفقات النقدية بين عملتين','Intercompany cash elimination across currencies'),rows:[
   ['fx-cash-amount',t('استبعاد كل طرف بالريال','Amount eliminated from each leg in SAR'),cash.eliminated],
   ['fx-cash-investing',t('الاستثمار بعد الإلغاء','Investing after elimination'),cash.rows[1].after],
   ['fx-cash-financing',t('التمويل بعد الإلغاء','Financing after elimination'),cash.rows[2].after],
   ['fx-cash-exchange',t('أثر الصرف بعد الإلغاء','Exchange effect after elimination'),cash.exchangeRateEffect],
   ['fx-cash-closing',t('النقد الختامي بعد الإلغاء','Closing cash after elimination'),cash.closing],
  ]},
  {title:t('تغيّر الملكية مع بقاء السيطرة','Ownership change with control retained'),rows:[
   ['parent-before',t('حصة الأم قبل التغيّر','Parent interest before the change'),equity.parentBefore+'%'],
   ['parent-after',t('حصة الأم بعد التغيّر','Parent interest after the change'),equity.parentAfter+'%'],
   ['change-date',t('تاريخ التغيّر','Effective date'),equity.effectiveDate],
   ['nci-before',t('حقوق الأقلية قبل العملية','NCI before the transaction'),equity.nciBefore],
   ['nci-after',t('حقوق الأقلية مباشرة بعد العملية','NCI immediately after the transaction'),equity.nciAfter],
   ['nci-profit-before',t('حصة الأقلية من الربح قبل التغيّر','NCI profit before the change'),equity.profitToNciBefore],
   ['nci-profit-after',t('حصة الأقلية من الربح بعد التغيّر','NCI profit after the change'),equity.profitToNciAfter],
   ['consideration',t('المقابل النقدي','Cash consideration'),equity.considerationCashChange],
   ['parent-equity',t('أثر العملية على حقوق ملاك الأم','Transaction effect on parent equity'),equity.parentEquityChange],
   ['profit-impact',t('أثر العملية على الأرباح','Transaction effect on profit'),equity.profitImpact],
   ['goodwill-impact',t('أثر العملية على الشهرة','Transaction effect on goodwill'),equity.goodwillImpact],
   ['nci-closing',t('حقوق الأقلية في نهاية الفترة','Closing non-controlling interests'),equity.closingNci],
  ]},
  {title:t('فقدان السيطرة','Loss of control'),rows:[
   ['disposal-date',t('تاريخ فقدان السيطرة','Loss of control date'),disposal.effectiveDate],
   ['disposal-nci',t('حقوق الأقلية المستبعدة','NCI derecognized'),disposal.nciDerecognized],
   ['disposal-closing-nci',t('حقوق الأقلية بعد الاستبعاد','NCI after derecognition'),disposal.closingNci],
   ['disposal-investment',t('القيمة العادلة للحصة المحتفظ بها','Fair value of the retained interest'),disposal.retainedInterest],
   ['disposal-cash',t('صافي المقبوضات من الاستبعاد','Net disposal cash proceeds'),disposal.netCashProceeds],
   ['disposal-profit',t('أثر فقدان السيطرة في ربح الأم','Loss of control effect on parent profit'),disposal.gainInParentProfit],
  ]},
 ];
 return <main className="fs-page" dir={en?'ltr':'rtl'} data-group-acceptance="synthetic">
  <h1>{t('قبول التجميع المالي على QA V2','QA V2 financial consolidation acceptance')}</h1>
  <p>{t('القيود والمستندات اصطناعية. أسعار نهاية الفترة من جدول ٢ب المنشور للبنك المركزي السعودي. المبالغ بالريال السعودي.','Journals and documents are synthetic. Period-end rates come from the published Saudi Central Bank table 2b. Amounts are in SAR.')}</p>
  <p data-group-rate-coverage>{t(
   'التغطية المعروضة: الدولار واليورو والجنيه الإسترليني مقابل الريال في نهايات الأشهر من ديسمبر 2025 إلى سبتمبر 2026. يُوقف الحساب عند غياب سعر التاريخ أو موافقة المؤسسة.',
   'Rates cover USD, EUR and GBP against SAR at month-end from December 2025 to September 2026. Missing rates or company approval block calculation.',
  )}</p>
  <p><a href={samaGroupRatePublication.sourceUrl}>{t('نشرة سبتمبر 2026، جدول ٢ب','September 2026 bulletin, table 2b')}</a></p>
  <p><a href="?lang=ar" lang="ar">العربية</a> · <a href="?lang=en" lang="en">English</a></p>
  {sections.map(section=><section className="fs-source-statements" key={section.title}>
   <h2>{section.title}</h2>
   <div className="fs-table-scroll"><table className="fs-table"><thead><tr><th scope="col">{t('البند','Item')}</th><th scope="col">{t('نتيجة الاختبار','Test result')}</th></tr></thead>
    <tbody>{section.rows.map(([key,label,value])=><tr key={key} data-group-check={key}><th scope="row">{label}</th><td><bdi>{value}</bdi></td></tr>)}</tbody>
   </table></div>
  </section>)}
 </main>;
}
