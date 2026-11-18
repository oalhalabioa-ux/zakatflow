import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import StudyProposalReview from '@/components/feasibility/StudyProposalReview';
import { supabaseServer } from '@/lib/supabase/server';
import '../../feasibility.css';

const ids = z.object({ organization: z.string().uuid(), project: z.string().uuid(), proposal: z.string().uuid() });

export default async function Page({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES !== 'true'
    || process.env.FEASIBILITY_ORG_SHARING !== 'true' || process.env.FEASIBILITY_ORG_QA !== 'true') notFound();

  const { locale } = await params;
  const supabase = await supabaseServer();
  if (!(await supabase.auth.getUser()).data.user) redirect('/' + locale + '/login');
  const query = ids.safeParse(await searchParams);
  if (!query.success) notFound();
  return <StudyProposalReview locale={locale} {...query.data}/>;
}
