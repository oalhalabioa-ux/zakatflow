import Link from 'next/link';
import {redirect} from 'next/navigation';
import {supabaseServer} from '../../../lib/supabase/server';
import '../owner.css';
export const dynamic='force-dynamic';
export const metadata={title:'الاشتراكات والباقات | يقين الأعمال'};
export default async function SubscriptionsPage(){
 const db=await supabaseServer();
 const {data:{user},error}=await db.auth.getUser();
 if(error||!user)redirect('/ar/login?next=%2Fadmin%2Fsubscriptions');
 const {data:owner}=await db.from('platform_admins').select('user_id').eq('user_id',user.id).eq('role','platform_owner').maybeSingle();
 if(!owner)return <main className="owner-denied" dir="rtl"><h1>الوصول غير مسموح</h1><Link href="/">الرئيسية</Link></main>;
 const {data,error:loadError}=await db.rpc('owner_subscription_summary');
 const summary=Array.isArray(data)?data[0]:null;
 const metrics=[['إجمالي الباقات',summary?.plans],['الباقات المفعّلة',summary?.active_plans],['إجمالي الاشتراكات',summary?.subscriptions],['الاشتراكات النشطة',summary?.active_subscriptions]];
 return <main className="owner-shell" dir="rtl"><section className="owner-content">
 <header className="owner-top"><div><Link href="/admin">← لوحة المالك</Link><h1>الباقات والاشتراكات</h1><p>بيانات اشتراكات المنصة من QA فقط</p></div></header>
 {loadError?<p role="alert">تعذر قراءة بيانات الاشتراكات. يرجى التحقق من الصلاحيات.</p>:<>
 <div className="owner-kpis">{metrics.map(([label,value])=><article key={String(label)}><span>{label}</span><strong>{value===null||value===undefined?'—':String(value)}</strong><small>بيانات فعلية من QA</small></article>)}</div>
 <div className="owner-intro"><h2>إدارة دورة الاشتراك</h2><p>تم إنشاء الهيكل الآمن للباقات والاشتراكات. لم يتم تفعيل إنشاء الباقات أو التحصيل المالي بعد؛ ستُضاف العمليات بعد اختبار الصلاحيات وربط بوابة الدفع.</p></div>
 </>}
 </section></main>;
}