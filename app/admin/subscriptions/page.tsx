import Link from 'next/link';
import {redirect} from 'next/navigation';
import {supabaseServer} from '../../../lib/supabase/server';
import '../owner.css';
import PlanEditor from './PlanEditor';
export const dynamic='force-dynamic';
export const metadata={title:'الاشتراكات والباقات | يقين الأعمال'};
export default async function SubscriptionsPage(){
 const db=await supabaseServer();
 const {data:{user},error}=await db.auth.getUser();
 if(error||!user)redirect('/ar/login?next=%2Fadmin%2Fsubscriptions');
 const {data:owner,error:roleError}=await db.from('platform_admins').select('user_id').eq('user_id',user.id).eq('role','platform_owner').maybeSingle();
 if(roleError||!owner)return <main className="owner-denied" dir="rtl"><h1>الوصول غير مسموح</h1><Link href="/">الرئيسية</Link></main>;
 const [{data,error:loadError},plansResult,subscriptionsResult]=await Promise.all([db.rpc('owner_subscription_summary'),db.rpc('owner_list_plans'),db.rpc('owner_list_subscriptions')]);
 const plans=(plansResult.data||[]) as {id:string;code:string;name_ar:string;price_amount:number;currency:string;billing_interval:string;is_active:boolean}[];
 const subscriptions=(subscriptionsResult.data||[]) as {id:string;organization_name:string;plan_name:string;status:string;started_at:string;current_period_end:string|null}[];
 const summary=Array.isArray(data)?data[0]:(data && typeof data==='object'?data:null);
 const metrics=[['إجمالي الباقات',summary?.plans],['الباقات المفعّلة',summary?.active_plans],['إجمالي الاشتراكات',summary?.subscriptions],['الاشتراكات النشطة',summary?.active_subscriptions]];
 return <main className="owner-shell" dir="rtl"><section className="owner-content">
 <nav className="owner-section-nav" aria-label="أقسام إدارة المنصة"><Link href="/admin">نظرة عامة</Link><Link href="/admin/users">المستخدمون</Link><Link href="/admin/companies">الشركات</Link><Link href="/admin/payments">الإيرادات والمدفوعات</Link><Link href="/admin/analytics">التحليلات</Link><Link href="/admin/settings">الإعدادات</Link></nav><header className="owner-top"><div><Link href="/admin">← لوحة المالك</Link><h1>الباقات والاشتراكات</h1><p>بيانات اشتراكات المنصة من QA فقط</p></div></header>
 {loadError?<p role="alert">تعذر قراءة بيانات الاشتراكات. يرجى التحقق من الصلاحيات.</p>:<>
 <div className="owner-kpis">{metrics.map(([label,value])=><article key={String(label)}><span>{label}</span><strong>{value===null||value===undefined?'—':String(value)}</strong><small>بيانات فعلية من QA</small></article>)}</div>
 <div className="owner-intro"><h2>سجل الباقات</h2><p>الباقات المعرفة في قاعدة الإدارة المستقلة — عرض فقط.</p></div>
 {plansResult.error?<p role="alert">تعذر تحميل الباقات.</p>:<div className="owner-table-wrap"><table className="owner-users-table"><thead><tr><th>الباقة</th><th>الرمز</th><th>السعر</th><th>دورة الفوترة</th><th>الحالة</th></tr></thead><tbody>{plans.map(p=><tr key={p.id}><td>{p.name_ar}</td><td>{p.code}</td><td>{Number(p.price_amount).toLocaleString('ar-SA')} {p.currency}</td><td>{p.billing_interval}</td><td>{p.is_active?'مفعلة':'غير مفعلة'}</td></tr>)}</tbody></table>{plans.length===0&&<p>لا توجد باقات مسجلة في QA.</p>}</div>}
 {!plansResult.error&&<PlanEditor plans={plans}/>}
 <div className="owner-intro"><h2>سجل الاشتراكات</h2><p>الاشتراكات المسجلة في QA فقط.</p></div>
 {subscriptionsResult.error?<p role="alert">تعذر تحميل سجل الاشتراكات.</p>:<div className="owner-table-wrap"><table className="owner-users-table"><thead><tr><th>الشركة</th><th>الباقة</th><th>الحالة</th><th>تاريخ البدء</th><th>نهاية الفترة</th></tr></thead><tbody>{subscriptions.map(s=><tr key={s.id}><td>{s.organization_name}</td><td>{s.plan_name}</td><td>{s.status}</td><td>{new Date(s.started_at).toLocaleDateString('ar-SA')}</td><td>{s.current_period_end?new Date(s.current_period_end).toLocaleDateString('ar-SA'):'—'}</td></tr>)}</tbody></table>{subscriptions.length===0&&<p>لا توجد اشتراكات مسجلة في QA.</p>}</div>}
 <div className="owner-intro"><h2>إدارة دورة الاشتراك</h2><p>تم إنشاء الهيكل الآمن للباقات والاشتراكات. يمكن الآن إنشاء الباقات وتعديلها في QA بصلاحية المالك مع تسجيل تدقيق. التحصيل المالي وإدارة تجديد الاشتراكات لم يُفعّلا بعد.</p></div>
 </>}
 </section></main>;
}