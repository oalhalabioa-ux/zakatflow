import Link from 'next/link';

const features = [
  { icon: '↺', title: 'سجل مالي موثوق', description: 'كل حركة محفوظة وقابلة للتتبع، مع المعالجة العكسية بدل حذف التاريخ المالي.' },
  { icon: '◎', title: 'احتساب قابل للتفسير', description: 'اعرف كيف وصل النظام إلى الزكاة المستحقة، من الأصل إلى الدفعة والمعاملة.' },
  { icon: '✓', title: 'مراجعة واعتماد', description: 'مسار واضح للمراجعة المحاسبية والشرعية قبل اعتماد النتيجة وتسجيل الدفع.' },
];

const steps = [
  ['01', 'سجّل الأصول', 'ذهب، نقد، استثمارات وأصول تجارية في سجل واحد.'],
  ['02', 'تابع الحول والقيمة', 'المنصة تتابع تواريخ التملك والأسعار وقواعد الأهلية.'],
  ['03', 'راجع واعتمد', 'نتيجة مفهومة وتقارير جاهزة للمراجعة والدفع.'],
];

export default function Home() {
  return (
    <main className="landing" dir="rtl">
      <header className="landing-nav">
        <Link className="landing-brand" href="/">
          <span className="brand-mark">ز</span>
          <span>ZakatFlow<small>إدارة الزكاة بوضوح</small></span>
        </Link>
        <nav aria-label="التنقل الرئيسي">
          <a href="#features">المزايا</a><a href="#how-it-works">كيف تعمل؟</a><Link href="/ar/guide">دليل الاستخدام</Link>
        </nav>
        <div className="landing-nav-actions">
          <Link className="landing-login" href="/ar/login">تسجيل الدخول</Link>
          <Link className="btn landing-nav-cta" href="/ar/dashboard">فتح المنصة</Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <span className="eyebrow"><i /> منصة متكاملة لإدارة الزكاة</span>
          <h1>زكاتك محسوبة.<br /><em>موثّقة ومفهومة.</em></h1>
          <p>من تسجيل الأصول والمعاملات إلى احتساب الحول والنصاب والمراجعة والدفع؛ يمنحك ZakatFlow سجلاً واحداً دقيقاً وقابلاً للتدقيق.</p>
          <div className="hero-actions">
            <Link className="btn landing-primary" href="/ar/dashboard">ابدأ إدارة الزكاة <span>←</span></Link>
            <Link className="btn landing-secondary" href="/ar/assessments">جرّب الاحتساب</Link>
          </div>
          <div className="trust-row"><span>✓ سجل مالي متكامل</span><span>✓ عربي وإنجليزي</span><span>✓ للأفراد والمؤسسات</span></div>
        </div>

        <div className="hero-product" aria-label="معاينة لوحة ZakatFlow">
          <div className="product-glow" />
          <div className="product-window">
            <div className="product-head"><div><span className="mini-mark">ز</span><b>ZakatFlow</b></div><span className="window-pill">الحول الحالي</span></div>
            <div className="product-body">
              <div className="product-title"><span><small>نظرة عامة</small><strong>ملخص الزكاة</strong></span><span className="period">1447 هـ</span></div>
              <div className="hero-metrics">
                <div><small>قيمة الأصول</small><strong>1,248,500</strong><span>ريال سعودي</span></div>
                <div className="due"><small>الزكاة المستحقة</small><strong>31,212.50</strong><span>تم الاحتساب بنجاح</span></div>
              </div>
              <div className="allocation-card">
                <div className="allocation-head"><b>توزيع الوعاء الزكوي</b><span>عرض التقرير</span></div>
                <div className="bar-row"><span>النقد والسيولة</span><i><b style={{width: '82%'}} /></i><strong>48%</strong></div>
                <div className="bar-row"><span>الذهب والمعادن</span><i><b style={{width: '58%'}} /></i><strong>31%</strong></div>
                <div className="bar-row"><span>الاستثمارات</span><i><b style={{width: '39%'}} /></i><strong>21%</strong></div>
              </div>
              <div className="product-status"><span><i /> جميع البيانات محدّثة</span><b>آخر تحديث: اليوم</b></div>
            </div>
          </div>
          <div className="verified-card"><span>✓</span><div><b>الاحتساب مكتمل</b><small>النتيجة جاهزة للمراجعة</small></div></div>
        </div>
      </section>

      <section className="landing-strip" aria-label="قيم المنصة"><span><b>01</b> الدقة والشفافية</span><span><b>02</b> سجل قابل للتدقيق</span><span><b>03</b> مراجعة محاسبية وشرعية</span><span><b>04</b> كيانات متعددة</span></section>

      <section className="landing-section" id="features">
        <div className="section-heading"><span className="eyebrow"><i /> مصممة للثقة</span><h2>كل ما تحتاجه لإدارة الزكاة<br />في مكان واحد</h2><p>أدوات عملية تحول البيانات المالية إلى نتيجة واضحة يمكن مراجعتها والاعتماد عليها.</p></div>
        <div className="landing-features">{features.map((feature) => <article className="landing-feature" key={feature.title}><span className="feature-icon">{feature.icon}</span><h3>{feature.title}</h3><p>{feature.description}</p><span className="feature-link">اعرف المزيد ←</span></article>)}</div>
      </section>

      <section className="landing-section process-section" id="how-it-works">
        <div className="section-heading compact"><span className="eyebrow"><i /> رحلة واضحة</span><h2>من الأصل إلى الزكاة المستحقة</h2></div>
        <div className="process-grid">{steps.map(([number, title, description]) => <article className="process-step" key={number}><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div></article>)}</div>
      </section>

      <section className="landing-cta"><div><span>ابدأ اليوم</span><h2>حوّل إدارة الزكاة إلى عملية<br />منظمة وواضحة.</h2></div><Link className="btn cta-button" href="/ar/dashboard">فتح ZakatFlow <span>←</span></Link></section>
      <footer className="landing-footer"><div className="landing-brand"><span className="brand-mark">ز</span><span>ZakatFlow<small>إدارة الزكاة بوضوح</small></span></div><p>منصة لإدارة الزكاة بسجل مالي قابل للمراجعة ونتائج قابلة للتفسير.</p><span>© 2026 ZakatFlow</span></footer>
    </main>
  );
}
