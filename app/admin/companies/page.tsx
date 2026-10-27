import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '../../../lib/supabase/server';
import '../owner.css';
export const dynamic='force-dynamic';
export const metadata={title:'إدارة الشركات | يقين الأعمال'};
type Organization={id:string;name:string;legal_name:string|null;base_currency:string;entity_type:string;status:string;created_at:string;owner_email:string|null;member_count:number};
export default async function CompaniesPage({searchParams}:{searchParams:Promise<{page?:string}>}){
 const db=await supabaseServer();
 const {data:{user},error}=await db.auth.getUser();
 if(error||!user)redirect('/ar/login?next=%2Fadmin%2Fcompanies');
 const {data:membership}=await db.from('platform_admins').select('user_id').eq('user_id',user.id).eq('role','platform_owner').maybeSingle();
 if(!membership)return <main className="owner-denied" dir="rtl"><h1>الوصول غير مسموح</h1><Link href="/">الرئيسية</Link></main>;
 const requested=Number((await searchParams).page||1);
 const page=Number.isSafeInteger(requested)?Math.max(1,Math.min(requested,10000)):1;
 const {data,error:loadError}=await db.rpc('owner_list_organizations',{p_page:page,p_per_page:30});
 const organizations=(data||[]) as Organization[];
 const date=(value:string)=>new Date(value).toLocaleDateString('ar-SA',{year:'numeric',month:'short',day:'numeric'});
 return <main className="owner-shell" dir="rtl"><section className="owner-content">
 <header className="owner-top"><div><Link href="/admin">← لوحة المالك</Link><h1>إدارة الشركات</h1><p>سجل الشركات الحقيقي في بيئة QA — عرض فقط</p></div></header>
 <div className="owner-intro"><h2>الشركات المسجلة</h2><p>تظهر هنا الشركات المسجلة فعلياً في قاعدة QA. لا تُعرض بيانات من Production.</p></div>
 {loadError?<p role="alert">تعذر تحميل سجل الشركات. يرجى التحقق من الصلاحيات والاتصال.</p>:
 <div className="owner-table-wrap"><table className="owner-users-table"><thead><tr><th>الشركة</th><th>المالك</th><th>النوع</th><th>العملة</th><th>الحالة</th><th>الأعضاء</th><th>تاريخ التسجيل</th></tr></thead><tbody>
 {organizations.map(org=><tr key={org.id}><td><strong>{org.name}</strong>{org.legal_name&&org.legal_name!==org.name?<div>{org.legal_name}</div>:null}</td><td dir="ltr">{org.owner_email||'—'}</td><td>{org.entity_type}</td><td>{org.base_currency}</td><td>{org.status}</td><td>{org.member_count}</td><td>{date(org.created_at)}</td></tr>)}
 </tbody></table>{organizations.length===0&&<p>لا توجد شركات مسجلة في QA حتى الآن.</p>}</div>}
 <nav className="owner-pagination">{page>1&&<Link href={`/admin/companies?page=${page-1}`}>السابق</Link>}{organizations.length===30&&<Link href={`/admin/companies?page=${page+1}`}>التالي</Link>}</nav>
 </section></main>;
}