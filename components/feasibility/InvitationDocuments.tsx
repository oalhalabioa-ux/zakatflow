'use client';
import {useEffect,useState} from 'react';

export function InvitationDocuments({organization,project,ar,selected,onSelect}:{
  organization:string; project:string; ar:boolean; selected?:string[]; onSelect?:(ids:string[])=>void;
}) {
  const [documents,setDocuments]=useState<{id:string;name:string;kind:string}[]>();
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    setDocuments(undefined);
    setFailed(false);
    Promise.all(['licensing','valuation'].map(async kind=>{
      const query=new URLSearchParams({organization,project,kind});
      const response=await fetch('/api/feasibility/evidence?'+query,{cache:'no-store',signal:controller.signal});
      if(!response.ok) throw Error();
      const rows:{id:string;name:string}[]=await response.json();
      return rows.map(row=>({...row,kind}));
    })).then(groups=>{if(!controller.signal.aborted)setDocuments(groups.flat())})
      .catch(()=>{if(!controller.signal.aborted)setFailed(true)});
    return ()=>controller.abort();
  },[organization,project]);
  if(failed) return onSelect ? <p role="alert">{ar?'تعذر تحميل قائمة المستندات.':'Could not load documents.'}</p> : null;
  if(!documents?.length) return onSelect ? <p>{documents?(ar?'لا توجد مستندات.':'No documents.'):(ar?'جارٍ التحميل…':'Loading…')}</p> : null;
  return <fieldset><legend>{ar?'مستندات الدراسة':'Study documents'}</legend>{documents.map(doc=><div key={doc.id}>{onSelect && selected
    ? <label><input type="checkbox" checked={selected.includes(doc.id)} onChange={e=>onSelect(e.target.checked?[...selected,doc.id]:selected.filter(id=>id!==doc.id))}/> {doc.name}</label>
    : <a href={'/api/feasibility/evidence?'+new URLSearchParams({organization,project,document:doc.id,kind:doc.kind})} download>{doc.name}</a>}</div>)}</fieldset>;
}
