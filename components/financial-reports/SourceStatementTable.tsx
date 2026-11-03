'use client';
import {useId,useMemo,useState} from 'react';
import Decimal from 'decimal.js';
import {validStatementComparison,statementChange} from '../../lib/financial-statement-comparison';
import {Icon} from './FinancialReportsPilot';
import {statementHierarchy} from '../../lib/financial-statement-hierarchy';
import {statementTreeRows,type StatementSourceSnapshot,type StatementView} from '../../lib/financial-statement-source';

const Money=Decimal.clone({precision:50});
export function statementAmount(value:string){const n=new Money(value),[whole,fraction]=n.abs().toFixed(2).split('.');const text=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+fraction;return n.isNegative()?'('+text+')':text}
export function StatementGroupToggle({label,icon,en,expanded,controls,onToggle}:{label:string;icon?:string;en:boolean;expanded:boolean;controls:string;onToggle:()=>void}){
 return <button type="button" className="fs-statement-group-toggle" aria-expanded={expanded} aria-controls={controls} aria-label={(en?(expanded?'Hide details: ':'Show details: '):(expanded?'إخفاء تفاصيل: ':'إظهار تفاصيل: '))+label} onClick={onToggle}><span className="fs-group-chevron"><Icon name="chevron" size={17}/></span><span className="fs-statement-row-label">{icon&&<Icon name={icon} size={19}/>}<span>{label}</span></span></button>;
}
export default function SourceStatementTable({snapshot,view,en,comparison}:{snapshot:StatementSourceSnapshot;view:StatementView;en:boolean;comparison?:StatementSourceSnapshot|null}){
 const[collapsed,setCollapsed]=useState<Set<string>>(()=>new Set()),prefix=useId().replaceAll(':','');
 const rows=useMemo(()=>statementTreeRows(snapshot,view,en),[snapshot,view,en]);
 const prior=validStatementComparison(snapshot,comparison),priorRows=useMemo(()=>new Map(prior?statementTreeRows(prior,view,en).map(r=>[r.id,r]):[]),[prior,view,en]);
 const hierarchy=useMemo(()=>statementHierarchy(rows),[rows]),children=hierarchy.descendants;
 const t=(ar:string,english:string)=>en?english:ar;
 function toggle(id:string){setCollapsed(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next})}
 return <div className={'fs-table-scroll fs-source-statement-table fs-statement-tree '+(view==='position'?'fs-position-table':'')}><table className="fs-table"><caption className="fs-sr-only">{snapshot.origin==='LIVE_CANONICAL_EVENTS'?t('قائمة من السجلات الفعلية — المبالغ','Live register statement — amounts in'):t('قائمة من أحداث اختبار محلية — المبالغ','Local test event statement — amounts in')} {snapshot.statements.currency}</caption><thead><tr><th>{t('البند','Item')}</th>{view==='position'&&<th>{t('إيضاح','Note')}</th>}<th>{t('الفترة الحالية','Current period')}</th><th>{t('الفترة السابقة','Previous period')}</th>{view==='position'&&<th>{t('التغير','Change')}</th>}<th>{t('نسبة التغير','Change %')}</th></tr></thead><tbody>{rows.map((row,index)=>{
  const childIndexes=children.get(row.id)??[],rowId=prefix+'-row-'+index,value=collapsed.has(row.id)&&row.collapsedValue!==undefined?row.collapsedValue:row.value,label=<span className="fs-statement-row-label">{row.icon&&<Icon name={row.icon} size={19}/>}<span>{row.label}</span></span>;
  const pr=priorRows.get(row.id),before=prior&&value!==''?(collapsed.has(row.id)&&pr?.collapsedValue!==undefined?pr.collapsedValue:pr?.value??'0.0000'):null,change=value!==''&&before!==null&&before!==''?statementChange(value,before):undefined;
  return <tr key={row.id} id={rowId} data-statement-row={row.id} data-parent-row={row.parentId} data-depth={hierarchy.ancestors.get(row.id)?.length??0} data-summary-for={row.summaryFor} hidden={hierarchy.hidden(row.id,collapsed)} className={'fs-row-'+row.kind+(row.parentId?' fs-row-child':'')}><th scope="row">{childIndexes.length?<StatementGroupToggle label={row.label} icon={row.icon} en={en} expanded={!collapsed.has(row.id)} controls={childIndexes.map(i=>prefix+'-row-'+i).join(' ')} onToggle={()=>toggle(row.id)}/>:label}</th>{view==='position'&&<td>—</td>}<td data-amount={value} data-canonical-amount={row.value} dir="ltr">{row.collapsedValue!==undefined?<><span className="fs-screen-group-value">{value?statementAmount(value):''}</span><span className="fs-print-group-value">{row.value?statementAmount(row.value):''}</span></>:value?statementAmount(value):''}</td><td dir="ltr">{before!==null&&before!==''?statementAmount(before):'—'}</td>{view==='position'&&<td dir="ltr">{change?statementAmount(change.delta):'—'}</td>}<td dir="ltr">{change?<b className={'fs-change '+(view==='position'?'neutral':change.tone)} data-trend={change.direction}>{change.direction==='up'?'▲':change.direction==='down'?'▼':'—'} {change.percentage===null?'—':change.text}</b>:'—'}</td></tr>;
 })}</tbody></table></div>;
}
