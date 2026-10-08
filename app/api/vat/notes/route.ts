import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin, requireOrganizationMember } from '@/services/organization-access';
import { executeFinancialEventAction } from '@/services/financial-events';
import { requestErrorMessage } from '@/lib/vat-invoice-workflow';

const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    const organizationId = params.get('organization_id');
    const side = params.get('side');
    if (!organizationId || !['SALES','PURCHASE'].includes(side || '')) return NextResponse.json({error:'INVALID_VAT_NOTE'}, {status:400,headers});
    await requireOrganizationMember(supabase,user.id,organizationId);
    const {data,error} = await supabase.from('vat_documents').select('id,document_number,document_type,document_kind,counterparty_contact_id,counterparty_name,counterparty_tax_number,transaction_date,currency,source_currency,exchange_rate,recoverable_percent').eq('organization_id',organizationId).eq('document_type',side).eq('document_kind','INVOICE').order('transaction_date',{ascending:false}).limit(500);
    if (error) throw error;
    return NextResponse.json({originals:data ?? []},{headers});
  } catch(error) { return NextResponse.json({error:requestErrorMessage(error)},{status:400,headers}); }
}

const schema = z.object({ organization_id: z.string().uuid(), document_id: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_VAT_NOTE' }, { status: 400, headers });
    const { supabase, user } = await requireUser();
    const body = parsed.data;
    await requireOrganizationAdmin(supabase, user.id, body.organization_id);
    const { data: doc, error: docError } = await supabase.from('vat_documents').select('id,document_kind,document_type,zatca_status')
      .eq('organization_id', body.organization_id).eq('id', body.document_id).maybeSingle();
    if (docError) throw docError;
    if (!doc || !['CREDIT_NOTE', 'DEBIT_NOTE'].includes(doc.document_kind)) throw new Error('VAT_NOTE_NOT_FOUND');
    if (doc.document_type === 'SALES' && !['ISSUED', 'CLEARED', 'REPORTED', 'SUBMITTED'].includes(doc.zatca_status)) throw new Error('VAT_NOTE_MUST_BE_ISSUED');
    const { data: binding, error } = await supabase.from('financial_vat_source_bindings').select('event_id')
      .eq('organization_id', body.organization_id).eq('source_table', 'vat_documents').eq('source_record_id', doc.id).maybeSingle();
    if (error) throw error;
    if (!binding) throw new Error('VAT_NOTE_FINANCIAL_SOURCE_REQUIRED');
    const { data: event, error: eventError } = await supabase.from('financial_events').select('status').eq('organization_id', body.organization_id).eq('id', binding.event_id).single();
    if (eventError) throw eventError;
    if (event.status !== 'ACTUAL') {
      const { data: approved, error: approvalError } = await supabase.rpc('financial_event_has_valid_approval', { p_event_id: binding.event_id });
      if (approvalError) throw approvalError;
      if (!approved) await executeFinancialEventAction({ action: 'APPROVE', organization_id: body.organization_id, event_id: binding.event_id, note: 'Approve linked VAT note under organization policy' });
      await executeFinancialEventAction({ action: 'RECOGNIZE_VAT', organization_id: body.organization_id, event_id: binding.event_id });
    }
    return NextResponse.json({ posted: true, event_id: binding.event_id, bank_effect: 'NONE' }, { headers });
  } catch (error) {
    const code = requestErrorMessage(error);
    const pending = /VALID_APPROVAL_REQUIRED|SELF_APPROVAL|SEGREGATION|APPROVE_DENIED|CANNOT_APPROVE|INDEPENDENT_APPROVAL/.test(code);
    return NextResponse.json({ error: pending ? 'VAT_NOTE_PENDING_APPROVAL' : code }, { status: pending ? 202 : code === 'UNAUTHORIZED' ? 401 : code === 'ORGANIZATION_ADMIN_REQUIRED' ? 403 : 409, headers });
  }
}
