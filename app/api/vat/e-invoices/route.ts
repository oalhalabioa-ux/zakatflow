import { NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { calculateVatEInvoiceDraft, vatEInvoiceDraftSchema } from '@/lib/vat-einvoice-draft';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin, requireOrganizationMember } from '@/services/organization-access';

export const runtime = 'nodejs';

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const known = new Set([
    'UNAUTHORIZED', 'ORGANIZATION_ACCESS_REQUIRED', 'ORGANIZATION_ADMIN_REQUIRED',
    'VAT_PROFILE_REQUIRED', 'VAT_REGISTRATION_REQUIRED', 'SELLER_VAT_MISMATCH',
    'SELLER_PROFILE_INCOMPLETE', 'VAT_CONTACT_NOT_FOUND', 'VAT_CONTACT_TYPE_MISMATCH',
    'EINVOICE_CONNECTION_MISMATCH', 'PRECEDING_INVOICE_NOT_ISSUED',
    'NOTE_INVOICE_CATEGORY_MISMATCH', 'EINVOICE_NUMBER_EXISTS', 'ACCOUNTING_INVOICE_NUMBER_EXISTS',
    'EINVOICE_DRAFT_NOT_FOUND', 'EINVOICE_DRAFT_LOCKED',
    'CURRENCY_NOT_ACTIVE', 'SAR_EXCHANGE_RATE_MUST_BE_ONE',
  ]);
  const code = known.has(message) || message.startsWith('LINE_DISCOUNT_EXCEEDS_AMOUNT:')
    ? message
    : 'EINVOICE_REQUEST_FAILED';
  const status = code === 'UNAUTHORIZED' ? 401
    : code === 'ORGANIZATION_ACCESS_REQUIRED' || code === 'ORGANIZATION_ADMIN_REQUIRED' ? 403
      : code === 'EINVOICE_DRAFT_NOT_FOUND' ? 404
        : ['VAT_PROFILE_REQUIRED', 'VAT_REGISTRATION_REQUIRED', 'SELLER_VAT_MISMATCH', 'SELLER_PROFILE_INCOMPLETE', 'PRECEDING_INVOICE_NOT_ISSUED', 'EINVOICE_NUMBER_EXISTS', 'ACCOUNTING_INVOICE_NUMBER_EXISTS', 'EINVOICE_DRAFT_LOCKED'].includes(code) ? 409
        : code === 'EINVOICE_REQUEST_FAILED' ? 500 : 400;
  return NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const organizationId = new URL(request.url).searchParams.get('organization_id');
    if (!organizationId) return NextResponse.json({ error: 'ORGANIZATION_ID_REQUIRED' }, { status: 400 });
    const membership = await requireOrganizationMember(supabase, user.id, organizationId);
    const { data: invoices, error } = await supabase.from('vat_einvoices')
      .select('*')
      .eq('organization_id', organizationId)
      .order('issue_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    const ids = (invoices ?? []).map((invoice: { id: string }) => invoice.id);
    const { data: lines, error: lineError } = ids.length
      ? await supabase.from('vat_einvoice_lines').select('*').in('invoice_id', ids).order('line_number')
      : { data: [], error: null };
    if (lineError) throw lineError;
    const linkedAccountingIds = new Set((invoices ?? []).map((invoice: any) => invoice.accounting_document_id).filter(Boolean));
    const { data: pendingAccounting, error: pendingAccountingError } = await supabase.from('vat_documents')
      .select('id,document_number,document_kind,transaction_date,due_date,counterparty_name,counterparty_contact_id,counterparty_tax_number,net_amount,tax_amount,gross_amount,currency,exchange_rate,line_items,zatca_status')
      .eq('organization_id', organizationId).eq('document_type','SALES').eq('document_kind','INVOICE')
      .order('created_at',{ascending:false}).limit(200);
    if (pendingAccountingError) throw pendingAccountingError;
    const accountingIds = (invoices ?? []).map((invoice: any) => invoice.accounting_document_id).filter(Boolean);
    const { data: accountingDocuments, error: accountingError } = accountingIds.length
      ? await supabase.from('vat_documents').select('id,document_number,document_kind,zatca_status').in('id', accountingIds)
      : { data: [], error: null };
    if (accountingError) throw accountingError;
    const { data: cashFlows, error: cashError } = accountingIds.length
      ? await supabase.from('liquidity_flows').select('id,source_record_id,amount,settled_amount,settlement_status,status,currency,due_date')
          .eq('organization_id', organizationId).eq('source_module','VAT_INTEGRATION').in('source_record_id', accountingIds)
      : { data: [], error: null };
    if (cashError) throw cashError;
    const accountingById = new Map((accountingDocuments ?? []).map((row: any) => [row.id,row]));
    const cashByDocument = new Map((cashFlows ?? []).map((row: any) => [row.source_record_id,row]));
    const pendingIds = (pendingAccounting ?? []).filter((doc:any)=>!linkedAccountingIds.has(doc.id)).map((doc:any)=>doc.id);
    const { data: pendingFlows, error: pendingFlowError } = pendingIds.length
      ? await supabase.from('liquidity_flows').select('id,source_record_id,amount,settled_amount,settlement_status,status,currency,due_date').eq('organization_id',organizationId).eq('source_module','VAT_INTEGRATION').in('source_record_id',pendingIds)
      : { data: [], error: null };
    if (pendingFlowError) throw pendingFlowError;
    const pendingFlowByDoc = new Map((pendingFlows ?? []).map((row:any)=>[row.source_record_id,row]));
    const linesByInvoice = new Map<string, unknown[]>();
    for (const line of lines ?? []) {
      const invoiceLines = linesByInvoice.get(line.invoice_id) ?? [];
      invoiceLines.push(line);
      linesByInvoice.set(line.invoice_id, invoiceLines);
    }
    const issuedRows = (invoices ?? []).map((invoice:any)=>({
      ...invoice, accounting_document: invoice.accounting_document_id ? accountingById.get(invoice.accounting_document_id) ?? null : null,
      cash_flow: invoice.accounting_document_id ? cashByDocument.get(invoice.accounting_document_id) ?? null : null,
      lines: linesByInvoice.get(invoice.id) ?? [],
    }));
    const pendingRows = (pendingAccounting ?? []).filter((doc:any)=>!linkedAccountingIds.has(doc.id)).map((doc:any)=>({
      id:'accounting:'+doc.id, invoice_number:doc.document_number, document_type:'INVOICE', invoice_category:'STANDARD',
      status:'ACCOUNTING_READY', issue_date:doc.transaction_date, issue_time:'00:00', due_date:doc.due_date,
      currency:doc.currency, exchange_rate:String(doc.exchange_rate || 1), payable_amount:String(doc.gross_amount),
      tax_total_amount:String(doc.tax_amount), qr_code:null, seller_name:'', seller_vat_number:'', seller_address:'',
      seller_building_number:'', seller_district:'', seller_city:'', seller_postal_code:'',
      buyer_name:doc.counterparty_name, buyer_contact_id:doc.counterparty_contact_id, buyer_vat_number:doc.counterparty_tax_number,
      buyer_address:null,buyer_city:null,accounting_document_id:doc.id,
      accounting_document:{id:doc.id,document_number:doc.document_number,document_kind:doc.document_kind,zatca_status:doc.zatca_status},
      cash_flow:pendingFlowByDoc.get(doc.id) ?? null,
      lines:(Array.isArray(doc.line_items)?doc.line_items:[]).map((line:any,index:number)=>({
        id:'accounting-line:'+doc.id+':'+index,item_name:line.description || 'Item',description:line.description || null,
        quantity:Number(line.quantity || 1),unit_code:line.unit || 'PCE',unit_price:String(line.unit_price || 0),
        discount_amount:String(line.discount_amount || 0),tax_category:line.supply_type==='STANDARD'?'S':line.supply_type==='ZERO_RATED'?'Z':line.supply_type==='EXEMPT'?'E':'O',
        tax_rate:String(line.tax_rate || 0),tax_exemption_reason_code:null,tax_exemption_reason:null,tax_amount:String(line.tax_amount || 0),gross_amount:String(line.gross_amount || 0)
      }))
    }));
    return NextResponse.json({ is_admin:['OWNER','ADMIN'].includes(membership.role), invoices:[...issuedRows,...pendingRows] }, { headers:{'Cache-Control':'no-store'} });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  let createdInvoiceId: string | null = null;
  try {
    const { supabase, user } = await requireUser();
    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON_BODY' }, { status: 400 });
    }
    const rawBody = requestBody as Record<string, unknown>;
    const accountingDocumentId = typeof rawBody?.accounting_document_id === 'string' ? rawBody.accounting_document_id : null;
    if (rawBody && 'accounting_document_id' in rawBody) delete rawBody.accounting_document_id;
    const parsed = vatEInvoiceDraftSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_EINVOICE_DRAFT', issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, { status: 400 });
    }
    const draft = parsed.data;
    await requireOrganizationAdmin(supabase, user.id, draft.organization_id);

    if (draft.document_type === 'INVOICE') {
      const { data: sameNumberAccounting, error: sameNumberError } = await supabase.from('vat_documents')
        .select('id,document_number')
        .eq('organization_id', draft.organization_id)
        .eq('document_type', 'SALES')
        .eq('document_kind', 'INVOICE')
        .eq('document_number', draft.invoice_number)
        .maybeSingle();
      if (sameNumberError) throw sameNumberError;
      if (sameNumberAccounting && sameNumberAccounting.id !== accountingDocumentId) {
        throw new Error('ACCOUNTING_INVOICE_NUMBER_EXISTS');
      }
    }

    const { data: currency, error: currencyError } = await supabase.from('currencies')
      .select('code')
      .eq('code', draft.currency)
      .eq('active', true)
      .maybeSingle();
    if (currencyError) throw currencyError;
    if (!currency) throw new Error('CURRENCY_NOT_ACTIVE');

    const { data: profile, error: profileError } = await supabase.from('vat_profiles')
      .select('registration_status,tax_registration_number,registered_name,seller_street,seller_building_number,seller_district,seller_additional_number,seller_city,seller_postal_code')
      .eq('organization_id', draft.organization_id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw new Error('VAT_PROFILE_REQUIRED');
    if (profile.registration_status !== 'REGISTERED') throw new Error('VAT_REGISTRATION_REQUIRED');
    if (profile.tax_registration_number?.trim() !== draft.seller_vat_number) throw new Error('SELLER_VAT_MISMATCH');
    const sellerValues = {
      seller_name: profile.registered_name?.trim(),
      seller_address: profile.seller_street?.trim(),
      seller_building_number: profile.seller_building_number?.trim(),
      seller_district: profile.seller_district?.trim(),
      seller_additional_number: profile.seller_additional_number?.trim(),
      seller_city: profile.seller_city?.trim(),
      seller_postal_code: profile.seller_postal_code?.trim(),
    };
    if (Object.values(sellerValues).some((value) => !value)) throw new Error('SELLER_PROFILE_INCOMPLETE');

    if (draft.buyer_contact_id) {
      const { data: buyerContact, error: buyerContactError } = await supabase.from('vat_contacts')
        .select('id,contact_type')
        .eq('id', draft.buyer_contact_id)
        .eq('organization_id', draft.organization_id)
        .maybeSingle();
      if (buyerContactError) throw buyerContactError;
      if (!buyerContact) throw new Error('VAT_CONTACT_NOT_FOUND');
      if (buyerContact.contact_type !== 'CUSTOMER' && buyerContact.contact_type !== 'BOTH') throw new Error('VAT_CONTACT_TYPE_MISMATCH');
    }

    if (draft.connection_id) {
      const { data: connection, error: connectionError } = await supabase.from('vat_einvoice_connections')
        .select('id,organization_id,taxpayer_vat_number,status')
        .eq('id', draft.connection_id)
        .eq('organization_id', draft.organization_id)
        .maybeSingle();
      if (connectionError) throw connectionError;
      if (!connection || connection.taxpayer_vat_number !== draft.seller_vat_number) throw new Error('EINVOICE_CONNECTION_MISMATCH');
    }

    if (draft.preceding_invoice_id) {
      const { data: precedingInvoice, error: precedingError } = await supabase.from('vat_einvoices')
        .select('id,organization_id,status,invoice_category')
        .eq('id', draft.preceding_invoice_id)
        .eq('organization_id', draft.organization_id)
        .maybeSingle();
      if (precedingError) throw precedingError;
      if (!precedingInvoice || !['ISSUED', 'SUBMITTED', 'CLEARED', 'REPORTED'].includes(precedingInvoice.status)) {
        throw new Error('PRECEDING_INVOICE_NOT_ISSUED');
      }
      if (precedingInvoice.invoice_category !== draft.invoice_category) throw new Error('NOTE_INVOICE_CATEGORY_MISMATCH');
    }

    const calculated = calculateVatEInvoiceDraft(draft);
    const taxTotalAmountSar = new Decimal(calculated.totals.tax_total_amount)
      .mul(draft.exchange_rate)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toFixed(2);
    const { lines, ...header } = draft;
    const { data: invoice, error: insertError } = await supabase.from('vat_einvoices').insert({
      ...header,
      ...sellerValues,
      buyer_contact_id: draft.buyer_contact_id || null,
      buyer_name: draft.buyer_name || null,
      buyer_vat_number: draft.buyer_vat_number || null,
      buyer_address: draft.buyer_address || null,
      buyer_city: draft.buyer_city || null,
      buyer_postal_code: draft.buyer_postal_code || null,
      buyer_country_code: draft.buyer_country_code || null,
      payment_means_code: draft.payment_means_code || null,
      billing_reference: draft.billing_reference || null,
      preceding_invoice_id: draft.preceding_invoice_id || null,
      note_reason: draft.note_reason || null,
      ...calculated.totals,
      exchange_rate: draft.exchange_rate,
      tax_total_amount_sar: taxTotalAmountSar,
      status: 'DRAFT',
      created_by: user.id,
    }).select('id,organization_id,invoice_uuid,invoice_number,document_type,invoice_category,status,issue_date,issue_time,currency,exchange_rate,tax_total_amount_sar,created_at').single();
    if (insertError) {
      if (insertError.code === '23505') throw new Error('EINVOICE_NUMBER_EXISTS');
      throw insertError;
    }
    createdInvoiceId = invoice.id;

    const { data: savedLines, error: lineError } = await supabase.from('vat_einvoice_lines').insert(
      calculated.lines.map((line) => ({ ...line, invoice_id: invoice.id }))
    ).select('*');
    if (lineError) throw lineError;

    if (accountingDocumentId) {
      const { error: linkError } = await supabase.rpc('link_zatca_accounting_document', { p_einvoice_id: invoice.id, p_document_id: accountingDocumentId });
      if (linkError) throw linkError;
    }
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      entity_type: 'vat_einvoice',
      entity_id: invoice.id,
      action: 'DRAFT_CREATED',
      new_data: {
        organization_id: draft.organization_id,
        invoice_number: draft.invoice_number,
        document_type: draft.document_type,
        invoice_category: draft.invoice_category,
        line_count: lines.length,
        status: 'DRAFT',
      },
    });
    return NextResponse.json({ ...invoice, accounting_document_id: accountingDocumentId, ...calculated.totals, lines: savedLines ?? [] }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (createdInvoiceId) {
      try {
        const { supabase } = await requireUser();
        await supabase.from('vat_einvoices').delete().eq('id', createdInvoiceId).eq('status', 'DRAFT');
      } catch {
        // Keep the original failure response; a draft can be safely inspected and cleaned up later.
      }
    }
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON_BODY' }, { status: 400 });
    }
    const invoiceId = typeof body.invoice_id === 'string' ? body.invoice_id : '';
    const accountingDocumentId = typeof body.accounting_document_id === 'string' ? body.accounting_document_id : null;
    const { invoice_id: _invoiceId, accounting_document_id: _accountingDocumentId, ...draftBody } = body;
    const parsed = vatEInvoiceDraftSchema.safeParse(draftBody);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_EINVOICE_DRAFT', issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, { status: 400 });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)) {
      return NextResponse.json({ error: 'EINVOICE_DRAFT_NOT_FOUND' }, { status: 404 });
    }
    const draft = parsed.data;
    await requireOrganizationAdmin(supabase, user.id, draft.organization_id);

    const { data: existing, error: existingError } = await supabase.from('vat_einvoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('organization_id', draft.organization_id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw new Error('EINVOICE_DRAFT_NOT_FOUND');
    if (existing.status !== 'DRAFT') throw new Error('EINVOICE_DRAFT_LOCKED');

    const { data: currency, error: currencyError } = await supabase.from('currencies')
      .select('code')
      .eq('code', draft.currency)
      .eq('active', true)
      .maybeSingle();
    if (currencyError) throw currencyError;
    if (!currency) throw new Error('CURRENCY_NOT_ACTIVE');

    const { data: profile, error: profileError } = await supabase.from('vat_profiles')
      .select('registration_status,tax_registration_number,registered_name,seller_street,seller_building_number,seller_district,seller_additional_number,seller_city,seller_postal_code')
      .eq('organization_id', draft.organization_id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw new Error('VAT_PROFILE_REQUIRED');
    if (profile.registration_status !== 'REGISTERED') throw new Error('VAT_REGISTRATION_REQUIRED');
    if (profile.tax_registration_number?.trim() !== draft.seller_vat_number) throw new Error('SELLER_VAT_MISMATCH');
    const sellerValues = {
      seller_name: profile.registered_name?.trim(),
      seller_address: profile.seller_street?.trim(),
      seller_building_number: profile.seller_building_number?.trim(),
      seller_district: profile.seller_district?.trim(),
      seller_additional_number: profile.seller_additional_number?.trim(),
      seller_city: profile.seller_city?.trim(),
      seller_postal_code: profile.seller_postal_code?.trim(),
    };
    if (Object.values(sellerValues).some((value) => !value)) throw new Error('SELLER_PROFILE_INCOMPLETE');

    if (draft.buyer_contact_id) {
      const { data: buyerContact, error: buyerContactError } = await supabase.from('vat_contacts')
        .select('id,contact_type')
        .eq('id', draft.buyer_contact_id)
        .eq('organization_id', draft.organization_id)
        .maybeSingle();
      if (buyerContactError) throw buyerContactError;
      if (!buyerContact) throw new Error('VAT_CONTACT_NOT_FOUND');
      if (buyerContact.contact_type !== 'CUSTOMER' && buyerContact.contact_type !== 'BOTH') throw new Error('VAT_CONTACT_TYPE_MISMATCH');
    }

    const calculated = calculateVatEInvoiceDraft(draft);
    const taxTotalAmountSar = new Decimal(calculated.totals.tax_total_amount)
      .mul(draft.exchange_rate)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toFixed(2);
    const { lines, ...header } = draft;
    const updateValues = {
      ...header,
      ...sellerValues,
      buyer_contact_id: draft.buyer_contact_id || null,
      buyer_name: draft.buyer_name || null,
      buyer_vat_number: draft.buyer_vat_number || null,
      buyer_address: draft.buyer_address || null,
      buyer_building_number: draft.buyer_building_number || null,
      buyer_district: draft.buyer_district || null,
      buyer_additional_number: draft.buyer_additional_number || null,
      buyer_city: draft.buyer_city || null,
      buyer_postal_code: draft.buyer_postal_code || null,
      buyer_country_code: draft.buyer_country_code || null,
      billing_reference: draft.billing_reference || null,
      note_reason: draft.note_reason || null,
      ...calculated.totals,
      exchange_rate: draft.exchange_rate,
      tax_total_amount_sar: taxTotalAmountSar,
    };

    const { data: oldLines, error: oldLinesError } = await supabase.from('vat_einvoice_lines')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('line_number');
    if (oldLinesError) throw oldLinesError;

    if (accountingDocumentId && !existing.accounting_document_id) {
      const { error: linkError } = await supabase.rpc('link_zatca_accounting_document', { p_einvoice_id: invoiceId, p_document_id: accountingDocumentId });
      if (linkError) throw linkError;
    }

    const { data: updatedInvoice, error: updateError } = await supabase.from('vat_einvoices')
      .update(updateValues)
      .eq('id', invoiceId)
      .eq('organization_id', draft.organization_id)
      .eq('status', 'DRAFT')
      .select('*')
      .maybeSingle();
    if (updateError) {
      if (updateError.code === '23505') throw new Error('EINVOICE_NUMBER_EXISTS');
      throw updateError;
    }
    if (!updatedInvoice) throw new Error('EINVOICE_DRAFT_LOCKED');

    const { error: deleteError } = await supabase.from('vat_einvoice_lines').delete().eq('invoice_id', invoiceId);
    if (deleteError) {
      const { id: _id, ...oldHeader } = existing;
      await supabase.from('vat_einvoices').update(oldHeader).eq('id', invoiceId).eq('status', 'DRAFT');
      throw deleteError;
    }
    const { data: savedLines, error: insertLinesError } = await supabase.from('vat_einvoice_lines').insert(
      calculated.lines.map((line) => ({ ...line, invoice_id: invoiceId }))
    ).select('*');
    if (insertLinesError) {
      await supabase.from('vat_einvoice_lines').delete().eq('invoice_id', invoiceId);
      if (oldLines?.length) await supabase.from('vat_einvoice_lines').insert(oldLines);
      const { id: _id, ...oldHeader } = existing;
      await supabase.from('vat_einvoices').update(oldHeader).eq('id', invoiceId).eq('status', 'DRAFT');
      if (insertLinesError.code === '23505') throw new Error('EINVOICE_NUMBER_EXISTS');
      throw insertLinesError;
    }

    await supabase.from('audit_logs').insert({
      user_id: user.id,
      entity_type: 'vat_einvoice',
      entity_id: invoiceId,
      action: 'DRAFT_UPDATED',
      new_data: { invoice_number: draft.invoice_number, line_count: lines.length, status: 'DRAFT' },
    });
    return NextResponse.json({ ...updatedInvoice, lines: savedLines ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}


export async function DELETE(request: Request) {
  try {
    const { supabase } = await requireUser();
    const params = new URL(request.url).searchParams;
    const invoiceId = params.get('invoice_id');
    if (!invoiceId) return NextResponse.json({ error: 'EINVOICE_NOT_FOUND' }, { status: 404 });
    const { data, error } = await supabase.rpc('delete_unissued_zatca_draft_bundle', { p_einvoice_id: invoiceId });
    if (error) throw error;
    return NextResponse.json(data ?? { deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
