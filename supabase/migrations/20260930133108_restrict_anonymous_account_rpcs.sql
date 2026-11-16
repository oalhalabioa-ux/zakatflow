-- Supabase projects may grant execute to anon directly through default privileges.
revoke all on function public.list_organization_users(uuid) from anon;
revoke all on function public.list_organization_invitations(uuid) from anon;
revoke all on function public.create_organization_invitation(uuid,text,text) from anon;
revoke all on function public.accept_organization_invitation(text) from anon;
revoke all on function public.manage_organization_member(uuid,uuid,text,text) from anon;
revoke all on function public.revoke_organization_invitation(uuid) from anon;
revoke all on function public.is_organization_member(uuid) from anon;
revoke all on function public.is_organization_owner(uuid) from anon;
revoke all on function public.is_organization_admin(uuid) from anon;
