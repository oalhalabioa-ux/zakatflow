'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function FeasibilityEnrollment({ locale }: { locale: string }) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function enroll() {
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/feasibility/enroll', { method: 'POST' });
      if (!response.ok) {
        setMessage(response.status === 403
          ? (ar ? 'أكّد بريد حسابك أولًا.' : 'Verify the email address on your account first.')
          : (ar ? 'تعذر إضافة الموديول. أعد المحاولة.' : 'Could not add the module. Try again.'));
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setMessage(ar ? 'تعذر إضافة الموديول. أعد المحاولة.' : 'Could not add the module. Try again.');
      setPending(false);
    }
  }

  return (
    <main className="settings-workspace" dir={ar ? 'rtl' : 'ltr'}>
      <section className="card fs-panel fs-handoff">
        <h1>{ar ? 'دراسات الجدوى وتأسيس المشاريع' : 'Feasibility & Project Development'}</h1>
        <p>{ar
          ? 'أضف تجربة شخصية لإعداد الدراسات ومقارنة السيناريوهات وحفظها سحابيًا. يمكنك أيضًا طلب الموديول ضمن باقة مؤسستك.'
          : 'Start a personal trial to prepare studies, compare scenarios and save in the cloud. You can also request the module in your organization’s bundle.'}</p>
        {message && <p role="alert">{message}</p>}
        <button className="fs-btn" type="button" onClick={enroll} disabled={pending}>
          {ar ? (pending ? 'جارٍ التفعيل…' : 'إضافة الموديول وتجربته') : (pending ? 'Activating…' : 'Add module and start trial')}
        </button>
        <Link className="fs-handoff-link" href={`/${locale}/billing?section=builder&module=feasibility`}>
          {ar ? 'إضافة الموديول إلى باقة المؤسسة' : 'Add to an organization bundle'}
        </Link>
      </section>
    </main>
  );
}
