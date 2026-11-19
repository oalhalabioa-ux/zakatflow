'use client';
import {evaluateQuantityBudget,quantityIssueLabel,type QuantityBudget,type QuantityLine} from '@/lib/feasibility/quantity-costs';
export default function QuantityBudgetEditor({value,onChange,context,categories,bases,locale,title,presets,allowPhasing=false}:{
 value:QuantityBudget;onChange:(v:QuantityBudget)=>void;context:Partial<Record<QuantityLine['basis'],number>>;
 categories:readonly [string,string,string][];bases:readonly [QuantityLine['basis'],string,string][];locale:string;title:string;presets?:QuantityLine[];allowPhasing?:boolean;
}){
 const ar=locale==='ar',l=(a:string,e:string)=>ar?a:e,result=evaluateQuantityBudget(value,context);
 const patch=(id:string,p:Partial<QuantityLine>)=>onChange({...value,items:value.items.map(x=>x.id===id?{...x,...p}:x)});
 return <section className="card fs-panel"><h3>{title}</h3>
  <label className="fs-check"><input type="checkbox" checked={value.enabled} onChange={e=>onChange({...value,enabled:e.target.checked})}/>{l('استخدام الكميات بدل المبلغ اليدوي — لا تجمع الطريقتين','Use quantities instead of manual amounts — never add both')}</label>
  <p className="fs-hint">{l('الكمية يدوية أو معامل يُضرب في الأساس المختار. أدخل وحدة القياس والمواصفات ومصدر السعر. القيم اليدوية السابقة محفوظة عند إيقاف هذا الوضع.','Quantity is manual or a multiplier of the selected basis. Record units, specifications and price evidence. Prior manual values are retained when this mode is off.')}</p>
  {value.items.map((row,i)=><fieldset className="fs-panel" key={row.id}><legend>{l('بند','Item')} {i+1}</legend><div className="fs-form-grid">
   <label className="fs-field"><span>{l('الوصف والمواصفات','Description and specifications')}</span><input value={row.name} maxLength={300} onChange={e=>patch(row.id,{name:e.target.value})}/></label>
   <label className="fs-field"><span>{l('التصنيف','Category')}</span><select value={row.category} onChange={e=>patch(row.id,{category:e.target.value})}>{categories.map(([v,a,b])=><option key={v} value={v}>{l(a,b)}</option>)}</select></label>
   <label className="fs-field"><span>{l('أساس الكمية','Quantity basis')}</span><select value={row.basis} onChange={e=>patch(row.id,{basis:e.target.value as QuantityLine['basis']})}>{bases.map(([v,a,b])=><option key={v} value={v}>{l(a,b)}</option>)}</select></label>
   <label className="fs-field"><span>{l('الكمية أو المعامل','Quantity or multiplier')}</span><input type="number" min={0} max={1e12} value={row.quantity} onChange={e=>patch(row.id,{quantity:Math.max(0,Number(e.target.value)||0)})}/></label>
   <label className="fs-field"><span>{l('الوحدة','Unit')}</span><input value={row.unit} maxLength={60} onChange={e=>patch(row.id,{unit:e.target.value})}/></label>
   <label className="fs-field"><span>{l('سعر الوحدة','Unit price')}</span><input type="number" min={0} max={1e12} value={row.unitCost} onChange={e=>patch(row.id,{unitCost:Math.max(0,Number(e.target.value)||0)})}/></label>
   <label className="fs-field"><span>{l('مرجع السعر وتاريخه','Price reference and date')}</span><input value={row.source} maxLength={1000} onChange={e=>patch(row.id,{source:e.target.value})}/></label>
   <p>{l('الكمية الفعلية × السعر','Effective quantity × price')}: <bdi>{result.rows[i].effectiveQuantity} × {row.unitCost} = {result.rows[i].total}</bdi></p>
  </div>{allowPhasing&&<><label className="fs-check"><input type="checkbox" checked={!!row.phasing} onChange={e=>patch(row.id,{phasing:e.target.checked?[.25,.25,.25,.25]:undefined})}/>{l('توزيع مراحل مستقل لهذا البند','Separate phasing for this item')}</label>
   {row.phasing&&<div className="fs-form-grid">{row.phasing.map((v,index)=><label className="fs-field" key={index}><span>{l('مرحلة البند','Item stage')} {index+1} %</span><input type="number" min={0} max={100} value={v*100} onChange={e=>{const next=[...row.phasing!] as NonNullable<QuantityLine['phasing']>;next[index]=Math.min(100,Math.max(0,Number(e.target.value)||0))/100;patch(row.id,{phasing:next})}}/></label>)}</div>}</>}
  <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>onChange({...value,items:value.items.filter(x=>x.id!==row.id)})}>{l('حذف بند الكميات','Remove quantity item')}</button></fieldset>)}
  <button type="button" className="fs-btn fs-btn--secondary" disabled={value.items.length>=100} onClick={()=>onChange({...value,items:[...value.items,{id:crypto.randomUUID(),name:'',category:categories[0][0],basis:'MANUAL',quantity:1,unit:'',unitCost:0,source:''}]})}>{l('إضافة بند كميات','Add quantity item')}</button>
  {presets&&value.items.length===0&&<button type="button" className="fs-btn fs-btn--secondary" onClick={()=>onChange({...value,items:presets})}>{l('إضافة بنود القالب دون أسعار','Add unpriced template items')}</button>}
  <strong>{l('المجموع المحسوب','Calculated total')}: <bdi>{result.total}</bdi></strong>
  {value.enabled&&!result.ready&&<ul role="alert">{result.blockers.map((code,i)=><li key={i}>{quantityIssueLabel(code,locale,value.items)}</li>)}</ul>}
 </section>;
}
