import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin, requireOrganizationMember } from '@/services/organization-access';
import { executeFinancialEventAction } from '@/services/financial-events';
import { requestErrorMessage } from '@/lib/vat-invoice-workflow';

const schema = z.object({ organization_id: z.string().uuid(), event_id: z.string().uuid(), account_id: z.string().uuid(), settlement_date: z.string().date(), amount: z.coerce.number().finite().positive() });
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    const organizationId = params.get('organization_id');
    const documentId = params.get('document_id');
    if (!organizationId || !documentId) return NextResponse.json({ error: 'RECEIPT_NOT_FOUND' }, { status: 404, headers });
    await requireOrganizationMember(supabase, user.id, organizationId);
    const { data: flows, error: flowError } = await supabase.from('liquidity_flows').select('id')
      .eq('organization_id', organizationId).eq('source_module', 'VAT_INTEGRATION').eq('source_record_id', documentId).eq('direction', 'INFLOW');
    if (flowError) throw flowError;
    const ids = (flows ?? []).map((flow: { id: string }) => flow.id);
    if (!ids.length) return NextResponse.json({ receipts: [] }, { headers });
    const [{ data: instructions, error: instructionError }, { data: allocations, error: allocationError }, { data: accounts, error: accountError }] = await Promise.all([
      supabase.from('financial_event_links').select('event_id,metadata').eq('organization_id', organizationId).eq('link_type', 'OTHER').eq('target_module', 'liquidity_flows').in('target_record_id', ids).contains('metadata', { purpose: 'SETTLEMENT_INSTRUCTION' }),
      supabase.from('liquidity_flow_settlement_allocations').select('settlement_id,financial_event_id,amount').eq('organization_id', organizationId).in('flow_id', ids),
      supabase.from('liquidity_accounts').select('id,name').eq('organization_id', organizationId),
    ]);
    if (instructionError) throw instructionError;
    if (allocationError) throw allocationError;
    if (accountError) throw accountError;
    const eventIds = [...new Set([...(instructions ?? []).map((row: any) => row.event_id), ...(allocations ?? []).map((row: any) => row.financial_event_id)].filter(Boolean))];
    if (!eventIds.length) return NextResponse.json({ receipts: [] }, { headers });
    const [{ data: events, error: eventError }, { data: settlements, error: settlementError }, { data: approvals, error: approvalError }] = await Promise.all([
      supabase.from('financial_events').select('id,status,event_date,created_at').eq('organization_id', organizationId).in('id', eventIds).order('created_at', { ascending: false }),
      supabase.from('liquidity_settlements').select('id,financial_event_id,status,account_id,settlement_date,amount,currency').eq('organization_id', organizationId).in('financial_event_id', eventIds),
      supabase.from('financial_event_approvals').select('event_id').eq('organization_id', organizationId).in('event_id', eventIds).eq('decision', 'APPROVED'),
    ]);
    if (eventError) throw eventError;
    if (settlementError) throw settlementError;
    if (approvalError) throw approvalError;
    const accountsById = new Map((accounts ?? []).map((row: any) => [row.id, row.name]));
    const instructionByEvent = new Map((instructions ?? []).map((row: any) => [row.event_id, row.metadata]));
    const settlementByEvent = new Map((settlements ?? []).map((row: any) => [row.financial_event_id, row]));
    const approvedIds = new Set((approvals ?? []).map((row: any) => row.event_id));
    const receipts = (events ?? []).map((event: any) => {
      const instruction = instructionByEvent.get(event.id) as any;
      const settlement = settlementByEvent.get(event.id) as any;
      const accountId = settlement?.account_id ?? instruction?.account_id;
      return { event_id: event.id, settlement_id: settlement?.id ?? null, status: settlement?.status ?? event.status,
        amount: settlement?.amount ?? instruction?.amount, currency: settlement?.currency ?? instruction?.currency,
        date: settlement?.settlement_date ?? instruction?.settlement_date, account_id: accountId,
        account_name: accountsById.get(accountId) ?? '',
        editable: !settlement && !approvedIds.has(event.id) && ['DRAFT', 'PLANNED', 'COMMITTED'].includes(event.status) };
    });
    return NextResponse.json({ receipts }, { headers });
  } catch (error) {
    const code = requestErrorMessage(error);
    return NextResponse.json({ error: code }, { status: code === 'UNAUTHORIZED' ? 401 : 400, headers });
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_RECEIPT' }, { status: 400, headers });
    const body = parsed.data;
    await requireOrganizationAdmin(supabase, user.id, body.organization_id);
    const { data: event, error: eventError } = await supabase.from('financial_events').select('id')
      .eq('organization_id', body.organization_id).eq('id', body.event_id).maybeSingle();
    if (eventError) throw eventError;
    if (!event) return NextResponse.json({ error: 'RECEIPT_NOT_FOUND' }, { status: 404, headers });
    const { data, error } = await supabase.rpc('amend_pending_invoice_receipt', { p_event_id: body.event_id, p_account_id: body.account_id, p_date: body.settlement_date, p_amount: body.amount });
    if (error) throw error;
    return NextResponse.json(data, { headers });
  } catch (error) {
    const code = requestErrorMessage(error);
    return NextResponse.json({ error: code }, { status: code === 'UNAUTHORIZED' ? 401 : code === 'ORGANIZATION_ADMIN_REQUIRED' ? 403 : 409, headers });
  }
}


export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = z.object({ organization_id: z.string().uuid(), event_id: z.string().uuid() }).parse(await request.json());
    await requireOrganizationAdmin(supabase, user.id, body.organization_id);
    const { data: link, error: linkError } = await supabase.from('financial_event_links').select('target_record_id')
      .eq('organization_id', body.organization_id).eq('event_id', body.event_id).eq('link_type', 'OTHER').eq('target_module', 'liquidity_flows').contains('metadata', { purpose: 'SETTLEMENT_INSTRUCTION' }).maybeSingle();
    if (linkError) throw linkError;
    if (!link) throw new Error('RECEIPT_NOT_FOUND');
    const { data: flow, error: flowError } = await supabase.from('liquidity_flows').select('id')
      .eq('organization_id', body.organization_id).eq('id', link.target_record_id).eq('source_module', 'VAT_INTEGRATION').eq('direction', 'INFLOW').maybeSingle();
    if (flowError) throw flowError;
    if (!flow) throw new Error('RECEIPT_NOT_FOUND');
    const { data: hasApproval, error: approvalError } = await supabase.rpc('financial_event_has_valid_approval', { p_event_id: body.event_id });
    if (approvalError) throw approvalError;
    if (!hasApproval) await executeFinancialEventAction({ action: 'APPROVE', organization_id: body.organization_id, event_id: body.event_id, note: 'Approve invoice receipt under organization policy' });
    const result = await executeFinancialEventAction({ action: 'POST_SAVED_SETTLEMENT', organization_id: body.organization_id, event_id: body.event_id });
    return NextResponse.json({ posted: true, result }, { headers });
  } catch (error) {
    const code = requestErrorMessage(error);
    const pending = /VALID_APPROVAL_REQUIRED|SELF_APPROVAL|SEGREGATION|APPROVE_DENIED|CANNOT_APPROVE/.test(code);
    return NextResponse.json({ error: pending ? 'SETTLEMENT_PENDING_APPROVAL' : code }, { status: pending ? 202 : code === 'UNAUTHORIZED' ? 401 : 409, headers });
  }
}
