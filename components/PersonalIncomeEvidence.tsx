'use client';
import {useRef,useState,type FormEvent} from 'react';

type Attachment={request_id:string;reference:string;filename:string};
export default function PersonalIncomeEvidence({documentId,ar,attachments,onSaved}:{
  documentId:string;ar:boolean;attachments:Attachment[];onSaved:()=>void
}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef('');
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const form=event.currentTarget,fields=new FormData(form),file=fields.get('pdf');
    if(!(file instanceof File)||!file.size||file.size>1048576){setError(ar?'اختر ملف PDF بحجم أقصاه 1 ميغابايت.':'Select a PDF up to 1 MiB.');return}
    setBusy(true);setError('');
    try{
      const reader=new FileReader();
      const result=await new Promise<string>((resolve,reject)=>{
        reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);
      });
      request.current ||= crypto.randomUUID();
      const response=await fetch('/api/personal-income/evidence',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({document_id:documentId,request_id:request.current,reference:fields.get('reference'),filename:file.name,pdf_base64:result})});
      if(!response.ok)throw Error();
      form.reset();request.current='';onSaved();
    }catch{setError(ar?'تعذّر ربط الإثبات. تحقق من الملف والمرجع.':'Could not attach evidence. Check the file and reference.')}
    finally{setBusy(false)}
  }
  return <section>{attachments.map(a=><p key={a.request_id}><a href={`/api/personal-income/evidence?document=${documentId}&attachment=${a.request_id}`}>{a.reference} · {a.filename}</a></p>)}
    <form onSubmit={submit}><fieldset disabled={busy}><legend>{ar?'إرفاق إثبات بهذا المستند':'Attach evidence to this document'}</legend>
    <label>{ar?'مرجع الإثبات':'Evidence reference'}<input required name="reference" maxLength={200}/></label>
    <input required aria-label="PDF" type="file" name="pdf" accept="application/pdf"/>
    <button>{ar?'حفظ المرفق':'Save attachment'}</button>{error&&<p role="alert">{error}</p>}</fieldset></form></section>
}
