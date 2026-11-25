'use client';
import {useState,type ReactNode} from 'react';
import {
 waterFactoryLegalItems,type FeasibilityStudy,type StudyTask,type LegalItem,type StudyRisk,type StudySupplier,type StudyDecision
} from '@/lib/feasibility/engine';
import {downloadFeasibilityCsv} from '@/lib/feasibility/report-export';
import {licenceReviewLabel,licenceReviewReason} from '@/lib/feasibility/licence-review';
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

export default function StudyRegisters({study,tab,locale,onChange,evidence=false,onOpenEvidence}:{
 study:FeasibilityStudy;tab:'legal'|'tasks'|'risks'|'suppliers'|'decisions';evidence?:boolean;locale:string;onChange:(patch:Partial<FeasibilityStudy>)=>void;
 onOpenEvidence?:(requirement:string)=>void;
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
 const row=(rowId:string,label:string,fields:ReactNode,remove:()=>void,metadata?:ReactNode)=>
  <details className="fs-register-row" key={rowId}>
   <summary>{label||l('سجل بلا عنوان','Untitled record')}{metadata}</summary>
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
 const badge=(label:string,tone:'green'|'gold'|'neutral')=><span className="fs-royal-tag" data-register-tone={tone}>{label}</span>;
 const summary=(values:readonly (readonly [string,ReactNode])[])=><dl className="fs-royal-checks">
  {values.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
 </dl>;

 if(tab==='legal'){
  const items=study.legal.filter(x=>!group||x.group===group);
  const addWater=waterFactoryLegalItems.filter(title=>!study.legal.some(x=>x.title===title));
  const outstanding=study.legal.filter(x=>x.critical&&licenceReviewReason(x)!==null);
  const referenced=study.legal.filter(x=>x.notes.trim());
  const requirementLabel=l('المتطلب','Requirement');
  const referenceLabel=l('مرجع المستند','Evidence reference');
  const labels=[requirementLabel,l('الملف','Group'),status,owner,due,referenceLabel];
  const values=(item:LegalItem)=>[item.title,item.group,legalStatuses[item.status][locale==='ar'?0:1],item.owner,item.due,item.notes];
  const metrics=[
   [l('إجمالي المتطلبات','Total requirements'),study.legal.length],
   [evidence?l('مستندات لها مراجع','Documents with references'):l('المتحقق منها','Verified'),
    evidence?referenced.length:study.legal.filter(item=>item.status==='VERIFIED'&&(!item.critical||licenceReviewReason(item)===null)).length],
   [l('تحت المراجعة','Under review'),study.legal.filter(item=>item.status==='UNDER_REVIEW').length],
   [evidence?l('متطلبات حاسمة مفتوحة','Open critical requirements'):l('متطلبات معلقة','Blocked requirements'),
    evidence?outstanding.length:study.legal.filter(item=>item.status==='BLOCKED').length]
  ] as const;
  const statusBadge=(item:LegalItem)=><td><span className="fs-royal-tag" data-legal-status={item.status}>
   {legalStatuses[item.status][locale==='ar'?0:1]}
  </span></td>;
  return <section className="fs-block fs-royal-licensing">
   <div className="fs-kpis fs-royal-overview-kpis">{metrics.map(([label,value],index)=>
    <div className="fs-metric" key={label}><RoyalIcon name={(['clipboard','check','file','alert'] as const)[index]}/><small>{label}</small><strong>{value}</strong></div>)}</div>
   <section className="card fs-panel">
   <h3 className="fs-royal-report-title"><RoyalIcon name="file"/>{evidence?l('سجل الموافقات والوثائق','Approvals and documents register'):l('سجل المتطلبات النظامية والتعاقدية','Legal and contractual requirements')}</h3>
   <p className="fs-hint">{l('تحقق من المستندات والمتطلبات السارية في موقع المشروع مع مختص محلي.','Verify documents and current requirements at the project location with a local specialist.')}</p>
   <div className="fs-form-grid">{groupField(l('المجال','Group'),study.legal.map(x=>x.group))}</div>
   {items.length>0&&<div className="fs-table-wrap fs-royal-licence-table" role="region"
    aria-label={evidence?l('سجل الموافقات والوثائق','Approvals and documents register'):l('سجل التراخيص','Licensing register')} tabIndex={0}>
    <table className="fs-table"><thead><tr>
     <th scope="col">{requirementLabel}</th><th scope="col">{l('المجال','Group')}</th>
     {!evidence&&<th scope="col">{status}</th>}
     <th scope="col">{owner}</th><th scope="col">{due}</th>
     <th scope="col">{evidence?referenceLabel:l('الأدلة والمرفقات','Evidence and attachments')}</th>
     {evidence&&<th scope="col">{status}</th>}
    </tr></thead><tbody>{items.map(item=><tr key={item.id}>
     <th scope="row">{item.title}</th><td>{display(item.group)}</td>{!evidence&&statusBadge(item)}
     <td>{display(item.owner)}</td><td><bdi>{display(item.due)}</bdi></td>
     <td><span>{display(item.notes)}</span>{!evidence&&onOpenEvidence&&<button type="button" className="fs-btn fs-btn--secondary"
      aria-label={l('أدلة المتطلب','Evidence for requirement')+' · '+item.title} onClick={()=>onOpenEvidence(item.id)}>
      <RoyalIcon name="file"/>{l('الأدلة','Evidence')}</button>}</td>
     {evidence&&statusBadge(item)}
    </tr>)}</tbody></table>
   </div>}
   {evidence&&<p className="fs-royal-licence-note"><RoyalIcon name="shield"/>
    {l('يتطلب اكتمال البند الحاسم التحقق منه وتسجيل مرجع المستند.','A critical requirement is complete after verification and recording its evidence reference.')}
   </p>}
   {items.length===0&&<p>{l('لا توجد متطلبات للعرض.','No requirements to display.')}</p>}
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
    {add(l('تصدير المتطلبات CSV','Export requirements CSV'),()=>downloadFeasibilityCsv('feasibility-licensing.csv',[labels,...items.map(values)]),items.length===0)}
   </div>
   </section>
   <div className="fs-royal-profile-grid">
    <section className="card fs-panel">
     <h3 className="fs-royal-report-title"><RoyalIcon name="check"/>{l('متطلبات حاسمة قبل الاستثمار','Critical requirements before investing')}</h3>
     {outstanding.length?<ul className="fs-royal-checks">{outstanding.map(item=><li key={item.id}>
      <span>{item.title}</span><strong data-complete={false}>{licenceReviewLabel(item,locale)}</strong>
     </li>)}</ul>:<p>{l('لا توجد متطلبات حاسمة مفتوحة في السجل.','No open critical requirements in the register.')}</p>}
    </section>
    <section className="card fs-panel">
     <h3 className="fs-royal-report-title"><RoyalIcon name="file"/>{l('أدلة التحقق المسجلة','Recorded evidence references')}</h3>
     {referenced.length?<dl className="fs-royal-checks">{referenced.map(item=><div key={item.id}>
      <dt>{item.title}</dt><dd>{item.notes}</dd>
     </div>)}</dl>:<p>{l('لم يُسجّل مرجع مستند بعد.','No evidence reference has been recorded.')}</p>}
    </section>
   </div>
  </section>;
 }
 if(tab==='tasks'){
  const items=study.tasks.filter(x=>(!group||x.phase===group)&&(!taskStatus||x.status===taskStatus)&&filter([x.title,x.owner,x.notes,x.phase]));
  const today=new Date().toISOString().slice(0,10);
  const open=study.tasks.filter(item=>item.status!=='DONE');
  const phases=[...new Set(study.tasks.flatMap(item=>item.phase?.trim()?[item.phase.trim()]:[]))];
  return <section className="fs-block fs-royal-register-layout">
   <section className="card fs-panel">
   <h3 className="fs-royal-report-title"><RoyalIcon name="clipboard"/>{l('لوحة المهام حسب الحالة','Task board by status')}</h3>
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
    </>,()=>onChange({tasks:study.tasks.filter(item=>item.id!==x.id)}),
     <span className="fs-royal-task-meta">
      <small>{[x.owner,x.due].filter(Boolean).join(' · ')}</small>
      {badge(priorities[x.priority][locale==='ar'?0:1],x.priority==='HIGH'?'gold':'neutral')}
     </span>);
   })}
    </section>;
   })}
   </div>
   {add(l('إضافة مهمة','Add task'),()=>{setQuery('');setGroup('');setTaskStatus('');onChange({tasks:[...study.tasks,{
    id:id(),title:l('مهمة جديدة','New task'),owner:'',due:'',status:'TODO',priority:'NORMAL'
   }]});},study.tasks.length>=500)}
   </section>
   <div className="fs-royal-profile-grid">
    <section className="card fs-panel">
     <h3 className="fs-royal-report-title"><RoyalIcon name="layers"/>{l('مراحل المشروع','Project phases')}</h3>
     {phases.length?summary(phases.map(phase=>[phase,study.tasks.filter(task=>task.phase?.trim()===phase).length]))
      :<p>{l('لم تُسند مراحل إلى المهام بعد.','No tasks have been assigned to a phase.')}</p>}
    </section>
    <section className="card fs-panel">
     <h3 className="fs-royal-report-title"><RoyalIcon name="check"/>{l('إحصائيات المتابعة','Task tracking summary')}</h3>
     {summary([
      [l('مهام مفتوحة','Open tasks'),open.length],
      [l('مهام مكتملة','Completed tasks'),study.tasks.length-open.length],
      [l('مهام متأخرة','Overdue tasks'),open.filter(item=>item.due&&item.due<today).length],
      [l('مهام عالية الأولوية','High-priority tasks'),open.filter(item=>item.priority==='HIGH').length]
     ])}
    </section>
   </div>
  </section>;
 }
 if(tab==='risks'){
  const items=study.risks.filter(x=>filter([x.title,x.owner,x.category,x.response])).sort((a,b)=>b.impact*b.likelihood-a.impact*a.likelihood);
  const open=items.filter(item=>item.status!=='MITIGATED');
  const level=(score:number)=>score>16?l('عالية جدًا','Critical'):score>11?l('عالية','High'):score>5?l('متوسطة','Medium'):l('منخفضة','Low');
  return <section className="fs-block fs-royal-register-layout">
   <div className="fs-royal-profile-grid">
   <figure className="fs-royal-risk">
    <figcaption><RoyalIcon name="shield"/>{l('مصفوفة المخاطر (5×5)','Risk matrix (5×5)')}</figcaption>
    <table className="fs-royal-risk-table">
     <caption>{l('درجة الخطورة حسب الاحتمال والأثر','Risk score by likelihood and impact')}</caption>
     <thead><tr><th scope="col">{l('الأثر / الاحتمال','Impact / likelihood')}</th>
      {[1,2,3,4,5].map(value=><th scope="col" key={value}>{value}</th>)}</tr></thead>
     <tbody>{[5,4,3,2,1].map(impact=><tr key={impact}><th scope="row">{impact}</th>
      {[1,2,3,4,5].map(likelihood=>{
       const selected=open.filter(item=>item.impact===impact&&item.likelihood===likelihood);
       const score=impact*likelihood;
       return <td key={likelihood} data-level={score>16?'critical':score>11?'high':score>5?'medium':'low'}
        title={selected.map(item=>item.title).join(' · ')||undefined}><b>{score}</b>{selected.length>0&&<small> · {selected.length}</small>}</td>;
      })}</tr>)}</tbody>
    </table>
    <div className="fs-royal-stats fs-royal-risk-legend">
     {[1,6,12,17].map(score=><span key={score}>{level(score)}</span>)}
    </div>
   </figure>
   <section className="card fs-panel">
    <h4 className="fs-royal-report-title"><RoyalIcon name="shield"/>{l('مؤشرات المخاطر المفتوحة','Open risk indicators')}</h4>
    {summary(([
     [l('عالية جدًا','Critical'),17,25],[l('عالية','High'),12,16],
     [l('متوسطة','Medium'),6,11],[l('منخفضة','Low'),1,5]
    ] as const).map(([label,min,max])=>[label,open.filter(item=>item.impact*item.likelihood>=min&&item.impact*item.likelihood<=max).length]))}
    {open.some(item=>item.impact*item.likelihood>16)&&<p className="fs-hint">{l('راجع المخاطر الحرجة وخطط المعالجة قبل الاعتماد.','Review critical risks and mitigation plans before approval.')}</p>}
   </section>
   </div>
   <section className="card fs-panel">
   <h3 className="fs-royal-report-title"><RoyalIcon name="file"/>{l('سجل المخاطر وإجراءات المعالجة','Risk register and mitigation actions')}</h3>{search}
   {comparison([l('الخطر','Risk'),l('الاحتمال','Likelihood'),l('الأثر','Impact'),l('الدرجة','Score'),l('التصنيف','Rating'),l('إجراء المعالجة','Mitigation')],items.map(item=>({
    id:item.id,cells:[item.title,item.likelihood,item.impact,item.likelihood*item.impact,
     badge(level(item.likelihood*item.impact),item.likelihood*item.impact>11?'gold':'neutral'),display(item.response)]
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
   </section>
  </section>;
 }
 if(tab==='suppliers')return <section className="fs-block fs-royal-register-layout">
  <section className="card fs-panel">
  <h3 className="fs-royal-report-title"><RoyalIcon name="truck"/>{l('قائمة عروض الأسعار','Supplier quote list')}</h3>
  {comparison([l('المورد','Vendor'),l('البند','Item'),l('القيمة','Quote value'),l('أيام التسليم','Delivery days'),l('الضمان','Warranty'),status],
   study.suppliers.map(item=>({id:item.id,cells:[display(item.vendor),display(item.item),item.offer+' '+study.currency,
    item.leadDays??'—',display(item.warranty),badge(quoteStatuses[item.status??'NEW'][locale==='ar'?0:1],item.status==='SELECTED'?'green':item.status==='REVIEW'?'gold':'neutral')]})))}
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
  </section>
  <div className="fs-royal-profile-grid">
   <section className="card fs-panel">
    <h3 className="fs-royal-report-title"><RoyalIcon name="check"/>{l('عناصر مراجعة عروض الأسعار','Quote review criteria')}</h3>
    <ul className="fs-notes">
     <li>{l('قارن متطلبات البند والسعة والمواصفات.','Compare item requirements, capacity and specifications.')}</li>
     <li>{l('راجع السعر ومدة التسليم والضمان.','Review price, delivery time and warranty.')}</li>
    </ul>
   </section>
   <section className="card fs-panel"><SupplierComparisonPanel suppliers={study.suppliers} currency={study.currency} locale={locale}/></section>
  </div>
 </section>;
 return <section className="fs-block fs-royal-register-layout">
  <section className="card fs-panel">
  <h3 className="fs-royal-report-title"><RoyalIcon name="file"/>{l('سجل القرارات ومحاضر الاجتماعات','Decision and meeting log')}</h3>
  {comparison([l('القرار','Decision'),l('التاريخ','Date'),owner,status,l('التفاصيل','Details')],study.decisions.map(item=>({
   id:item.id,cells:[item.title,display(item.date),display(item.owner),badge(decisionStatuses[item.status??'OPEN'][locale==='ar'?0:1],item.status==='DONE'?'green':item.status==='AGREED'?'gold':'neutral'),display(item.notes)]
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
  </section>
  <section className="card fs-panel">
   <h3 className="fs-royal-report-title"><RoyalIcon name="check"/>{l('حالة القرارات المسجلة','Recorded decision status')}</h3>
   {summary((Object.keys(decisionStatuses) as StudyDecision['status'][]).flatMap(key=>key?[[
    decisionStatuses[key][locale==='ar'?0:1],study.decisions.filter(item=>(item.status??'OPEN')===key).length
   ] as const]:[]))}
  </section>
 </section>;
}
