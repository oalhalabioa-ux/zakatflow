-- Save the selected personal debt category within the existing atomic funding command.
-- Keep legacy clients' defaults and request fingerprints; do not rewrite existing rows.
do $patch$
declare definition text:=pg_get_functiondef('private.personal_financing_command(jsonb)'::regprocedure);
 old_fragment text:=$old$category:=case when side='RECEIVABLE'then case when kind='LOAN'then 'P_AR_LOAN'else 'P_AR_OTHER'end else case when kind='LOAN'then 'P_AP_LOAN'else 'P_AP_OTHER'end end;$old$;
 new_fragment text:=$new$category:=coalesce(nullif(p->>'category',''),case when side='RECEIVABLE'then case when kind='LOAN'then 'P_AR_LOAN'else 'P_AR_OTHER'end else case when kind='LOAN'then 'P_AP_LOAN'else 'P_AP_OTHER'end end);
 if (side='RECEIVABLE' and category not in('P_AR_PERSON','P_AR_LOAN','P_AR_RENT','P_AR_ASSET_SALE','P_AR_OTHER')) or (side='PAYABLE' and category not in('P_AP_PERSON','P_AP_LOAN','P_AP_INSTALLMENT','P_AP_ACCRUAL','P_AP_OTHER')) then raise exception 'DEBT_CATEGORY_SIDE_MISMATCH';end if;$new$;
begin
 if position(old_fragment in definition)=0 then raise exception 'PERSONAL_FINANCING_CATEGORY_PATCH_MISMATCH';end if;
 execute replace(definition,old_fragment,new_fragment);
end $patch$;
