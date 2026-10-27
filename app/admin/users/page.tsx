import { redirect } from 'next/navigation';
import { supabaseServer } from '../../../lib/supabase/server';
import '../owner.css';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'المستخدمون المسجلون' };
export default async function AdminUsers({searchParams}:{searchParams:Promise<{page?:string}>}){
 const db=await supabaseServer();
 const {data:{user},error}=await db.auth.getUser();
 if(error||!user)redirect('/ar/login?next=%2Fadmin%2Fusers');
 const {data:member,error:membershipError}=await db.from('platform_admins').select('user_id').eq('user_id',user.id).eq('role','platform_owner').maybeSingle();
 if(membershipError||!member)return <main className="owner-denied" dir="rtl"><h1>الوصول غير مسموح</h1><Link href="/">العودة للرئيسية</Link></main>;
 const requested=Number((await searchParams).page||1);
 const page=Number.isSafeInteger(requested)?Math.max(1,Math.min(requested,10000)):1;
 let users: {id:string;email?:string;created_at:string;last_sign_in_at?:string|null;email_confirmed_at?:string|null}[]=[];
 let next=false;let failure=false;
 try{
  const {data,error:fetchError}=await db.rpc('owner_list_users',{p_page:page,p_per_page:50});
  if(fetchError)throw fetchError;
  users=(data||[]) as typeof users;
  next=users.length===50;
 }catch{failure=true;}
 const date=(value?:string|null)=>value?new Date(value).toLocaleDateString('ar-SA',{year:'numeric',month:'short',day:'numeric'}):'—';
 return <main className="owner-shell" dir="rtl"><section className="owner-content"><nav className="owner-section-nav" aria-label="أقسام إدارة المنصة"><Link href="/admin">نظرة عامة</Link><Link href="/admin/users">المستخدمون</Link><Link href="/admin/companies">الشركات</Link><Link href="/admin/subscriptions">الاشتراكات</Link></nav><header className="owner-top"><div><Link href="/admin">← لوحة المالك</Link><h1>المستخدمون المسجلون</h1><p>بيانات التسجيل في نظام المصادقة — صفحة {page}</p></div></header>
 {failure?<p role="alert">تعذر تحميل المستخدمين. تحقق من إعدادات الاتصال وصلاحيات الخدمة.</p>:<div className="owner-table-wrap"><table className="owner-users-table"><thead><tr><th>البريد الإلكتروني</th><th>تاريخ التسجيل</th><th>آخر دخول</th><th>تأكيد البريد</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td dir="ltr">{u.email||'—'}</td><td>{date(u.created_at)}</td><td>{date(u.last_sign_in_at)}</td><td>{u.email_confirmed_at?'مؤكد':'غير مؤكد'}</td></tr>)}</tbody></table>{users.length===0&&<p>لا توجد حسابات في هذه الصفحة.</p>}</div>}
 <nav className="owner-pagination">{page>1&&<Link href={`/admin/users?page=${page-1}`}>السابق</Link>}{next&&<Link href={`/admin/users?page=${page+1}`}>التالي</Link>}</nav></section></main>;
}
