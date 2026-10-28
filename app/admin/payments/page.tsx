import OwnerSidebar from '../OwnerSidebar';
import OwnerNavigation from '../OwnerNavigation';
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
 const {data:payments,error:paymentsError}=await db.rpc('owner_list_payment_transactions',{p_limit:100});
 const transactions=Array.isArray(payments)?payments:[];
 return <main className="owner-shell" dir="rtl"><OwnerSidebar/><section className="owner-content">
 <OwnerNavigation/>
 <header className="owner-top"><div><h1>الإيرادات والمدفوعات</h1><p>إدارة مالية مستقلة خاصة بمالك المنصة</p></div></header>
 <div className="owner-intro"><h2>سجل معاملات مزود الدفع — QA</h2><p>سجل للقراءة فقط. لا تُعرض أية إيرادات ما لم تُسجّل معاملات موثوقة عبر تكامل دفع معتمد.</p>
 {paymentsError?<p role="alert">تعذر تحميل سجل المعاملات. تحقق من صلاحيات المالك واتصال QA.</p>:transactions.length===0?<p>لا توجد معاملات مسجلة في بيئة الاختبار.</p>:<div style={{overflowX:'auto'}}><table><thead><tr><th>الشركة</th><th>مزود الدفع</th><th>نوع العملية</th><th>الحالة</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>{transactions.map((t:{id:string;organization_name:string;provider:string;event_kind:string;status:string;amount:number;currency:string;occurred_at:string})=><tr key={t.id}><td>{t.organization_name}</td><td>{t.provider}</td><td>{t.event_kind==='refund'?'استرداد':'دفع'}</td><td>{t.status}</td><td>{Number(t.amount).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2})} {t.currency}</td><td>{new Date(t.occurred_at).toLocaleDateString('ar-SA')}</td></tr>)}</tbody></table></div>}
 </div>
 <div className="owner-intro"><h2>تجهيز سجل التحصيل</h2><p>لم يتم ربط بوابة دفع أو مصدر موثوق لعمليات التحصيل بعد. لا توجد مبالغ مالية مؤكدة يمكن عرضها في هذه البيئة.</p><p>سيشمل القسم بعد الربط: الفواتير، المدفوعات الناجحة والمرفوضة، المبالغ المستردة، وتسوية الاشتراكات.</p><Link href="/admin/subscriptions">عرض الاشتراكات</Link></div>
 </section></main>;
}
