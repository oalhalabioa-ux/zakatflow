import type {supabaseServer} from '@/lib/supabase/server';
import type {WorkspaceOrganization} from '@/lib/workspace-organization';

export async function feasibilityOrganizationOptions(
 supabase:Awaited<ReturnType<typeof supabaseServer>>
):Promise<WorkspaceOrganization[]> {
 const {data,error}=await supabase.from('organizations')
  .select('id,name,organization_kind,parent_organization_id,sort_order')
  .eq('status','ACTIVE')
  .order('sort_order',{ascending:true});
 return error?[]:data??[];
}
