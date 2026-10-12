import { NextResponse } from 'next/server';
import { requireUser } from '../../../../services/auth';
import { requireOrganizationMember } from '../../../../services/organization-access';
import { buildUnifiedInvoices } from '../../../../lib/unified-invoice-register';
import {assetPurchaseInvoices} from '../../../../lib/asset-invoice-source';
export const runtime = 'nodejs';
const pageSize = 200;
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    const organizationId = params.get('organization_id');
    const offset = Number(params.get('offset') || 0);
    if (!organizationId || !Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ error: 'INVALID_REGISTER_QUERY' }, { status: 400 });
    await requireOrganizationMember(supabase, user.id, organizationId);
    const [documentsResult, standaloneResult, assetsResult] = await Promise.all([
      supabase.from('vat_documents').select('id,asset_transaction_id,document_number,counterparty_name,transaction_date,due_date,document_type,document_kind,zatca_status,currency,source_currency,source_gross_amount,source_tax_amount,gross_amount,tax_amount,preceding_document_id')
        .eq('organization_id', organizationId).order('transaction_date', { ascending: false }).order('id').range(offset, offset + pageSize),
      supabase.from('vat_einvoices').select('id,accounting_document_id,invoice_number,buyer_name,issue_date,due_date,document_type,status,currency,payable_amount,tax_total_amount,exchange_rate,preceding_invoice_id,billing_reference')
        .eq('organization_id', organizationId).is('accounting_document_id', null).order('issue_date', { ascending: false }).order('id').range(offset, offset + pageSize),
      supabase.from('transactions').select('id,organization_id,asset_account_id,transaction_type,transaction_date,reference,currency,base_currency,gross_value,base_value,metadata,reversal_of_transaction_id').eq('organization_id',organizationId).eq('transaction_type','PURCHASE').order('transaction_date',{ascending:false}).order('id').range(offset,offset+pageSize),
    ]);
    if (assetsResult.error) throw assetsResult.error;
    const assetTransactions = (assetsResult.data || []).slice(0,pageSize);
    if (documentsResult.error) throw documentsResult.error;
    if (standaloneResult.error) throw standaloneResult.error;
    const documents = (documentsResult.data || []).slice(0, pageSize);
    const standalone = (standaloneResult.data || []).slice(0, pageSize);
    const ids = documents.map(d => d.id);
    const originalIds = [...new Set(documents.map(d => d.preceding_document_id).filter(Boolean))];
    const empty = { data: [], error: null };
    const [electronic, flows, links, bindings, originals] = await Promise.all([
      ids.length ? supabase.from('vat_einvoices').select('id,accounting_document_id,invoice_number,buyer_name,issue_date,due_date,document_type,status,currency,payable_amount,tax_total_amount,exchange_rate,preceding_invoice_id,billing_reference').eq('organization_id', organizationId).in('accounting_document_id', ids) : empty,
      ids.length ? supabase.from('liquidity_flows').select('id,source_record_id,amount,settled_amount,settlement_status,currency,direction,due_date').eq('organization_id', organizationId).eq('source_module', 'VAT_INTEGRATION').in('source_record_id', ids) : empty,
      ids.length ? supabase.from('financial_event_links').select('event_id,target_record_id').eq('organization_id', organizationId).eq('target_module', 'vat_documents').eq('link_type', 'SOURCE').in('target_record_id', ids) : empty,
      ids.length ? supabase.from('financial_vat_source_bindings').select('event_id,source_record_id').eq('organization_id', organizationId).eq('source_table', 'vat_documents').in('source_record_id', ids) : empty,
      originalIds.length ? supabase.from('vat_documents').select('id,document_number').eq('organization_id', organizationId).in('id', originalIds) : empty,
    ]);
    for (const result of [electronic, flows, links, bindings, originals]) if (result.error) throw result.error;
    const eventIds = [...new Set([...assetTransactions.map(t=>t.metadata?.financial_event_id).filter(Boolean),...(links.data || []).map(l => l.event_id), ...(bindings.data || []).map(b => b.event_id)])];
    const events = eventIds.length ? await supabase.from('financial_events').select('id,organization_id,source_module,source_record_id,status,counterparty_id,due_date').eq('organization_id', organizationId).in('id', eventIds) : empty;
    if (events.error) throw events.error;
    const statusByEvent = new Map<string,string>((events.data || []).map(e => [e.id, e.status]));
    const statusByDocument = new Map<string,string>();
    for (const l of links.data || []) statusByDocument.set(l.target_record_id, statusByEvent.get(l.event_id) || 'UNLINKED');
    for (const b of bindings.data || []) statusByDocument.set(b.source_record_id, statusByEvent.get(b.event_id) || 'UNLINKED');
    const assetIds = [...new Set([...assetTransactions.map(t=>t.id),...documents.map(d=>d.asset_transaction_id).filter(Boolean)])];
    const [assetBindings,assetFlows,assetParties] = await Promise.all([
      assetIds.length ? supabase.from('vat_documents').select('organization_id,asset_transaction_id').eq('organization_id',organizationId).in('asset_transaction_id',assetIds) : empty,
      assetIds.length ? supabase.from('liquidity_flows').select('id,source_record_id,amount,settled_amount,settlement_status,currency,direction,due_date').eq('organization_id',organizationId).eq('source_module','ASSETS_INTEGRATION').in('source_record_id',assetIds) : empty,
      eventIds.length ? supabase.from('liquidity_counterparties').select('id,organization_id,name').eq('organization_id',organizationId).in('id',[...new Set((events.data||[]).map(e=>e.counterparty_id).filter(Boolean))]) : empty,
    ]);
    for(const result of [assetBindings,assetFlows,assetParties]) if(result.error)throw result.error;
    const assetInvoices=assetPurchaseInvoices(assetTransactions,events.data||[],assetParties.data||[],assetBindings.data||[]);
    const rows = buildUnifiedInvoices(documents, [...(electronic.data || []), ...standalone], flows.data || [], statusByDocument, new Map((originals.data || []).map(o => [o.id, o.document_number])));
    for(const row of rows){if(row.sourceTransactionId)row.flow=(assetFlows.data||[]).find(f=>f.source_record_id===row.sourceTransactionId)||row.flow;}
    for(const a of assetInvoices)rows.push({id:'asset:'+a.id,documentId:null,electronicId:null,source:'ASSETS',sourceTransactionId:a.id,side:'PURCHASE',kind:'INVOICE',category:'INVOICE',number:a.reference,name:a.partyName,date:a.date,due:a.due,currency:a.currency,baseAmount:a.baseTotal,total:a.total,tax:a.tax,accountingStatus:a.accountingStatus,status:'REGISTERED',originalId:null,originalNumber:null,flow:(assetFlows.data||[]).find(f=>f.source_record_id===a.id)||null});
    return NextResponse.json({ rows, nextOffset: documentsResult.data.length > pageSize || standaloneResult.data.length > pageSize || assetsResult.data.length > pageSize ? offset + pageSize : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = message === 'UNAUTHORIZED' ? 401 : message === 'ORGANIZATION_ACCESS_REQUIRED' ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? 'REGISTER_LOAD_FAILED' : message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
