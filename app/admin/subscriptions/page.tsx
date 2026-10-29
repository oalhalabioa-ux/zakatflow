import {ownerLocale} from '@/lib/i18n/owner-server';
import {ownerTranslator,ownerHref} from '@/lib/i18n/owner';
import OwnerSidebar from '../OwnerSidebar';
import OwnerNavigation from '../OwnerNavigation';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {supabaseServer} from '../../../lib/supabase/server';
import '../owner.css';
export const dynamic='force-dynamic';
export async function generateMetadata(){return {title:ownerTranslator(await ownerLocale())("الاشتراكات والباقات | يقين الأعمال")};}
export default async function SubscriptionsPage(){
 const locale=await ownerLocale();const translate=ownerTranslator(locale);
 const db=await supabaseServer();
 const {data:{user},error}=await db.auth.getUser();
 if(error||!user)redirect(`/${locale}/login?next=%2Fadmin%2Fsubscriptions%3Flang%3D${locale}`);
 const {data:owner,error:roleError}=await db.from('platform_admins').select('user_id').eq('user_id',user.id).eq('role','platform_owner').maybeSingle();
 if(roleError||!owner)return <main className="owner-denied" dir={locale==='ar'?'rtl':'ltr'}><h1>{translate("الوصول غير مسموح")}</h1><Link href="/">{translate("الرئيسية")}</Link></main>;
 const [{data,error:loadError},plansResult,subscriptionsResult]=await Promise.all([db.rpc('owner_subscription_summary'),db.rpc('owner_list_plans'),db.rpc('owner_list_subscriptions')]);
 const plans=(plansResult.data||[]) as {id:string;code:string;name_ar:string;price_amount:number;currency:string;billing_interval:string;is_active:boolean}[];
 const subscriptions=(subscriptionsResult.data||[]) as {id:string;organization_name:string;plan_name:string;status:string;started_at:string;current_period_end:string|null}[];
 const summary=Array.isArray(data)?data[0]:(data && typeof data==='object'?data:null);
 const metrics=[[translate("إجمالي الباقات"),summary?.plans],[translate("الباقات المفعّلة"),summary?.active_plans],[translate("إجمالي الاشتراكات"),summary?.subscriptions],[translate("الاشتراكات النشطة"),summary?.active_subscriptions]];
 return <main className="owner-shell" dir={locale==='ar'?'rtl':'ltr'}><OwnerSidebar locale={locale}/><section className="owner-content">
 <OwnerNavigation locale={locale}/><header className="owner-top"><div><Link href={ownerHref('/admin',locale)}>{translate("← لوحة المالك")}</Link><h1>{translate("الباقات والاشتراكات")}</h1><p>{translate("الباقات والاشتراكات — عرض فقط")}</p></div></header>
 {loadError?<p role="alert">{translate("تعذر قراءة بيانات الاشتراكات. يرجى التحقق من الصلاحيات.")}</p>:<>
 <div className="owner-kpis">{metrics.map(([label,value])=><article key={String(label)}><span>{label}</span><strong>{value===null||value===undefined?'—':String(value)}</strong><small>{translate("بيانات المنصة الحالية")}</small></article>)}</div>
 <div className="owner-intro"><h2>{translate("سجل الباقات")}</h2><p>{translate("الباقات الجديدة للمنصة. وظائف الإنشاء والتعديل غير مفعّلة حالياً.")}</p></div>
 {plansResult.error?<p role="alert">{translate("تعذر تحميل الباقات.")}</p>:<div className="owner-table-wrap"><table className="owner-users-table"><thead><tr><th>{translate("الباقة")}</th><th>{translate("الرمز")}</th><th>{translate("السعر")}</th><th>{translate("دورة الفوترة")}</th><th>{translate("الحالة")}</th></tr></thead><tbody>{plans.map(p=><tr key={p.id}><td>{p.name_ar}</td><td>{p.code}</td><td>{Number(p.price_amount).toLocaleString(locale==='ar'?'ar-SA':'en-GB')} {p.currency}</td><td>{p.billing_interval}</td><td>{p.is_active?translate("مفعلة"):translate("غير مفعلة")}</td></tr>)}</tbody></table>{plans.length===0&&<p>{translate("لم تُضف باقات بعد.")}</p>}</div>}
 <div className="owner-intro"><h2>{translate("سجل الاشتراكات")}</h2><p>{translate("يبدأ سجل الاشتراكات فارغاً في مرحلة التأسيس.")}</p></div>
 {subscriptionsResult.error?<p role="alert">{translate("تعذر تحميل سجل الاشتراكات.")}</p>:<div className="owner-table-wrap"><table className="owner-users-table"><thead><tr><th>{translate("الشركة")}</th><th>{translate("الباقة")}</th><th>{translate("الحالة")}</th><th>{translate("تاريخ البدء")}</th><th>{translate("نهاية الفترة")}</th></tr></thead><tbody>{subscriptions.map(s=><tr key={s.id}><td>{s.organization_name}</td><td>{s.plan_name}</td><td>{s.status}</td><td>{new Date(s.started_at).toLocaleDateString(locale==='ar'?'ar-SA':'en-GB')}</td><td>{s.current_period_end?new Date(s.current_period_end).toLocaleDateString(locale==='ar'?'ar-SA':'en-GB'):'—'}</td></tr>)}</tbody></table>{subscriptions.length===0&&<p>{translate("لا توجد اشتراكات مسجلة بعد.")}</p>}</div>}
 <div className="owner-intro"><h2>{translate("إدارة دورة الاشتراك")}</h2><p>{translate("الباقات والاشتراكات للعرض فقط حالياً. إنشاء الباقات وتعديلها وتغيير حالات الاشتراك والتحصيل المالي غير مفعّلة.")}</p></div>
 </>}
 </section></main>;
}