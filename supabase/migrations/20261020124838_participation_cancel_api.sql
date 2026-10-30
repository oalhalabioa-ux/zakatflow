revoke all on function private.cancel_participation_movement(uuid,text)from public,anon;grant execute on function private.cancel_participation_movement(uuid,text)to authenticated;
create function public.cancel_participation_movement(p_id uuid,p_reason text)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.cancel_participation_movement(p_id,p_reason);$$;
revoke all on function public.cancel_participation_movement(uuid,text)from public,anon;grant execute on function public.cancel_participation_movement(uuid,text)to authenticated;
