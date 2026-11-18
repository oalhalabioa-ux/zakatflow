import { Suspense } from 'react';
import {feasibilityOrganizationOptions} from '@/lib/feasibility/organization-options';
import { notFound, redirect } from 'next/navigation';
import OrganizationStudyInbox from '@/components/feasibility/OrganizationStudyInbox';
import { supabaseServer } from '@/lib/supabase/server';
import '../feasibility.css';

export const dynamic = 'force-dynamic';

export default async function SharedFeasibilityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES !== 'true'
    || process.env.FEASIBILITY_ORG_SHARING !== 'true' || process.env.FEASIBILITY_ORG_QA !== 'true') notFound();

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/' + locale + '/login');
  const organizations=await feasibilityOrganizationOptions(supabase);
  return <Suspense fallback={null}><OrganizationStudyInbox locale={locale} organizations={organizations}/></Suspense>;
}
