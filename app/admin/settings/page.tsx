import Link from 'next/link';
import {redirect} from 'next/navigation';
import {supabaseServer} from '../../../lib/supabase/server';
import '../owner.css';
export const dynamic='force-dynamic';
export const metadata={title:'إعدادات مالك المنصة | يقين الأعمال'};
export default async function OwnerSettings(){
 const db=await supabaseServer();
 const {data:{user},error}=await db.auth.getUser();
 if(error||!user)redirect('/ar/login?next=%2Fadmin%2Fsettings');
 const {data:owner,error:roleError}=await db.from('platform_admins').select('user_id').eq('user_id',user.id).eq('role','platform_owner').maybeSingle();
 if(roleError||!owner)return <main className="owner-denied" dir="rtl"><h1>الوصول غير مسموح</h1><Link href="/admin">العودة إلى لوحة المالك</Link></main>;
 return <main className="owner-shell" dir="rtl"><section className="owner-content">
 <nav className="owner-section-nav"><Link href="/admin">نظرة عامة</Link><Link href="/admin/users">المستخدمون</Link><Link href="/admin/companies">الشركات</Link><Link href="/admin/subscriptions">الاشتراكات</Link><Link href="/admin/payments">الإيرادات والمدفوعات</Link><Link href="/admin/analytics">التحليلات</Link></nav>
 <header className="owner-top"><div><h1>الباقات والإعدادات</h1><p>مركز ضبط المنصة — وضع آمن للعرض فقط</p></div></header>
 <div className="owner-panels"><article><h3>الباقات والأسعار</h3><p>عرض الاشتراكات متاح. إنشاء الباقات وتعديل الأسعار غير مفعّلين حتى اكتمال سجل التدقيق واختبارات الصلاحيات.</p><Link href="/admin/subscriptions">الانتقال إلى الاشتراكات</Link></article><article><h3>الدفع والفوترة</h3><p>لم تُفعّل بوابة تحصيل أو مفاتيح دفع. لن تُجرى أي عمليات مالية من هذه الصفحة.</p><Link href="/admin/payments">مركز الإيرادات والمدفوعات</Link></article><article><h3>الصلاحيات والأمان</h3><p>الدخول مقصور على دور مالك المنصة الموثق من قاعدة البيانات، وليس البريد الإلكتروني أو بيانات الملف الشخصي.</p></article><article><h3>البيئة</h3><p>بيانات هذه المعاينة معزولة عن Production وبيئات QA الأخرى. لا يوجد مزامنة تشغيلية مفعلّة.</p></article></div>
 </section></main>;
}
