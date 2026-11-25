import Link from 'next/link';
import {recordWorkspaceHref,type RecordWorkspace,type RecordWorkspaceSelection} from '../lib/record-workspace-scope';

export default function RecordWorkspaceNotice({locale,collection,id,owner,selection,error}:{locale:string;collection:'lots'|'transactions';id:string;owner:RecordWorkspace|null;selection:RecordWorkspaceSelection|null;error:string}){
 const ar=locale==='ar';
 return <section className="card section">
  <h1>{ar?'تعذر عرض السجل في النطاق المحدد':'Record unavailable in this workspace'}</h1>
  <p role="alert">{error?(ar?'تعذر الوصول إلى السجل أو التحقق من ملكيته. راجع الرابط وصلاحية الوصول.':'The record could not be accessed or its ownership verified. Check the link and your access.'):(ar?'هذا السجل يتبع نطاقًا أو مؤسسة مختلفة عن الاختيار الحالي. افتحه في نطاقه الصحيح للمتابعة.':'This record belongs to a different scope or organization. Open its own workspace to continue.')}</p>
  {!error&&owner&&<p><Link className="btn" href={recordWorkspaceHref(locale,collection,{...owner,group:false},id)}>{owner.scope==='PERSONAL'?(ar?'فتح السجل في النطاق الشخصي':'Open in personal workspace'):(ar?'فتح السجل في المؤسسة المالكة':'Open in owning organization')}</Link></p>}
  <Link className="btn secondary" href={recordWorkspaceHref(locale,collection,selection??{scope:'PERSONAL',organizationId:null,group:false})}>{ar?'العودة إلى السجل':'Back to register'}</Link>
 </section>;
}
