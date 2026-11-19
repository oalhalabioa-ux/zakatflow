'use client';
import type {FeasibilityStudy} from '@/lib/feasibility/engine';
import {costingReportRows} from '@/lib/feasibility/costing-report';
import {downloadFeasibilityCsv} from '@/lib/feasibility/report-export';
export default function CostingReport({study,locale,allowExport}:{study:FeasibilityStudy;locale:string;allowExport:boolean}){
 const rows=costingReportRows(study),l=(a:string,e:string)=>locale==='ar'?a:e;
 if(!rows.length)return null;
 const fmt=(n:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(n);
 const headers=[l('الوصف','Description'),l('الفترة','Period'),l('الأساس','Basis'),l('الكمية الفعلية','Effective quantity'),l('الوحدة','Unit'),l('سعر الوحدة','Unit price'),l('الإجمالي','Total'),l('مرجع السعر','Price evidence')];
 const values=rows.map(x=>[x.name,x.period==='MONTH'?l('شهري','Monthly'):x.period==='CAPITAL'?l('استثمار','Capital'):l('تطوير قبل معامل السيناريو','Development before scenario multiplier'),
  ({MANUAL:l('يدوي','Manual'),LAND_AREA:l('الأرض','Site area'),BUILT_AREA:l('البناء','Built area'),CAPACITY:l('الطاقة','Capacity'),NET_AREA:l('الصافي','Net area'),SALE_AREA:l('البيعي','Saleable area'),ROAD_LENGTH:l('الطرق','Road length'),NETWORK_LENGTH:l('الشبكات','Network length'),SERVICE_AREA:l('الخدمات','Service area')})[x.basis],x.effectiveQuantity,x.unit,x.unitCost,x.total,x.source]);
 return <section className="card fs-panel"><h3>{l('أساس التكاليف ومراجع الكميات','Cost basis and quantity evidence')}</h3>
  <p className="fs-hint">{l('بنود التطوير قبل معامل تكلفة السيناريو. الاحتياطي والرسوم يضافان وفق إعدادات النموذج. العمالة والمرافق الشهرية لا تُجمع مع الاستثمار.','Development items precede the scenario cost multiplier. Contingency and fees follow model settings. Monthly labour/utilities are separate from capital.')}</p>
  <div className="fs-table-wrap"><table className="fs-table"><thead><tr>{headers.map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{values.map((row,i)=><tr key={rows[i].id}>{row.map((v,j)=><td key={j}>{typeof v==='number'?fmt(v):v}</td>)}</tr>)}</tbody></table></div>
  {allowExport&&<button type="button" className="fs-btn fs-btn--secondary" onClick={()=>downloadFeasibilityCsv('cost-quantity-evidence.csv',[[...headers,l('العملة','Currency')],...values.map(x=>[...x,study.currency])])}>{l('تصدير الكميات ومراجع الأسعار CSV','Export quantities and price evidence CSV')}</button>}
 </section>;
}
