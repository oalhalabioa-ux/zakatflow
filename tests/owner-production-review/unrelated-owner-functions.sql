-- Synthetic bodies, observed Production names/signatures only. Never copy to Production.
create function public.owner_set_member_permission_override(p_org uuid,p_user uuid,p_permission text,p_effect text,p_amount_limit numeric,p_currency text) returns boolean language sql as $$select true$$;
create function public.owner_set_organization_approval_policy(p_org uuid,p_policy text) returns boolean language sql as $$select true$$;
create function public.owner_update_organization_role(p_org uuid,p_role_id uuid,p_permissions text[],p_amount_limits jsonb) returns boolean language sql as $$select true$$;
