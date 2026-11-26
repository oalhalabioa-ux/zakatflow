-- Apply the proposed leaves as one transaction, under the single-account writer's lock.
create function public.apply_financial_chart_template(p_org uuid, p_industry text, p_accounts jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  existing public.financial_chart_custom_accounts%rowtype;
  added integer := 0;
begin
  if not coalesce((public.financial_chart_workspace(p_org)->>'canManage')::boolean,false) then
    raise exception 'CHART_WRITE_DENIED';
  end if;
  if p_industry is null or p_industry !~ '^[A-Z_]{2,64}$'
     or jsonb_typeof(p_accounts) is distinct from 'array' then
    raise exception 'CHART_INPUT_INVALID';
  end if;
  if jsonb_array_length(p_accounts) not between 1 and 250 then
    raise exception 'CHART_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('chart-accounts:' || p_org::text,0));
  for item in select value from jsonb_array_elements(p_accounts) loop
    select * into existing from public.financial_chart_custom_accounts
      where organization_id = p_org and code = item->>'code';
    if found then
      if existing.parent_code is distinct from item->>'parentCode'
         or existing.name_ar is distinct from item->>'nameAr'
         or existing.name_en is distinct from item->>'nameEn'
         or existing.normal_side is distinct from item->>'normalSide'
         or not existing.is_active or not existing.is_postable then
        raise exception 'CHART_TEMPLATE_CONFLICT';
      end if;
    else
      perform public.save_financial_chart_account(p_org,item->>'code',item->>'parentCode',
        item->>'nameAr',item->>'nameEn',item->>'normalSide',true,true,0,
        'Activate industry template ' || p_industry);
      added := added + 1;
    end if;
  end loop;
  return added;
end $$;
revoke all on function public.apply_financial_chart_template(uuid,text,jsonb) from public, anon;
grant execute on function public.apply_financial_chart_template(uuid,text,jsonb) to authenticated;
