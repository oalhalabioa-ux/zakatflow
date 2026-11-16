import Link from 'next/link';

export default function PersonalSetupPanel({locale}:{locale:string}){
 const ar=locale==='ar';
 const stages=[
  {id:1,title:ar?'التفضيلات الشخصية':'Personal preferences',
   description:ar?'الاسم واللغة والعملة والتقويم من الحساب الشخصي، دون فتح مؤسسة جديدة.':
    'Name, language, currency and calendar in My Account, without creating an institution.',
   href:`/${locale}/account`,label:ar?'فتح حسابي':'Open my account'},
  {id:2,title:ar?'المصادر المالية الشخصية':'Personal finance sources',
   description:ar?'سجّل الأصول والنقد والحركات الشخصية من صفحاتها الأصلية؛ لا تتطلب سجلاً تجاريًا أو ملف VAT مؤسسيًا.':
    'Manage personal assets and cash in their original modules. No company registration or institutional VAT profile required.',
   href:`/${locale}/assets?scope=PERSONAL`,label:ar?'فتح الأصول الشخصية':'Open personal assets'},
  {id:3,title:ar?'القوائم والتقارير الشخصية':'Personal reports',
   description:ar?'راجع التقارير وفق البيانات الشخصية الفعلية. لا يُفترض نجاح ربط أي دليل مبسط حتى يؤكده Financial Core V2.':
    'Review reports against actual personal records; default chart mapping is not certified until verified by Financial Core V2.',
   href:`/${locale}/financial-reports?scope=PERSONAL`,label:ar?'فتح التقارير الشخصية':'Open personal reports'},
 ];
 return <section className="personal-setup-panel" dir={ar?'rtl':'ltr'}>
  <header>
   <p>{ar?'رحلة الإعداد / الوضع الشخصي':'Setup journey / Personal mode'}</p>
   <h2>{ar?'الإعداد الشخصي المبسط':'Simplified personal setup'}</h2>
   <span>{ar?'ثلاث محطات مرتبطة بوحداتك الشخصية. فروع المؤسسات والضريبة المؤسسية والدعوات غير منطبقة على هذا الوضع.':
    'Three links to your own workspaces. Company subsidiaries, institutional VAT and invitations do not apply here.'}</span>
  </header>
  <div className="personal-setup-grid">
   {stages.map(stage=><article key={stage.id}>
    <div className="personal-setup-num">{stage.id}</div>
    <h3>{stage.title}</h3><p>{stage.description}</p>
    <Link href={stage.href}>{stage.label}</Link>
   </article>)}
  </div>
  <div className="personal-setup-note">
   <strong>{ar?'حول دليل الحسابات':'About the chart of accounts'}</strong>
   <p>{ar?'الوضع الشخصي يستخدم مصادره المبسطة، ولا يحتاج نسخة من إعدادات الشركة. لا نعرض نسبة اكتمال وهمية أو نعتمد ربطًا افتراضيًا قبل اختبار توافقه مع Financial Core V2.':
    'Personal setup does not copy company settings. No fabricated completion percentage or default chart certification is shown before Financial Core V2 validation.'}</p>
  </div>
  <Link className="personal-setup-back" href={`/${locale}/settings/financial/setup`}>
    {ar?'العودة إلى رحلة إعداد المؤسسة':'Return to organization setup'}
  </Link>
 </section>;
}