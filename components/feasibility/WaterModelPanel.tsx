'use client';
import {useId,useMemo,type ReactNode} from 'react';
import {emptyWaterOperationsPlan,emptyWaterUnitCosts,evaluateWater,waterOperationalRequirements,waterProductionBalance,waterVariableCostBreakdown,type WaterModel} from '@/lib/feasibility/water-model';
import {RoyalBars, RoyalCashTrend, RoyalOwnership} from './RoyalCharts';
import {RoyalIcon,type RoyalIconName} from './RoyalIcon';
import {downloadFeasibilityCsv} from '@/lib/feasibility/report-export';

type Labels=readonly [string,string];
type NumericKey<T>={[K in keyof T]-?:T[K] extends number?K:never}[keyof T];
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
const sourceOptions=[
 ['well','بئر','Well'],['public-network','شبكة عامة','Public network'],['spring','ينبوع','Spring'],
 ['other','مصدر آخر','Other source']
] as const;
const distributionOptions=[
 ['wholesale','بيع جملة','Wholesale'],['distributors','موزعون','Distributors'],['direct-retail','تجزئة مباشرة','Direct retail']
] as const;
const logisticsFields:NumberFields<NonNullable<WaterModel['operationsPlan']>>=[
 ['packagingLossPct','فاقد مواد التعبئة %','Packaging material waste %',99],
 ['kwhPerThousandBottles','استهلاك الكهرباء لكل 1,000 عبوة (ك.و.س)','Electricity use per 1,000 bottles (kWh)'],
 ['cartonsPerTrip','صناديق الكرتون لكل رحلة','Cartons per distribution trip',1e12,1],
 ['roundTripKm','المسافة ذهابًا وإيابًا للرحلة (كم)','Round-trip distance (km)'],
];
const unitCostFields:NumberFields<typeof emptyWaterUnitCosts>=[
 ['bottle','تكلفة العبوة','Bottle cost'],['cap','تكلفة الغطاء','Cap cost'],['label','تكلفة الملصق','Label cost'],
 ['carton','تكلفة صندوق الكرتون','Carton cost'],['kwh','تكلفة كيلوواط ساعة','Cost per kWh'],
 ['rawWaterM3','تكلفة متر مكعب من المياه الخام','Cost per m³ of raw water'],['distributionKm','تكلفة التوزيع لكل كم','Distribution cost per km']
];
const logisticsColumns=[
 ['bottles','العبوات المعبأة','Filled bottles'],
 ['filledLitres','لترات المياه المعبأة','Packaged litres'],
 ['sourceWaterM3','المياه المطلوبة من المصدر م³','Source water required m³'],
 ['bottleInputs','العبوات المطلوبة مع الفاقد','Bottle units required including waste'],
 ['cartonInputs','الكرتون المطلوب مع الفاقد','Carton units required including waste'],
 ['electricityKwh','الكهرباء ك.و.س','Electricity kWh'],
 ['trips','رحلات التوزيع','Distribution trips'],
 ['distributionKm','مسافة التوزيع كم','Distribution kilometres'],
] as const;
const projectionLabels=[
 ['year','السنة','Year'],['utilization','الاستغلال %','Utilization %'],['volume','الكراتين المرسلة','Cartons dispatched'],
 ['price','سعر الكرتون','Carton price'],['unitCost','تكلفة الكرتون المتغيرة','Variable cost / carton'],
 ['revenue','المبيعات','Revenue'],['variable','التكلفة المتغيرة','Variable costs'],['fixed','التكاليف الثابتة','Fixed costs'],
 ['ebitda','EBITDA','EBITDA'],['depreciation','الإهلاك','Depreciation'],['ebit','EBIT','EBIT'],
 ['tax','الضرائب التقديرية','Indicative tax'],['maintenance','الصيانة','Maintenance'],
 ['workingCapital','رأس المال العامل','Working capital'],
 ['workingCapitalMovement','تغير رأس المال العامل','Working capital movement'],
 ['freeCashFlow','التدفق الحر قبل التمويل','Project free cash flow'],['principal','سداد الأصل','Principal'],
 ['interest','الفائدة','Interest'],['debtService','خدمة القرض','Debt service'],['debtBalance','رصيد القرض','Closing loan balance'],
 ['afterDebt','التدفق بعد خدمة القرض','Cash flow after debt service'],['dscr','تغطية خدمة الدين (DSCR)','Debt service coverage (DSCR)'],
 ['returnedVolume','الكراتين المرتجعة','Returned cartons'],['netVolume','صافي الكراتين المباعة','Net cartons sold']
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

function Table({headers,rows,footer}:{headers:ReactNode[];rows:ReactNode[][];footer?:ReactNode}){
 return <div className="fs-table-wrap"><table className="fs-table">
  <thead><tr>{headers.map((value,index)=><th scope="col" key={index}>{value}</th>)}</tr></thead>
  <tbody>{rows.map((row,index)=><tr key={index}>{row.map((value,cell)=>
   cell===0?<th scope="row" key={cell}>{value}</th>:<td key={cell}>{value}</td>)}</tr>)}</tbody>
  {footer&&<tfoot><tr>{footer}</tr></tfoot>}
 </table></div>;
}

function Panel({title,icon,children}:{title:string;icon:RoyalIconName;children:ReactNode}){
 return <section className="card fs-panel">
  <h4 className="fs-royal-report-title"><RoyalIcon name={icon}/>{title}</h4>
  {children}
 </section>;
}

export default function WaterModelPanel({water,locale,currency,tab,detail,onChange,allowExport=true}:{
 water:WaterModel;locale:string;currency:string;
 tab:'overview'|'investment'|'partners'|'operations'|'scenarios'|'cashflow'|'advanced'|'sector'|'report';
 detail?:'water'|'valuation'|'scenario'|'evidence'|'permissions';
 onChange:(water:WaterModel)=>void;allowExport?:boolean;
}){
 const l=(ar:string,en:string)=>locale==='ar'?ar:en;
 const distributionLabelId=useId();
 const fmt=(value:number|null)=>value===null||!Number.isFinite(value)?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
 const money=(value:number|null)=>value===null?'—':fmt(value)+(currency?' '+currency:'');
 const percentage=(value:number|null)=>value===null?'—':fmt(value)+'%';
 const scenarioLabel=(name:string)=>locale==='ar'?({Conservative:'متحفظ',Base:'أساسي',Optimistic:'متفائل'}[name]??name):name;
 const m=useMemo(()=>evaluateWater(water),[water]);
 const field=<K extends 'capex'|'deal'|'ops'>(section:K,[key,ar,en,max,step]:NumberFields<WaterModel[K]>[number])=>
  <NumberInput key={String(key)} label={l(ar,en)} value={Number(water[section][key])} max={max}
   min={key==='horizon'?3:0} step={step} onChange={value=>
    onChange({...water,[section]:{...water[section],[key]:value}})}/>;
 const fields=<K extends 'capex'|'deal'|'ops'>(section:K,definition:NumberFields<WaterModel[K]>)=>
  <div className="fs-form-grid">{definition.map(item=>field(section,item))}</div>;
 const metrics=(items:Array<[Labels,string,RoyalIconName?,string?]>)=><div className="fs-kpis">{items.map(([[ar,en],value,icon,note])=>
  <div key={en} className="fs-metric">{icon&&<RoyalIcon name={icon}/>}<small>{l(ar,en)}</small>
   <strong dir="ltr">{value}</strong>{note&&<span>{note}</span>}</div>)}</div>;
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
  tab==='overview'&&water.deal.extraFunding>0&&l('التمويل الإضافي مدرج في هيكل التمويل. خصص استخدامه قبل الاعتماد.','Additional funds are included in the financing structure. Allocate their use before approval.'),
  tab==='overview'&&water.deal.licenseValue>0&&l('قيمة الرخصة للمراجعة ولا تدخل في الحصص.','Licence valuation is for review and excluded from ownership.'),
  tab==='overview'&&water.deal.landMode==='lease'&&l('الأرض خارج رأس المال. وثّق حقوق المنشآت في العقد.','Land is outside equity. Document rights over the improvements in the agreement.'),
  tab==='overview'&&water.deal.landMode!=='lease'&&water.deal.leaseMonth>0&&l('راجع احتمال الجمع بين الحصة العينية وإيجار الأرض.','Review the possible overlap of an in-kind contribution with land rent.'),
  water.ops.licensedWaterM3Day>0&&m.waterDemand>water.ops.licensedWaterM3Day&&l('الطلب النظري للمياه يتجاوز الكمية المرخصة المدخلة.','Theoretical water demand exceeds the entered licensed limit.'),
  m.ready&&m.breakEven===null&&l('هامش الكرتون غير موجب.','Carton contribution margin is non-positive.')
 ].filter(Boolean);
 const forecast=<>
  <p>{l('التدفق عند التأسيس (السنة صفر)','Initial investment cash flow (year zero)')} <b>{money(m.flows[0])}</b></p>
  {m.ready&&chart}
  <Table headers={[l('البند','Metric'),...m.annual.map(y=>y.year)]}
   rows={projectionLabels.slice(1).map(([key,ar,en])=>[l(ar,en),...m.annual.map(y=>fmt(y[key]))])}/>
  <p className="fs-hint">{l('تغطية خدمة الدين تساوي التدفق الحر قبل التمويل مقسومًا على أصل القرض وفائدته خلال السنة.','Debt service coverage divides project free cash flow before financing by annual principal and interest.')}</p>
  <p className="fs-hint">{l('يُحتسب القرض بأقساط أصل متساوية على الرصيد الافتتاحي ودون فوائد قبل أول سنة سداد. لا يشمل التوقع قيمة تخارج أو استردادًا نهائيًا لرأس المال العامل.','The loan uses equal principal repayments and interest on opening balances, with no interest before the first repayment year. The forecast excludes exit proceeds and final working capital recovery.')}</p>
 </>;
 const exportForecast=()=>downloadFeasibilityCsv('bottled-water-projections.csv',[
  [...projectionLabels.map(([,ar,en])=>l(ar,en)),l('العملة','Currency')],
  [0,...projectionLabels.slice(1).map(([key])=>key==='freeCashFlow'?m.flows[0]:key==='debtBalance'?m.totalLoan:null),currency],
  ...m.annual.map(y=>[...projectionLabels.map(([key])=>y[key]),currency])
 ]);
 if(tab==='investment'){
  const items=capexFields.filter(([key])=>key!=='contingencyPct'&&key!=='workingCapital');
  const reserveFields=capexFields.filter(([key])=>key==='contingencyPct'||key==='workingCapital');
  return <section className="fs-block fs-royal-capex">
   {metrics([[['الإنشاءات والمعدات','Works and equipment'],money(m.hard)],
    [['احتياطي الاستثمار','Investment contingency'],money(m.contingency)],
    [['رأس المال العامل','Working capital'],money(water.capex.workingCapital)],
    [['إجمالي الاحتياج النقدي','Total initial cash required'],money(m.cashRequired)]])}
   <section className="card fs-panel">
    <h3 className="fs-royal-report-title"><RoyalIcon name="coins"/>{l('جدول البنود الاستثمارية','Investment cost schedule')}</h3>
    <Table headers={[l('البند الاستثماري','Investment item'),l('القيمة','Amount')+(currency?' · '+currency:'')]}
     rows={[
      ...items.map(item=>[l(item[1],item[2]),field('capex',item)]),
      [l('احتياطي الاستثمار','Investment contingency'),<bdi>{money(m.contingency)}</bdi>]
     ]}
     footer={<><th scope="row">{l('إجمالي التأسيس','Total establishment costs')}</th><td><bdi>{money(m.investment)}</bdi></td></>}/>
   </section>
   <div className="fs-royal-profile-grid">
    <RoyalBars title={l('توزيع الاستثمار حسب البند','Investment costs by item')} locale={locale} unit={currency}
     data={[...items.map(([key,ar,en])=>({label:l(ar,en),value:water.capex[key]})),
      {label:l('احتياطي الاستثمار','Investment contingency'),value:m.contingency}].filter(point=>point.value>0)}/>
    <section className="card fs-panel">
     <h3 className="fs-royal-report-title"><RoyalIcon name="settings"/>{l('سياسة احتياطي التشغيل','Operating reserve policy')}</h3>
     {fields('capex',reserveFields)}
     <p className="fs-hint">{l('يُحسب الاحتياطي على الأعمال والمعدات. تُراجع حقوق الأرض في تبويب الشراكة.', 'Contingency is based on works and equipment. Review land rights in the Partnership tab.')}</p>
    </section>
   </div>
  </section>;
 }
 const debtRatios=m.annual.flatMap(year=>year.dscr===null?[]:[year.dscr]);
 const projectReturns=metrics([
  [['NPV للمشروع','Project NPV'],money(m.ready?m.npv:null)],
  [['IRR للمشروع','Project IRR'],percentage(m.ready?m.irr:null)],
  [['الاسترداد بالسنوات','Payback in years'],fmt(m.ready?m.payback:null)],
  [['أدنى تغطية خدمة دين DSCR','Minimum debt service coverage (DSCR)'],fmt(m.ready&&debtRatios.length?Math.min(...debtRatios):null)]
 ]);
 const financingSummary=[
  [l('القيمة الاستثمارية الاقتصادية','Economic investment'),money(m.cashRequired+m.land)],
  [l('النقد المطلوب للتأسيس','Initial cash requirement'),money(m.cashRequired)],
  [l('قرض المساهم المخصص للتأسيس','Shareholder loan allocated to establishment'),money(m.shareholderLoan)],
  [l('رأس المال النقدي لتغطية التأسيس','Cash equity allocated to establishment'),money(m.cashRequired-m.shareholderLoan)],
  [l('التمويل الإضافي بحسب المدخلات','Additional financing entered'),money(water.deal.extraFunding)],
  [l('إجمالي رأس مال الممول النقدي','Total investor cash equity'),money(m.investorEquity)],
  [l('الحصة العينية للأرض أو الحق','Land or right-of-use in-kind contribution'),money(m.land)],
  [l('قروض المساهم الإجمالية','Total shareholder debt'),money(m.totalLoan)]
 ];
 const compactValues=(rows:string[][])=><dl className="fs-royal-checks">{rows.map(([label,value])=>
  <div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}</dl>;
 const landTerms=<label className="fs-field"><span>{l('معالجة الأرض','Land arrangement')}</span><select value={water.deal.landMode}
  onChange={e=>onChange({...water,deal:{...water.deal,landMode:e.currentTarget.value as WaterModel['deal']['landMode']}})}>
  <option value="transfer">{l('نقل الملكية','Title transfer')}</option><option value="lease">{l('إيجار','Lease')}</option>
  <option value="right">{l('حق انتفاع مقوَّم','Valued right of use')}</option>
 </select></label>;
 const extraTerms=<label className="fs-field"><span>{l('معالجة التمويل الإضافي','Additional financing type')}</span><select value={water.deal.extraType}
  onChange={e=>onChange({...water,deal:{...water.deal,extraType:e.currentTarget.value as WaterModel['deal']['extraType']}})}>
  <option value="loan">{l('قرض مساهم','Shareholder loan')}</option>
  <option value="equity">{l('زيادة رأس المال','Equity injection')}</option>
 </select></label>;
 const ownership=<RoyalOwnership title={l('محاكاة توزيع حصص الملكية الاقتصادية','Economic ownership allocation')}
  locale={locale} showAllocation data={[
  {label:l('الممول','Investor'),value:m.investorShare??0},
  {label:l('صاحب الأرض','Land partner'),value:m.partnerShare??0}
 ]}/>;
 const plan=water.operationsPlan??emptyWaterOperationsPlan;
 const costBreakdown=waterVariableCostBreakdown(water);
 const unitCostRows:[string,string][]=costBreakdown?[
  [l('مواد التعبئة لكل كرتون','Packaging per carton'),money(costBreakdown.packaging)],
  [l('الطاقة لكل كرتون','Energy per carton'),money(costBreakdown.electricity)],
  [l('المياه لكل كرتون','Water per carton'),money(costBreakdown.water)],
  [l('التوزيع لكل كرتون','Distribution per carton'),money(costBreakdown.distribution)],
  [l('الإجمالي لكل كرتون','Total per carton'),money(costBreakdown.total)],
  [l('التكلفة المعتمدة لكل كرتون','Approved cost per carton'),money(water.ops.variableCarton)]
 ]:[];
 const updatePlan=(patch:Partial<typeof plan>)=>onChange({...water,operationsPlan:{...plan,...patch}});
 const productionBalance=waterProductionBalance(water);
 const production=detail==='water'?productionBalance:null;
 const {ops}=water;
 const planNumber=(key:'pumpingM3Hour'|'sourceHoursDay'|'finishedBottleLossPct'|'collectionDays'|'returnsPct',
  labels:Labels,max:number,step?:number)=><NumberInput label={l(...labels)} value={plan[key]??0}
   max={max} step={step} onChange={value=>updatePlan({[key]:value})}/>;
 const collectionPeriod=()=>planNumber('collectionDays',['فترة التحصيل (يوم)','Collection period (days)'],3650,1);
 const updateUtilization=(index:number,value:number)=>{
  const util=Array.from({length:Math.max(water.ops.util.length,index+1)},(_,i)=>
   i===index?value:(water.ops.util[i]??water.ops.util.at(-1)??0));
  onChange({...water,ops:{...water.ops,util}});
 };
 const firstYearDispatchPct=ops.bottlesCarton>0?m.annual[0].utilization:0;
 const saleableCapacityPct=productionBalance.nominalBottles>0?100-(plan.finishedBottleLossPct??0):0;
 const productionMix=[
  {label:l('الطاقة الاسمية','Nominal capacity'),value:productionBalance.nominalBottles>0?100:0},
  {label:l('الإنتاج القابل للبيع','Saleable output'),value:saleableCapacityPct},
  {label:l('الإرسال المخطط','Planned dispatch'),value:productionBalance.nominalBottles>0?firstYearDispatchPct:0},
  {label:l('الطاقة القابلة للبيع المتبقية','Spare saleable capacity'),value:Math.max(0,saleableCapacityPct-firstYearDispatchPct)}
 ];
 const operationsRows=detail==='water'?m.annual.map(year=>({
  year:year.year,requirements:waterOperationalRequirements(water,year),
 })):[];
 const headings:Record<typeof tab,Labels>={
  overview:['مؤشرات مصنع المياه','Bottled-water diagnostics'],
  partners:['الشراكة وتمويل مصنع المياه','Water factory partnership and funding'],operations:['الإنتاج والمبيعات ومصدر المياه','Production, sales and water source'],
  scenarios:['السيناريوهات والحساسية','Scenarios and sensitivity'],cashflow:['التوقعات وخدمة قرض المساهم','Forecast and shareholder debt service'],
  advanced:['الإهلاك ورأس المال العامل وخدمة الدين','Depreciation, working capital and debt service'],
  sector:['التحليل القطاعي لمصنع المياه','Water factory sector analysis'],
  report:['الافتراضات والتوقعات المالية','Financial assumptions and forecast']
 };
 return <section className={tab==='overview'||tab==='report'?'card fs-panel':'fs-block fs-royal-water-layout'}>
  <h3 className="fs-royal-water-heading">{detail==='water'?l('الطاقة الإنتاجية ومصدر المياه','Production capacity and water source'):detail==='valuation'?l('التقييم والحقوق والمستندات','Valuation, rights and evidence'):detail==='scenario'?l('افتراضات السيناريوهات','Scenario assumptions'):l(...headings[tab])}</h3>
  {(tab==='overview'||tab==='report')&&<>{valuation}{tab==='overview'&&partnership}{diagnostics.length>0&&
   <ul className="fs-notes">{diagnostics.map(item=><li key={String(item)}>{item}</li>)}</ul>}</>}
  {tab==='partners'&&<>
   <div className="fs-royal-profile-grid fs-royal-water-forms">
    <Panel title={l('مساهمة شريك الأرض','Land partner contribution')} icon="building">
     <div className="fs-form-grid">{landTerms}{dealFields.slice(0,5).map(item=>field('deal',item))}
      {detail==='valuation'&&([
       ['appraisalDate',l('تاريخ التقييم المستقل','Independent valuation date')],
       ['appraisalApprovalDate',l('تاريخ اعتماد التقييم الموثّق','Documented valuation approval date')],
      ] as const).map(([key,label])=><label key={key} className="fs-field"><span>{label}</span>
       <input type="date" value={water.deal[key]??''} onChange={event=>{
        const value=event.currentTarget.value;
        if(value.length<=10)onChange({...water,deal:{...water.deal,[key]:value||undefined}});
       }}/></label>)}
     </div>
     {detail==='valuation'&&<p className="fs-hint">{l('سجّل التاريخ الوارد في مستند التقييم أو الاعتماد.',
      'Enter the dates shown on the valuation or approval document.')}</p>}
     <p>{l('تقييم المتر المربع','Valuation per square metre')} <bdi>{money(water.deal.landArea>0?water.deal.landValue/water.deal.landArea:null)}</bdi></p>
     <p className="fs-hint">{l('الملكية تقديرية. راجع التقييم المستقل ومستندات نقل الملكية أو حق الانتفاع.',
      'Ownership is indicative. Review the independent valuation and title transfer or right-of-use documents.')}</p>
    </Panel>
    {detail!=='valuation'&&<Panel title={l('مساهمة الشريك الممول','Investor contribution')} icon="coins">
     <div className="fs-form-grid">{dealFields.slice(5).map(item=>field('deal',item))}{extraTerms}</div>
     <p className="fs-hint">{l('يُعرض التمويل الإضافي كرأس مال أو قرض. تكلفة المشروع المرجعية مستقلة عن مصدر التمويل.',
      'Additional financing appears as equity or debt. Reference project cost is independent of the funding source.')}</p>
    </Panel>}
    {detail==='valuation'&&<Panel title={l('أثر التقييم على الملكية','Effect of valuation on ownership')} icon="file">
     <Table headers={[l('العنصر','Item'),l('القيمة المقدرة','Estimated value'),l('المعاملة','Treatment')]} rows={[
      [l('الأرض','Land'),money(water.deal.landValue),water.deal.landMode==='transfer'?l('حصة عينية','In-kind equity'):l('خارج الملكية','Outside equity')],
      [l('حق الانتفاع','Right of use'),money(water.deal.rightValue),water.deal.landMode==='right'?l('حصة عينية','In-kind equity'):l('خارج الملكية','Outside equity')],
      [l('الترخيص','Licence'),money(water.deal.licenseValue),l('للمراجعة','For review')]
     ]}/>
    </Panel>}
    {ownership}
    {detail!=='valuation'&&<Panel title={l('توازن التمويل','Funding balance')} icon="users">
     {compactValues(financingSummary)}
     {water.deal.investorLoan>m.shareholderLoan&&<p className="fs-hint">
      {l('خُصص قرض التأسيس بحد أقصى يساوي الاحتياج النقدي. الجزء الزائد من القرض المدخل',
       'The establishment loan is capped at the initial cash requirement. Unallocated entered loan amount')}
      {' · '}<bdi>{money(water.deal.investorLoan-m.shareholderLoan)}</bdi>
     </p>}
     {water.deal.extraFunding>0&&<p className="fs-hint">{l('حدّد أوجه استخدام التمويل الإضافي قبل اعتماد الدراسة.',
      'Allocate additional financing to specific uses before approving the study.')}</p>}
    </Panel>}
   </div>
  </>}
  {(tab==='operations'||tab==='sector')&&<>
   {tab==='sector'&&metrics([
    [['الطاقة الاسمية عبوة/ساعة','Nominal hourly bottles'],fmt(water.ops.bottlesHour)],
    [['الطاقة الاسمية عبوة/شهر','Nominal monthly bottles'],fmt(water.ops.bottlesHour*water.ops.hoursDay*water.ops.daysMonth)],
    [['فاقد المياه','Water loss'],percentage(water.ops.waterLossPct)],
    [['استغلال السنة الأولى','First-year utilization'],percentage(m.annual[0].utilization)]
   ])}
   {!production&&<>
   <div className={tab==='operations'?'fs-royal-profile-grid fs-royal-water-production-inputs':'fs-royal-profile-grid'}>
    <Panel title={l('الطاقة التشغيلية والجودة','Operating capacity and quality')} icon="factory">
     <div className="fs-form-grid">
      {operationFields.slice(0,7).map(item=>field('ops',item))}
      {tab==='operations'&&<NumberInput label={l('استغلال الخط في السنة الأولى %','First-year line utilization %')}
       value={m.annual[0].utilization} max={100} onChange={value=>updateUtilization(0,value)}/>}
     </div>
    </Panel>
    <Panel title={l('اقتصاديات الوحدة والمبيعات','Unit economics and sales')} icon="coins">
     <div className="fs-form-grid">
      {operationFields.slice(7,10).map(item=>field('ops',item))}
      {collectionPeriod()}
      {tab==='operations'&&planNumber('returnsPct',['المرتجعات %','Returns %'],100)}
      {tab==='operations'&&<label className="fs-field"><span id={distributionLabelId}>{l('قناة التوزيع','Distribution channel')}</span>
       <select aria-labelledby={distributionLabelId} value={plan.distributionChannel??''} onChange={event=>updatePlan({
        distributionChannel:distributionOptions.find(([key])=>key===event.currentTarget.value)?.[0],
       })}>
        <option value="">{l('اختر القناة','Select channel')}</option>
        {distributionOptions.map(([key,ar,en])=><option key={key} value={key}>{l(ar,en)}</option>)}
       </select>
      </label>}
     </div>
     {tab==='operations'&&compactValues([
      [l('تكلفة مواد التعبئة لكل كرتون','Packaging cost per carton'),money(costBreakdown?.packaging??null)],
      [l('تكلفة الطاقة لكل كرتون','Energy cost per carton'),money(costBreakdown?.electricity??null)]
     ])}
     {fields('ops',operationFields.slice(10,13))}
    </Panel>
   </div>
   {tab==='operations'&&<div className="fs-royal-water-production-kpis">{metrics([
    [['الطاقة الاسمية عبوة/شهر','Nominal monthly bottles'],fmt(productionBalance.nominalBottles),'factory',l('عبوة قبل الفاقد','Bottles before waste')],
    [['العبوات القابلة للبيع شهريًا','Monthly saleable bottles'],fmt(productionBalance.saleableBottles),'check'],
    [['الكراتين الكاملة القابلة للبيع شهريًا','Monthly complete saleable cartons'],fmt(productionBalance.saleableCartons),'layers'],
    [['احتياج مياه المصدر م³/شهر','Source water demand m³/month'],fmt(productionBalance.requiredM3Day*ops.daysMonth),'droplet',l('احتياج تقديري','Estimated demand')]
   ])}</div>}
   <div className={tab==='operations'?'fs-royal-water-production-balance':'fs-royal-profile-grid'}>
    <Panel title={l('توازن الإنتاج والمصدر المرخّص','Production and licensed source balance')} icon="droplet">
     {tab==='operations'&&<RoyalBars title={l('خطة السنة الأولى من الطاقة الاسمية','First-year plan as a share of nominal capacity')}
      locale={locale} unit="%" data={productionMix}/>}
     {tab==='operations'&&productionBalance.nominalBottles>0&&firstYearDispatchPct>saleableCapacityPct&&
      <p className="fs-hint">{l('الإرسال المخطط يتجاوز الإنتاج القابل للبيع بعد فاقد العبوات.',
       'Planned dispatch exceeds saleable output after bottle waste.')}</p>}
     {compactValues([
      [l('احتياج المياه النظري م³/يوم','Theoretical water demand m³/day'),fmt(productionBalance.requiredM3Day)],
      [l('الكمية المرخّصة المدخلة م³/يوم','Entered licensed water m³/day'),fmt(productionBalance.licensedM3Day)],
      [l('المتاح وفق الضخ والترخيص م³/يوم','Available within pumping and permit limits m³/day'),fmt(productionBalance.availableM3Day)]
     ])}
     <p className="fs-hint" data-source-warning={productionBalance.licensedM3Day===null||
      productionBalance.requiredM3Day>(productionBalance.availableM3Day??productionBalance.licensedM3Day)}>
      {productionBalance.licensedM3Day===null
       ?l('أدخل الكمية المرخّصة ووثّق تصريح المصدر للتحقق من كفاية المياه.','Enter the licensed volume and document the permit to check source sufficiency.')
       :productionBalance.requiredM3Day>(productionBalance.availableM3Day??productionBalance.licensedM3Day)
        ?l('الطلب النظري يتجاوز الحد المتاح وفق مدخلات المصدر.','Theoretical demand exceeds the available limit from the source assumptions.')
        :l('الطلب النظري ضمن الحد المدخل. تحقّق من مستند المصدر.','Theoretical demand fits the entered limit. Verify the source documentation.')}
     </p>
    </Panel>
   </div>
   <div className="fs-royal-profile-grid">
    {m.ready&&<RoyalBars title={l('صافي الكراتين المباعة حسب السنة','Net cartons sold by year')} locale={locale}
     data={m.annual.map(y=>({label:fmt(y.year),value:y.netVolume}))}/>}
    {tab==='operations'&&<Panel title={l('الطاقة والتعادل','Capacity and break-even')} icon="chart">
     {compactValues([
      [l('الطاقة الشهرية بالكراتين','Monthly carton capacity'),fmt(m.capacity/12)],
      [l('الكراتين المطلوب إرسالها شهريًا للتعادل','Monthly cartons to dispatch to break even'),fmt(m.breakEven===null?null:m.breakEven/12)]
     ])}
    </Panel>}
   </div>
   </>}
   {production&&<>
    <div className="fs-royal-water-kpis">{metrics([
     [['طاقة التعبئة الاسمية','Nominal bottles / hour'],fmt(ops.bottlesHour)],
     [['ساعات التشغيل اليومية','Operating hours / day'],fmt(ops.hoursDay)],
     [['فاقد معالجة المياه','Water treatment loss'],percentage(ops.waterLossPct)],
     [['العبوات لكل كرتون','Bottles per carton'],fmt(ops.bottlesCarton)]
    ])}</div>
    <div className="fs-royal-profile-grid fs-royal-water-forms">
     <Panel title={l('مصدر المياه والطاقة المرخصة','Water source and licensed capacity')} icon="droplet">
      <div className="fs-form-grid">
       {field('ops',operationFields[6])}
       <label className="fs-field"><span>{l('مصدر المياه','Water source')}</span>
        <select value={plan.sourceType??''} onChange={event=>updatePlan({
         sourceType:sourceOptions.find(([key])=>key===event.currentTarget.value)?.[0],
        })}>
         <option value="">{l('اختر المصدر','Select source')}</option>
         {sourceOptions.map(([key,ar,en])=><option key={key} value={key}>{l(ar,en)}</option>)}
        </select>
       </label>
       {planNumber('pumpingM3Hour',['معدل الضخ (م³/ساعة)','Pumping rate (m³/hour)'],1e12)}
       {planNumber('sourceHoursDay',['ساعات تشغيل المصدر يوميًا','Source operating hours per day'],24)}
       {field('ops',operationFields[5])}
       {field('ops',operationFields[4])}
       <label className="fs-field"><span>{l('اسم مصدر المياه','Water source name')}</span>
        <input maxLength={160} value={plan.sourceName} onChange={event=>updatePlan({sourceName:event.currentTarget.value})}/>
       </label>
       <label className="fs-field"><span>{l('مرجع تصريح الضخ','Extraction permit reference')}</span>
        <input maxLength={160} value={plan.permitReference} onChange={event=>updatePlan({permitReference:event.currentTarget.value})}/>
       </label>
      </div>
      {compactValues([
       [l('قدرة الضخ المقدّرة م³/يوم','Estimated pumping capacity m³/day'),fmt(production.pumpedM3Day)],
       [l('المتاح وفق القدرة والكمية المدخلة م³/يوم','Available within capacity and entered limit m³/day'),fmt(production.availableM3Day)],
       [l('احتياج التعبئة الاسمي م³/يوم','Nominal production demand m³/day'),fmt(production.requiredM3Day)]
      ])}
      <p className="fs-hint">{production.availableM3Day===null
       ?l('أكمل معدل الضخ وساعات المصدر والكمية المرخّصة للتحقق من كفاية المياه.',
        'Enter the pumping rate, source hours and licensed volume to check water sufficiency.')
       :production.requiredM3Day>production.availableM3Day
        ?l('احتياج الإنتاج الاسمي يتجاوز المياه المتاحة وفق المدخلات.','Nominal production demand exceeds the water available from the entered assumptions.')
        :l('احتياج الإنتاج الاسمي ضمن المياه المتاحة وفق المدخلات.','Nominal production demand fits the water available from the entered assumptions.')}</p>
      <p className="fs-hint">{l('تحقّق من صلاحية التصريح والتحاليل والكمية المسموح بضخها في سجل التراخيص.',
       'Verify the permit, water analyses and permitted extraction volume in the licensing register.')}</p>
     </Panel>
     <Panel title={l('تفاصيل الخط والتعبئة والتوزيع','Line, packaging and distribution')} icon="factory">
      <div className="fs-form-grid">
       {operationFields.slice(0,4).map(item=>field('ops',item))}
       {operationFields.slice(7,9).map(item=>field('ops',item))}
       {planNumber('finishedBottleLossPct',['فاقد العبوات النهائية %','Finished bottle loss %'],100)}
       {collectionPeriod()}
       {logisticsFields.map(([key,ar,en,max,step])=><NumberInput key={key} label={l(ar,en)} value={plan[key]}
        max={max} step={step} onChange={value=>updatePlan({[key]:value})}/>)}
      </div>
     </Panel>
    </div>
    <Panel title={l('تقدير تكلفة المواد والطاقة والتوزيع','Materials, energy and distribution cost estimate')} icon="coins">
     <div className="fs-form-grid">{unitCostFields.map(([key,ar,en])=><NumberInput key={key} label={l(ar,en)}
      value={plan.unitCosts?.[key]??0} onChange={value=>updatePlan({unitCosts:{...emptyWaterUnitCosts,...plan.unitCosts,[key]:value}})}/>)}</div>
     <p className="fs-hint">{l('التقدير لكل كرتون للمراجعة. أدخل التكلفة المتغيرة المعتمدة في تفاصيل الخط بعد إضافة أي بنود أخرى.',
      'Review the per-carton estimate and enter the approved variable cost in line details after adding any other costs.')}</p>
     {costBreakdown&&compactValues(unitCostRows)}
    </Panel>

    <Panel title={l('ميزان الطاقة والفاقد','Capacity and waste balance')} icon="chart">
     <Table headers={[l('المرحلة','Stage'),l('المدخل','Input'),l('النتيجة الشهرية','Monthly result')]} rows={[
      [l('الإنتاج الاسمي للعبوات','Nominal bottle output'),<bdi key="capacity">{[ops.bottlesHour,ops.hoursDay,ops.daysMonth].map(fmt).join(' × ')}</bdi>,fmt(production.nominalBottles)],
      [l('فاقد العبوات النهائية','Finished bottle waste'),percentage(plan.finishedBottleLossPct??0),fmt(production.finishedWaste)],
      [l('العبوات القابلة للبيع','Saleable bottles'),percentage(100-(plan.finishedBottleLossPct??0)),fmt(production.saleableBottles)],
      [l('الكراتين الكاملة القابلة للبيع','Complete saleable cartons'),fmt(ops.bottlesCarton),fmt(production.saleableCartons)]
     ]}/>
     <p className="fs-hint">{l('ميزان تشغيلي تخطيطي. تستمر توقعات المبيعات في استخدام نسب الاستغلال المحفوظة، ويستخدم رأس المال العامل نسبته المعتمدة من المبيعات.',
      'This balance is for operating plans. Sales forecasts use saved utilization rates, and working capital uses its approved share of sales.')}</p>
    </Panel>
    <Panel title={l('اقتصاديات الوحدة','Unit economics')} icon="coins">
     {fields('ops',operationFields.slice(9,13))}
    </Panel>
    <Panel title={l('الاحتياجات التشغيلية السنوية','Annual operating requirements')} icon="clipboard">
     <p className="fs-hint">{l('تُقدّر الاحتياجات من إنتاج كل سنة. تُدخل تكاليف التشغيل المعتمدة في اقتصاديات الوحدة.',
      'Requirements are estimated from each year’s production. Enter approved operating costs in unit economics.')}</p>
     <Table headers={[l('السنة','Year'),...logisticsColumns.map(([,ar,en])=>l(ar,en))]}
      rows={operationsRows.map(({year,requirements})=>[year,...logisticsColumns.map(([key])=>fmt(requirements?.[key]??null))])}/>
     {allowExport&&<div className="fs-actions"><button type="button" className="fs-btn fs-btn--secondary"
      onClick={()=>downloadFeasibilityCsv('water-operating-requirements.csv',[
       [l('السنة','Year'),...logisticsColumns.map(([,ar,en])=>l(ar,en))],
       ...operationsRows.map(({year,requirements})=>[year,...logisticsColumns.map(([key])=>requirements?.[key]??null)]),
      ])}>{l('تصدير الاحتياجات CSV','Export requirements CSV')}</button></div>}
    </Panel>
   </>}
   <Panel title={l('الاستغلال والمبيعات السنوية','Annual utilization and sales')} icon="chart">
    <Table headers={[l('السنة','Year'),l('الاستغلال %','Utilization %'),l('الكراتين المرسلة','Cartons dispatched'),l('المرتجعات','Returns'),l('صافي الكراتين المباعة','Net cartons sold'),l('المبيعات','Sales'),l('هامش المساهمة','Contribution margin'),'EBITDA']}
     rows={m.annual.map((y,i)=>[y.year,<NumberInput key={i} label={l('استغلال السنة ','Utilization in year ')+y.year}
      value={y.utilization} max={100} onChange={value=>updateUtilization(i,value)}/>,fmt(y.volume),fmt(y.returnedVolume),fmt(y.netVolume),money(y.revenue),money(y.revenue-y.variable),money(y.ebitda)])}/>
   </Panel>
   {tab==='operations'&&detail!=='water'&&<Panel title={l('افتراضات التوقعات','Forecast assumptions')} icon="settings">
    {fields('ops',operationFields.slice(13))}
   </Panel>}
  </>}
  {tab==='scenarios'&&<>
   {detail==='scenario'&&<div className="fs-royal-scenario-cards">{water.scenarios.map((scenario,index)=>{
    const name=scenarioLabel(scenario.name);
    return <section className="card fs-panel" key={index}><h4>{name}</h4>
     {([['volume','الحجم','Volume'],['price','السعر','Price'],['cost','التكلفة','Cost']] as const).map(([key,ar,en])=>
      <NumberInput key={key} label={l(ar,en)+' % · '+name} max={1000} value={scenario[key]}
       onChange={value=>onChange({...water,scenarios:water.scenarios.map((s,ix)=>ix===index?{...s,[key]:value}:s)})}/>)}
    </section>;
   })}</div>}
   <Panel title={l('تعريف السيناريوهات','Scenario assumptions')} icon="chart">
   <Table headers={[l('السيناريو','Scenario'),l('الحجم %','Volume %'),l('السعر %','Price %'),l('التكلفة %','Cost %'),
    l('مبيعات سنة 1','Year 1 sales'),'EBITDA · 1','NPV','IRR']}
    rows={water.scenarios.map((scenario,i)=>{
     const result=evaluateWater(water,scenario);
     return [scenarioLabel(scenario.name),
      ...(detail==='scenario'?[percentage(scenario.volume),percentage(scenario.price),percentage(scenario.cost)]:([['volume','الحجم','Volume'],['price','السعر','Price'],['cost','التكلفة','Cost']] as const).map(([key,ar,en])=>
       <NumberInput key={key} label={l(ar,en)+' · '+scenario.name} max={1000} value={scenario[key]}
        onChange={value=>onChange({...water,scenarios:water.scenarios.map((s,ix)=>ix===i?{...s,[key]:value}:s)})}/>)),
      money(result.annual[0].revenue),money(result.annual[0].ebitda),money(result.ready?result.npv:null),percentage(result.ready?result.irr:null)];
    })}/>
   </Panel>
   <div className="fs-royal-profile-grid">
    {m.ready&&<RoyalBars title={l('صافي القيمة الحالية حسب السيناريو','Net present value by scenario')} locale={locale} unit={currency}
     data={water.scenarios.map(s=>({label:scenarioLabel(s.name),value:evaluateWater(water,s).npv}))}/>}
    <Panel title={l('حساسية NPV لتغيّر حجم المبيعات والسعر','NPV sensitivity to sales volume and price')} icon="chart">
     <div className="fs-royal-sensitivity">
      <Table headers={[l('الحجم / السعر','Volume / price'),...sensitivityPrices.map(percentage)]}
       rows={sensitivityVolume.map(volume=>[percentage(volume),...sensitivityPrices.map(price=>{
        const value=m.ready?evaluateWater(water,{volume,price,cost:100}).npv:null;
        return <span key={price} data-sign={value===null?'empty':value<0?'negative':'positive'}><bdi>{money(value)}</bdi></span>;
       })])}/>
     </div>
     <p className="fs-hint">{l('تتغير عوامل الحجم والسعر. تبقى تكلفة الوحدة عند افتراض النموذج الأساسي.',
      'Volume and price factors vary. Unit cost remains at its model baseline.')}</p>
    </Panel>
   </div>
  </>}
  {tab==='advanced'&&<>
   <div className="fs-royal-profile-grid">
    <Panel title={l('الإهلاك والعمر الاقتصادي','Depreciation and economic life')} icon="layers">
     {fields('ops',operationFields.filter(([key])=>key==='life'||key==='maintenancePct'))}
     {compactValues([[l('الإهلاك السنوي','Annual depreciation'),money(m.annual[0].depreciation)]])}
    </Panel>
    <Panel title={l('سياسة رأس المال العامل والخصم','Working capital and discount assumptions')} icon="coins">
     {fields('ops',operationFields.filter(([key])=>['nwcPct','discountRate','taxRate','horizon'].includes(key)))}
     {compactValues([[l('رأس المال العامل عند التأسيس','Initial working capital'),money(water.capex.workingCapital)]])}
    </Panel>
   </div>
   {projectReturns}
   <Panel title={l('خدمة الدين السنوية','Annual debt service')} icon="coins">
    <Table headers={[l('السنة','Year'),l('الرصيد الافتتاحي','Opening balance'),l('الفائدة','Interest'),
     l('سداد الأصل','Principal repayment'),l('الرصيد الختامي','Closing balance'),'DSCR',l('التدفق بعد القرض','Cash flow after debt')]}
     rows={m.annual.map(y=>[y.year,money(y.debtBalance+y.principal),money(y.interest),money(y.principal),
      money(y.debtBalance),fmt(y.dscr),money(y.afterDebt)])}/>
   </Panel>
   <Panel title={l('الإهلاك وتغير رأس المال العامل','Depreciation and working capital movement')} icon="layers">
    <Table headers={[l('السنة','Year'),l('الإهلاك','Depreciation'),l('تغير رأس المال العامل','Working capital movement')]}
     rows={m.annual.map(y=>[y.year,money(y.depreciation),money(y.workingCapitalMovement)])}/>
   </Panel>
  </>}
  {tab==='cashflow'&&<>
   {projectReturns}
   <Panel title={l('التدفقات النقدية السنوية','Annual cash flows')} icon="coins">
    <Table headers={[l('البند','Metric'),l('السنة 0','Year 0'),...m.annual.map(y=>y.year)]}
     rows={[
      [l('الإيرادات','Revenue'),'—',...m.annual.map(y=>fmt(y.revenue))],
      [l('التكاليف التشغيلية','Operating costs'),'—',...m.annual.map(y=>fmt(y.variable+y.fixed))],
      ['EBITDA','—',...m.annual.map(y=>fmt(y.ebitda))],
      [l('الضريبة الاسترشادية','Indicative tax'),'—',...m.annual.map(y=>fmt(y.tax))],
      [l('التدفق الحر قبل التمويل','Project free cash flow'),...m.flows.map(fmt)],
      [l('التدفق التراكمي','Cumulative cash flow'),...m.flows.map((_,i)=>fmt(m.flows.slice(0,i+1).reduce((sum,flow)=>sum+flow,0)))]
     ]}/>
   </Panel>
   <div className="fs-royal-profile-grid">
    {m.ready&&<RoyalCashTrend title={l('التدفق النقدي التراكمي','Cumulative cash flow')}
     locale={locale} unit={currency} flows={m.flows}/>}
    <Panel title={l('خدمة القرض ومصادر التمويل','Loan service and financing sources')} icon="coins">
     {compactValues([
      [l('قروض المساهم الإجمالية','Total shareholder debt'),money(m.totalLoan)],
      [l('مدة السداد بالسنوات','Repayment term in years'),fmt(water.deal.loanYears)],
      [l('سعر الفائدة','Interest rate'),percentage(water.deal.loanInterest)],
      [l('الرصيد بعد آخر سنة من التوقعات','Balance after last forecast year'),money(m.annual.at(-1)?.debtBalance??m.totalLoan)]
     ])}
    </Panel>
   </div>
   <Panel title={l('التوقعات التفصيلية وخدمة القرض','Detailed forecast and loan service')} icon="chart">
    {valuation}{forecast}
    {allowExport&&<button className="fs-btn fs-btn--secondary" type="button" onClick={exportForecast}>{l('تصدير التوقعات CSV','Export forecast CSV')}</button>}
   </Panel>
  </>}
  {tab==='report'&&<>
   {costBreakdown&&<section className="fs-panel">
    <h4>{l('تقدير مكونات تكلفة الكرتون','Estimated carton cost components')}</h4>{compactValues(unitCostRows)}
   </section>}
   {allowExport&&<div className="fs-actions"><button className="fs-btn fs-btn--secondary" type="button" onClick={exportForecast}>
    {l('تصدير التوقعات CSV','Export forecast CSV')}</button></div>}{forecast}
  </>}
 </section>;
}
