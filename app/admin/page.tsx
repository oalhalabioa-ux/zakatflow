import { redirect } from 'next/navigation';
import { supabaseServer } from '../../lib/supabase/server';
import './owner.css';
import OwnerThemeSelector from './OwnerThemeSelector';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'لوحة مالك المنصة' };

const modules = [
  ['المستخدمون','/admin/users','👥'],['الشركات','/admin/companies','🏢'],
  ['الاشتراكات','/admin/subscriptions','◈'],['الإيرادات والمدفوعات','/admin/payments','▣'],
  ['التحليلات','/admin/analytics','▥'],['الباقات والإعدادات','/admin/settings','⚙']
];

export default async function OwnerDashboard() {
  const supabase = await supabaseServer();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/ar/login?next=%2Fadmin');
  // Only a server-verified application role can unlock platform-wide data.
  // User-controlled metadata and email address are never authorization sources.
  const { data: owner, error: roleError } = await supabase
    .from('platform_admins').select('user_id')
    .eq('user_id', user.id).eq('role', 'platform_owner').maybeSingle();
  if (roleError || !owner) return <main className="owner-denied" dir="rtl"><h1>الوصول غير مسموح</h1><p>هذه الصفحة مخصصة لمالك منصة يقين الأعمال.</p><a href="/">العودة إلى الرئيسية</a></main>;

  const { data: userCount, error: countError } = await supabase.rpc('owner_user_count');
  const totalUsers = countError ? null : Number(userCount);
  const { data: orgCount, error: orgError } = await supabase.rpc('owner_organization_count');
  const totalOrganizations = orgError ? null : Number(orgCount);
  return <main className="owner-shell" dir="rtl">
    <aside className="owner-sidebar"><div className="owner-brand">يقين <span>الأعمال</span><small>YAQEEN BUSINESS</small></div><div className="owner-menu-title">إدارة المنصة</div><nav><a className="selected" href="/admin">⌂ &nbsp; نظرة عامة</a>{modules.map(([name,url,icon])=><a key={url} href={url}>{icon} &nbsp; {name}</a>)}</nav><div className="owner-foot">لوحة مالك المنصة</div></aside>
    <section className="owner-content"><header className="owner-top"><div><h1>لوحة تحكم مالك المنصة</h1><p>إدارة يقين الأعمال ومتابعة أدائها</p></div><div className="owner-top-actions"><OwnerThemeSelector/><div className="owner-tag">يقين الأعمال</div></div></header>
    <div className="owner-intro"><h2>مرحباً بك في يقين الأعمال</h2><p>لوحة إدارة مستقلة بصلاحيات محمية، متوافقة مع الثيمات المعتمدة.</p></div>
    <div className="owner-kpis">{[['المستخدمون',totalUsers === null ? '—' : String(totalUsers)],['الشركات',totalOrganizations === null ? '—' : String(totalOrganizations)],['الإيرادات الشهرية','—'],['الاشتراكات النشطة','—']].map(([label,value])=><article key={label}><span>{label}</span><strong>{value}</strong><small>{label === 'المستخدمون' || label === 'الشركات' ? 'بيانات فعلية من QA' : 'لم يتم ربط مصدر البيانات بعد'}</small></article>)}</div>
    <div className="owner-panels"><article><h3>نمو المستخدمين والإيرادات</h3><p>سيتم عرض المؤشرات الفعلية بعد إتاحة واجهة التقارير الإدارية المحمية.</p><div className="owner-placeholder">لا توجد بيانات معروضة حالياً</div></article><article><h3>التحليلات المتقدمة</h3><p>الاحتفاظ، توزيع الباقات، النشاط الشهري، وتحليل النمو.</p><div className="owner-placeholder">قيد الربط</div></article></div>
    </section></main>;
}
