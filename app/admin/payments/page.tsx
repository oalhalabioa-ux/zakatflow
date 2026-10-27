import Link from 'next/link';
import {redirect} from 'next/navigation';
import {supabaseServer} from '../../../lib/supabase/server';
import '../owner.css';
export const dynamic='force-dynamic';
export const metadata={title:'الإيرادات والمدفوعات | يقين الأعمال'};
export default async function PaymentsPage(){
 const db=await supabaseServer();
 const {data:{user},error}=await db.auth.getUser();
 if(error||!user)redirect('/ar/login?next=%2Fadmin%2Fpayments');
 const {data:owner,error:roleError}=await db.from('platform_admins').select('user_id').eq('user_id',user.id).eq('role','platform_owner').maybeSingle();
 if(roleError||!owner)return <main className="owner-denied" dir="rtl"><h1>الوصول غير مسموح</h1><Link href="/admin">لوحة المالك</Link></main>;
 return <main className="owner-shell" dir="rtl"><section className="owner-content">
 <nav className="owner-section-nav"><Link href="/admin">نظرة عامة</Link><Link href="/admin/users">المستخدمون</Link><Link href="/admin/companies">الشركات</Link><Link href="/admin/subscriptions">الاشتراكات</Link></nav>
 <header className="owner-top"><div><h1>الإيرادات والمدفوعات</h1><p>إدارة مالية مستقلة خاصة بمالك المنصة</p></div></header>
 <div className="owner-intro"><h2>تجهيز سجل التحصيل</h2><p>لم يتم ربط بوابة دفع أو مصدر موثوق لعمليات التحصيل بعد. لا توجد مبالغ مالية مؤكدة يمكن عرضها في هذه البيئة.</p><p>سيشمل القسم بعد الربط: الفواتير، المدفوعات الناجحة والمرفوضة، المبالغ المستردة، وتسوية الاشتراكات.</p><Link href="/admin/subscriptions">عرض الاشتراكات</Link></div>
 </section></main>;
}
