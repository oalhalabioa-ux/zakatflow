import type { supabaseServer } from '@/lib/supabase/server';
import type { FeasibilityAccessGrant } from './access';

export const feasibilitySelfServeEnabled = () => process.env.FEASIBILITY_SELF_SERVE === 'true';

export async function readFeasibilityGrant(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
) {
  if (feasibilitySelfServeEnabled()) {
    const { data, error } = await supabase.rpc('my_feasibility_access');
    return { data: data as FeasibilityAccessGrant | null, error };
  }
  const { data, error } = await supabase.from('feasibility_access_grants')
    .select('status,starts_at,ends_at').eq('user_id', userId).maybeSingle();
  return { data: data as FeasibilityAccessGrant | null, error };
}
