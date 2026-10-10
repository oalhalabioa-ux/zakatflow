import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin } from '@/services/organization-access';
import { executeFinancialEventAction } from '@/services/financial-events';
import { requestErrorMessage } from '@/lib/vat-invoice-workflow';

const headers = { 'Cache-Control': 'no-store' };
const schema = z.object({ organization_id: z.string().uuid(), document_id: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INVOICE_RECOGNITION' }, { status: 400, headers });
    const { supabase, user } = await requireUser();
    const body = parsed.data;
    await requireOrganizationAdmin(supabase, user.id, body.organization_id);
    const { data: doc, error: docError } = await supabase.from('vat_documents').select('id,document_kind,asset_transaction_id')
      .eq('organization_id', body.organization_id).eq('id', body.document_id).maybeSingle();
    if (docError) throw docError;
    if (!doc || doc.document_kind !== 'INVOICE') throw new Error('VAT_ORIGINAL_ACCOUNTING_INVOICE_REQUIRED');
    const { data: link, error: linkError } = await supabase.from('financial_event_links').select('event_id')
      .eq('organization_id', body.organization_id).eq('link_type', 'SOURCE').eq('target_module', 'vat_documents').eq('target_record_id', doc.id).single();
    if (linkError) throw linkError;
    const { data: event, error: eventError } = await supabase.from('financial_events').select('id,status,source_module,event_type')
      .eq('organization_id', body.organization_id).eq('id', link.event_id).single();
    if (eventError) throw eventError;
    if (!['REVENUE', 'EXPENSE', 'CAPEX'].includes(event.event_type)&&!(doc.asset_transaction_id&&['ASSETS_INTEGRATION','ASSET_LIFECYCLE'].includes(event.source_module))) throw new Error('VAT_ORIGINAL_RECOGNITION_REQUIRED');
    if (event.status !== 'ACTUAL') {
      if(doc.asset_transaction_id&&event.status==='DRAFT'){await executeFinancialEventAction({action:'TRANSITION',organization_id:body.organization_id,event_id:event.id,status:'PLANNED',note:'Asset invoice prepared'});event.status='PLANNED';}
      if(doc.asset_transaction_id&&event.status==='PLANNED'){await executeFinancialEventAction({action:'TRANSITION',organization_id:body.organization_id,event_id:event.id,status:'COMMITTED',note:'Asset invoice approval requested'});event.status='COMMITTED';}
      const { data: approved, error: approvalError } = await supabase.rpc('financial_event_has_valid_approval', { p_event_id: event.id });
      if (approvalError) throw approvalError;
      if (!approved) await executeFinancialEventAction({ action: 'APPROVE', organization_id: body.organization_id, event_id: event.id, note: 'Approve invoice recognition under organization policy' });
      if (event.source_module === 'VAT_INTEGRATION') await executeFinancialEventAction({ action: 'RECOGNIZE_VAT', organization_id: body.organization_id, event_id: event.id });
      else await executeFinancialEventAction({ action: 'TRANSITION', organization_id: body.organization_id, event_id: event.id, status: 'ACTUAL', note: 'Post original invoice recognition without cash' });
    }
    return NextResponse.json({ posted: true, event_id: event.id, bank_effect: 'NONE' }, { headers });
  } catch (error) {
    const code = requestErrorMessage(error);
    const pending = /VALID_APPROVAL_REQUIRED|SELF_APPROVAL|SEGREGATION|APPROVE_DENIED|CANNOT_APPROVE|INDEPENDENT_APPROVAL/.test(code);
    return NextResponse.json({ error: pending ? 'INVOICE_PENDING_APPROVAL' : code }, { status: pending ? 202 : code === 'UNAUTHORIZED' ? 401 : code === 'ORGANIZATION_ADMIN_REQUIRED' ? 403 : 409, headers });
  }
}
