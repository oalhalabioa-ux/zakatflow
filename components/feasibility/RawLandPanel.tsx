'use client';
import {useState,type ReactNode} from 'react';
import {evaluateRawLand,rawLandCostKeys,type RawLand} from '@/lib/feasibility/raw-land';
import {calculateLandDistribution} from '@/lib/feasibility/raw-land-distributions';
import {downloadFeasibilityCsv,downloadFeasibilityXlsx} from '@/lib/feasibility/report-export';
import {RoyalIcon} from './RoyalIcon';
import QuantityBudgetEditor from './QuantityBudgetEditor';
import {quantityPresets} from '@/lib/feasibility/quantity-presets';

type Label=readonly [string,string];
type Numeric<T>={[K in keyof T]-?:T[K] extends number?K:never}[keyof T];
type Field<T>=readonly [Numeric<T>,Label,('pct'|'whole')?,number?,number?];
type LandTab='overview'|'sector'|'operations'|'investment'|'advanced'|'scenarios'|'partners'|'cashflow'|'report'|'distribution-report';

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
 const [xlsxState,setXlsxState]=useState<'idle'|'working'|'error'>('idle');
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
 const {project,site,cost,finance,waterfall,sales,phasing,legacyReference,distribution}=model;
 const quantities=model.quantityDevelopment??{budget:{enabled:false,items:[]},roadLength:0,networkLength:0,serviceArea:0,serviceAreaFromSite:true};
 const patchQuantities=(next:Partial<typeof quantities>)=>onChange?.({...model,quantityDevelopment:{...quantities,...next}});
 const results=sales.scenarios.map((_,i)=>evaluateRawLand(model,i));
 const base=results[2]??results[0];
 const warnings={
  area:['الاستبعادات تتجاوز المساحة المدخلة بعد التسويات.','Exclusions exceed the area after prior transfers.'],
  mix:['يجب أن يساوي مجموع نسب الاستخدامات النشطة 100%.','Enabled land uses must add to 100%.'],
  phasing:['يجب أن يساوي مجموع نسب كل توزيع للمبيعات أو التحصيل أو التكلفة 100%.','Each sales, collection or cost allocation must add to 100%.'],
  growth:['مجموع النمو السنوي وتعديل الاستخدام يجب ألا يقل عن ‎−100%.','Combined annual growth and use adjustment must be at least −100%.']
 } as const;
 const warning=base.issue?<p className="fs-warning" role="status">{l(warnings[base.issue])}</p>:null;

 const landTerms=<>
  {choice(['طريقة الحصول على الأرض','How the land is secured'],site.landPaymentMethod,[
   ['lease',['إيجار','Lease']],['in_kind',['تقديم عيني من أحد الشركاء','In-kind contribution by a partner']],['cash',['شراء الأرض','Land purchase']]
  ],v=>patch('site',{landPaymentMethod:v}))}
  {site.landPaymentMethod==='lease'&&numeric(['الإيجار السنوي طوال مدة التوقع','Annual rent throughout the forecast'],site.annualLandRent??0,v=>patch('site',{annualLandRent:v}))}
  {site.landPaymentMethod==='lease'&&<p className="fs-hint">{l(['أدرج فقط الإيرادات التي يتيحها عقد الإيجار.','Include only revenue permitted by the lease.'])}</p>}
 </>;

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
    ['serviceRatio',['نسبة الخدمات %','Services %'],'pct'],['landPricePerNetSqm',['سعر متر استحواذ الأرض','Land acquisition price per m²']]
   ],x=>patch('site',x))}
   {choice(['مساحة احتساب قيمة الاستحواذ','Land acquisition area basis'],site.acquisitionBasis??'NET',[
    ['NET',['صافي الأرض بعد الاستبعادات','Net area after exclusions']],['GROSS',['كامل المساحة المدخلة','Gross entered area']],['MANUAL',['مساحة تعاقدية محددة','Specified contractual area']]
   ],v=>patch('site',{acquisitionBasis:v}))}
   {site.acquisitionBasis==='MANUAL'&&numeric(['مساحة الاستحواذ التعاقدية م²','Contractual acquisition area m²'],site.acquisitionArea??0,v=>patch('site',{acquisitionArea:v}))}
   {landTerms}
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
   </div>
   <fieldset className="fs-panel">
    <legend>{l(['مراحل البيع والتحصيل','Sales and collection schedule'])}</legend>
    <label className="fs-check"><input type="checkbox" checked={!!use.salesPhasing}
     onChange={event=>update({salesPhasing:event.currentTarget.checked?[...phasing.sales]:undefined})}/>
     {l(['توزيع مراحل بيع مستقل لهذا الاستخدام','Use a separate sales schedule'])}</label>
    {use.salesPhasing&&<div className="fs-form-grid">{use.salesPhasing.map((weight,index)=>numeric(
     ['مرحلة بيع '+(index+1)+' %','Sales stage '+(index+1)+' %'],weight*100,value=>{
      if(!use.salesPhasing)return;
      const next=[...use.salesPhasing] as typeof use.salesPhasing;
      next[index]=value/100;update({salesPhasing:next});
     },0,100))}</div>}
    <label className="fs-check"><input type="checkbox" checked={!!use.collectionPhasing}
     onChange={event=>update({collectionPhasing:event.currentTarget.checked?[1,0,0,0]:undefined})}/>
     {l(['توزيع التحصيل على دفعات سنوية','Schedule annual instalments'])}</label>
    {use.collectionPhasing&&<div className="fs-form-grid">{use.collectionPhasing.map((weight,index)=>numeric(
     index===0?['سنة البيع %','Year of sale %']:['بعد البيع بـ '+index+' سنة %','Years after sale · '+index+' %'],
     weight*100,value=>{
      if(!use.collectionPhasing)return;
      const next=[...use.collectionPhasing] as typeof use.collectionPhasing;
      next[index]=value/100;update({collectionPhasing:next});
     },0,100))}</div>}
   </fieldset>
   <button className="fs-btn fs-btn--secondary" type="button" onClick={()=>patch('sales',{mix:sales.mix.filter((_,j)=>j!==i)})}>{l(['حذف الاستخدام','Remove use'])}</button></section>;
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
 <fieldset className="fs-panel" disabled={quantities.budget.enabled}>
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
 <section className="card fs-panel"><h3>{l(['أسس كميات البنية التحتية','Infrastructure quantity drivers'])}</h3><div className="fs-form-grid">
  {numeric(['طول الطرق م','Road length m'],quantities.roadLength,v=>patchQuantities({roadLength:v}))}
  {numeric(['طول مسار الشبكات م','Network route length m'],quantities.networkLength,v=>patchQuantities({networkLength:v}))}
  <label className="fs-check"><input type="checkbox" checked={quantities.serviceAreaFromSite??false} onChange={e=>patchQuantities({serviceAreaFromSite:e.target.checked})}/>{l(['ربط مساحة الخدمات بنسبة الخدمات','Link service area to site services ratio'])}</label>
  {quantities.serviceAreaFromSite?<p>{l(['مساحة الخدمات م²','Service area m²'])}: {fmt(base.net*site.serviceRatio)}</p>:numeric(['مساحة أعمال الخدمات م²','Services works area m²'],quantities.serviceArea,v=>patchQuantities({serviceArea:v}))}
 </div><p className="fs-hint">{l(['للتسوية بالمتر المكعب، استخدم صافي المساحة × عمق التسوية في معامل الكمية. للطرق بالمتر المربع، استخدم طول الطريق × عرضه. أضف بندًا مستقلًا لكل شبكة ومرفق مع مواصفاته ومرجع سعره. يمكن اختيار مراحل مستقلة لكل بند؛ وإلا يتبع توزيع التطوير في النموذج المالي المتقدم.','For earthworks in m³ use net area × excavation depth as the quantity multiplier. For roads in m² use road length × width. Add a separate item for each network and facility with specifications and price evidence. Choose separate phasing per item, or inherit Development phasing under Advanced finance.'])}</p>
 <label className="fs-field"><span>{l(['توثيق افتراضات التطوير والبيع والتمويل','Development, sales and funding assumption evidence'])}</span><textarea maxLength={3000} value={quantities.assumptionSource??''} onChange={e=>patchQuantities({assumptionSource:e.target.value})}/></label></section>
 <QuantityBudgetEditor allowPhasing presets={quantityPresets('land')} locale={locale} title={l(['كميات التطوير المرتبطة بالمساحات','Area-linked development quantities'])} value={quantities.budget} onChange={budget=>patchQuantities({budget})}
  context={{LAND_AREA:site.areaAfterPriorTransfers,NET_AREA:base.net,SALE_AREA:base.saleArea,ROAD_LENGTH:quantities.roadLength,NETWORK_LENGTH:quantities.networkLength,SERVICE_AREA:quantities.serviceAreaFromSite?base.net*site.serviceRatio:quantities.serviceArea}}
  categories={ [['earthworks','تسوية وأعمال ترابية','Earthworks'],['roads','طرق وأرصفة','Roads and paving'],['water','شبكة المياه','Water network'],['sewer','صرف وتصريف','Sewer and drainage'],['electric','كهرباء واتصالات','Power and communications'],['services','مرافق وخدمات','Facilities and services'],['other','أخرى','Other']]}
  bases={ [['MANUAL','كمية مستقلة','Independent quantity'],['LAND_AREA','كامل المساحة','Gross area'],['NET_AREA','صافي المساحة','Net area'],['SALE_AREA','المساحة البيعية','Saleable area'],['ROAD_LENGTH','طول الطرق','Road length'],['NETWORK_LENGTH','طول الشبكات','Network length'],['SERVICE_AREA','مساحة الخدمات','Service area']]}/>
 </>);
 if(tab==='advanced')return <>
  {panel(['التمويل وجدول الدين','Financing and debt'],<div className="fs-form-grid">
   {numeric(['رأس المال النقدي الملتزم لتغطية العجز','Committed cash equity to cover the deficit'],quantities.committedEquity??0,v=>patchQuantities({committedEquity:v}))}
   {choice(['توقيت استثمار الأرض','Land investment timing'],quantities.landTiming??'YEAR1',[
    ['YEAR1',['ضمن السنة الأولى — المنهج السابق','Within year one — legacy method']],['YEAR0',['عند البداية — سنة صفر','At inception — year zero']]
   ],v=>patchQuantities({landTiming:v}))}
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
 const settlement=distribution&&!base.issue&&base.ready
  ?calculateLandDistribution(distribution,site.landPaymentMethod==='in_kind'?base.land:0,base.annual)
  :null;
 const settlementView=()=>{
  if(!distribution?.partners.length)return null;
  if(!settlement)return <p className="fs-hint">{l(['استكمل مدخلات السيناريو الأساسي لحساب التوزيع.','Complete the base scenario to calculate the distribution.'])}</p>;
  if(settlement.issue){
   const issues={
    PARTNERS:['أدخل اسم كل شريك.','Enter each partner’s name.'],
    SHARES:['يجب أن يساوي مجموع نسب الأرباح 100%.','Profit shares must total 100%.'],
    LAND:['طابق مجموع المساهمات العينية مع قيمة الأرض المقدمة كحصة، وأدخل صفرًا للأرض المشتراة نقدًا.',
     'Match in-kind contributions to contributed land value. Enter zero for land purchased in cash.'],
    FUNDING:['توجد فجوة تمويل قبل التسوية.','A funding gap occurs before settlement.']
   } as const;
   return <p className="fs-warning" role="status">{l(issues[settlement.issue])}{settlement.issue==='FUNDING'&&' '+money(settlement.fundingGap)}</p>;
  }
  return <>
   {table([
    ['سنة التسوية','Settlement year'],['الدين المحجوز للسداد','Debt reserved'],['المتاح للتوزيع','Distributable cash']
   ],[[String(settlement.year),money(settlement.debtReserve),money(settlement.distributable)]])}
   {settlement.debtShortfall>=.005&&<p className="fs-warning" role="status">
    {l(['عجز تغطية الدين عند التسوية','Debt shortfall at settlement'])} · {money(settlement.debtShortfall)}
   </p>}
   {table([
    ['الشريك','Partner'],['رأس المال','Capital'],['رأس المال المسترد','Capital returned'],
    ['رأس المال غير المسترد','Unrecovered capital'],['الأرباح الموزعة','Distributed profit'],['إجمالي التوزيع','Total distribution']
   ],settlement.partners.map(partner=>[partner.name,money(partner.capital),money(partner.capitalReturned),
    money(partner.unrecoveredCapital),money(partner.profit),money(partner.distribution)]))}
  </>;
 };
 if(tab==='distribution-report')return distribution?.partners.length
  ?panel(['توزيع عوائد الشركاء · السيناريو الأساسي','Partner distributions · base scenario'],settlementView())
  :null;
 if(tab==='partners')return <>
 {panel(['حوافز الشراكة','Partnership incentives'],<>
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
 </>)}
 {panel(['معالجة الأرض','Land arrangement'],<div className="fs-form-grid">{landTerms}</div>)}
 {panel(['رد رأس المال وتوزيع العوائد المتوقعة','Projected capital return and profit distribution'],<>
  <p className="fs-hint">{l(['يفترض النموذج ضخ المساهمات النقدية في بداية المشروع والتسوية في آخر سنة من السيناريو الأساسي. يُحجز رصيد الدين، ثم يُرد رأس المال بدءًا بالأولوية 1 ويُوزّع الفائض حسب نسب الأرباح.',
   'The model assumes cash contributions at inception and settlement in the last year of the base scenario. Closing debt is reserved, capital is returned starting at priority 1, and surplus follows profit shares.'])}</p>
  {distribution?.partners.map((partner,index)=>{
   const update=(fields:Partial<typeof partner>)=>patch('distribution',{
    partners:distribution.partners.map((item,i)=>i===index?{...item,...fields}:item)
   });
   return <fieldset className="fs-panel" key={index}>
    <legend>{l(['الشريك','Partner'])} {index+1}</legend>
    <div className="fs-form-grid">
     {textField(['اسم الشريك','Partner name'],partner.name,name=>update({name}))}
     {numberFields(partner,[
      ['cash',['المساهمة النقدية','Cash contribution']],
      ['inKindLand',['حصة الأرض العينية','In-kind land contribution']],
      ['priority',['أولوية رد رأس المال','Capital return priority'],'whole',1,50],
      ['profitShare',['حصة الأرباح %','Profit share %'],'pct']
     ],update)}
    </div>
    <button className="fs-btn fs-btn--secondary" type="button" onClick={()=>onChange?.({
     ...model,distribution:{partners:distribution.partners.filter((_,i)=>i!==index)}
    })}>{l(['إزالة الشريك','Remove partner'])}</button>
   </fieldset>;
  })}
  <button className="fs-btn fs-btn--secondary" type="button" disabled={(distribution?.partners.length??0)>=50}
   onClick={()=>patch('distribution',{partners:[...(distribution?.partners??[]),{name:'',cash:0,inKindLand:0,priority:1,profitShare:0}]})}>
   {l(['إضافة شريك','Add partner'])}
  </button>
  {settlementView()}
 </>)}
 {legacyReference&&panel(['بيانات ملف الأراضي المرجعية','Reference data from the land file'],<>
  <p className="fs-hint">{l(['هذه البيانات محفوظة للمراجعة. يستخدم التوقع مراحل البيع العامة كما في الإصدار 1.0. راجع أي استبعادات إضافية في تبويب التحليل القطاعي.',
   'Reference data is retained for review. The forecast uses the shared sales schedule as in version 1.0. Review any additional exclusions in Sector analysis.'])}</p>
  {legacyReference.structure&&<p>{l(['الهيكل الوارد في الملف','Structure from file'])} · {legacyReference.structure}</p>}
  {legacyReference.additionalConstraints>0&&<p>{l(['قيود إضافية واردة في الملف م²','Additional constraints from file m²'])} · {fmt(legacyReference.additionalConstraints)}</p>}
  {legacyReference.partners.length>0&&table([
   ['الشريك','Partner'],['نوع المساهمة','Contribution type'],['المساهمة','Contribution'],
   ['حصة الأرباح %','Profit share %'],['الدور','Role']
  ],legacyReference.partners.map(partner=>[partner.name,partner.contributionType,money(partner.contribution),
   fmt(partner.profitShare*100),partner.role]))}
  {legacyReference.developmentAllocation.length>0&&table([
   ['بند توزيع التطوير','Development allocation item'],['النسبة %','Share %']
  ],legacyReference.developmentAllocation.map(item=>[item.name,fmt(item.share*100)]))}
  {legacyReference.absorption.length>0&&table([
   ['الاستخدام','Land use'],['المرحلة 1 %','Stage 1 %'],['المرحلة 2 %','Stage 2 %'],
   ['المرحلة 3 %','Stage 3 %'],['المرحلة 4 %','Stage 4 %']
  ],legacyReference.absorption.map(use=>[use.name,...use.phasing.map(value=>fmt(value*100))]))}
 </>)}
 </>;
 const headings:readonly Label[]=[
  ['السنة','Year'],['المساحة المباعة م²','Sold area m²'],['المبيعات','Sales'],['التحصيل النقدي','Cash collected'],
  ['الذمم المدينة آخر السنة','Closing receivables'],['تكلفة نقدية','Cash cost'],['الحافز','Incentive'],
  ['سحب الدين','Debt draw'],['السداد','Debt repayment'],['رصيد الدين','Closing debt'],['التدفق الاقتصادي','Economic cash flow'],
  ['التدفق بعد الدين','Equity cash flow'],['التدفق الاقتصادي التراكمي','Cumulative economic cash flow'],['تغطية خدمة الدين DSCR','Debt service coverage DSCR']
 ];
 return <div className="fs-block">
  {tab==='cashflow'&&<div className="fs-kpis" aria-label={l(['مؤشرات التدفقات النقدية','Cash flow metrics'])}>
   {([
    [['صافي القيمة الحالية','NPV'],!base.issue&&base.ready?money(base.npv):'—'],
    [['معدل العائد الداخلي','IRR'],!base.issue&&base.ready&&base.irr!==null?fmt(base.irr)+'%':'—'],
    [['ذروة عجز التمويل','Peak funding deficit'],!base.issue&&base.ready?money(base.peakEquityDeficit):'—'],
    [['الرصيد الختامي للدين','Closing debt'],!base.issue&&base.ready?money(base.annual.at(-1)?.closingDebt??null):'—']
   ] satisfies readonly (readonly [Label,string])[]).map(([label,value])=><div className="card fs-kpi" key={label[1]}>
    <small>{l(label)}</small><strong><bdi>{value}</bdi></strong>
   </div>)}
  </div>}
  {!base.issue&&base.financeMetrics&&panel(['توقيت الاستثمار وتغطية الدين','Investment timing and debt coverage'],<>
   <p>{l(['تدفق الأرض في سنة صفر','Year-zero land cash flow'])}: <bdi>{money(base.financeMetrics.initialProject)}</bdi></p>
   <p>{l(['عجز التمويل غير المغطى بالالتزام النقدي','Funding deficit not covered by cash commitment'])}: <bdi>{money(Math.max(0,base.peakEquityDeficit-(quantities.committedEquity??0)))}</bdi></p>
   <p>{l(['فترة الاسترداد من سنة صفر بالسنوات','Payback from year zero in years'])}: <bdi>{fmt(base.financeMetrics.payback)}</bdi></p>
   {base.financeMetrics.returns&&<dl className="fs-royal-checks">
    <div><dt>{l(['صافي القيمة الحالية للمشروع قبل التمويل','Project NPV before financing'])}</dt><dd><bdi>{money(base.financeMetrics.returns.unleveredNpv)}</bdi></dd></div>
    <div><dt>{l(['عائد المشروع قبل التمويل %','Project IRR before financing %'])}</dt><dd><bdi>{fmt(base.financeMetrics.returns.unleveredIrr)}</bdi></dd></div>
    <div><dt>{l(['عائد إجمالي حقوق الملكية الاقتصادية %','Total economic equity IRR %'])}</dt><dd><bdi>{fmt(base.financeMetrics.returns.equityIrr)}</bdi></dd></div>
   </dl>}
   <p className="fs-hint">{l(['الاسترداد يُحسب عند اختيار استثمار الأرض في سنة صفر. المنهج السابق يجمعها بتدفق السنة الأولى، ولا نفترض تاريخًا داخل السنة. DSCR يقسم النقد المتاح قبل الفائدة وأصل الدين على خدمة الدين، دون سحوبات التمويل.','Payback is calculated when land is invested at year zero. The legacy method nets land into year-one cash flow; no intra-year date is assumed. DSCR divides cash available before interest/principal by debt service, excluding loan draws.'])}</p>
   {table([['السنة','Year'],['تغطية خدمة الدين DSCR','Debt service coverage DSCR']],base.annual.map((x,i)=>[x.year,fmt(base.financeMetrics!.dscr[i])]))}
  </>)}
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
   const annual:Array<Array<string|number|null>>=result.annual.map((y,index)=>[y.year,y.soldArea,y.salesValue,y.cashCollected,y.receivables,y.cashCost,y.performanceFee,
    y.draw,y.repayment,y.closingDebt,y.projectCash,y.equityCash,y.cumulativeProject,result.financeMetrics?.dscr[index]??
     (y.repayment+y.interest>0?(y.cashCollected-y.cashCost+y.interest-y.performanceFee)/(y.repayment+y.interest):null)]);
   if(result.financeMetrics&&result.financeMetrics.initialProject<0)annual.unshift([
    l(['سنة صفر','Year zero']),0,0,0,0,0,0,0,0,0,result.financeMetrics.initialProject,result.financeMetrics.initialEquity,result.financeMetrics.initialProject,null
   ]);
   const rows=[[...headings.map(l),l(['العملة','Currency'])],...annual.map(row=>[...row,currency])];
   const filename='land-development-'+(i+1);
   return <div key={i}>{panel(['التدفقات النقدية · '+(sales.scenarios[i].name||String(i+1)),'Cash flows · '+(sales.scenarios[i].name||String(i+1))],<>
    {table(headings,annual.map(row=>row.map((n,j)=>typeof n==='string'?n:j<2||j===13?fmt(n):money(n))))}
    {allowExport&&<div className="fs-actions"><button className="fs-btn fs-btn--secondary" type="button"
     onClick={()=>downloadFeasibilityCsv(filename+'.csv',rows)}>{l(['تصدير التدفقات CSV','Export cash flows CSV'])}</button>
     <button className="fs-btn fs-btn--secondary" type="button" disabled={xlsxState==='working'} onClick={async()=>{
      setXlsxState('working');
      try{
       await downloadFeasibilityXlsx(filename+'.xlsx',l(['التدفقات النقدية','Cash flow']),rows,ar);
       setXlsxState('idle');
      }catch{setXlsxState('error');}
     }}>{l(['تصدير التدفقات Excel','Export cash flows Excel'])}</button>
    </div>}
   </>)}</div>;
  })}
  {xlsxState==='error'&&<p role="alert">{l(['تعذر تصدير ملف Excel.','Could not export the Excel file.'])}</p>}
 </div>;
}
