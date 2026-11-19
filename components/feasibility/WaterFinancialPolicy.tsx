'use client';
import type {ReactNode} from 'react';
import {effectiveWaterInputs,legacyWaterFinancialPolicy,waterFinancialReadiness,waterCapexItemKeys,type WaterModel} from '@/lib/feasibility/water-model';
import {RoyalIcon} from './RoyalIcon';
const labels:Record<typeof waterCapexItemKeys[number],readonly [string,string]>={
 buildings:['المباني','Buildings'],line:['خط التعبئة','Bottling line'],treatment:['المعالجة','Water treatment'],power:['مرافق الطاقة','Power utilities'],
 lab:['المختبر','Laboratory'],vehicles:['النقل','Vehicles'],licenses:['التراخيص','Licences'],others:['أصول أخرى','Other assets']
};
export default function WaterFinancialPolicy({water,locale,currency,onChange,depreciationFields,workingCapitalFields,settings}:{water:WaterModel;locale:string;currency:string;onChange?:(m:WaterModel)=>void;depreciationFields?:ReactNode;workingCapitalFields?:ReactNode;settings?:ReactNode}){
 const l=(a:string,e:string)=>locale==='ar'?a:e,p=water.financialPolicy??legacyWaterFinancialPolicy();
 const state=waterFinancialReadiness(water),e=effectiveWaterInputs(water);
 const patch=(value:Partial<typeof p>)=>onChange?.({...water,financialPolicy:{...p,...value}});
 const issues:Record<string,readonly [string,string]>={DEPRECIATION_LIFE:['أكمل عمر الإهلاك','Enter the depreciation life'],
  LEGACY_OVERDEPRECIATION:['المنهج المرجعي يستهلك أكثر من تكلفة الأصل؛ اختر إهلاكًا محدودًا أو حسب الفئات قبل الاعتماد','The legacy method depreciates beyond asset cost; select capped or class depreciation before approval'],
  ASSET_LIFE:['أكمل عمر الفئة','Enter the asset-class life'],COLLECTION_DAYS:['أدخل أيام التحصيل صراحة، بما فيها صفر للبيع النقدي','Explicitly enter collection days, including zero for cash sales'],
  CYCLE_HORIZON:['طريقة الدورة السنوية تدعم مددًا حتى سنة؛ راجع المدد الأطول قبل الاعتماد','Annual cycle estimates support terms up to one year; review longer terms before approval'],
  FINANCE_EVIDENCE:['وثّق مصادر افتراضات الإهلاك والدورة والتخارج','Document sources for depreciation, cycle and terminal assumptions']};
 const details=[
  [l('أساس رأس المال العامل','Working capital method'),p.workingCapitalMode==='CYCLE'?l('أيام الدورة التشغيلية','Operating cycle days'):l('نسبة من المبيعات','Percentage of sales')],
  [l('طريقة الإهلاك','Depreciation method'),p.depreciationMode==='CLASSES'?l('حسب فئات الأصول','By asset class'):p.depreciationMode==='CAPPED'?l('قسط ثابت محدود بقيمة الأصل','Straight line capped at asset cost'):l('المنهج المرجعي المحفوظ','Saved reference method')],
  ...(p.workingCapitalMode==='PERCENT'?[[l('رأس المال العامل من المبيعات %','Working capital as % of sales'),String(water.ops.nwcPct)]]:[]),
  ...(p.depreciationMode!=='CLASSES'?[[l('عمر الإهلاك بالسنوات','Depreciation life in years'),String(water.ops.life)]]:[]),
  [l('استرداد رأس المال العامل عند النهاية %','Terminal working capital recovery %'),String(p.workingCapitalRecoveryPct)],
  [l('صافي حصيلة بيع الأصول والأرض عند النهاية','Net terminal asset and land sale proceeds'),String(p.terminalAssetProceeds)],
 ];
 const num=(label:string,value:number,change:(n:number)=>void,max=3650)=><label className="fs-field"><span>{label}</span><input type="number" min={0} max={max} step={1} value={value} onChange={event=>change(Math.min(max,Math.max(0,Math.trunc(Number(event.target.value)||0))))}/></label>;
 return <section className={onChange?'fs-block fs-financial-policy':'card fs-panel fs-financial-policy'}>
  {onChange?<>
   <div className="fs-royal-profile-grid fs-financial-policy-grid">
    <section className="card fs-panel"><h3 className="fs-royal-report-title"><RoyalIcon name="layers"/>{l('الإهلاك والعمر الاقتصادي','Depreciation and economic life')}</h3>
    <label className="fs-field"><span>{l('طريقة الإهلاك','Depreciation method')}</span><select value={p.depreciationMode} onChange={event=>patch({depreciationMode:event.target.value as typeof p.depreciationMode})}>
     <option value="LEGACY">{l('المنهج المرجعي المحفوظ','Saved reference method')}</option><option value="CAPPED">{l('قسط ثابت محدود بقيمة الأصل','Straight line capped at asset cost')}</option><option value="CLASSES">{l('حسب فئات الأصول','By asset class')}</option></select></label>
    {depreciationFields}
    <div className="fs-table-wrap fs-financial-assets" role="region" tabIndex={0} aria-label={l('أعمار فئات الأصول','Asset-class lives')}><table className="fs-table"><thead><tr>
     <th>{l('نوع الأصل','Asset class')}</th><th>{l('القيمة','Amount')} {currency}</th><th>{l('العمر بالسنوات','Life in years')}</th><th>{l('طريقة الإهلاك','Method')}</th>
    </tr></thead><tbody>{waterCapexItemKeys.filter(key=>e.capex[key]>0).map(key=><tr key={key}>
     <th scope="row">{l(...labels[key])}</th><td><bdi>{new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(e.capex[key])}</bdi></td>
     <td>{p.depreciationMode==='CLASSES'?<input aria-label={l('عمر الفئة بالسنوات','Class life in years')+' · '+l(...labels[key])} type="number" min={1} max={60} step={1} value={p.assetLives[key]??''} onChange={event=>patch({assetLives:{...p.assetLives,[key]:event.target.value===''?undefined:Math.min(60,Math.max(1,Math.trunc(Number(event.target.value)||1)))}})}/>:water.ops.life||'—'}</td>
     <td>{l('قسط ثابت','Straight line')}{p.depreciationMode!=='LEGACY'?' · '+l('محدود','capped'):''}</td>
    </tr>)}</tbody></table></div>
    <p className="fs-hint">{l('الأرض ورأس المال العامل خارج الإهلاك. يظهر الجدول تكلفة الفئة قبل توزيع الاحتياطي؛ يوزّع الاحتياطي نسبيًا على الأصول دون التراخيص. لا يمحو تبديل المنهج الأعمار السابقة.','Land and working capital are not depreciated. Class costs are shown before allocating contingency proportionately to assets excluding licences. Switching methods retains prior lives.')}</p>
    </section>
    <section className="card fs-panel"><h3 className="fs-royal-report-title"><RoyalIcon name="coins"/>{l('سياسة رأس المال العامل','Working capital policy')}</h3>
    <label className="fs-field"><span>{l('أساس رأس المال العامل','Working capital method')}</span><select value={p.workingCapitalMode} onChange={event=>patch({workingCapitalMode:event.target.value as typeof p.workingCapitalMode})}>
     <option value="PERCENT">{l('نسبة من المبيعات','Percentage of sales')}</option><option value="CYCLE">{l('أيام التحصيل والمخزون والموردين','Collection, inventory and supplier days')}</option></select></label>
   {p.workingCapitalMode==='CYCLE'&&<><div className="fs-form-grid fs-financial-cycle-fields">
    <label className="fs-field"><span>{l('أيام التحصيل المستخدمة','Effective collection days')}</span><input type="number" min={0} max={3650} step={1} value={water.operationsPlan?.collectionDays??''} onChange={event=>onChange({...water,operationsPlan:{sourceName:'',permitReference:'',packagingLossPct:0,kwhPerThousandBottles:0,cartonsPerTrip:0,roundTripKm:0,...water.operationsPlan,collectionDays:event.target.value===''?undefined:Math.min(3650,Math.max(0,Math.trunc(Number(event.target.value)||0)))}})}/></label>
    {num(l('أيام المخزون','Inventory days'),p.inventoryDays,n=>patch({inventoryDays:n}))}
    {num(l('أيام ائتمان الموردين','Supplier credit days'),p.payableDays,n=>patch({payableDays:n}))}
    <label className="fs-field"><span>{l('أيام السنة الحسابية','Calculation year days')}</span><select value={p.daysPerYear} onChange={event=>patch({daysPerYear:Number(event.target.value) as 360|365})}><option value={365}>365</option><option value={360}>360</option></select></label>
   </div><p className="fs-hint">{l('الذمم = صافي المبيعات × أيام التحصيل ÷ أيام السنة. المخزون وائتمان الموردين على تكلفة الإنتاج المتغيرة. صافي الدورة = الذمم + المخزون − الموردين، وقد يكون سالبًا. هذا تقدير سنوي مستقر، ولا يمثل جدول فواتير شهريًا أو أجلًا يتجاوز سنة.','Receivables = net sales × collection days ÷ year days. Inventory and supplier credit use variable production cost. Net cycle = receivables + inventory − payables and may be negative. This is an annual steady-state estimate, not a monthly invoice schedule or terms exceeding one year.')}</p></>}
    {workingCapitalFields}
    <p className="fs-hint">{l('رأس المال العامل الأولي مموّل عند التأسيس، ثم يدخل تغير الرصيد السنوي فقط في التدفق. تُحفظ النسبة السابقة عند اختيار الأيام. ائتمان الموردين يحتاج ترتيبات موثقة.','Opening working capital is funded at inception; only annual balance movements enter cash flow. Selecting days retains the saved percentage. Supplier credit requires documented arrangements.')}</p>
    </section>
   </div>
   <details className="card fs-panel fs-financial-policy-settings"><summary>{l('افتراضات الخصم والضريبة والتخارج ومصادرها','Discount, tax and terminal assumptions and evidence')}</summary>
   {settings}
   <div className="fs-form-grid">
    {num(l('استرداد رأس المال العامل عند النهاية %','Terminal working capital recovery %'),p.workingCapitalRecoveryPct,n=>patch({workingCapitalRecoveryPct:n}),100)}
    <label className="fs-field"><span>{l('صافي حصيلة بيع الأصول والأرض عند النهاية','Net terminal asset and land sale proceeds')}</span><input type="number" min={0} max={1e12} value={p.terminalAssetProceeds} onChange={event=>patch({terminalAssetProceeds:Math.min(1e12,Math.max(0,Number(event.target.value)||0))})}/></label>
   </div>
   <p className="fs-hint">{l('حصيلة البيع صافية بعد الضرائب والتكاليف، ولا تشمل رأس المال العامل المسترد. لا تضاف قيمة الأرض مرة أخرى تلقائيًا. استرداد رأس مال عامل سالب يعني سداد ائتمان الموردين. تُستبعد حصيلة التخارج والتصفية من DSCR التشغيلي.','Enter sale proceeds net of taxes/costs, excluding working capital recovery. Land is not added again automatically. Recovering negative working capital settles supplier credit. Terminal sale/liquidation proceeds are excluded from operating DSCR.')}</p>
   <label className="fs-field"><span>{l('مصادر افتراضات السياسة المالية','Financial policy assumption evidence')}</span><textarea maxLength={3000} value={p.evidence} onChange={event=>patch({evidence:event.target.value})}/></label>
   </details>
  </>:<>
   <h3 className="fs-royal-report-title"><RoyalIcon name="coins"/>{l('منهج رأس المال العامل والإهلاك','Working capital and depreciation policy')}</h3>
   <dl className="fs-royal-checks">{details.map(([name,value])=><div key={name}><dt>{name}</dt><dd><bdi>{value}</bdi></dd></div>)}</dl>
   {p.workingCapitalMode==='CYCLE'&&<p>{l('أيام التحصيل / المخزون / الموردين / السنة','Collection / inventory / payables / year days')}: <bdi>{water.operationsPlan?.collectionDays??'—'} / {p.inventoryDays} / {p.payableDays} / {p.daysPerYear}</bdi></p>}
   {p.depreciationMode==='CLASSES'&&<ul>{waterCapexItemKeys.filter(key=>e.capex[key]>0).map(key=><li key={key}>{l(...labels[key])}: {p.assetLives[key]??'—'} {l('سنة','years')}</li>)}</ul>}
   <p>{l('مصدر الافتراضات','Assumption evidence')}: {p.evidence||l('غير موثّق','Not documented')}</p>
   <p className="fs-hint">{l('الذمم على صافي المبيعات؛ المخزون والموردون على تكلفة الإنتاج المتغيرة. التخارج صافي بعد الضرائب والتكاليف، مستقل عن رأس المال العامل، ولا يضاف إلى DSCR التشغيلي.','Receivables use net sales; inventory and payables use variable production cost. Terminal asset proceeds are net of taxes/costs, separate from working capital recovery, and excluded from operating DSCR.')}</p>
  </>}
  {!state.ready&&<ul role="alert">{state.issues.map(code=>{const [key,item]=code.split(':'),pair=issues[key];return <li key={code}>{pair?l(...pair):code}{item?' · '+l(...labels[item as keyof typeof labels]):''}</li>})}</ul>}
 </section>;
}
