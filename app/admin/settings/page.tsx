import {ownerLocale} from '@/lib/i18n/owner-server';
import {ownerTranslator,ownerHref} from '@/lib/i18n/owner';
import OwnerSidebar from '../OwnerSidebar';
import OwnerNavigation from '../OwnerNavigation';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {supabaseServer} from '../../../lib/supabase/server';
import '../owner.css';
export const dynamic='force-dynamic';
export async function generateMetadata(){return {title:ownerTranslator(await ownerLocale())("إعدادات مالك المنصة | يقين الأعمال")};}
export default async function OwnerSettings(){
 const locale=await ownerLocale();const translate=ownerTranslator(locale);
 const db=await supabaseServer();
 const {data:{user},error}=await db.auth.getUser();
 if(error||!user)redirect(`/${locale}/login?next=%2Fadmin%2Fsettings%3Flang%3D${locale}`);
 const {data:owner,error:roleError}=await db.from('platform_admins').select('user_id').eq('user_id',user.id).eq('role','platform_owner').maybeSingle();
 if(roleError||!owner)return <main className="owner-denied" dir={locale==='ar'?'rtl':'ltr'}><h1>{translate("الوصول غير مسموح")}</h1><Link href={ownerHref('/admin',locale)}>{translate("العودة إلى لوحة المالك")}</Link></main>;
 const {data:events,error:auditError}=await db.rpc('owner_list_audit_events',{p_limit:50});
 return <main className="owner-shell" dir={locale==='ar'?'rtl':'ltr'}><OwnerSidebar locale={locale}/><section className="owner-content">
 <OwnerNavigation locale={locale}/>
 <header className="owner-top"><div><h1>{translate("الباقات والإعدادات")}</h1><p>{translate("إعدادات المنصة وسجل التدقيق — عرض فقط")}</p></div></header>
 <div className="owner-panels"><article><h3>{translate("الباقات والأسعار")}</h3><p>{translate("عرض الباقات والاشتراكات متاح. وظائف الإنشاء والتعديل وتغيير الحالات غير مفعّلة حالياً.")}</p><Link href={ownerHref('/admin/subscriptions',locale)}>{translate("الانتقال إلى الاشتراكات")}</Link></article><article><h3>{translate("الدفع والفوترة")}</h3><p>{translate("لم تُفعّل بوابة تحصيل أو مفاتيح دفع. لن تُجرى أي عمليات مالية من هذه الصفحة.")}</p><Link href={ownerHref('/admin/payments',locale)}>{translate("مركز الإيرادات والمدفوعات")}</Link></article><article><h3>{translate("الصلاحيات والأمان")}</h3><p>{translate("الدخول إلى الصفحات مقصور على دور مالك المنصة الموثق من قاعدة البيانات. تُفحص صلاحيات المالك في الخادم وقاعدة البيانات قبل إتاحة البيانات الإدارية.")}</p></article><article><h3>{translate("البيئة")}</h3><p>{translate("المنصة في مرحلة التأسيس. تبقى حسابات المستخدمين وصلاحياتهم وبياناتهم محفوظة.")}</p></article></div>
 <div className="owner-intro"><h2>{translate("سجل العمليات الإدارية")}</h2><p>{translate("آخر 50 عملية إدارية مسجلة، للعرض فقط.")}</p></div>
 {auditError?<p role="alert">{translate("تعذر تحميل سجل التدقيق.")}</p>:<div className="owner-table-wrap"><table className="owner-users-table"><thead><tr><th>{translate("التاريخ")}</th><th>{translate("العملية")}</th><th>{translate("النوع")}</th><th>{translate("المنفّذ")}</th><th>{translate("المعرّف")}</th></tr></thead><tbody>{(events||[]).map((e:{id:string;created_at:string;event_type:string;entity_type:string;actor_user_id:string;entity_id:string|null})=><tr key={e.id}><td>{new Date(e.created_at).toLocaleString(locale==='ar'?'ar-SA':'en-GB')}</td><td>{e.event_type}</td><td>{e.entity_type}</td><td>{e.actor_user_id}</td><td>{e.entity_id||'—'}</td></tr>)}</tbody></table>{(!events||events.length===0)&&<p>{translate("لا توجد عمليات مسجلة بعد.")}</p>}</div>}
 </section></main>;
}
