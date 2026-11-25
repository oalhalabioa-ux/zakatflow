'use client';

import {use,useState,useRef,useEffect} from 'react';
import Link from 'next/link';
import AssetFinancialReports from '@/components/asset-financial-reports';
import {useWorkspaceScope} from '@/hooks/useWorkspaceScope';
import {operationalReportQuery,type OperationalReportType,type ReportScopeSelection} from '@/lib/operational-report-scope';

export default function Reports({params}:{params:Promise<{locale:string}>}) {
 const {locale}=use(params);const ar=locale==='ar';const [scope]=useWorkspaceScope();
 const [selection,setSelection]=useState<ReportScopeSelection|null>(null),[error,setError]=useState(''),[downloading,setDownloading]=useState('');
 const query=selection?.scope===scope?operationalReportQuery(selection):null;
 const printQuery=selection?.scope===scope?operationalReportQuery(selection,true):null;
 const queryKey=query?.toString()??null;
 const currentQuery=useRef({key:queryKey,generation:0});if(currentQuery.current.key!==queryKey)currentQuery.current={key:queryKey,generation:currentQuery.current.generation+1};
 const generation=currentQuery.current.generation;
 useEffect(()=>{setError('');setDownloading('')},[generation]);
 async function download(type:OperationalReportType){
  if(!query)return;
  const key=query.toString(),params=new URLSearchParams(key);params.set('type',type);setError('');setDownloading(type);
  try{
   const response=await fetch('/api/reports?'+params,{cache:'no-store'});
   if(!response.ok)throw Error();
   const blob=await response.blob();
   if(currentQuery.current.generation!==generation)return;
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`yaqeen-${type}-${scope.toLowerCase()}.csv`;a.click();URL.revokeObjectURL(url);
  }catch{if(currentQuery.current.generation===generation)setError(ar?'تعذر تصدير التقرير للنطاق المختار. راجع الصلاحيات وأعد المحاولة.':'Unable to export this workspace report. Check access and retry.');}
  finally{if(currentQuery.current.generation===generation)setDownloading('');}
 }
 const reports:Array<[OperationalReportType,string,string]>=[['assessments',ar?'الاحتسابات':'Assessments','◈'],['transactions',ar?'المعاملات':'Transactions','↔'],['lots',ar?'دفعات الأصول':'Asset lots','◷'],['payments',ar?'المدفوعات':'Payments','✓']];
 return <main className="container"><div className="page-head"><div><h1>{ar?'التقارير':'Reports'}</h1><p className="muted">{ar?'تقارير الأصول والحركات والتقييم، مع تقارير تشغيلية قابلة للتدقيق والتصدير.':'Asset registers, movements and valuation with auditable operational exports.'}</p></div>{printQuery?<Link className="btn secondary" href={`/${locale}/reports/print?${printQuery}`}>{ar?'تقرير للطباعة':'Printable report'}</Link>:<button className="btn secondary" disabled>{ar?'تقرير للطباعة':'Printable report'}</button>}</div><AssetFinancialReports locale={locale} onScopeSelection={setSelection}/>{error&&<p role="alert">{error}</p>}{scope==='ORGANIZATION'&&<p className="muted">{ar?'تقارير الزكاة والمدفوعات تخص الشركة أو المجموعة المختارة. تعرض المدفوع فعليًا منفصلًا عن قيمة الاستحقاق؛ فلاتر الفرع في سجل الأصول تخص الأصول والحركات.':'Zakat and payment reports cover the selected company or group. Amounts paid are separate from liabilities; asset entity filters apply to assets and movements.'}</p>}<div className="cards section">{reports.map(([type,label,icon])=><div className="card report-card premium-report-card" key={type}><span className="report-icon" aria-hidden="true">{icon}</span><h3>{label}</h3><button className="btn secondary" disabled={!query||Boolean(downloading)} onClick={()=>void download(type)}>{downloading===type?(ar?'جارٍ التصدير…':'Exporting…'):'CSV'}</button></div>)}</div></main>;
}
