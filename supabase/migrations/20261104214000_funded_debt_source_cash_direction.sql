-- Institutional funded-debt cash classification, additive and forward-only.
-- Existing posted/approved events and policies are deliberately unchanged.
-- Only NEW loan/advance creation records the cash direction that the canonical
-- post_debt_contract() funding settlement will produce after explicit approval.
-- OPENING contracts remain NON_CASH; an unposted contract is not a statement event.
do $migration$
declare
  definition text;
  target text := $target$'cash_direction','NON_CASH','vat_treatment'$target$;
  replacement text := $replacement$'cash_direction',
    case
      when mode='NEW' and side='RECEIVABLE' then 'OUTFLOW'
      when mode='NEW' and side='PAYABLE' then 'INFLOW'
      else 'NON_CASH'
    end,
    'vat_treatment'$replacement$;
begin
  if to_regprocedure('private.create_debt_contract(jsonb)') is null then
    raise exception 'FUNDED_DEBT_SOURCE_FUNCTION_MISSING';
  end if;
  definition := pg_get_functiondef('private.create_debt_contract(jsonb)'::regprocedure);
  if (length(definition)-length(replace(definition,target,'')))/length(target) <> 1 then
    raise exception 'FUNDED_DEBT_SOURCE_SIGNATURE_CHANGED';
  end if;
  execute replace(definition,target,replacement);
end $migration$;

-- Fail closed when a pre-migration cash-funded contract is approved for posting.
-- Do not alter its old immutable line or approval fingerprint. A new audited
-- contract/approval is required before real bank funding can be posted.
do $migration$
declare
  definition text;
  target text := $target$if e.status<>'COMMITTED'or not public.financial_event_has_valid_approval(e.id)then raise exception 'VALID_APPROVAL_REQUIRED';end if;$target$;
  replacement text := $replacement$if e.status<>'COMMITTED'or not public.financial_event_has_valid_approval(e.id)then raise exception 'VALID_APPROVAL_REQUIRED';end if;
 if c.mode='NEW' and exists(
  select 1 from public.financial_event_lines funding
   where funding.organization_id=c.organization_id and funding.event_id=e.id
    and funding.cash_direction is distinct from
     case when c.side='RECEIVABLE' then 'OUTFLOW' else 'INFLOW' end
 ) then raise exception 'DEBT_FUNDING_REISSUE_REQUIRED';end if;$replacement$;
begin
  if to_regprocedure('private.post_debt_contract(uuid)') is null then
    raise exception 'FUNDED_DEBT_POST_FUNCTION_MISSING';
  end if;
  definition := pg_get_functiondef('private.post_debt_contract(uuid)'::regprocedure);
  if (length(definition)-length(replace(definition,target,'')))/length(target) <> 1 then
    raise exception 'FUNDED_DEBT_POST_SIGNATURE_CHANGED';
  end if;
  execute replace(definition,target,replacement);
end $migration$;

-- The original SECURITY DEFINER function keeps its restricted search_path,
-- existing grants, membership checks, idempotency key and approval lifecycle.
-- No historical financial_event_lines, policies or cash balances are updated.
