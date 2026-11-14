-- Approved report source is independent of unfinished editor drafts.
create function public.financial_dimensional_opening_report_context(p_org uuid,p_fiscal_start date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare row_ private.financial_dimensional_opening_distributions%rowtype;
 original public.financial_opening_workspaces%rowtype;
 fresh boolean;
begin
 if not private.financial_opening_can(p_org,'financial_core.view')
 then raise exception 'DIMENSION_OPENING_READ_DENIED';end if;
 select * into row_ from private.financial_dimensional_opening_distributions
  where organization_id=p_org and fiscal_start=p_fiscal_start
   and status='APPROVED' limit 1;
 if row_.id is null then return jsonb_build_object('status','MISSING');end if;
 select * into original from public.financial_opening_workspaces
  where id=row_.opening_workspace_id and organization_id=p_org
   and fiscal_start=p_fiscal_start and status='APPROVED';
 fresh:=original.id is not null and original.version=row_.opening_version
   and original.currency=row_.currency
   and md5(original.approved_opening::text)=row_.opening_digest;
 if not private.financial_opening_can(p_org,'financial_core.view')
 then raise exception 'DIMENSION_OPENING_READ_DENIED';end if;
 return jsonb_build_object('status',case when fresh then row_.status else 'STALE' end,
  'kind','DIMENSION_OPENING_DISTRIBUTION_EVIDENCE_ONLY',
  'id',row_.id,'version',row_.version,'fiscalStart',row_.fiscal_start,
  'organizationId',p_org,'openingWorkspaceId',row_.opening_workspace_id,
  'openingVersion',row_.opening_version,'openingDigest',row_.opening_digest,
  'entries',row_.entries,'approvedBy',row_.approved_by,
  'approvedAt',row_.approved_at,'journalCoverageComplete',false);
end $$;
revoke all on function public.financial_dimensional_opening_report_context(uuid,date) from public,anon,authenticated;
grant execute on function public.financial_dimensional_opening_report_context(uuid,date) to authenticated;
