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
 const {data:events,error:auditError}=await db.rpc('owner_list_audit_events',{p_limit:50});
 return <main className="owner-shell" dir="rtl"><section className="owner-content">
 <nav className="owner-section-nav"><Link href="/admin">نظرة عامة</Link><Link href="/admin/users">المستخدمون</Link><Link href="/admin/companies">الشركات</Link><Link href="/admin/subscriptions">الاشتراكات</Link><Link href="/admin/payments">الإيرادات والمدفوعات</Link><Link href="/admin/analytics">التحليلات</Link></nav>
 <header className="owner-top"><div><h1>الباقات والإعدادات</h1><p>مركز ضبط المنصة وسجل التدقيق — QA</p></div></header>
 <div className="owner-panels"><article><h3>الباقات والأسعار</h3><p>عرض الاشتراكات متاح. إنشاء الباقات وتعديلها متاحان في QA لمالك المنصة مع تسجيل تدقيق. لم تجتز الميزة الاختبارات النهائية بعد.</p><Link href="/admin/subscriptions">الانتقال إلى الاشتراكات</Link></article><article><h3>الدفع والفوترة</h3><p>لم تُفعّل بوابة تحصيل أو مفاتيح دفع. لن تُجرى أي عمليات مالية من هذه الصفحة.</p><Link href="/admin/payments">مركز الإيرادات والمدفوعات</Link></article><article><h3>الصلاحيات والأمان</h3><p>الدخول إلى الصفحات مقصور على دور مالك المنصة الموثق من قاعدة البيانات. توجد تحذيرات أمنية لوظائف RPC مرتفعة الصلاحيات، ويجب اختبار منع استدعائها من الحسابات العادية قبل الإطلاق.</p></article><article><h3>البيئة</h3><p>بيانات هذه المعاينة معزولة عن Production وبيئات QA الأخرى. لا يوجد مزامنة تشغيلية مفعلّة.</p></article></div>
 <div className="owner-intro"><h2>سجل العمليات الإدارية</h2><p>آخر 50 عملية إدارية مسجلة في QA، للعرض فقط.</p></div>
 {auditError?<p role="alert">تعذر تحميل سجل التدقيق.</p>:<div className="owner-table-wrap"><table className="owner-users-table"><thead><tr><th>التاريخ</th><th>العملية</th><th>النوع</th><th>المنفّذ</th><th>المعرّف</th></tr></thead><tbody>{(events||[]).map((e:{id:string;created_at:string;event_type:string;entity_type:string;actor_user_id:string;entity_id:string|null})=><tr key={e.id}><td>{new Date(e.created_at).toLocaleString('ar-SA')}</td><td>{e.event_type}</td><td>{e.entity_type}</td><td>{e.actor_user_id}</td><td>{e.entity_id||'—'}</td></tr>)}</tbody></table>{(!events||events.length===0)&&<p>لا توجد عمليات مسجلة بعد.</p>}</div>}
 </section></main>;
}
