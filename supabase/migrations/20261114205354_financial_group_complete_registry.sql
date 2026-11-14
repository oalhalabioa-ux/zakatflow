-- Complete enumeration of the PLATFORM's registered group graph, never a
-- legal opinion about unregistered entities or authority to issue statements.
-- Both structural children and effective approved control edges are traversed.
-- Hidden children cause denial, never a partial but apparently complete roster.
create function public.financial_group_registered_scope(p_root uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare members uuid[]:=array[p_root];next_members uuid[];relationships jsonb;payload jsonb;iterations integer:=0;
begin
 if auth.uid() is null or p_root is null
  or not private.financial_opening_can(p_root,'financial_core.view')
 then raise exception 'GROUP_CONTROL_READ_DENIED';end if;
 if p_from is null or p_to is null or p_from>p_to
 then raise exception 'GROUP_CONTROL_PERIOD_INVALID';end if;
 loop
  iterations:=iterations+1;
  select array_agg(id order by id) into next_members from (
   select unnest(members) id
   union select o.id from public.organizations o where o.parent_organization_id=any(members)
   union select a.subsidiary_organization_id from private.financial_group_control_assessments a
    where a.parent_organization_id=any(members) and a.status='APPROVED'
    and a.effective_from<=p_to and (a.effective_to is null or a.effective_to>=p_from)
  ) graph;
  if cardinality(next_members)>100 or iterations>100 then raise exception 'GROUP_CONTROL_REGISTRY_TOO_LARGE';end if;
  exit when next_members=members;
  members:=next_members;
 end loop;
 if exists(select 1 from unnest(members) id where not private.financial_opening_can(id,'financial_core.view'))
 then raise exception 'GROUP_CONTROL_READ_DENIED';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'parentOrganizationId',a.parent_organization_id,'subsidiaryOrganizationId',a.subsidiary_organization_id,
  'effectiveFrom',a.effective_from,'effectiveTo',a.effective_to,
  'directEconomicInterestPercent',a.economic_interest_percent::text,
  'directVotingInterestPercent',a.voting_interest_percent::text,
  'controlBasis',a.control_basis,'controlAssessmentId',a.id,'assessmentStatus',a.status
 ) order by a.id),'[]'::jsonb) into relationships
 from private.financial_group_control_assessments a
 where a.parent_organization_id=any(members) and a.status='APPROVED'
  and a.effective_from<=p_to and (a.effective_to is null or a.effective_to>=p_from);
 payload:=jsonb_build_object('rootOrganizationId',p_root,'from',p_from,'to',p_to,
  'expectedOrganizationIds',to_jsonb(members),'authorizedOrganizationIds',to_jsonb(members),
  'relationships',relationships);
 if exists(select 1 from unnest(members) id where not private.financial_opening_can(id,'financial_core.view'))
 then raise exception 'GROUP_CONTROL_READ_DENIED';end if;
 return payload||jsonb_build_object('registry',jsonb_build_object('complete',true,
  'revision',md5(payload::text),'relationshipCount',jsonb_array_length(relationships)));
end $$;
revoke all on function public.financial_group_registered_scope(uuid,date,date) from public,anon,authenticated;
grant execute on function public.financial_group_registered_scope(uuid,date,date) to authenticated;
