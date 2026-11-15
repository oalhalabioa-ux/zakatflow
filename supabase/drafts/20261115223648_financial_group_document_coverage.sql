-- Review approved documentary pairs within the period against its approved batch.
-- Event references only, without documentary contents or changes to ledgers.
create index financial_group_document_approved_organizations
 on private.financial_group_document_matches(left_organization_id,right_organization_id)
 where status='APPROVED';

create function private.financial_group_document_coverage(p_root uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scope jsonb; approved jsonb; members uuid[]; unmatched jsonb;
begin
 if auth.uid() is null then raise exception 'GROUP_DOCUMENT_READ_DENIED';end if;
 scope:=public.financial_group_registered_scope(p_root,p_from,p_to);
 approved:=public.financial_group_approved_eliminations(p_root,p_from,p_to);
 select array_agg(id::uuid) into members
 from jsonb_array_elements_text(scope->'expectedOrganizationIds') as member(id);
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',m.id,'leftEventId',m.left_event_id,'rightEventId',m.right_event_id,
  'sourceCurrent',m.left_status='ACTUAL' and m.right_status='ACTUAL'
   and private.financial_group_document_fingerprint(m.left_event_id,m.right_event_id) is not distinct from m.source_fingerprint
 ) order by m.id),'[]'::jsonb) into unmatched
 from (
  select d.id,d.left_event_id,d.right_event_id,d.source_fingerprint,a.status as left_status,b.status as right_status
  from private.financial_group_document_matches d
  join public.financial_events a on a.id=d.left_event_id and a.organization_id=d.left_organization_id
  join public.financial_events b on b.id=d.right_event_id and b.organization_id=d.right_organization_id
  where d.status='APPROVED'
   and d.left_organization_id=any(members) and d.right_organization_id=any(members)
   and a.event_date between p_from and p_to and b.event_date between p_from and p_to
   and not exists(select 1 from jsonb_array_elements(approved->'entries') as entry(value)
    where entry.value->>'documentMatchId'=d.id::text)
  order by d.id limit 201
 ) m;
 if jsonb_array_length(unmatched)>200 then raise exception 'GROUP_DOCUMENT_COVERAGE_LIMIT';end if;
 if scope is distinct from public.financial_group_registered_scope(p_root,p_from,p_to)
  then raise exception 'GROUP_DOCUMENT_SCOPE_CHANGED';end if;
 return jsonb_build_object('status','GROUP_DOCUMENT_COVERAGE_REVIEW','organization',p_root,'from',p_from,'to',p_to,
  'batchId',approved->'id','batchVersion',approved->'version','rows',unmatched);
end $$;
revoke all on function private.financial_group_document_coverage(uuid,date,date) from public,anon,authenticated;
grant execute on function private.financial_group_document_coverage(uuid,date,date) to authenticated;

create function public.financial_group_document_coverage(p_root uuid,p_from date,p_to date)
returns jsonb language sql security invoker set search_path='' as $$
 select private.financial_group_document_coverage(p_root,p_from,p_to)
$$;
revoke all on function public.financial_group_document_coverage(uuid,date,date) from public,anon,authenticated;
grant execute on function public.financial_group_document_coverage(uuid,date,date) to authenticated;
