import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/services/auth';
import { requireOrganizationMember } from '@/services/organization-access';
import { executeFinancialEventAction } from '@/services/financial-events';
const canWrite=async(supabase:any,userId:string,organizationId:string)=>{const{data}=await supabase.from('organization_members').select('role').eq('organization_id',organizationId).eq('user_id',userId).eq('status','ACTIVE').maybeSingle();return !!data&&['OWNER','ADMIN','ACCOUNTANT','ADVISOR'].includes(data.role)};
const schema=z.object({
 status:z.enum(['ACTUAL','CONFIRMED','EXPECTED']).optional(),direction:z.enum(['INFLOW','OUTFLOW']).optional(),
 flow_type:z.enum(['OPERATING','PAYROLL','TAX','FINANCING','INVESTMENT','OTHER']).optional(),category_id:z.string().uuid().nullable().optional(),due_date:z.string().date().optional(),
 title:z.string().trim().min(1).max(160).optional(),counterparty:z.string().max(160).optional(),counterparty_id:z.string().uuid().nullable().optional(),
 amount:z.coerce.number().positive().optional(),base_amount:z.coerce.number().positive().optional(),currency:z.string().length(3).optional(),
 account_id:z.string().uuid().nullable().optional(),entity_id:z.string().uuid().nullable().optional(),
 source:z.enum(['MANUAL','INVOICE','IMPORT','VAT','ACCOUNTING']).optional(),settlement_date:z.string().date().optional(),notes:z.string().max(500).optional(),reference:z.string().max(120).optional()
}).refine(v=>Object.keys(v).length>0);
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{
 const{id}=await params;const{supabase,user}=await requireUser();const body=schema.parse(await request.json());
 const{data:record,error:lookupError}=await supabase.from('liquidity_flows').select('id,organization_id,entity_id,account_id,counterparty_id,category_id,flow_type,due_date,transfer_id,intercompany_transfer_id,direction,amount,currency,base_amount,status,source_module,source_record_id,source_event_key,settled_amount,settlement_status,title').eq('id',id).maybeSingle();
 if(lookupError)throw lookupError;if(!record)return NextResponse.json({error:'LIQUIDITY_RECORD_NOT_FOUND'},{status:404});
 if(record.transfer_id||record.intercompany_transfer_id)return NextResponse.json({error:'TRANSFER_LEGS_CANNOT_BE_EDITED_HERE'},{status:409});
 await requireOrganizationMember(supabase,user.id,record.organization_id);
 if(!await canWrite(supabase,user.id,record.organization_id))return NextResponse.json({error:'ORGANIZATION_ADMIN_REQUIRED'},{status:403});
 for(const [field,table] of [['account_id','liquidity_accounts'],['entity_id','organization_entities'],['counterparty_id','liquidity_counterparties']] as const){
   const value=body[field];if(value){const{data,error}=await supabase.from(table).select('id').eq('id',value).eq('organization_id',record.organization_id).maybeSingle();if(error)throw error;if(!data)return NextResponse.json({error:field.toUpperCase()+'_ORGANIZATION_MISMATCH'},{status:400});}
 }
 if(body.status==='ACTUAL'&&record.settlement_status!=='SETTLED'){
   if(!record.source_module||record.source_module==='MANUAL'){
     let treatment:string|null=null;
     if(record.category_id){const{data:cat,error:catError}=await supabase.from('liquidity_flow_categories').select('financial_classification_type,flow_group').eq('id',record.category_id).eq('organization_id',record.organization_id).maybeSingle();if(catError)throw catError;treatment=cat?.financial_classification_type??null;if(!treatment&&cat?.flow_group==='OPERATING')treatment=record.direction==='INFLOW'?'REVENUE':'OPEX';}
     if(!treatment){if(record.flow_type==='OPERATING')treatment=record.direction==='INFLOW'?'REVENUE':'OPEX';else if(record.flow_type==='PAYROLL')treatment='OPEX';else if(record.flow_type==='TAX')treatment='TAX';else if(record.flow_type==='FINANCING')treatment='FINANCING';else if(record.flow_type==='INVESTMENT')treatment='INVESTMENT';}
     if(!treatment)return NextResponse.json({error:'FINANCIAL_TREATMENT_REQUIRED'},{status:409});
     const obligationType=record.direction==='OUTFLOW'?'PAYABLE':'RECEIVABLE';
     const [{data:recognitionClass,error:rcError},{data:obligationClass,error:ocError},{data:organization,error:orgError}]=await Promise.all([
       supabase.from('financial_classifications').select('id').eq('organization_id',record.organization_id).eq('classification_type',treatment).eq('active',true).limit(1).maybeSingle(),
       supabase.from('financial_classifications').select('id').eq('organization_id',record.organization_id).eq('classification_type',obligationType).eq('active',true).limit(1).maybeSingle(),
       supabase.from('organizations').select('base_currency').eq('id',record.organization_id).single()
     ]);if(rcError)throw rcError;if(ocError)throw ocError;if(orgError)throw orgError;if(!recognitionClass||!obligationClass)return NextResponse.json({error:'FINANCIAL_CLASSIFICATION_REQUIRED'},{status:409});
     const recognitionKey=`liquidity:${record.id}:recognition`;
     let{data:existing,error:existingError}=await supabase.from('financial_events').select('id,status').eq('organization_id',record.organization_id).eq('source_module','OPERATIONAL_CONSOLE').eq('source_event_key',recognitionKey).maybeSingle();if(existingError)throw existingError;
     let created:any=existing;
     if(!created){const exchangeRate=Number(record.base_amount)/Number(record.amount);created=await executeFinancialEventAction({action:'CREATE',payload:{organization_id:record.organization_id,entity_id:record.entity_id,counterparty_id:record.counterparty_id,event_type:treatment==='CAPEX'||treatment==='ASSET'||treatment==='INVESTMENT'?'ASSET_PURCHASE':record.direction==='INFLOW'?'REVENUE':'EXPENSE',source_module:'OPERATIONAL_CONSOLE',source_record_id:record.id,source_event_key:recognitionKey,event_date:record.due_date,due_date:record.due_date,base_currency:organization.base_currency,description:record.title,lines:[{line_number:1,description:record.title,classification_id:recognitionClass.id,cost_center_id:null,amount:Number(record.amount),currency:record.currency,exchange_rate:exchangeRate,base_amount:Number(record.base_amount),cash_direction:'NON_CASH',vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}],obligations:[{obligation_key:`liquidity:${record.id}:obligation`,obligation_type:obligationType,settleable_amount:Number(record.amount),currency:record.currency,exchange_rate:exchangeRate,base_currency:organization.base_currency,settleable_base_amount:Number(record.base_amount)}]}});}
     const eventId=typeof created==='string'?created:(created?.event_id??created?.id);if(!eventId)throw new Error('LIQUIDITY_RECOGNITION_EVENT_ID_MISSING');
     const{error:linkError}=await supabase.from('financial_event_links').upsert({organization_id:record.organization_id,event_id:eventId,link_type:'CASH_FLOW',target_module:'liquidity_flows',target_record_id:record.id},{onConflict:'organization_id,event_id,link_type,target_module,target_record_id'});if(linkError)throw linkError;
     const{data:event}=await supabase.from('financial_events').select('status').eq('id',eventId).single();
     if(event?.status==='DRAFT')await executeFinancialEventAction({action:'TRANSITION',organization_id:record.organization_id,event_id:eventId,status:'PLANNED',note:'Legacy liquidity recognition'});
     const{data:planned}=await supabase.from('financial_events').select('status').eq('id',eventId).single();
     if(planned?.status==='PLANNED')await executeFinancialEventAction({action:'TRANSITION',organization_id:record.organization_id,event_id:eventId,status:'COMMITTED',note:'Legacy liquidity obligation'});
     const{data:committed}=await supabase.from('financial_events').select('status,created_by').eq('id',eventId).single();
     if(committed?.status==='COMMITTED'){
       const{data:approval,error:approvalError}=await supabase.from('financial_event_approvals').select('id,approver_id,decision').eq('organization_id',record.organization_id).eq('event_id',eventId).eq('decision','APPROVED').maybeSingle();if(approvalError)throw approvalError;
       if(!approval||approval.approver_id===committed.created_by)return NextResponse.json({id:record.id,status:record.status,settlement_status:'RECOGNITION_PENDING_APPROVAL',recognition_event_id:eventId,error:'CORE_RECOGNITION_APPROVAL_REQUIRED'},{status:202});
       await executeFinancialEventAction({action:'TRANSITION',organization_id:record.organization_id,event_id:eventId,status:'ACTUAL',note:'Activated after independent approval'});
     }
     const{error:flowLinkError}=await supabase.from('liquidity_flows').update({source_module:'LIQUIDITY',source_record_id:record.id,source_event_key:recognitionKey,updated_at:new Date().toISOString()}).eq('id',record.id);if(flowLinkError)throw flowLinkError;
     record.source_module='LIQUIDITY';record.source_record_id=record.id;record.source_event_key=recognitionKey;
   }
   const accountId=body.account_id??record.account_id;
   if(!accountId)return NextResponse.json({error:'SETTLEMENT_ACCOUNT_REQUIRED'},{status:400});
   const{data:account,error:accountError}=await supabase.from('liquidity_accounts').select('id,currency').eq('id',accountId).eq('organization_id',record.organization_id).maybeSingle();
   if(accountError)throw accountError;if(!account)return NextResponse.json({error:'ACCOUNT_ORGANIZATION_MISMATCH'},{status:400});
   if(account.currency!==record.currency)return NextResponse.json({error:'SETTLEMENT_ACCOUNT_CURRENCY_MISMATCH'},{status:400});
   const{data:links,error:linkError}=await supabase.from('financial_event_links').select('event_id').eq('organization_id',record.organization_id).eq('link_type','CASH_FLOW').eq('target_module','liquidity_flows').eq('target_record_id',record.id);
   if(linkError)throw linkError;if(!links?.length)return NextResponse.json({error:'CORE_RECOGNITION_LINK_REQUIRED'},{status:409});
   const linkedEventIds=[...new Set(links.map((item:any)=>item.event_id))];
   const{data:recognitions,error:recognitionError}=await supabase.from('financial_events').select('id,status,entity_id,counterparty_id,base_currency,event_type').eq('organization_id',record.organization_id).in('id',linkedEventIds).neq('event_type','SETTLEMENT');
   if(recognitionError)throw recognitionError;if(!recognitions?.length)return NextResponse.json({error:'CORE_RECOGNITION_LINK_REQUIRED'},{status:409});
   if(recognitions.length!==1)return NextResponse.json({error:'MULTIPLE_CORE_RECOGNITIONS_REQUIRE_SELECTION'},{status:409});
   const recognition=recognitions[0];
   if(recognition.status!=='ACTUAL')return NextResponse.json({error:'CORE_RECOGNITION_MUST_BE_ACTUAL'},{status:409});
   const{data:balances,error:balanceError}=await supabase.from('financial_event_obligation_balances').select('obligation_id,obligation_type,outstanding_base_amount').eq('organization_id',record.organization_id).eq('event_id',recognition.id).gt('outstanding_base_amount',0);
   if(balanceError)throw balanceError;if(!balances?.length)return NextResponse.json({error:'NO_OUTSTANDING_OBLIGATION'},{status:409});
   if(balances.length!==1)return NextResponse.json({error:'MULTIPLE_OBLIGATIONS_REQUIRE_ALLOCATION'},{status:409});
   const remainingAmount=Math.max(0,Number(record.amount)-Number(record.settled_amount||0));
   const remainingBase=Number(balances[0].outstanding_base_amount);
   if(!(remainingAmount>0&&remainingBase>0))return NextResponse.json({error:'NO_OUTSTANDING_OBLIGATION'},{status:409});
   if(!['PAYABLE','RECEIVABLE'].includes(balances[0].obligation_type))return NextResponse.json({error:'UNSUPPORTED_SETTLEMENT_OBLIGATION_TYPE'},{status:409});
   const classificationType=balances[0].obligation_type as 'PAYABLE'|'RECEIVABLE';
   const{data:classification,error:classError}=await supabase.from('financial_classifications').select('id').eq('organization_id',record.organization_id).eq('classification_type',classificationType).eq('active',true).limit(1).maybeSingle();
   if(classError)throw classError;if(!classification)return NextResponse.json({error:'SETTLEMENT_CLASSIFICATION_REQUIRED'},{status:409});
   const settlementDate=body.settlement_date??new Date().toISOString().slice(0,10);
   const exchangeRate=remainingBase/remainingAmount;
   const settlementSourceKey=`liquidity:${record.id}:settlement:${Number(record.settled_amount||0)}`;
   const{data:existingSettlement,error:existingSettlementError}=await supabase.from('financial_events').select('id,status').eq('organization_id',record.organization_id).eq('event_type','SETTLEMENT').eq('source_module','OPERATIONAL_CONSOLE').eq('source_event_key',settlementSourceKey).maybeSingle();
   if(existingSettlementError)throw existingSettlementError;
   let created:any=existingSettlement;
   if(!created)created=await executeFinancialEventAction({action:'CREATE',payload:{organization_id:record.organization_id,entity_id:recognition.entity_id,counterparty_id:recognition.counterparty_id,event_type:'SETTLEMENT',source_module:'OPERATIONAL_CONSOLE',source_event_key:settlementSourceKey,event_date:settlementDate,due_date:null,base_currency:recognition.base_currency,description:`Settlement · ${record.title}`,lines:[{line_number:1,description:`Settlement · ${record.title}`,classification_id:classification.id,cost_center_id:null,amount:remainingAmount,currency:record.currency,exchange_rate:exchangeRate,base_amount:remainingBase,cash_direction:record.direction,vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}],obligations:[]}});
   const settlementEventId=typeof created==='string'?created:(created?.event_id??created?.id);
   if(!settlementEventId)throw new Error('SETTLEMENT_EVENT_ID_MISSING');
   const{data:settlementEvent}=await supabase.from('financial_events').select('status').eq('id',settlementEventId).single();
   if(settlementEvent?.status==='DRAFT')await executeFinancialEventAction({action:'TRANSITION',organization_id:record.organization_id,event_id:settlementEventId,status:'PLANNED',note:'Created from Cash Management'});
   const{data:afterPlanned}=await supabase.from('financial_events').select('status').eq('id',settlementEventId).single();
   if(afterPlanned?.status==='PLANNED')await executeFinancialEventAction({action:'TRANSITION',organization_id:record.organization_id,event_id:settlementEventId,status:'COMMITTED',note:'Pending independent settlement approval'});
   // Keep the originally expected account on the flow for audit. The selected actual account is stored on cash posting after approval.
   return NextResponse.json({id:record.id,status:record.status,settlement_status:'PENDING_APPROVAL',settlement_event_id:settlementEventId,recognition_event_id:recognition.id,obligation_id:balances[0].obligation_id,amount:remainingAmount,base_amount:remainingBase,account_id:accountId},{status:202});
 }
 if(body.category_id){const{data:category,error}=await supabase.from('liquidity_flow_categories').select('id,flow_group,allowed_direction').eq('id',body.category_id).eq('organization_id',record.organization_id).eq('active',true).maybeSingle();if(error)throw error;if(!category)return NextResponse.json({error:'CATEGORY_ORGANIZATION_MISMATCH'},{status:400});const direction=body.direction||record.direction;if(category.allowed_direction!=='BOTH'&&category.allowed_direction!==direction)return NextResponse.json({error:'CATEGORY_DIRECTION_NOT_ALLOWED'},{status:400});body.flow_type=category.flow_group;}
 const update:any={...body,updated_at:new Date().toISOString()};
 if(body.counterparty_id){const{data,error}=await supabase.from('liquidity_counterparties').select('name').eq('id',body.counterparty_id).eq('organization_id',record.organization_id).eq('active',true).single();if(error)throw error;update.counterparty=data.name;}
 const{data,error}=await supabase.from('liquidity_flows').update(update).eq('id',id).select().single();if(error)throw error;return NextResponse.json(data)
}catch(error){const message=error instanceof Error?error.message:'LIQUIDITY_UPDATE_FAILED';return NextResponse.json({error:message},{status:message==='UNAUTHORIZED'?401:/ACCESS_REQUIRED/.test(message)?403:400})}}
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    const { data: account } = await supabase.from('liquidity_accounts').select('id,organization_id').eq('id', id).maybeSingle();
    const { data: flow } = account ? { data: null } : await supabase.from('liquidity_flows').select('id,organization_id,transfer_id,intercompany_transfer_id').eq('id', id).maybeSingle();
    const record = account ?? flow;
    if (!record) return NextResponse.json({ error: 'LIQUIDITY_RECORD_NOT_FOUND' }, { status: 404 });
    await requireOrganizationMember(supabase, user.id, record.organization_id);
    if (!await canWrite(supabase,user.id,record.organization_id)) return NextResponse.json({ error: 'ORGANIZATION_ADMIN_REQUIRED' }, { status: 403 });
    let result;
    if (account) result = await supabase.from('liquidity_accounts').delete().eq('id', id);
    else if (flow?.transfer_id) result = await supabase.rpc('delete_liquidity_transfer', { p_transfer_id: flow.transfer_id });
    else if (flow?.intercompany_transfer_id) {
      const { data: transfer, error: transferError } = await supabase.from('liquidity_intercompany_transfers').select('id,holding_organization_id,source_organization_id,destination_organization_id').eq('id', flow.intercompany_transfer_id).single();
      if (transferError) throw transferError;
      for (const organizationId of [transfer.holding_organization_id,transfer.source_organization_id,transfer.destination_organization_id]) {
        await requireOrganizationMember(supabase,user.id,organizationId);
        if (!await canWrite(supabase,user.id,organizationId)) return NextResponse.json({error:'ORGANIZATION_ADMIN_REQUIRED'},{status:403});
      }
      result = await supabase.rpc('delete_liquidity_intercompany_transfer', { p_transfer_id: flow.intercompany_transfer_id });
    } else result = await supabase.from('liquidity_flows').delete().eq('id', id);
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'LIQUIDITY_DELETE_FAILED' }, { status: error instanceof Error && error.message === 'UNAUTHORIZED' ? 401 : 400 }); }
}