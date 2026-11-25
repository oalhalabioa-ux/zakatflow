import Link from '@/components/WorkspaceLink';

export default async function Workflow({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params,ar=locale==='ar';
 return <main className="container review-workflow" dir={ar?'rtl':'ltr'}>
  <header className="page-head"><div><span className="pill">{ar?'غير مفعلة':'Not active'}</span><h1>{ar?'دورة المراجعة والاعتماد':'Review and approval workflow'}</h1></div></header>
  <section className="card section">
   <p role="status">{ar?'لا توجد دورة اعتماد موحدة مفعّلة في هذه الصفحة. افتح الاحتسابات والدفعات لعرض سجلاتك وإدارة الإجراءات المتاحة في النطاق المختار.':'A unified approval workflow is not active on this page. Open assessments and payments to view your saved records and manage the actions available in the selected workspace.'}</p>
   <div className="operation-detail-actions">
    <Link className="btn" href={`/${locale}/assessments`}>{ar?'فتح احتسابات الزكاة':'Open Zakat assessments'}</Link>
    <Link className="btn secondary" href={`/${locale}/payments`}>{ar?'فتح دفعات الزكاة':'Open Zakat payments'}</Link>
   </div>
  </section>
 </main>;
}
