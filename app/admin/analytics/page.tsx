import {ownerLocale} from '@/lib/i18n/owner-server';
import {ownerTranslator,ownerHref} from '@/lib/i18n/owner';
import OwnerSidebar from '../OwnerSidebar';
import OwnerNavigation from '../OwnerNavigation';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {supabaseServer} from '../../../lib/supabase/server';
import '../owner.css';
export const dynamic='force-dynamic';
export async function generateMetadata(){return {title:ownerTranslator(await ownerLocale())("تحليلات المنصة | يقين الأعمال")};}
export default async function OwnerAnalytics(){
 const locale=await ownerLocale();const translate=ownerTranslator(locale);
 const db=await supabaseServer();
 const {data:{user},error}=await db.auth.getUser();
 if(error||!user)redirect(`/${locale}/login?next=%2Fadmin%2Fanalytics%3Flang%3D${locale}`);
 const {data:owner,error:roleError}=await db.from('platform_admins').select('user_id').eq('user_id',user.id).eq('role','platform_owner').maybeSingle();
 if(roleError||!owner)return <main className="owner-denied" dir={locale==='ar'?'rtl':'ltr'}><h1>{translate("الوصول غير مسموح")}</h1><Link href={ownerHref('/admin',locale)}>{translate("العودة إلى لوحة المالك")}</Link></main>;
 const [users,companies,subscriptions]=await Promise.all([db.rpc('owner_user_count'),db.rpc('owner_organization_count'),db.rpc('owner_subscription_summary')]);
 const summary=Array.isArray(subscriptions.data)?subscriptions.data[0]:(subscriptions.data && typeof subscriptions.data==='object'?subscriptions.data:null);
 const metrics:[string,number|null][]=[
 [translate("المستخدمون"),users.error?null:Number(users.data)],[translate("الشركات"),companies.error?null:Number(companies.data)],
 [translate("إجمالي الاشتراكات"),subscriptions.error||!summary?null:Number(summary.subscriptions)],[translate("الاشتراكات النشطة"),subscriptions.error||!summary?null:Number(summary.active_subscriptions)]
 ];
 return <main className="owner-shell" dir={locale==='ar'?'rtl':'ltr'}><OwnerSidebar locale={locale}/><section className="owner-content">
 <OwnerNavigation locale={locale}/>
 <header className="owner-top"><div><h1>{translate("تحليلات المنصة")}</h1><p>{translate("مؤشرات تشغيلية للبيئة الإدارية المعزولة فقط")}</p></div></header>
 <div className="owner-kpis">{metrics.map(([label,value])=><article key={label}><span>{label}</span><strong>{value===null?'—':value.toLocaleString(locale==='ar'?'ar-SA':'en-GB')}</strong><small>{value===null?translate("تعذر قراءة المؤشر"):translate("بيانات المنصة الحالية")}</small></article>)}</div>
 <div className="owner-panels"><article><h3>{translate("معدل تفعيل الاشتراكات")}</h3><p>{translate("نسبة الاشتراكات النشطة إلى إجمالي الاشتراكات المسجلة في المنصة.")}</p><strong>{summary&&Number(summary.subscriptions)>0?(100*Number(summary.active_subscriptions)/Number(summary.subscriptions)).toFixed(1)+'%':'—'}</strong><p>{summary&&Number(summary.subscriptions)===0?translate("لا توجد اشتراكات مسجلة لحساب النسبة."):''}</p></article><article><h3>{translate("الباقات المتاحة")}</h3><p>{translate("عدد الباقات المفعّلة مقارنة بإجمالي الباقات.")}</p><strong>{summary?String(summary.active_plans)+' / '+String(summary.plans):'—'}</strong></article></div>
 <div className="owner-intro"><h2>{translate("حدود البيانات الحالية")}</h2><p>{translate("هذه المؤشرات لا تشمل بيانات Production، ولا تمثل عدد عملاء المنصة الفعلي أو إيراداتها. التحليلات الزمنية والإيرادات تتطلب مزامنة آمنة ومصدر مدفوعات موثق.")}</p></div>
 </section></main>;
}
