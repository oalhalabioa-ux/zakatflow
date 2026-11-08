import Link from 'next/link';

export default function OrganizationSubnav({locale,organization,active}:{
 locale:string;organization?:string;active:'details'|'structure'|'billing';
}){
 const ar=locale==='ar';
 const prefix=organization?'?organization='+encodeURIComponent(organization):'';
 const sections=[
  {id:'details',path:'settings',ar:'البيانات الأساسية',en:'Organization details'},
  {id:'structure',path:'settings/structure',ar:'الهيكل والفروع',en:'Structure & branches'},
  {id:'billing',path:'billing',ar:'الاشتراك والفوترة',en:'Subscription & billing'},
 ] as const;
 return <nav className="settings-subsection-nav"
   aria-label={ar?'أقسام إعدادات المؤسسة':'Organization settings sub-sections'}>
   {sections.map(s=><Link key={s.id} href={`/${locale}/${s.path}${prefix}`}
     aria-current={s.id===active?'page':undefined}>{ar?s.ar:s.en}</Link>)}
 </nav>;
}