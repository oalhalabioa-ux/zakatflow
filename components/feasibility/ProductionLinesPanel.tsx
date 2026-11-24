'use client';

import {emptyProductionPlan,evaluateProductionPlan,type ProductionLine,type ProductionPlan,type ProductionProduct} from '@/lib/feasibility/production-lines';

function NumberField({label,value,change,max=1e12,integer=false,optional=false,min=0}:{
 label:string;value:number|undefined;change:(value:number|undefined)=>void;max?:number;integer?:boolean;optional?:boolean;min?:number
}){
 return <label className="fs-field"><span>{label}</span>
  <input type="number" inputMode={integer?'numeric':'decimal'} min={min} max={max} step={integer?1:'any'} value={value??''}
   onChange={event=>{
    const raw=event.currentTarget.value;
    if(raw===''&&optional){change(undefined);return;}
    const number=Number(raw);
    if(Number.isFinite(number))change(Math.min(max,Math.max(min,integer?Math.trunc(number):number)));
   }}/>
 </label>;
}

export default function ProductionLinesPanel({plan=emptyProductionPlan,locale,currency,onChange}:{
 plan?:ProductionPlan;locale:string;currency:string;onChange:(plan:ProductionPlan)=>void
}){
 const t=(ar:string,en:string)=>locale==='ar'?ar:en;
 const result=plan.enabled?evaluateProductionPlan(plan):null;
 const format=new Intl.NumberFormat(locale,{maximumFractionDigits:2});
 const units={KG:t('كغ','kg'),L:t('لتر','L'),UNIT:t('وحدة','unit')};
 const money=(amount:number)=>[format.format(amount),currency].filter(Boolean).join(' ');
 const set=(patch:Partial<ProductionPlan>)=>onChange({...plan,...patch});
 const setLine=(line:ProductionLine)=>set({lines:plan.lines.map(item=>item.id===line.id?line:item)});
 const addLine=()=>set({lines:[...plan.lines,{id:crypto.randomUUID(),name:'',basis:'HOURLY',capacity:0,hoursPerDay:0,utilizationPct:100,products:[]}]});
 const addProduct=(line:ProductionLine)=>setLine({...line,products:[...line.products,{
  id:crypto.randomUUID(),name:'',allocationPct:Math.max(0,100-line.products.reduce((total,item)=>total+item.allocationPct,0)),
  yieldPct:100,soldPct:100,pricePerTonne:0,packagingPerSaleableTonne:0,recipe:[]
 }]});
 const removeLabel=t('إزالة','Remove');
 return <section className="card fs-panel">
  <h3>{t('خطوط الإنتاج والمنتجات','Production lines and products')}</h3>
  <label className="fs-check"><input type="checkbox" checked={plan.enabled} onChange={event=>set({enabled:event.currentTarget.checked})}/>
   {t('استخدام خطة الإنتاج في توقعات الجدوى','Use the production plan in feasibility forecasts')}</label>
  {result&&<>
   <p className="fs-hint">{t('أدخل طاقة كل خط، ثم خصص نسبة من ساعاته أو طاقته اليومية لكل منتج. تُصرف تكلفة المواد على كامل الإنتاج وتكلفة التغليف على الإنتاج الصالح للبيع. الإيراد يحسب من الكمية المباعة فقط.','Set each line’s capacity and allocate its hours or daily capacity across products. Material cost applies to gross output, packaging to saleable output, and revenue to sales only.')}</p>
   <div className="fs-form-grid">
    <NumberField label={t('أيام التشغيل في الشهر','Operating days per month')} value={plan.daysPerMonth} integer min={1} max={31} change={n=>set({daysPerMonth:n??1})}/>
   </div>
   <details className="fs-panel">
    <summary>{t('دليل المواد وأسعارها','Material catalogue and prices')}</summary>
    {plan.materials.map(material=>{
     const patch=(p:Partial<typeof material>)=>set({materials:plan.materials.map(item=>item.id===material.id?{...item,...p}:item)});
     const used=plan.lines.some(line=>line.products.some(product=>product.recipe.some(row=>row.materialId===material.id)));
     return <div className="fs-form-grid" key={material.id}>
      <label className="fs-field"><span>{t('اسم المادة','Material name')}</span><input maxLength={120} value={material.name} onChange={e=>patch({name:e.currentTarget.value})}/></label>
      <label className="fs-field"><span>{t('وحدة قياس المادة','Material unit')}</span><select value={material.unit} disabled={used} onChange={e=>patch({unit:e.currentTarget.value as keyof typeof units})}>
       {Object.entries(units).map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select></label>
      <NumberField label={t('تكلفة وحدة المادة','Cost per material unit')} value={material.unitCost} change={n=>patch({unitCost:n??0})}/>
      <button type="button" className="fs-btn fs-btn--secondary" disabled={used}
       onClick={()=>set({materials:plan.materials.filter(item=>item.id!==material.id)})}>{t('إزالة المادة','Remove material')}</button>
     </div>;
    })}
    <button type="button" className="fs-btn fs-btn--secondary" disabled={plan.materials.length>=50}
     onClick={()=>set({materials:[...plan.materials,{id:crypto.randomUUID(),name:'',unit:'KG',unitCost:0}]})}>{t('إضافة مادة','Add material')}</button>
   </details>
   {plan.lines.map((line,index)=>{
    const lineResult=result.lines[index];
    const patch=(p:Partial<ProductionLine>)=>setLine({...line,...p});
    return <section key={line.id} className="fs-panel">
     <h4>{line.name||t('خط إنتاج','Production line')}</h4>
     <div className="fs-form-grid">
      <label className="fs-field"><span>{t('اسم الخط','Line name')}</span><input maxLength={120} value={line.name} onChange={e=>patch({name:e.currentTarget.value})}/></label>
      <label className="fs-field"><span>{t('أساس الطاقة','Capacity basis')}</span><select value={line.basis} onChange={e=>{
       const basis=e.currentTarget.value as ProductionLine['basis'];
       if(basis!==line.basis)patch({basis,capacity:0});
      }}>
       <option value="HOURLY">{t('طن/ساعة','Tonnes/hour')}</option><option value="DAILY">{t('طن/يوم','Tonnes/day')}</option>
      </select></label>
      <NumberField label={line.basis==='HOURLY'?t('سرعة الخط (طن/ساعة)','Line rate (tonnes/hour)'):t('طاقة الخط (طن/يوم)','Line capacity (tonnes/day)')}
       value={line.capacity} change={n=>patch({capacity:n??0})}/>
      {line.basis==='HOURLY'&&<NumberField label={t('ساعات التشغيل يوميًا','Operating hours per day')} max={24} value={line.hoursPerDay} change={n=>patch({hoursPerDay:n??0})}/>}
      <NumberField label={t('استغلال السعة %','Capacity utilization %')} max={100} value={line.utilizationPct} change={n=>patch({utilizationPct:n??0})}/>
     </div>
     <p className="fs-hint">{t('نسبة الخط المخصصة','Line allocated')} <bdi>{format.format(lineResult.allocation)}%</bdi></p>
     {lineResult.overallocated&&<p className="fs-hint" role="alert">{t('يجب ألا يتجاوز مجموع تخصيص المنتجات 100% لهذا الخط.','Product allocations cannot exceed 100% on this line.')}</p>}
     {lineResult.incomplete&&<p className="fs-hint">{t('أكمل اسم الخط والطاقة والمنتجات وأسعار البيع.','Complete the line name, capacity, products and selling prices.')}</p>}
     {line.products.map((product,productIndex)=>{
      const productResult=lineResult.products[productIndex];
      const edit=(p:Partial<ProductionProduct>)=>patch({products:line.products.map(item=>item.id===product.id?{...item,...p}:item)});
      const nextMaterial=plan.materials.find(material=>!product.recipe.some(row=>row.materialId===material.id));
      return <details className="fs-panel" key={product.id} open>
       <summary>{product.name||t('منتج','Product')}</summary>
       <div className="fs-form-grid">
        <label className="fs-field"><span>{t('اسم المنتج','Product name')}</span><input maxLength={120} value={product.name} onChange={e=>edit({name:e.currentTarget.value})}/></label>
        <NumberField label={line.basis==='HOURLY'?t('حصة المنتج من ساعات الخط %','Share of line hours %'):t('حصة المنتج من طاقة الخط %','Share of line capacity %')}
         max={100} value={product.allocationPct} change={n=>edit({allocationPct:n??0})}/>
        {line.basis==='HOURLY'&&<NumberField label={t('سرعة المنتج الاختيارية (طن/ساعة)','Optional product rate (tonnes/hour)')} optional value={product.tonnesPerHour} change={n=>edit({tonnesPerHour:n})}/>}
        <NumberField label={t('الناتج الصالح للبيع %','Saleable yield %')} max={100} value={product.yieldPct} change={n=>edit({yieldPct:n??0})}/>
        <NumberField label={t('نسبة المباع من الصالح للبيع %','Share of saleable output sold %')} max={100} value={product.soldPct} change={n=>edit({soldPct:n??0})}/>
        <NumberField label={t('سعر بيع الطن','Selling price per tonne')} value={product.pricePerTonne} change={n=>edit({pricePerTonne:n??0})}/>
        <NumberField label={t('تكلفة التغليف للطن الصالح للبيع','Packaging cost per saleable tonne')} value={product.packagingPerSaleableTonne} change={n=>edit({packagingPerSaleableTonne:n??0})}/>
       </div>
       {product.recipe.map(row=>{
        const material=plan.materials.find(item=>item.id===row.materialId);
        return <div className="fs-form-grid" key={row.materialId}>
         <NumberField label={t('كمية المادة لكل طن إنتاج إجمالي','Material quantity per gross tonne')+' · '+(material?.name||t('مادة','Material'))+' '+(material?units[material.unit]:'')}
          value={row.quantityPerGrossTonne} change={n=>edit({recipe:product.recipe.map(item=>item.materialId===row.materialId?{...item,quantityPerGrossTonne:n??0}:item)})}/>
         <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>edit({recipe:product.recipe.filter(item=>item.materialId!==row.materialId)})}>{t('إزالة من الوصفة','Remove from recipe')}</button>
        </div>;
       })}
       {nextMaterial&&<label className="fs-field"><span>{t('إضافة مادة للوصفة','Add recipe material')}</span>
        <select value="" onChange={event=>edit({recipe:[...product.recipe,{materialId:event.currentTarget.value,quantityPerGrossTonne:0}]})}>
         <option value="" disabled>{t('اختر مادة','Choose material')}</option>
         {plan.materials.filter(material=>!product.recipe.some(row=>row.materialId===material.id))
          .map(material=><option key={material.id} value={material.id}>{material.name||t('مادة بلا اسم','Unnamed material')}</option>)}
        </select>
       </label>}
       {!lineResult.overallocated&&!lineResult.incomplete&&<p className="fs-hint">
        {t('الإنتاج الشهري بالطن · المباع · الإيراد · التكلفة المباشرة · هامش المساهمة','Monthly tonnes produced · sold · revenue · direct cost · contribution')}{' '}
        <bdi>{format.format(productResult.gross)} · {format.format(productResult.sold)} · {money(productResult.revenue)} · {money(productResult.variable)} · {money(productResult.revenue-productResult.variable)}</bdi>
       </p>}
       <button type="button" className="fs-btn fs-btn--secondary"
        onClick={()=>patch({products:line.products.filter(item=>item.id!==product.id)})}>{t('إزالة المنتج','Remove product')}</button>
      </details>;
     })}
     <div className="fs-actions">
      <button type="button" className="fs-btn fs-btn--secondary" disabled={line.products.length>=20} onClick={()=>addProduct(line)}>{t('إضافة منتج','Add product')}</button>
      <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>set({lines:plan.lines.filter(item=>item.id!==line.id)})}>{t('إزالة الخط','Remove line')}</button>
     </div>
    </section>;
   })}
   <button type="button" className="fs-btn fs-btn--secondary" disabled={plan.lines.length>=20} onClick={addLine}>{t('إضافة خط إنتاج','Add production line')}</button>
   <details className="fs-panel">
    <summary>{t('مسير الرواتب الشهري','Monthly payroll')}</summary>
    {plan.payroll.map(role=>{
     const patch=(p:Partial<typeof role>)=>set({payroll:plan.payroll.map(item=>item.id===role.id?{...item,...p}:item)});
     return <div className="fs-form-grid" key={role.id}>
      <label className="fs-field"><span>{t('المسمى الوظيفي','Job title')}</span><input maxLength={120} value={role.name} onChange={e=>patch({name:e.currentTarget.value})}/></label>
      <NumberField label={t('عدد العاملين','Headcount')} integer max={100000} value={role.headcount} change={n=>patch({headcount:n??0})}/>
      <NumberField label={t('التكلفة الشهرية الشاملة للفرد','Total monthly cost per person')} value={role.monthlyCostPerPerson} change={n=>patch({monthlyCostPerPerson:n??0})}/>
      <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>set({payroll:plan.payroll.filter(item=>item.id!==role.id)})}>{removeLabel}</button>
     </div>;
    })}
    <button type="button" className="fs-btn fs-btn--secondary" disabled={plan.payroll.length>=50}
     onClick={()=>set({payroll:[...plan.payroll,{id:crypto.randomUUID(),name:'',headcount:0,monthlyCostPerPerson:0}]})}>{t('إضافة وظيفة','Add role')}</button>
    <p className="fs-hint">{t('إجمالي الرواتب الشهري','Monthly payroll total')} <bdi>{money(result.payroll)}</bdi></p>
    {result.payrollIncomplete&&<p className="fs-hint">{t('أكمل مسمى وتكلفة الوظائف التي حددت عدد العاملين فيها.','Complete the title and cost for staffed roles.')}</p>}
   </details>
   {!result.ready&&<p className="fs-hint" role="status">{t('أكمل خطة الخطوط والمواد والرواتب وأدخل كمية مباعة لإظهار توقعات الدراسة.','Complete lines, materials and payroll, and plan sales to show study forecasts.')}</p>}
   {result.ready&&<div className="fs-kpis">
    <div className="fs-metric"><small>{t('المباع شهريًا (طن)','Monthly sales (tonnes)')}</small><strong><bdi>{format.format(result.totals.sold)}</bdi></strong></div>
    <div className="fs-metric"><small>{t('الإيراد الشهري','Monthly revenue')}</small><strong><bdi>{money(result.totals.revenue)}</bdi></strong></div>
    <div className="fs-metric"><small>{t('التكلفة المباشرة الشهرية','Monthly direct cost')}</small><strong><bdi>{money(result.totals.variable)}</bdi></strong></div>
   </div>}
  </>}
 </section>;
}
