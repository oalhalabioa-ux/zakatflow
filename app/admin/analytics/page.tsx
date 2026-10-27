import Link from 'next/link';
import {redirect} from 'next/navigation';
import {supabaseServer} from '../../../lib/supabase/server';
import '../owner.css';
export const dynamic='force-dynamic';
export const metadata={title:'تحليلات المنصة | يقين الأعمال'};
export default async function OwnerAnalytics(){
 const db=await supabaseServer();
 const {data:{user},error}=await db.auth.getUser();
 if(error||!user)redirect('/ar/login?next=%2Fadmin%2Fanalytics');
 const {data:owner,error:roleError}=await db.from('platform_admins').select('user_id').eq('user_id',user.id).eq('role','platform_owner').maybeSingle();
 if(roleError||!owner)return <main className="owner-denied" dir="rtl"><h1>الوصول غير مسموح</h1><Link href="/admin">العودة إلى لوحة المالك</Link></main>;
 const [users,companies,subscriptions]=await Promise.all([db.rpc('owner_user_count'),db.rpc('owner_organization_count'),db.rpc('owner_subscription_summary')]);
 const summary=Array.isArray(subscriptions.data)?subscriptions.data[0]:null;
 const metrics:[string,number|null][]=[
 ['المستخدمون',users.error?null:Number(users.data)],['الشركات',companies.error?null:Number(companies.data)],
 ['إجمالي الاشتراكات',subscriptions.error||!summary?null:Number(summary.subscriptions)],['الاشتراكات النشطة',subscriptions.error||!summary?null:Number(summary.active_subscriptions)]
 ];
 return <main className="owner-shell" dir="rtl"><section className="owner-content">
 <nav className="owner-section-nav"><Link href="/admin">نظرة عامة</Link><Link href="/admin/users">المستخدمون</Link><Link href="/admin/companies">الشركات</Link><Link href="/admin/subscriptions">الاشتراكات</Link><Link href="/admin/payments">الإيرادات والمدفوعات</Link></nav>
 <header className="owner-top"><div><h1>تحليلات المنصة</h1><p>مؤشرات تشغيلية للبيئة الإدارية المعزولة فقط</p></div></header>
 <div className="owner-kpis">{metrics.map(([label,value])=><article key={label}><span>{label}</span><strong>{value===null?'—':value.toLocaleString('ar-SA')}</strong><small>{value===null?'تعذر قراءة المؤشر':'بيانات Platform Admin QA فقط'}</small></article>)}</div>
 <div className="owner-intro"><h2>حدود البيانات الحالية</h2><p>هذه المؤشرات لا تشمل بيانات Production، ولا تمثل عدد عملاء المنصة الفعلي أو إيراداتها. التحليلات الزمنية والإيرادات تتطلب مزامنة آمنة ومصدر مدفوعات موثق.</p></div>
 </section></main>;
}
