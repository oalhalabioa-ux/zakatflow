'use client';
import type {ReactNode} from 'react';
import {evaluateRawLand,rawLandCostKeys,type RawLand} from '@/lib/feasibility/raw-land';
import {downloadFeasibilityCsv} from '@/lib/feasibility/report-export';
import {RoyalIcon} from './RoyalIcon';

type Label=readonly [string,string];
type Numeric<T>={[K in keyof T]-?:T[K] extends number?K:never}[keyof T];
type Field<T>=readonly [Numeric<T>,Label,('pct'|'whole')?,number?,number?];
type LandTab='overview'|'sector'|'operations'|'investment'|'advanced'|'scenarios'|'partners'|'cashflow'|'report';

const costLabels:Record<(typeof rawLandCostKeys)[number],Label>={
 development:['التطوير','Development'],studies:['الدراسات','Studies'],developerFee:['أتعاب المطور','Developer fee'],
 marketing:['التسويق','Marketing'],fundSetup:['هيكلة الصندوق','Fund setup'],fundMgmt:['إدارة الصندوق','Fund management'],
 interestBudget:['الفائدة','Interest'],arrangement:['عمولة الترتيب','Arrangement fee'],
 contingency:['الاحتياطي','Contingency'],otherCosts:['مصاريف ورسوم أخرى','Other costs and fees']
};
const phaseLabels={sales:['المبيعات','Sales'] as const,...costLabels};

export default function RawLandPanel({model,locale,currency,tab,onChange,allowExport=true}:{
 model:RawLand;locale:string;currency:string;tab:LandTab;onChange?:(value:RawLand)=>void;allowExport?:boolean
}){
 const ar=locale==='ar';
 const l=([a,b]:Label)=>ar?a:b;
 const fmt=(value:number|null)=>value===null?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
 const money=(value:number|null)=>value===null?'—':[fmt(value),currency].filter(Boolean).join(' ');
 const patch=<K extends keyof RawLand>(section:K,value:Partial<RawLand[K]>)=>onChange?.({...model,[section]:{...model[section],...value}});
 const numeric=(label:Label,value:number,change:(n:number)=>void,min=0,max=1e12,step:'any'|1='any')=>
  <label className="fs-field" key={label[1]}><span>{l(label)}</span><input type="number" inputMode="decimal"
   value={Number(value.toFixed(8))} min={min} max={max} step={step} onChange={e=>{
    const n=e.currentTarget.valueAsNumber;
    const clamped=Math.min(max,Math.max(min,Number.isFinite(n)?n:0));
    change(step===1?Math.trunc(clamped):clamped);
   }}/></label>;
 const numberFields=<T extends object>(value:T,fields:readonly Field<T>[],change:(next:Partial<T>)=>void)=>
  fields.map(([key,label,unit,min,max])=>{
   const scale=unit==='pct'?100:1;
   return numeric(label,Number(value[key])*scale,n=>change({[key]:n/scale} as Partial<T>),
    min??0,max??(unit==='pct'?100:1e12),unit==='whole'?1:'any');
  });
 const textField=(label:Label,value:string,change:(s:string)=>void,date=false)=>
  <label className="fs-field"><span>{l(label)}</span><input type={date?'date':'text'} value={value} maxLength={300}
   onChange={e=>{if(!date||e.currentTarget.value.length<=10)change(e.currentTarget.value)}}/></label>;
 const choice=<T extends string>(label:Label,value:T,values:readonly (readonly [T,Label])[],change:(v:T)=>void)=>
  <label className="fs-field"><span>{l(label)}</span><select value={value} onChange={e=>{
   const selected=values.find(([key])=>key===e.currentTarget.value);
   if(selected)change(selected[0]);
  }}>{values.map(([key,name])=><option key={key} value={key}>{l(name)}</option>)}</select></label>;
 const panel=(label:Label,children:ReactNode)=><section className="card fs-panel fs-block">
  <h3 className="fs-royal-report-title"><RoyalIcon name="building"/>{l(label)}</h3>{children}
 </section>;
 const table=(headers:readonly Label[],rows:readonly (readonly ReactNode[])[])=><div className="fs-table-wrap"><table className="fs-table">
  <thead><tr>{headers.map(header=><th scope="col" key={header[1]}>{l(header)}</th>)}</tr></thead>
  <tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}><bdi>{cell}</bdi></td>)}</tr>)}</tbody>
 </table></div>;
 const {project,site,cost,finance,waterfall,sales,phasing}=model;
 const results=sales.scenarios.map((_,i)=>evaluateRawLand(model,i));
 const base=results[2]??results[0];
 const warnings={
  area:['الاستبعادات تتجاوز المساحة المدخلة بعد التسويات.','Exclusions exceed the area after prior transfers.'],
  mix:['يجب أن يساوي مجموع نسب الاستخدامات النشطة 100%.','Enabled land uses must add to 100%.'],
  phasing:['يجب أن يساوي توزيع كل بند على مراحله 100%.','Each stage allocation must add to 100%.'],
  growth:['مجموع النمو السنوي وتعديل الاستخدام يجب ألا يقل عن ‎−100%.','Combined annual growth and use adjustment must be at least −100%.']
 } as const;
 const warning=base.issue?<p className="fs-warning" role="status">{l(warnings[base.issue])}</p>:null;

 if(tab==='sector')return panel(['الأرض والمساحات','Land and areas'],<>
  <div className="fs-form-grid">
   {numberFields(project,[
    ['startYear',['سنة البداية','Start year'],'whole',1900,2200],['years',['مدة التطوير بالسنوات','Development duration in years'],'whole',1,15],
    ['discountRate',['معدل الخصم %','Discount rate %'],'pct']
   ],x=>patch('project',x))}
   {numberFields(site,[
    ['areaAfterPriorTransfers',['المساحة بعد التسويات السابقة م²','Area after prior transfers m²']],
    ['excludedValley',['المساحة المستبعدة للسيول م²','Flood exclusion m²']],['extraExcluded',['استبعادات إضافية م²','Additional exclusions m²']],
    ['otherConstraintsSqm',['ارتفاقات غير محسوبة في الاستبعادات السابقة م²','Easements not included in other exclusions m²']],
    ['serviceRatio',['نسبة الخدمات %','Services %'],'pct'],['landPricePerNetSqm',['قيمة متر الأرض الصافي','Value per net land m²']]
   ],x=>patch('site',x))}
   {choice(['طريقة تقديم الأرض','Land contribution method'],site.landPaymentMethod,[
    ['in_kind',['حصة عينية','In kind']],['cash',['شراء نقدي','Cash purchase']]
   ],v=>patch('site',{landPaymentMethod:v}))}
   {textField(['تاريخ التقييم','Valuation date'],site.valuationDate,v=>patch('site',{valuationDate:v}),true)}
   {textField(['المقيّم','Appraiser'],site.appraiser,v=>patch('site',{appraiser:v}))}
   <label className="fs-field"><span>{l(['بيان التسويات السابقة','Prior transfers and reconciliations'])}</span><textarea maxLength={5000}
    value={site.priorTransferDescription} onChange={e=>patch('site',{priorTransferDescription:e.currentTarget.value})}/></label>
  </div>
  <p className="fs-hint">{l(['أدخل المساحة بعد خصم التسويات المسجلة لتجنب خصمها مرة أخرى.','Enter the area after recorded transfers to avoid deducting them twice.'])}</p>
  {table([['صافي الأرض م²','Net land m²'],['القابلة للبيع م²','Saleable land m²']],[[fmt(base.net),fmt(base.saleArea)]])}{warning}
 </>);
 if(tab==='operations')return panel(['الاستخدامات والأسعار','Land uses and prices'],<>
  <div className="fs-form-grid">{choice(['أساس التسعير','Pricing mode'],sales.priceMode,[
   ['compound',['نمو سنوي مركب','Compound annual growth']],['reference',['معامل السيناريو المرجعي','Reference scenario multiplier']]
  ],v=>patch('sales',{priceMode:v}))}</div>
  {sales.mix.map((use,i)=>{
   const update=(next:Partial<typeof use>)=>patch('sales',{mix:sales.mix.map((row,j)=>j===i?{...row,...next}:row)});
   return <section className="card fs-panel" key={i}><div className="fs-form-grid">
    {textField(['اسم الاستخدام','Use name'],use.name,v=>update({name:v}))}
    {numberFields(use,[['share',['حصة الاستخدام %','Use share %'],'pct'],['price',['سعر البيع للمتر','Sale price per m²']],
     ['annualGrowthAdjustment',['تعديل النمو السنوي %','Annual growth adjustment %'],'pct',-100,1000]],update)}
    <label className="fs-field"><span>{l(['استخدام نشط','Enabled use'])}</span><input type="checkbox" checked={use.enabled}
     onChange={e=>update({enabled:e.currentTarget.checked})}/></label>
   </div><button className="fs-btn fs-btn--secondary" type="button" onClick={()=>patch('sales',{mix:sales.mix.filter((_,j)=>j!==i)})}>{l(['حذف الاستخدام','Remove use'])}</button></section>;
  })}
  <button className="fs-btn fs-btn--secondary" type="button" disabled={sales.mix.length>=20} onClick={()=>patch('sales',{mix:[...sales.mix,{name:'',share:0,price:0,enabled:true,annualGrowthAdjustment:0}]})}>{l(['إضافة استخدام','Add land use'])}</button>
  {warning}
 </>);
 if(tab==='investment')return panel(['تكاليف التطوير والصندوق','Development and fund costs'],<>
 <div className="fs-form-grid">
  {numberFields(cost,[
   ['developmentPerNetSqm',['تكلفة التطوير للمتر الصافي','Development cost per net m²']],
   ['studies',['الدراسات','Studies']],['developerFeeRate',['أتعاب المطور %','Developer fee %'],'pct'],
   ['marketingRate',['التسويق %','Marketing %'],'pct'],['marketingReferenceRevenue',['إيراد التسويق المرجعي','Marketing reference revenue']],
   ['fundSetupRate',['هيكلة الصندوق من قيمة الأرض %','Fund setup on land value %'],'pct'],['fundMgmtBase',['أساس إدارة الصندوق','Fund management base']],
   ['fundMgmtRatePerYear',['الإدارة السنوية %','Annual management fee %'],'pct'],['fundMgmtYears',['مدة رسوم الإدارة بالسنوات','Fund management fee years'],'whole',0,15],
   ['contingencyRate',['الاحتياطي %','Contingency %'],'pct'],['otherCosts',['تكاليف أخرى','Other costs']],
   ['taxes',['ضرائب تقديرية','Indicative taxes']],['landAcquisitionFees',['رسوم الاستحواذ على الأرض','Land acquisition fees']]
  ],x=>patch('cost',x))}
  {choice(['أساس أتعاب المطور','Developer fee base'],cost.developerFeeBase,[
   ['development',['التطوير','Development']],['dev_plus_studies',['التطوير والدراسات','Development and studies']]
  ],v=>patch('cost',{developerFeeBase:v}))}
  {choice(['أساس التسويق','Marketing basis'],cost.marketingMode,[
   ['scenario',['مبيعات السيناريو','Scenario sales']],['reference',['إيراد مرجعي','Reference revenue']]
  ],v=>patch('cost',{marketingMode:v}))}
 </div>
 <fieldset className="fs-panel">
  <legend>{l(['جدول كميات التطوير','Development bill of quantities'])}</legend>
  <p className="fs-hint">{l(['عند إضافة بنود، تُحسب تكلفة التطوير من الكميات وأسعار الوحدات بدل تكلفة المتر الإجمالية.',
   'When line items are entered, development cost uses quantities and unit prices instead of the overall rate per m².'])}</p>
  {(cost.developmentItems??[]).map((item,index)=>{
   const change=(next:Partial<typeof item>)=>patch('cost',{developmentItems:cost.developmentItems?.map((row,i)=>i===index?{...row,...next}:row)});
   return <section className="card fs-panel" key={index}>
    <div className="fs-form-grid">
     {textField(['بند التطوير','Development item'],item.name,name=>change({name}))}
     {numberFields(item,[['quantity',['الكمية','Quantity']],['unitCost',['تكلفة الوحدة','Unit cost']]],change)}
     <p>{l(['إجمالي البند','Line total'])} · <bdi>{money(item.quantity*item.unitCost)}</bdi></p>
    </div>
    <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>patch('cost',{
     developmentItems:cost.developmentItems?.filter((_,i)=>i!==index)
    })}>{l(['حذف البند','Remove item'])}</button>
   </section>;
  })}
  <button type="button" className="fs-btn fs-btn--secondary" disabled={(cost.developmentItems?.length??0)>=100}
   onClick={()=>patch('cost',{developmentItems:[...(cost.developmentItems??[]),{name:'',quantity:0,unitCost:0}]})}>
   {l(['إضافة بند تطوير','Add development item'])}
  </button>
 </fieldset>
 </>);
 if(tab==='advanced')return <>
  {panel(['التمويل وجدول الدين','Financing and debt'],<div className="fs-form-grid">
   {numberFields(finance,[
    ['facility',['التسهيل التمويلي','Financing facility']],['benchmarkRate',['معدل المؤشر %','Benchmark rate %'],'pct'],
    ['spreadRate',['هامش التمويل %','Financing spread %'],'pct'],['interestBudgetRate',['موازنة الفائدة %','Budgeted interest %'],'pct'],
    ['arrangementRate',['ترتيب التمويل %','Arrangement fee %'],'pct'],['loanDrawFirstYear',['سحب التمويل في السنة الأولى %','Financing drawn in year one %'],'pct']
   ],x=>patch('finance',x))}
   {choice(['أساس الفائدة','Interest mode'],finance.interestMode,[
    ['reference',['موازنة مرجعية','Reference budget']],['dynamic',['متوسط الرصيد القائم','Average outstanding balance']]
   ],v=>patch('finance',{interestMode:v}))}
  </div>)}
  {panel(['توزيع التنفيذ على أرباع مدة المشروع','Allocation over quarters of the development duration'],<>
   {warning}
   {Object.entries(phasing).map(([key,phase])=><fieldset key={key} className="fs-panel">
    <legend>{l(phaseLabels[key as keyof typeof phasing])}</legend><div className="fs-form-grid">{phase.map((weight,i)=>numeric(
     ['المرحلة '+(i+1)+' %','Stage '+(i+1)+' %'],weight*100,value=>{
      const next=[...phase] as typeof phase;next[i]=value/100;patch('phasing',{[key]:next});
     },0,100))}</div></fieldset>)}
  </>)}
 </>;
 if(tab==='scenarios')return panel(['سيناريوهات تطوير الأرض','Land development scenarios'],<>
  {sales.scenarios.map((scenario,i)=>{
   const update=(next:Partial<typeof scenario>)=>patch('sales',{scenarios:sales.scenarios.map((row,j)=>j===i?{...row,...next}:row)});
   return <section className="card fs-panel" key={i}><div className="fs-form-grid">
    {textField(['اسم السيناريو','Scenario name'],scenario.name,v=>update({name:v}))}
    {numberFields(scenario,[
     ['priceMultiplier',['معامل السعر المرجعي','Reference price multiplier'],undefined,0,10],
     ['annualGrowth',['النمو السنوي %','Annual growth %'],'pct',-100,1000],
     ['initialPricePremium',['تعديل السعر الافتتاحي %','Initial price adjustment %'],'pct',-100,1000],
     ['costMultiplier',['معامل تكلفة التطوير','Development cost multiplier'],undefined,0,10],
     ['salesDelayYears',['تأخير البيع بالسنوات','Sales delay in years'],'whole',0,3]
    ],update)}
   </div>{sales.scenarios.length>1&&<button className="fs-btn fs-btn--secondary" type="button" onClick={()=>patch('sales',{scenarios:sales.scenarios.filter((_,j)=>j!==i)})}>{l(['حذف السيناريو','Remove scenario'])}</button>}</section>;
  })}
  <button className="fs-btn fs-btn--secondary" type="button" disabled={sales.scenarios.length>=12} onClick={()=>patch('sales',{
   scenarios:[...sales.scenarios,{name:'',priceMultiplier:1,costMultiplier:1,annualGrowth:0,initialPricePremium:0,salesDelayYears:0}]
  })}>{l(['إضافة سيناريو','Add scenario'])}</button>
 </>);
 if(tab==='partners')return panel(['حوافز الشراكة','Partnership incentives'],<>
  <div className="fs-form-grid">
   {numberFields(waterfall,[
    ['incentiveRate',['معدل الحافز %','Performance incentive %'],'pct'],
    ['hurdleRate',['عتبة الربح %','Profit hurdle %'],'pct'],
    ['developerIncentiveShare',['حصة المطور من الحافز %','Developer share of incentive %'],'pct']
   ],x=>patch('waterfall',x))}
   {choice(['أساس العتبة','Hurdle basis'],waterfall.hurdleBase,[
    ['revenue',['الإيرادات','Revenue']],['cost',['التكلفة الاقتصادية','Economic cost']]
   ],v=>patch('waterfall',{hurdleBase:v}))}
  </div>{!base.issue&&table([['قيمة الأرض','Land value'],['حافز المطور','Developer incentive'],['حافز المدير','Manager incentive']],
   [[money(base.land),money(base.developerIncentive),money(base.managerIncentive)]])}
 </>);
 const headings:readonly Label[]=[
  ['السنة','Year'],['المساحة المباعة م²','Sold area m²'],['المبيعات','Sales'],['تكلفة نقدية','Cash cost'],['الحافز','Incentive'],
  ['سحب الدين','Debt draw'],['السداد','Debt repayment'],['رصيد الدين','Closing debt'],['التدفق الاقتصادي','Economic cash flow'],
  ['التدفق بعد الدين','Equity cash flow'],['التدفق الاقتصادي التراكمي','Cumulative economic cash flow']
 ];
 return <div className="fs-block">
  {panel(['مقارنة سيناريوهات تطوير الأراضي','Land development scenario comparison'],<>
   {warning}
   {table([['السيناريو','Scenario'],['المبيعات','Sales'],['التكلفة','Cost'],['صافي الربح','Net profit'],
    ['صافي القيمة الحالية','NPV'],['معدل العائد الداخلي %','IRR %'],['عائد التكلفة %','Return on cost %'],['تعادل سعر المتر','Break-even price per m²'],['ذروة عجز التمويل','Peak funding deficit']],
    results.map((result,i)=>[sales.scenarios[i].name||String(i+1),...(result.issue||!result.ready?Array(8).fill('—'):
     [money(result.revenue),money(result.totalCost),money(result.profit),money(result.npv),fmt(result.irr),fmt(result.roiCost===null?null:result.roiCost*100),
      money(result.breakEven),money(result.peakEquityDeficit)])]))}
  </>)}
  {tab!=='overview'&&results.map((result,i)=>{
   if(result.issue||!result.ready)return null;
   const annual=result.annual.map(y=>[y.year,y.soldArea,y.salesValue,y.cashCost,y.performanceFee,y.draw,y.repayment,y.closingDebt,y.projectCash,y.equityCash,y.cumulativeProject]);
   return <div key={i}>{panel(['التدفقات النقدية · '+(sales.scenarios[i].name||String(i+1)),'Cash flows · '+(sales.scenarios[i].name||String(i+1))],<>
    {table(headings,annual.map(row=>row.map((n,j)=>j<2?fmt(n):money(n))))}
    {allowExport&&<div className="fs-actions"><button className="fs-btn fs-btn--secondary" type="button"
     onClick={()=>downloadFeasibilityCsv('land-development-'+(i+1)+'.csv',[
      [...headings.map(l),l(['العملة','Currency'])],...annual.map(row=>[...row,currency])
     ])}>{l(['تصدير التدفقات CSV','Export cash flows CSV'])}</button></div>}
   </>)}</div>;
  })}
 </div>;
}
