create or replace function public.financial_opening_workspace(p_org uuid,p_fiscal_start date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s jsonb; w jsonb; base text;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'OPENING_ACCESS_DENIED';end if;
 if p_fiscal_start is null or p_fiscal_start>current_date+366 then raise exception 'OPENING_PERIOD_INVALID';end if;
 select base_currency into base from public.organizations where id=p_org;
 s:=private.financial_opening_sources(p_org,p_fiscal_start-1);
 select to_jsonb(t) into w from public.financial_opening_workspaces t where organization_id=p_org and fiscal_start=p_fiscal_start
  and status in('DRAFT','APPROVED') order by case when status='DRAFT' then 0 else 1 end limit 1;
 return jsonb_build_object('organizationId',p_org,'fiscalStart',p_fiscal_start,'cutoff',p_fiscal_start-1,'currency',base,
  'periodAssetOpenings',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'assetId',a.id,'date',t.transaction_date,'name',a.name,'amount',t.base_value::text,'currency',t.base_currency) order by t.transaction_date,t.id),'[]'::jsonb)
   from public.transactions t join public.asset_accounts a on a.id=t.asset_account_id and a.organization_id=t.organization_id
   where t.organization_id=p_org and a.ownership_scope='ORGANIZATION' and t.transaction_type='OPENING_BALANCE'
    and t.transaction_date>=p_fiscal_start and t.transaction_date<p_fiscal_start+interval '1 year'),
  'bankRegister',(select coalesce(jsonb_object_agg('cash:'||a.id,jsonb_build_object(
   'balance',a.current_balance_base::text,'openedOn',coalesce(nullif(a.metadata->>'opening_date','')::date,a.created_at::date))),'{}'::jsonb)
   from public.liquidity_accounts a where a.organization_id=p_org and (a.active or a.current_balance_base<>0)),
  'registerAsOf',current_date,'chart',public.financial_reporting_chart(),'source',s,'workspace',w,'canSave',private.financial_opening_can(p_org,'financial_core.create'),
  'canApprove',private.financial_opening_can(p_org,'financial_core.approve') and private.financial_opening_can(p_org,'financial_core.post'));
end $$;
revoke all on function public.financial_opening_workspace(uuid,date) from public,anon;
grant execute on function public.financial_opening_workspace(uuid,date) to authenticated;
