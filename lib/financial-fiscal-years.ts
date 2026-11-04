import {fiscalPeriod, type FiscalCalendar} from './financial-fiscal';

export type FiscalClosure={id:string;start:string;end:string;version:number;status:'CLOSED'|'SUPERSEDED'};
export type FiscalReference={start:string;source:'opening'|'policy'|'budget'|'assignment';status?:string};
export type FiscalManagementContext={
 organizationId:string;
 calendar:{start_month:number;start_day:number;retained_earnings_account:string;version:number}|null;
 period:{start:string;end:string}|null;
 closures:FiscalClosure[];
 canConfigure:boolean;canClose:boolean;
 references:FiscalReference[];
 asOf:string;
};
export function calendarFromContext(context:FiscalManagementContext):FiscalCalendar|null{
 const c=context.calendar;
 return c?{startMonth:c.start_month,startDay:c.start_day,retainedEarningsAccount:c.retained_earnings_account}:null;
}
export function fiscalReferencesMatch(calendar:FiscalCalendar,references:FiscalReference[]){
 return references.every(r=>fiscalPeriod(calendar,r.start).start===r.start);
}
/** Display projection only. This function never creates fiscal records or entries. */
export function fiscalYearRows(context:FiscalManagementContext,span=2){
 const calendar=calendarFromContext(context);
 if(!calendar)return[];
 const current=fiscalPeriod(calendar,context.asOf);
 const starts=new Set<string>();
 for(let offset=-Math.min(10,Math.max(0,span));offset<=Math.min(10,Math.max(0,span));offset++){
  const year=Number(current.start.slice(0,4))+offset;
  // Resolve at year-end to retain the shared leap-day anchor semantics.
  starts.add(fiscalPeriod(calendar,`${year}-12-31`).start);
 }
 context.closures.forEach(c=>starts.add(c.start));
 context.references.forEach(r=>starts.add(r.start));
 return [...starts].sort().map(start=>{
  const period=fiscalPeriod(calendar,start);
  const closure=context.closures.filter(c=>c.start===start&&c.status==='CLOSED').sort((a,b)=>b.version-a.version)[0];
  const references=context.references.filter(r=>r.start===start);
  const mismatch=period.start!==start;
  return {start,end:closure?.end??(mismatch?null:period.end),closure,
   status:closure?'CLOSED' as const:'OPEN' as const,
   phase:start===current.start?'CURRENT' as const:start>current.start?'FUTURE' as const:'PREVIOUS' as const,
   recorded:context.closures.some(c=>c.start===start)||references.length>0,
   mismatch,references,
   canClose:context.canClose&&!closure&&!mismatch&&period.end<context.asOf,
   canReopen:context.canClose&&!!closure,
  };
 });
}
export function fiscalCalendarLocked(context:FiscalManagementContext){
 return !!context.calendar&&(context.references.length>0||context.closures.length>0);
}
