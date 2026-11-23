'use client';

import {emptyWaterPackMix,type WaterPackLine,type WaterPackMix} from '@/lib/feasibility/water-pack-mix';
import {effectiveWaterInputs,type WaterModel} from '@/lib/feasibility/water-model';
import {quantityIssueLabel} from '@/lib/feasibility/quantity-costs';

function Numeric({label,value,onChange,max=1e12,integer=false}:{
 label:string;value:number;onChange:(value:number)=>void;max?:number;integer?:boolean;
}){
 return <label className="fs-field"><span>{label}</span><input type="number" min={0} max={max}
  inputMode={integer?'numeric':'decimal'} step={integer?1:'any'} value={value} onChange={event=>{
   const value=Math.min(max,Math.max(0,Number(event.currentTarget.value)||0));
   onChange(integer?Math.trunc(value):value);
  }}/></label>;
}

export default function WaterPackMixPanel({model,locale,currency,onChange}:{
 model:WaterModel;locale:string;currency:string;onChange:(mix:WaterPackMix)=>void;
}){
 const t=(ar:string,en:string)=>locale==='ar'?ar:en;
 const plan=model.packMix??emptyWaterPackMix;
 const {mix,readiness}=effectiveWaterInputs(model);
 const detailedCost=model.quantityCosting?.materialsEnabled;
 const format=new Intl.NumberFormat(locale,{maximumFractionDigits:2});
 const set=(patch:Partial<WaterPackMix>)=>onChange({...plan,...patch});
 const setLine=(line:WaterPackLine)=>set({lines:plan.lines.map(item=>item.id===line.id?line:item)});
 return <section className="card fs-panel">
  <h4>{t('خطوط تعبئة المياه وأحجام العبوات','Water bottling lines and pack sizes')}</h4>
  <label className="fs-check"><input type="checkbox" checked={plan.enabled} onChange={event=>set({enabled:event.currentTarget.checked})}/>
   {t('استخدام خطوط وأحجام متعددة في التوقعات','Use multiple lines and pack sizes in forecasts')}</label>
  {mix&&<>
   <p className="fs-hint">{t('وزّع ساعات كل خط بين الأحجام. تُحسب المبيعات والتكلفة من كراتين كل حجم، ويُحسب طلب المصدر من لترات التعبئة قبل الفاقد.', 'Allocate line hours across sizes. Cartons by size drive revenue and cost. Filled litres before losses drive source demand.')}</p>
   {detailedCost&&<p className="fs-hint">{t('تُحسب تكلفة كل حجم من مدخلات المواد والطاقة والتوزيع في تفاصيل المصدر.', 'Costs by size use the materials, energy, and distribution inputs in the source details.')}</p>}
   {plan.lines.map((line,i)=>{
    const lineResult=mix.lines[i];
    const patch=(update:Partial<WaterPackLine>)=>setLine({...line,...update});
    return <section className="fs-panel" key={line.id}>
     <h5>{line.name||t('خط تعبئة','Bottling line')}</h5>
     <div className="fs-form-grid">
      <label className="fs-field"><span>{t('اسم خط التعبئة','Bottling line name')}</span><input maxLength={120} value={line.name} onChange={event=>patch({name:event.currentTarget.value})}/></label>
      <Numeric label={t('سرعة الخط (عبوات/ساعة)','Line rate (bottles/hour)')} value={line.bottlesPerHour} onChange={bottlesPerHour=>patch({bottlesPerHour})}/>
      <Numeric label={t('ساعات الخط يوميًا','Line hours per day')} value={line.hoursPerDay} max={24} onChange={hoursPerDay=>patch({hoursPerDay})}/>
     </div>
     <p className="fs-hint">{t('نسبة الساعات المخصصة','Allocated line hours')} <bdi>{format.format(lineResult.allocatedPct)}%</bdi></p>
     {lineResult.overallocated&&<p className="fs-hint" role="alert">{t('لا يمكن أن يتجاوز تخصيص الخط 100%.','Line allocations cannot exceed 100%.')}</p>}
     {line.packs.map((pack,index)=>{
      const edit=(update:Partial<typeof pack>)=>patch({packs:line.packs.map(item=>item.id===pack.id?{...item,...update}:item)});
      return <details key={pack.id} className="fs-panel" open>
       <summary>{pack.name||t('حجم عبوة','Pack size')}</summary>
       <div className="fs-form-grid">
        <label className="fs-field"><span>{t('اسم حجم العبوة','Pack name')}</span><input maxLength={120} value={pack.name} onChange={event=>edit({name:event.currentTarget.value})}/></label>
        <Numeric label={t('حصة الحجم من ساعات الخط %','Share of line hours %')} max={100} value={pack.allocationPct} onChange={allocationPct=>edit({allocationPct})}/>
        <label className="fs-field"><span>{t('سرعة هذا الحجم اختيارياً (عبوات/ساعة)','Optional pack rate (bottles/hour)')}</span>
         <input type="number" inputMode="decimal" min={0} max={1e12} step="any" value={pack.bottlesPerHour??''} onChange={event=>{
          const value=event.currentTarget.value;
          edit({bottlesPerHour:value===''?undefined:Math.min(1e12,Math.max(0,Number(value)||0))});
         }}/></label>
        <Numeric label={t('اللترات في العبوة','Litres per bottle')} value={pack.litersPerBottle} onChange={litersPerBottle=>edit({litersPerBottle})}/>
        <Numeric label={t('عدد العبوات في الكرتون','Bottles per carton')} value={pack.bottlesPerCarton} integer onChange={bottlesPerCarton=>edit({bottlesPerCarton})}/>
        <Numeric label={t('سعر بيع كرتون هذا الحجم','Pack selling price per carton')} value={pack.pricePerCarton} onChange={pricePerCarton=>edit({pricePerCarton})}/>
        {!detailedCost&&<Numeric label={t('التكلفة المتغيرة لكرتون هذا الحجم','Pack variable cost per carton')} value={pack.costPerCarton} onChange={costPerCarton=>edit({costPerCarton})}/>}
       </div>
       {!lineResult.incomplete&&!lineResult.overallocated&&<p className="fs-hint">
        {t('الطاقة اليومية قبل فاقد العبوات (كرتون)','Daily capacity before bottle loss (cartons)')}{' '}
        <bdi>{format.format(lineResult.packs[index].cartons)}</bdi>
       </p>}
       <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>patch({packs:line.packs.filter(item=>item.id!==pack.id)})}>{t('إزالة الحجم','Remove pack')}</button>
      </details>;
     })}
     <div className="fs-actions">
      <button type="button" className="fs-btn fs-btn--secondary" disabled={line.packs.length>=20} onClick={()=>patch({packs:[...line.packs,{
       id:crypto.randomUUID(),name:'',allocationPct:Math.max(0,100-lineResult.allocatedPct),
       litersPerBottle:0,bottlesPerCarton:0,pricePerCarton:0,costPerCarton:0
      }]})}>{t('إضافة حجم عبوة','Add pack size')}</button>
      <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>set({lines:plan.lines.filter(item=>item.id!==line.id)})}>{t('إزالة خط التعبئة','Remove bottling line')}</button>
     </div>
    </section>;
   })}
   <button type="button" className="fs-btn fs-btn--secondary" disabled={plan.lines.length>=20} onClick={()=>set({lines:[...plan.lines,{
    id:crypto.randomUUID(),name:'',bottlesPerHour:0,hoursPerDay:0,packs:[]
   }]})}>{t('إضافة خط تعبئة','Add bottling line')}</button>
   {!mix.ready&&<p className="fs-hint" role="status">{t('أكمل أسماء الخطوط وسرعتها وساعاتها، وبيانات الأحجام والتخصيص والأسعار.', 'Complete line names, rates and hours, and pack sizes, allocations and prices.')}</p>}
   {readiness.blockers.filter(code=>['PACK_MIX_INPUTS','LICENSED_WATER_CAPACITY','PUMP_CAPACITY','MATERIAL_INPUTS'].includes(code)).map(code=>
    <p className="fs-hint" key={code}>{quantityIssueLabel(code,locale)}</p>)}
   {mix.ready&&<div className="fs-kpis">
    <div className="fs-metric"><small>{t('الطاقة اليومية (عبوة)','Daily capacity (bottles)')}</small><strong><bdi>{format.format(mix.daily.bottles)}</bdi></strong></div>
    <div className="fs-metric"><small>{t('الطاقة اليومية (كرتون)','Daily capacity (cartons)')}</small><strong><bdi>{format.format(mix.daily.cartons)}</bdi></strong></div>
    <div className="fs-metric"><small>{t('متوسط التكلفة المتغيرة للكرتون','Weighted variable cost per carton')}</small><strong><bdi>{format.format(mix.daily.cost/mix.daily.cartons)} {currency}</bdi></strong></div>
   </div>}
  </>}
 </section>;
}
