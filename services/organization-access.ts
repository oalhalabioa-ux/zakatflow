export async function requireOrganizationMember(
  supabase: any,
  userId: string,
  organizationId: string,
) {
  const { data, error } = await supabase
    .from('organization_members')
    .select('role,status')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.status !== 'ACTIVE') throw new Error('ORGANIZATION_ACCESS_REQUIRED');

  return data;
}

export async function requireOrganizationAdmin(
  supabase: any,
  userId: string,
  organizationId: string,
) {
  const data = await requireOrganizationMember(supabase, userId, organizationId);
  if (!['OWNER', 'ADMIN'].includes(data.role)) throw new Error('ORGANIZATION_ADMIN_REQUIRED');
  return data;
}
