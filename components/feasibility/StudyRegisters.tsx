'use client';
import {useState,type ReactNode} from 'react';
import {
 waterFactoryLegalItems,type FeasibilityStudy,type StudyTask,type LegalItem,type StudyRisk,type StudySupplier,type StudyDecision
} from '@/lib/feasibility/engine';
import SupplierComparisonPanel from './SupplierComparisonPanel';
import {RoyalIcon} from './RoyalIcon';

type Labels=readonly [string,string];
const taskStatuses={TODO:['لم يبدأ','To do'],IN_PROGRESS:['جارٍ','In progress'],BLOCKED:['معلق','Blocked'],DONE:['مكتمل','Done']} as const;
const priorities={HIGH:['عالية','High'],NORMAL:['متوسطة','Normal'],LOW:['منخفضة','Low']} as const;
const legalStatuses={NOT_STARTED:['لم يبدأ','Not started'],UNDER_REVIEW:['قيد الفحص','Under review'],VERIFIED:['متحقق منه','Verified'],BLOCKED:['معلق','Blocked']} as const;
const riskStatuses={OPEN:['مفتوح','Open'],MITIGATED:['تمت المعالجة','Mitigated']} as const;
const quoteStatuses={NEW:['مستلم','Received'],REVIEW:['قيد المقارنة','Under review'],SELECTED:['مختار','Selected'],REJECTED:['مستبعد','Rejected']} as const;
const decisionStatuses={OPEN:['بانتظار الحسم','Pending'],AGREED:['متفق عليه','Agreed'],DONE:['منفّذ','Done']} as const;

function TextField({label,value,onChange,type='text',maxLength=5000}:{
 label:string;value?:string;onChange:(value:string)=>void;type?:'text'|'date'|'textarea';maxLength?:number
}){
 return <label className="fs-field"><span>{label}</span>{type==='textarea'?
  <textarea maxLength={maxLength} value={value??''} onChange={e=>onChange(e.currentTarget.value)}/>:
  <input type={type} maxLength={maxLength} value={value??''} onChange={e=>onChange(e.currentTarget.value)}/>}
 </label>;
}

function NumberField({label,value,onChange,min=0,max=1e12}:{
 label:string;value?:number;onChange:(value:number)=>void;min?:number;max?:number
}){
 return <label className="fs-field"><span>{label}</span>
  <input type="number" min={min} max={max} step={min===1?1:'any'} value={value??0}
   onChange={e=>{
    const v=Math.max(min,Math.min(max,Number(e.currentTarget.value)||0));
    onChange(min===1?Math.trunc(v):v);
   }}/>
 </label>;
}

function Choice<T extends string>({label,value,options,locale,onChange}:{
 label:string;value:T;options:Readonly<Record<T,Labels>>;locale:string;onChange:(value:T)=>void
}){
 return <label className="fs-field"><span>{label}</span><select value={value} onChange={e=>onChange(e.currentTarget.value as T)}>
  {(Object.keys(options) as T[]).map(key=><option key={key} value={key}>{options[key][locale==='ar'?0:1]}</option>)}
 </select></label>;
}

export default function StudyRegisters({study,tab,locale,onChange,evidence=false}:{
 study:FeasibilityStudy;tab:'legal'|'tasks'|'risks'|'suppliers'|'decisions';evidence?:boolean;locale:string;onChange:(patch:Partial<FeasibilityStudy>)=>void
}){
 const l=(ar:string,en:string)=>locale==='ar'?ar:en;
 const [query,setQuery]=useState('');
 const [group,setGroup]=useState('');
 const [taskStatus,setTaskStatus]=useState('');
 const owner=l('المسؤول','Owner'),due=l('الموعد','Due date'),status=l('الحالة','Status');
 const id=()=>crypto.randomUUID();
 const filter=(fields:Array<string|undefined>)=>fields.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
 const groupField=(label:string,groups:(string|undefined)[])=>
  <label className="fs-field"><span>{label}</span><select value={group} onChange={e=>setGroup(e.currentTarget.value)}>
   <option value="">{l('الكل','All')}</option>
   {[...new Set(groups.filter(Boolean))].map(value=><option key={value}>{value}</option>)}
  </select></label>;
 const search=<TextField label={l('بحث','Search')} value={query} onChange={setQuery}/>;
 const add=(label:string,save:()=>void,limit:boolean)=>
  <button type="button" className="fs-btn fs-btn--secondary" onClick={save} disabled={limit}>{label}</button>;
 const row=(rowId:string,label:string,fields:ReactNode,remove:()=>void)=>
  <details className="fs-register-row" key={rowId}>
   <summary>{label||l('سجل بلا عنوان','Untitled record')}</summary>
   <div className="fs-form-grid">{fields}</div>
   <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>{
    if(window.confirm(l('حذف هذا السجل؟','Delete this record?')))remove();
   }}>{l('حذف','Delete')}</button>
  </details>;
 const comparison=(headers:string[],rows:{id:string;cells:ReactNode[]}[])=>rows.length>0&&
  <div className="fs-table-wrap"><table className="fs-table"><thead><tr>{headers.map(header=><th key={header} scope="col">{header}</th>)}</tr></thead>
   <tbody>{rows.map(({id,cells})=><tr key={id}>{cells.map((cell,index)=>index===0?<th scope="row" key={index}>{cell}</th>:<td key={index}>{cell}</td>)}</tr>)}</tbody>
  </table></div>;
 const display=(label?:string)=>label||'—';

 if(tab==='legal'){
  const items=study.legal.filter(x=>!group||x.group===group);
  const addWater=waterFactoryLegalItems.filter(title=>!study.legal.some(x=>x.title===title));
  const completed=study.legal.filter(x=>x.critical&&x.status==='VERIFIED').length;
  const count=study.legal.filter(x=>x.critical).length;
  return <section className="card fs-panel">
   <h3>{evidence?l('أدلة التراخيص والمستندات','Licensing evidence and documents'):l('الفحص القانوني والتراخيص','Legal and licensing checklist')}</h3>
   <p>{l('تحقق من المستندات والمتطلبات السارية في موقع المشروع مع مختص محلي.','Verify documents and current requirements at the project location with a local specialist.')}</p>
   <div className="fs-kpis">{(Object.keys(legalStatuses) as Array<keyof typeof legalStatuses>).map(key=>
    <div className="fs-metric" key={key}><small>{legalStatuses[key][locale==='ar'?0:1]}</small>
     <strong>{study.legal.filter(item=>item.status===key).length}</strong></div>)}</div>
   {count>0&&<p>{l('البنود الحاسمة المتحقق منها','Critical checks verified')} · {completed}/{count}</p>}
   {comparison([l('المتطلب','Requirement'),l('الملف','Group'),status,owner,due,l('مرجع المستند','Evidence reference')],items.map(item=>({
    id:item.id,cells:[item.title,display(item.group),legalStatuses[item.status][locale==='ar'?0:1],display(item.owner),display(item.due),display(item.notes)]
   })))}
   {groupField(l('الملف','Group'),study.legal.map(x=>x.group))}
   {items.map(x=>{
    const set=(patch:Partial<LegalItem>)=>onChange({legal:study.legal.map(item=>item.id===x.id?{...item,...patch}:item)});
    return row(x.id,x.title,<>
     <TextField label={l('المتطلب','Requirement')} value={x.title} maxLength={500} onChange={title=>set({title})}/>
     <TextField label={l('الملف','Group')} value={x.group} onChange={group=>set({group})}/>
     <Choice label={status} value={x.status} options={legalStatuses} locale={locale} onChange={status=>set({status})}/>
     <TextField label={owner} value={x.owner} onChange={owner=>set({owner})}/>
     <TextField label={due} type="date" value={x.due} onChange={due=>set({due})}/>
     <TextField label={l('مرجع المستند','Evidence reference')} value={x.notes} onChange={notes=>set({notes})}/>
     <TextField label={l('وصف الفحص','Check description')} value={x.description} onChange={description=>set({description})}/>
     <label className="fs-check"><input type="checkbox" checked={x.critical??false}
      onChange={e=>set({critical:e.currentTarget.checked})}/>{l('بند حاسم','Critical requirement')}</label>
    </>,()=>onChange({legal:study.legal.filter(item=>item.id!==x.id)}));
   })}
   <div className="fs-actions">
    {add(l('إضافة متطلب','Add requirement'),()=>onChange({legal:[...study.legal,{
     id:id(),title:l('متطلب جديد','New requirement'),status:'NOT_STARTED',notes:''
    }]}),study.legal.length>=500)}
    {study.sector==='INDUSTRIAL'&&add(l('إضافة متطلبات مصنع مياه','Add water factory requirements'),()=>onChange({
     legal:[...study.legal,...addWater.map(title=>({id:id(),title,status:'NOT_STARTED' as const,notes:''}))]
    }),!addWater.length||study.legal.length+addWater.length>500)}
   </div>
  </section>;
 }
 if(tab==='tasks'){
  const items=study.tasks.filter(x=>(!group||x.phase===group)&&(!taskStatus||x.status===taskStatus)&&filter([x.title,x.owner,x.notes,x.phase]));
  return <section className="card fs-panel">
   <h3>{l('الجدول التنفيذي والمهام','Tasks and milestones')}</h3>
   <div className="fs-form-grid">
    {search}{groupField(l('المجال','Phase'),study.tasks.map(x=>x.phase))}
    <Choice label={status} locale={locale} value={taskStatus as ''|StudyTask['status']} options={{'':['الكل','All'],...taskStatuses}} onChange={setTaskStatus}/>
   </div>
   <p>{items.length} / {study.tasks.length}</p>
   <div className="fs-royal-task-board" aria-label={l('لوحة المهام حسب الحالة','Task board by status')}>
   {(Object.keys(taskStatuses) as StudyTask['status'][]).map(key=>{
    const stage=items.filter(item=>item.status===key);
    return <section className="fs-royal-task-stage" key={key}><h4>{taskStatuses[key][locale==='ar'?0:1]} <b>{stage.length}</b></h4>
   {stage.map(x=>{
    const set=(patch:Partial<StudyTask>)=>onChange({tasks:study.tasks.map(item=>item.id===x.id?{...item,...patch}:item)});
    return row(x.id,x.title,<>
     <TextField label={l('عنوان المهمة','Task title')} value={x.title} maxLength={400} onChange={title=>set({title})}/>
     <TextField label={l('المجال','Phase')} value={x.phase} onChange={phase=>set({phase})}/>
     <Choice label={l('الأولوية','Priority')} value={x.priority} options={priorities} locale={locale} onChange={priority=>set({priority})}/>
     <Choice label={status} value={x.status} options={taskStatuses} locale={locale} onChange={status=>set({status})}/>
     <TextField label={owner} value={x.owner} maxLength={300} onChange={owner=>set({owner})}/>
     <TextField label={due} type="date" value={x.due} onChange={due=>set({due})}/>
     <TextField label={l('الملاحظات','Notes')} value={x.notes} onChange={notes=>set({notes})}/>
    </>,()=>onChange({tasks:study.tasks.filter(item=>item.id!==x.id)}));
   })}
    </section>;
   })}
   </div>
   {add(l('إضافة مهمة','Add task'),()=>{setQuery('');setGroup('');setTaskStatus('');onChange({tasks:[...study.tasks,{
    id:id(),title:l('مهمة جديدة','New task'),owner:'',due:'',status:'TODO',priority:'NORMAL'
   }]});},study.tasks.length>=500)}
  </section>;
 }
 if(tab==='risks'){
  const items=study.risks.filter(x=>filter([x.title,x.owner,x.category,x.response])).sort((a,b)=>b.impact*b.likelihood-a.impact*a.likelihood);
  return <section className="card fs-panel">
   <h3>{l('سجل المخاطر','Risk register')}</h3>{search}
   <div className="fs-columns">
   <figure className="fs-royal-risk">
    <figcaption><RoyalIcon name="shield"/>{l('مصفوفة المخاطر (5×5)','Risk matrix (5×5)')}</figcaption>
    <table className="fs-royal-risk-table">
     <caption>{l('درجة الخطورة حسب الاحتمال والأثر','Risk score by likelihood and impact')}</caption>
     <thead><tr><th scope="col">{l('الأثر / الاحتمال','Impact / likelihood')}</th>
      {[1,2,3,4,5].map(value=><th scope="col" key={value}>{value}</th>)}</tr></thead>
     <tbody>{[5,4,3,2,1].map(impact=><tr key={impact}><th scope="row">{impact}</th>
      {[1,2,3,4,5].map(likelihood=>{
       const selected=items.filter(item=>item.status!=='MITIGATED'&&item.impact===impact&&item.likelihood===likelihood);
       const score=impact*likelihood;
       return <td key={likelihood} data-level={score>16?'critical':score>11?'high':score>5?'medium':'low'}
        title={selected.map(item=>item.title).join(' · ')||undefined}><b>{score}</b>{selected.length>0&&<small> · {selected.length}</small>}</td>;
      })}</tr>)}</tbody>
    </table>
   </figure>
   <section className="card fs-panel">
    <h4>{l('مؤشرات المخاطر المفتوحة','Open risk indicators')}</h4>
    {([
     [l('عالية جدًا','Critical'),17,25],[l('عالية','High'),12,16],
     [l('متوسطة','Medium'),6,11],[l('منخفضة','Low'),1,5]
    ] as const).map(([label,min,max])=><div className="fs-row" key={label}>
     <span>{label}</span><strong>{items.filter(item=>item.status!=='MITIGATED'&&item.impact*item.likelihood>=min&&item.impact*item.likelihood<=max).length}</strong>
    </div>)}
   </section>
   </div>
   {comparison([l('الخطر','Risk'),l('الاحتمال','Likelihood'),l('الأثر','Impact'),l('الدرجة','Score'),l('إجراء المعالجة','Mitigation')],items.map(item=>({
    id:item.id,cells:[item.title,item.likelihood,item.impact,item.likelihood*item.impact,display(item.response)]
   })))}
   {items.map(x=>{
    const set=(patch:Partial<StudyRisk>)=>onChange({risks:study.risks.map(item=>item.id===x.id?{...item,...patch}:item)});
    return row(x.id,x.title,<>
     <TextField label={l('الخطر','Risk')} value={x.title} maxLength={500} onChange={title=>set({title})}/>
     <TextField label={l('المجال','Category')} value={x.category} onChange={category=>set({category})}/>
     <NumberField label={l('الاحتمال','Likelihood')} value={x.likelihood} min={1} max={5} onChange={likelihood=>set({likelihood})}/>
     <NumberField label={l('الأثر','Impact')} value={x.impact} min={1} max={5} onChange={impact=>set({impact})}/>
     <p>{l('درجة الخطر','Risk score')} <strong>{x.impact*x.likelihood}/25</strong></p>
     <TextField label={l('إجراء المعالجة','Mitigation')} value={x.response} onChange={response=>set({response})}/>
     <TextField label={owner} value={x.owner} onChange={owner=>set({owner})}/>
     <Choice label={status} value={x.status??'OPEN'} options={riskStatuses} locale={locale} onChange={status=>set({status})}/>
    </>,()=>onChange({risks:study.risks.filter(item=>item.id!==x.id)}));
   })}
   {add(l('إضافة خطر','Add risk'),()=>{setQuery('');onChange({risks:[...study.risks,{
    id:id(),title:l('خطر جديد','New risk'),likelihood:3,impact:3,response:'',status:'OPEN'
   }]});},study.risks.length>=500)}
  </section>;
 }
 if(tab==='suppliers')return <section className="card fs-panel">
  <h3>{l('عروض الموردين والمقاولين','Supplier and contractor offers')}</h3>
  {comparison([l('المورد','Vendor'),l('البند','Item'),l('القيمة','Quote value'),l('أيام التسليم','Delivery days'),l('الضمان','Warranty'),status],
   study.suppliers.map(item=>({id:item.id,cells:[display(item.vendor),display(item.item),item.offer+' '+study.currency,
    item.leadDays??'—',display(item.warranty),quoteStatuses[item.status??'NEW'][locale==='ar'?0:1]]})))}
  {study.suppliers.map(x=>{
   const set=(patch:Partial<StudySupplier>)=>onChange({suppliers:study.suppliers.map(item=>item.id===x.id?{...item,...patch}:item)});
   return row(x.id,[x.vendor,x.item].filter(Boolean).join(' · '),<>
    <TextField label={l('المورد','Vendor')} value={x.vendor} maxLength={300} onChange={vendor=>set({vendor})}/>
    <TextField label={l('البند','Item')} value={x.item} maxLength={500} onChange={item=>set({item})}/>
    <NumberField label={l('القيمة','Quote value')} value={x.offer} onChange={offer=>set({offer})}/>
    <NumberField label={l('الطاقة في الساعة','Capacity per hour')} value={x.capacity} onChange={capacity=>set({capacity})}/>
    <NumberField label={l('أيام التسليم','Delivery days')} value={x.leadDays} onChange={leadDays=>set({leadDays})}/>
    <TextField label={l('الضمان','Warranty')} value={x.warranty} onChange={warranty=>set({warranty})}/>
    <TextField label={l('المرجع والملاحظات','Reference and notes')} value={x.notes} onChange={notes=>set({notes})}/>
    <Choice label={status} value={x.status??'NEW'} options={quoteStatuses} locale={locale} onChange={status=>set({status})}/>
   </>,()=>onChange({suppliers:study.suppliers.filter(item=>item.id!==x.id)}));
  })}
  {add(l('إضافة عرض','Add offer'),()=>onChange({suppliers:[...study.suppliers,{id:id(),vendor:'',item:'',offer:0,notes:''}]}),study.suppliers.length>=500)}
  <SupplierComparisonPanel suppliers={study.suppliers} currency={study.currency} locale={locale}/>
 </section>;
 return <section className="card fs-panel">
  <h3>{l('سجل القرارات ومحاضر الاجتماعات','Decision and meeting log')}</h3>
  {comparison([l('القرار','Decision'),l('التاريخ','Date'),owner,status,l('التفاصيل','Details')],study.decisions.map(item=>({
   id:item.id,cells:[item.title,display(item.date),display(item.owner),decisionStatuses[item.status??'OPEN'][locale==='ar'?0:1],display(item.notes)]
  })))}
  {study.decisions.map(x=>{
   const set=(patch:Partial<StudyDecision>)=>onChange({decisions:study.decisions.map(item=>item.id===x.id?{...item,...patch}:item)});
   return row(x.id,x.title,<>
    <TextField label={l('القرار','Decision')} value={x.title} maxLength={500} onChange={title=>set({title})}/>
    <TextField label={l('التاريخ','Date')} type="date" value={x.date} onChange={date=>set({date})}/>
    <TextField label={l('التفاصيل','Details')} type="textarea" value={x.notes} onChange={notes=>set({notes})}/>
    <TextField label={owner} value={x.owner} onChange={owner=>set({owner})}/>
    <Choice label={status} value={x.status??'OPEN'} options={decisionStatuses} locale={locale} onChange={status=>set({status})}/>
   </>,()=>onChange({decisions:study.decisions.filter(item=>item.id!==x.id)}));
  })}
  {add(l('إضافة قرار','Add decision'),()=>onChange({decisions:[...study.decisions,{
   id:id(),title:l('قرار جديد','New decision'),date:new Date().toISOString().slice(0,10),notes:'',status:'OPEN'
  }]}),study.decisions.length>=500)}
 </section>;
}
