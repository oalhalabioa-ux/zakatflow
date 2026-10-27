-- Applied only to dedicated Platform Admin QA (weucywfwbdnomtlkjurl).
-- Reproducible guarded subscription status transition. No payment or period extension.
create or replace function public.owner_change_subscription_status(p_subscription_id uuid,p_expected_status text,p_new_status text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_new_status not in ('active','past_due','cancelled','expired') or p_expected_status not in ('trialing','active','past_due','cancelled','expired') then raise exception 'invalid status' using errcode='22023'; end if;
 if not ((p_expected_status='trialing' and p_new_status in ('active','cancelled','expired')) or (p_expected_status='active' and p_new_status in ('past_due','cancelled','expired')) or (p_expected_status='past_due' and p_new_status in ('active','cancelled','expired'))) then raise exception 'transition not permitted' using errcode='22023'; end if;
 update public.platform_subscriptions set status=p_new_status where id=p_subscription_id and status=p_expected_status;
 if not found then raise exception 'subscription changed or missing' using errcode='40001'; end if;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details) values(auth.uid(),'subscription.status_changed','subscription',p_subscription_id,jsonb_build_object('from',p_expected_status,'to',p_new_status,'billing_effect','none'));
 return true;
end $$;
revoke all on function public.owner_change_subscription_status(uuid,text,text) from public,anon;
grant execute on function public.owner_change_subscription_status(uuid,text,text) to authenticated;
