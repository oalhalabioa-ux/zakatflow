'use client';
import {useMemo,type ReactNode} from 'react';
import {evaluateWater,type WaterModel} from '@/lib/feasibility/water-model';
import {downloadFeasibilityCsv} from '@/lib/feasibility/report-export';

type Labels=readonly [string,string];
type NumericKey<T>={[K in keyof T]:T[K] extends number?K:never}[keyof T];
type NumberFields<T>=readonly (readonly [NumericKey<T>,string,string,number?,number?])[];

const capexFields:NumberFields<WaterModel['capex']>=[
 ['buildings','الإنشاءات والمباني','Construction and buildings'],
 ['line','خط التعبئة والتغليف','Bottling and packaging line'],
 ['treatment','المعالجة والفلاتر والخزانات','Treatment, filters and tanks'],
 ['power','الطاقة والمولدات','Power and generators'],
 ['lab','المختبر وضبط الجودة','Laboratory and quality control'],
 ['vehicles','النقل والتوزيع','Transport and distribution'],
 ['licenses','رسوم التأسيس والتراخيص','Establishment and licence fees'],
 ['others','تجهيزات أخرى','Other equipment'],
 ['contingencyPct','احتياطي الأعمال والمعدات %','Works and equipment contingency %',1000],
 ['workingCapital','رأس المال العامل الأولي','Opening working capital']
];
const dealFields:NumberFields<WaterModel['deal']>=[
 ['landArea','مساحة الأرض م²','Land area m²'],['landValue','تقييم الأرض','Land valuation'],
 ['rightValue','تقييم حق الانتفاع','Right-of-use valuation'],['leaseMonth','إيجار الأرض الشهري','Monthly land rent'],
 ['licenseValue','قيمة الرخصة للمراجعة فقط','Licence valuation for review only'],
 ['investorLoan','قرض المساهم عند التأسيس','Initial shareholder loan'],
 ['loanInterest','فائدة قرض المساهم %','Shareholder loan interest %',100],
 ['loanYears','مدة السداد بالسنوات','Repayment term in years',60,1],
 ['loanStart','أول سنة للسداد','First repayment year',60,1],
 ['extraFunding','تمويل إضافي من الممول','Additional investor financing']
];
const operationFields:NumberFields<WaterModel['ops']>=[
 ['bottlesHour','عبوات في الساعة','Bottles per hour'],['hoursDay','ساعات العمل اليومية','Operating hours per day'],
 ['daysMonth','أيام العمل في الشهر','Operating days per month'],['bottlesCarton','عبوات في الكرتون','Bottles per carton'],
 ['litersBottle','لترات في العبوة','Litres per bottle'],['waterLossPct','فاقد المياه %','Water loss %',100],
 ['licensedWaterM3Day','الكمية المرخصة م³/يوم','Licensed water m³/day'],
 ['priceCarton','سعر الكرتون','Price per carton'],['variableCarton','التكلفة المتغيرة للكرتون','Variable cost per carton'],
 ['fixedMonth','التكاليف الشهرية الثابتة قبل الإيجار','Monthly fixed costs before rent'],
 ['priceGrowth','نمو السعر سنويًا %','Annual price growth %',1000],
 ['costGrowth','نمو التكلفة المتغيرة سنويًا %','Annual variable cost growth %',1000],
 ['fixedGrowth','نمو الثابتة والإيجار سنويًا %','Annual fixed cost and rent growth %',1000],
 ['maintenancePct','الصيانة الرأسمالية سنويًا %','Annual capital maintenance %',1000],
 ['nwcPct','رأس المال العامل من المبيعات %','Working capital as % of sales',1000],
 ['discountRate','معدل الخصم %','Discount rate %',1000],['taxRate','ضريبة تقديرية %','Indicative tax %',100],
 ['life','عمر الإهلاك بالسنوات','Depreciation life in years',60,1],
 ['horizon','أفق التوقع بالسنوات','Projection years',10,1]
];
const projectionLabels=[
 ['year','السنة','Year'],['utilization','الاستغلال %','Utilization %'],['volume','الكراتين المباعة','Cartons sold'],
 ['price','سعر الكرتون','Carton price'],['unitCost','تكلفة الكرتون المتغيرة','Variable cost / carton'],
 ['revenue','المبيعات','Revenue'],['variable','التكلفة المتغيرة','Variable costs'],['fixed','التكاليف الثابتة','Fixed costs'],
 ['ebitda','EBITDA','EBITDA'],['depreciation','الإهلاك','Depreciation'],['ebit','EBIT','EBIT'],
 ['tax','الضرائب التقديرية','Indicative tax'],['maintenance','الصيانة','Maintenance'],
 ['workingCapital','رأس المال العامل','Working capital'],
 ['workingCapitalMovement','تغير رأس المال العامل','Working capital movement'],
 ['freeCashFlow','التدفق الحر قبل التمويل','Project free cash flow'],['principal','سداد الأصل','Principal'],
 ['interest','الفائدة','Interest'],['debtService','خدمة القرض','Debt service'],['debtBalance','رصيد القرض','Closing loan balance'],
 ['afterDebt','التدفق بعد خدمة القرض','Cash flow after debt service']
] as const;
const sensitivityVolume=[70,85,100,115,130],sensitivityPrices=[90,95,100,105,110];

function NumberInput({label,value,onChange,max=1e12,min=0,step='any'}:{
 label:string;value:number;onChange:(value:number)=>void;max?:number;min?:number;step?:number|'any';
}){
 return <label className="fs-field"><span>{label}</span><input type="number" inputMode="decimal"
  min={min} max={max} step={step} value={value}
  onChange={e=>{
   const next=Math.min(max,Math.max(min,Number(e.currentTarget.value)||0));
   onChange(step===1?Math.trunc(next):next);
  }}/></label>;
}

function Table({headers,rows}:{headers:ReactNode[];rows:ReactNode[][]}){
 return <div className="fs-table-wrap"><table className="fs-table">
  <thead><tr>{headers.map((value,index)=><th scope="col" key={index}>{value}</th>)}</tr></thead>
  <tbody>{rows.map((row,index)=><tr key={index}>{row.map((value,cell)=>
   cell===0?<th scope="row" key={cell}>{value}</th>:<td key={cell}>{value}</td>)}</tr>)}</tbody>
 </table></div>;
}

export default function WaterModelPanel({water,locale,currency,tab,onChange,allowExport=true}:{
 water:WaterModel;locale:string;currency:string;
 tab:'overview'|'investment'|'partners'|'operations'|'scenarios'|'cashflow'|'report';
 onChange:(water:WaterModel)=>void;allowExport?:boolean;
}){
 const l=(ar:string,en:string)=>locale==='ar'?ar:en;
 const fmt=(value:number|null)=>value===null||!Number.isFinite(value)?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
 const money=(value:number|null)=>value===null?'—':fmt(value)+(currency?' '+currency:'');
 const percentage=(value:number|null)=>value===null?'—':fmt(value)+'%';
 const m=useMemo(()=>evaluateWater(water),[water]);
 const fields=<K extends 'capex'|'deal'|'ops'>(section:K,definition:NumberFields<WaterModel[K]>)=>
  <div className="fs-form-grid">{definition.map(([key,ar,en,max,step])=>
   <NumberInput key={String(key)} label={l(ar,en)} value={Number(water[section][key])} max={max}
    min={key==='horizon'?3:0} step={step} onChange={value=>
     onChange({...water,[section]:{...water[section],[key]:value}})}/>)}</div>;
 const metrics=(items:Array<[Labels,string]>)=><div className="fs-kpis">{items.map(([[ar,en],value])=>
  <div key={en} className="fs-metric"><small>{l(ar,en)}</small><strong dir="ltr">{value}</strong></div>)}</div>;
 const chartSeries=[
  ['revenue',l('الإيرادات','Revenue'),'#10243A'],
  ['ebitda','EBITDA','#C6A35D'],
  ['freeCashFlow',l('التدفق الحر','Free cash flow'),'#205347']
 ] as const;
 const chartMax=Math.max(1,...m.annual.flatMap(year=>chartSeries.map(([key])=>Math.abs(year[key]))));
 const chart=<div className="fs-water-chart" aria-hidden="true">
  <div className="fs-water-series">{chartSeries.map(([key,label,color])=><span key={key}><i style={{background:color}}/>{label}</span>)}</div>
  {m.annual.map(year=><div className="fs-water-chart-row" key={year.year}><b>{year.year}</b>
   <div className="fs-water-plot">{chartSeries.map(([key,label,color])=>{
    const value=year[key]/chartMax*50;
    return <div className="fs-water-track" key={key}><span title={label+' '+money(year[key])}
     style={{background:color,insetInlineStart:(value<0?50+value:50)+'%',width:Math.abs(value)+'%'}}/></div>;
   })}</div>
  </div>)}
 </div>;
 const partnership=metrics([
  [['تكلفة التأسيس مع الرسوم','Establishment costs including fees'],money(m.investment)],
  [['رأس المال العامل الأولي','Opening working capital'],money(water.capex.workingCapital)],
  [['رأس مال الممول النقدي','Investor cash equity'],money(m.investorEquity)],
  [['الحصة العينية للأرض أو الحق','Land or right-of-use in-kind contribution'],money(m.land)],
  [['الملكية الاقتصادية للممول','Investor economic ownership'],percentage(m.investorShare)],
  [['الملكية الاقتصادية لصاحب الأرض','Land partner economic ownership'],percentage(m.partnerShare)],
  [['التمويل النقدي المطلوب عند التأسيس','Initial cash requirement'],money(m.cashRequired)],
  [['قروض المساهم الإجمالية','Total shareholder debt'],money(m.totalLoan)]
 ]);
 const valuation=metrics([
  [['NPV اقتصادية','Economic NPV'],money(m.ready?m.npv:null)],
  [['NPV للنفقات النقدية الأولية','Cash-investment NPV'],money(m.ready?m.cashNpv:null)],
  [['IRR للمشروع','Project IRR'],percentage(m.ready?m.irr:null)],
  [['الاسترداد بالسنوات','Payback in years'],fmt(m.ready?m.payback:null)],
  [['التعادل السنوي بالكراتين','Annual break-even cartons'],fmt(m.ready?m.breakEven:null)],
  [['التعادل من الطاقة','Break-even utilization'],percentage(m.ready&&m.breakEven!==null?m.breakEven/m.capacity*100:null)]
 ]);
 const diagnostics=[
  !m.ready&&l('أكمل الاستثمار والطاقة والسعر والاستغلال لعرض مؤشرات العائد.','Enter investment, capacity, price and utilization to see return metrics.'),
  m.ready&&m.npv<0&&l('صافي القيمة الحالية الاقتصادية سالب.','Economic NPV is negative.'),
  water.deal.extraFunding>0&&l('التمويل الإضافي مدرج في هيكل التمويل. خصص استخدامه قبل الاعتماد.','Additional funds are included in the financing structure. Allocate their use before approval.'),
  water.deal.licenseValue>0&&l('قيمة الرخصة للمراجعة ولا تدخل في الحصص.','Licence valuation is for review and excluded from ownership.'),
  water.deal.landMode==='lease'&&l('الأرض خارج رأس المال. وثّق حقوق المنشآت في العقد.','Land is outside equity. Document rights over the improvements in the agreement.'),
  water.deal.landMode!=='lease'&&water.deal.leaseMonth>0&&l('راجع احتمال الجمع بين الحصة العينية وإيجار الأرض.','Review the possible overlap of an in-kind contribution with land rent.'),
  water.ops.licensedWaterM3Day>0&&m.waterDemand>water.ops.licensedWaterM3Day&&l('الطلب النظري للمياه يتجاوز الكمية المرخصة المدخلة.','Theoretical water demand exceeds the entered licensed limit.'),
  m.ready&&m.breakEven===null&&l('هامش الكرتون غير موجب.','Carton contribution margin is non-positive.')
 ].filter(Boolean);
 const forecast=<>
  <p>{l('التدفق عند التأسيس (السنة صفر)','Initial investment cash flow (year zero)')} <b>{money(m.flows[0])}</b></p>
  {m.ready&&chart}
  <Table headers={[l('البند','Metric'),...m.annual.map(y=>y.year)]}
   rows={projectionLabels.slice(1).map(([key,ar,en])=>[l(ar,en),...m.annual.map(y=>fmt(y[key]))])}/>
  <p className="fs-hint">{l('يُحتسب القرض بأقساط أصل متساوية على الرصيد الافتتاحي ودون فوائد قبل أول سنة سداد. لا يشمل التوقع قيمة تخارج أو استردادًا نهائيًا لرأس المال العامل.','The loan uses equal principal repayments and interest on opening balances, with no interest before the first repayment year. The forecast excludes exit proceeds and final working capital recovery.')}</p>
 </>;
 const exportForecast=()=>downloadFeasibilityCsv('bottled-water-projections.csv',[
  [...projectionLabels.map(([,ar,en])=>l(ar,en)),l('العملة','Currency')],
  [0,...projectionLabels.slice(1).map(([key])=>key==='freeCashFlow'?m.flows[0]:key==='debtBalance'?m.totalLoan:null),currency],
  ...m.annual.map(y=>[...projectionLabels.map(([key])=>y[key]),currency])
 ]);
 const headings:Record<typeof tab,Labels>={
  overview:['مؤشرات مصنع المياه','Bottled-water diagnostics'],investment:['التكلفة التأسيسية','Establishment costs'],
  partners:['الشراكة وتمويل مصنع المياه','Water factory partnership and funding'],operations:['الإنتاج والمبيعات ومصدر المياه','Production, sales and water source'],
  scenarios:['السيناريوهات والحساسية','Scenarios and sensitivity'],cashflow:['التوقعات وخدمة قرض المساهم','Forecast and shareholder debt service'],
  report:['التكاليف والتمويل والتوقعات','Costs, funding and projections']
 };
 return <section className="card fs-panel">
  <h3>{l(...headings[tab])}</h3>
  {(tab==='overview'||tab==='report')&&<>{valuation}{partnership}{diagnostics.length>0&&
   <ul className="fs-notes">{diagnostics.map(item=><li key={String(item)}>{item}</li>)}</ul>}</>}
  {tab==='investment'&&<>
   {fields('capex',capexFields)}
   {metrics([[['الأعمال والمعدات','Works and equipment'],money(m.hard)],
    [['الاحتياطي','Contingency'],money(m.contingency)],[['التأسيس مع الرسوم','Investment including fees'],money(m.investment)],
    [['التمويل النقدي المطلوب','Required initial cash'],money(m.cashRequired)]])}
  </>}
  {tab==='partners'&&<>
   <div className="fs-form-grid">
    <label className="fs-field">{l('معالجة الأرض','Land arrangement')}<select value={water.deal.landMode}
     onChange={e=>onChange({...water,deal:{...water.deal,landMode:e.currentTarget.value as WaterModel['deal']['landMode']}})}>
     <option value="transfer">{l('نقل الملكية','Title transfer')}</option><option value="lease">{l('إيجار','Lease')}</option>
     <option value="right">{l('حق انتفاع مقوَّم','Valued right of use')}</option>
    </select></label>
    <label className="fs-field">{l('معالجة التمويل الإضافي','Additional financing type')}<select value={water.deal.extraType}
     onChange={e=>onChange({...water,deal:{...water.deal,extraType:e.currentTarget.value as WaterModel['deal']['extraType']}})}>
     <option value="loan">{l('قرض مساهم','Shareholder loan')}</option><option value="equity">{l('زيادة رأس المال','Equity injection')}</option>
    </select></label>
   </div>
   {fields('deal',dealFields)}{partnership}
   <p>{l('تقييم المتر المربع','Valuation per square metre')} <b>{money(water.deal.landArea>0?water.deal.landValue/water.deal.landArea:null)}</b></p>
   <p className="fs-hint">{l('الملكية اقتصادية تقديرية. اعتماد نقل الأرض أو حق الانتفاع يتطلب تقييمًا مستقلًا ومستندات. التمويل الإضافي يُعرض كرأس مال أو قرض دون تغيير تكلفة المشروع المرجعية.','Ownership is indicative. Title transfer or right-of-use recognition requires independent valuation and supporting documents. Extra financing changes equity or debt while leaving reference project cost unchanged.')}</p>
  </>}
  {tab==='operations'&&<>
   {fields('ops',operationFields)}
   <Table headers={[l('السنة','Year'),l('الاستغلال %','Utilization %'),l('الكراتين','Cartons'),l('المبيعات','Sales'),l('هامش المساهمة','Contribution margin'),'EBITDA']}
    rows={m.annual.map((y,i)=>[y.year,<NumberInput key={i} label={l('استغلال السنة ','Utilization in year ')+y.year}
     value={y.utilization} max={100} onChange={value=>{
      const util=Array.from({length:Math.max(water.ops.util.length,i+1)},(_,index)=>index===i?value:(water.ops.util[index]??water.ops.util.at(-1)??0));
      onChange({...water,ops:{...water.ops,util}});
     }}/>,fmt(y.volume),money(y.revenue),money(y.revenue-y.variable),money(y.ebitda)])}/>
   {metrics([[['الطاقة السنوية بالكراتين','Annual carton capacity'],fmt(m.capacity)],
    [['الطاقة الشهرية بالكراتين','Monthly carton capacity'],fmt(m.capacity/12)],
    [['طلب المياه م³ في اليوم','Water demand m³/day'],fmt(m.waterDemand)],
    [['التعادل الشهري بالكراتين','Monthly break-even cartons'],fmt(m.breakEven===null?null:m.breakEven/12)]])}
  </>}
  {tab==='scenarios'&&<>
   <Table headers={[l('السيناريو','Scenario'),l('الحجم %','Volume %'),l('السعر %','Price %'),l('التكلفة %','Cost %'),
    l('مبيعات سنة 1','Year 1 sales'),'EBITDA · 1','NPV','IRR']}
    rows={water.scenarios.map((scenario,i)=>{
     const result=evaluateWater(water,scenario);
     const names=new Map([['Conservative','متحفظ'],['Base','أساسي'],['Optimistic','متفائل']]);
     return [locale==='ar'?(names.get(scenario.name)??scenario.name):scenario.name,
      ...([['volume','الحجم','Volume'],['price','السعر','Price'],['cost','التكلفة','Cost']] as const).map(([key,ar,en])=>
       <NumberInput key={key} label={l(ar,en)+' · '+scenario.name} max={1000} value={scenario[key]}
        onChange={value=>onChange({...water,scenarios:water.scenarios.map((s,ix)=>ix===i?{...s,[key]:value}:s)})}/>),
      money(result.annual[0].revenue),money(result.annual[0].ebitda),money(result.ready?result.npv:null),percentage(result.ready?result.irr:null)];
    })}/>
   <h4>{l('حساسية NPV لتغيّر حجم المبيعات والسعر','NPV sensitivity to sales volume and price')}</h4>
   <Table headers={[l('الحجم / السعر','Volume / price'),...sensitivityPrices.map(percentage)]}
    rows={sensitivityVolume.map(volume=>[percentage(volume),...sensitivityPrices.map(price=>money(m.ready?
      evaluateWater(water,{volume,price,cost:100}).npv:null))])}/>
  </>}
  {(tab==='cashflow'||tab==='report')&&<>
   {tab==='cashflow'&&valuation}
   {allowExport&&<div className="fs-actions"><button className="fs-btn fs-btn--secondary" type="button" onClick={exportForecast}>
    {l('تصدير التوقعات CSV','Export forecast CSV')}</button></div>}{forecast}
  </>}
 </section>;
}
