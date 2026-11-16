'use client';
import {useId,useMemo,useState} from 'react';
import {Icon} from './FinancialReportsPilot';
import {StatementGroupToggle} from './SourceStatementTable';
import {STATEMENT_LINE_ICONS} from '../../lib/financial-statement-icons';
import {positionPreviewRows} from '../../lib/financial-position-preview';
import {statementHierarchy} from '../../lib/financial-statement-hierarchy';
import {reportVariance,type ReportLine} from '../../lib/financial-reporting-demo';
export default function PreviewPositionTable({lines,en,scale,unit,onDetail}:{lines:ReportLine[];en:boolean;scale:number;unit:string;onDetail:(s:string)=>void}){
 const[collapsed,setCollapsed]=useState<Set<string>>(()=>new Set()),prefix=useId().replaceAll(':','');
 const rows=useMemo(()=>positionPreviewRows(lines),[lines]),hierarchy=useMemo(()=>statementHierarchy(rows),[rows]);
 const t=(ar:string,english:string)=>en?english:ar,n=(v:number)=>v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const value=(v:number|null)=>v==null?'':v<0?'('+n(-v*scale)+')':n(v*scale);
 function toggle(id:string){setCollapsed(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next})}
 return <div className="fs-table-scroll fs-statement-tree fs-position-table"><table className="fs-table"><caption className="fs-sr-only">{t('قائمة اصطناعية — المبالغ ','Synthetic statement — amounts in ')+unit}</caption><thead><tr>{[t('البند','Item'),t('إيضاح','Note'),t('الفترة الحالية','Current period'),t('الفترة السابقة','Previous period'),t('التغير','Change'),t('نسبة التغير','Change %')].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row,index)=>{
  const children=hierarchy.descendants.get(row.id)??[],shown=collapsed.has(row.id)&&row.collapsedTotals?row.collapsedTotals:row,icon=STATEMENT_LINE_ICONS[row.id],label=en?row.en:row.ar;
  const ratio=(r:ReportLine)=>r.current==null||r.previous==null?null:reportVariance(r.current,r.previous);
  const cells=(r:ReportLine)=>[value(r.current),value(r.previous),r.current==null||r.previous==null?'':n((r.current-r.previous)*scale),ratio(r)==null?'':`${ratio(r)!>=0?'+':''}${n(ratio(r)!)}%`];
  const shownCells=cells(shown),fullCells=cells(row),display=<span className="fs-statement-row-label">{icon&&<Icon name={icon} size={19}/>}<span>{label}</span></span>;
  return <tr key={row.id} id={prefix+'-row-'+index} data-depth={hierarchy.ancestors.get(row.id)?.length??0} data-summary-for={row.summaryFor} hidden={hierarchy.hidden(row.id,collapsed)} className={'fs-row-'+row.kind+(row.parentId?' fs-row-child':'')}><th scope="row">{children.length?<StatementGroupToggle label={label} icon={icon} en={en} expanded={!collapsed.has(row.id)} controls={children.map(i=>prefix+'-row-'+i).join(' ')} onToggle={()=>toggle(row.id)}/>:row.kind==='section'?display:<button onClick={()=>onDetail(label+' — '+t('بيانات اصطناعية للمعاينة.','Synthetic preview data.'))}>{display}</button>}</th><td><button className="fs-note-link" onClick={()=>onDetail(t('إيضاح تجريبي؛ ليس إفصاحاً محاسبياً.','Illustrative note; not an accounting disclosure.'))}>({index+4})</button></td>{shownCells.map((text,i)=><td key={i}>{row.collapsedTotals?<><span className="fs-screen-group-value">{text}</span><span className="fs-print-group-value">{fullCells[i]}</span></>:text}</td>)}</tr>;
 })}</tbody></table></div>;
}
