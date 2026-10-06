import { NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { vatDocumentSchema, vatPeriodSummarySchema, vatProfileSchema } from '@/lib/validation/schemas';
import { getVatPeriod, type VatFilingFrequency } from '@/lib/vat-period';
import { calculateVatAmounts, summarizeVatDocuments } from '@/lib/vat';
import { calculateVatDocumentLines } from '@/lib/vat-document-lines';
import { convertVatAmountToBase, convertVatLineToBase } from '@/lib/vat-invoice-currency';
import { getVatPaymentDeadline, getVatYearStart, summarizePaidAndReserved, summarizeVatPeriodInputs, summarizeVatRowsWithDetail } from '@/lib/vat-period-summary';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin, requireOrganizationMember } from '@/services/organization-access';

const errorStatus = (message: string) => {
  if (message === 'UNAUTHORIZED') return 401;
  if (message === 'ORGANIZATION_ADMIN_REQUIRED') return 403;
  if (message === 'ORGANIZATION_ACCESS_REQUIRED') return 403;
  if (message === 'VAT_PROFILE_REQUIRED') return 409;
  return 400;
};


async function ensureInvoiceCashForecast(supabase: any, userId: string, document: any, eventId: string, counterpartyId: string | null, baseCurrency: string) {
  const sourceEventKey = `vat_documents:${document.id}:cash-forecast`;
  const { data: existing, error: existingError } = await supabase.from('liquidity_flows')
    .select('id').eq('organization_id', document.organization_id).eq('source_module', 'VAT_INTEGRATION').eq('source_event_key', sourceEventKey).maybeSingle();
  if (existingError) throw existingError;
  let flowId = existing?.id ?? null;
  if (!flowId) {
    const { data: flow, error: flowError } = await supabase.from('liquidity_flows').insert({
      organization_id: document.organization_id,
      entity_id: null,
      account_id: null,
      direction: document.document_type === 'SALES' ? 'INFLOW' : 'OUTFLOW',
      flow_type: 'OPERATING',
      title: `${document.document_type === 'SALES' ? 'Invoice receivable' : 'Invoice payable'} · ${document.document_number}`,
      counterparty: document.counterparty_name,
      counterparty_id: counterpartyId,
      due_date: document.due_date,
      amount: document.gross_amount,
      currency: baseCurrency,
      base_amount: document.gross_amount,
      status: 'EXPECTED',
      source: 'INVOICE',
      reference: document.document_number,
      notes: 'Generated from invoice due date; settlement must clear the linked Financial Core obligation.',
      created_by: userId,
      source_module: 'VAT_INTEGRATION',
      source_record_id: document.id,
      source_event_key: sourceEventKey,
      settled_amount: 0,
      settlement_status: 'UNSETTLED',
    }).select('id').single();
    if (flowError) throw flowError;
    flowId = flow.id;
  }
  const { data: link, error: linkError } = await supabase.from('financial_event_links').select('id')
    .eq('organization_id', document.organization_id).eq('event_id', eventId).eq('link_type', 'CASH_FLOW')
    .eq('target_module', 'liquidity_flows').eq('target_record_id', flowId).maybeSingle();
  if (linkError) throw linkError;
  if (!link) {
    const { error } = await supabase.from('financial_event_links').insert({
      organization_id: document.organization_id, event_id: eventId, link_type: 'CASH_FLOW',
      target_module: 'liquidity_flows', target_record_id: flowId,
      metadata: { purpose: 'INVOICE_DUE_FORECAST', due_date: document.due_date, source_document_id: document.id },
    });
    if (error) throw error;
  }
  return flowId;
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    const organizationId = params.get('organization_id');
    const periodMonth = params.get('period_month') ?? new Date().toISOString().slice(0, 7);
    if (!organizationId) return NextResponse.json({ error: 'ORGANIZATION_ID_REQUIRED' }, { status: 400 });
    await requireOrganizationMember(supabase, user.id, organizationId);

    const profileResult = await supabase.from('vat_profiles').select('*').eq('organization_id', organizationId).maybeSingle();
    if (profileResult.error) throw profileResult.error;
    const period = getVatPeriod(
      periodMonth,
      (profileResult.data?.filing_frequency ?? 'QUARTERLY') as VatFilingFrequency,
      Number(profileResult.data?.period_start_month ?? 1),
    );
    const yearStart = getVatYearStart(period.to, Number(profileResult.data?.period_start_month ?? 1));
    const documents: Record<string, any>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from('vat_documents')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('transaction_date', yearStart)
        .lte('transaction_date', period.to)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + 999);
      if (error) throw error;
      documents.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const { data: issuedInvoices, error: invoiceError } = await supabase.from('vat_einvoices')
      .select('id,invoice_number,invoice_category,issue_date,buyer_name,buyer_vat_number,organization_id')
      .eq('organization_id', organizationId)
      .eq('status', 'ISSUED')
      .gte('issue_date', yearStart)
      .lte('issue_date', period.to)
      .order('issue_date', { ascending: false });
    if (invoiceError) throw invoiceError;
    const invoiceIds = (issuedInvoices ?? []).map((invoice: { id: string }) => invoice.id);
    const { data: invoiceLines, error: invoiceLinesError } = invoiceIds.length
      ? await supabase.from('vat_einvoice_lines').select('invoice_id,tax_category,tax_rate,line_extension_amount,tax_amount').in('invoice_id', invoiceIds)
      : { data: [], error: null };
    if (invoiceLinesError) throw invoiceLinesError;
    const invoicesById = new Map((issuedInvoices ?? []).map((invoice: any) => [invoice.id, invoice]));
    const summaries = new Map<string, any>();
    for (const line of invoiceLines ?? []) {
      const invoice = invoicesById.get(line.invoice_id);
      if (!invoice) continue;
      const key = `${invoice.id}:${line.tax_category}:${line.tax_rate}`;
      const summary = summaries.get(key) ?? {
        id: `einvoice-${key}`,
        organization_id: organizationId,
        document_type: 'SALES',
        document_kind: 'INVOICE',
        document_number: invoice.invoice_number,
        transaction_date: invoice.issue_date,
        counterparty_name: invoice.buyer_name || invoice.invoice_category,
        counterparty_tax_number: invoice.buyer_vat_number,
        supply_type: ({ S: 'STANDARD', Z: 'ZERO_RATED', E: 'EXEMPT', O: 'OUT_OF_SCOPE' } as Record<string, string>)[line.tax_category],
        tax_rate: line.tax_rate,
        recoverable_percent: '100.00',
        net_amount: new Decimal(0),
        tax_amount: new Decimal(0),
        gross_amount: new Decimal(0),
        is_einvoice: true,
      };
      summary.net_amount = summary.net_amount.plus(line.line_extension_amount);
      summary.tax_amount = summary.tax_amount.plus(line.tax_amount);
      summary.gross_amount = summary.gross_amount.plus(line.line_extension_amount).plus(line.tax_amount);
      summaries.set(key, summary);
    }
    const issuedDocumentSummaries = Array.from(summaries.values(), (summary) => ({
      ...summary,
      net_amount: summary.net_amount.toFixed(2),
      tax_amount: summary.tax_amount.toFixed(2),
      gross_amount: summary.gross_amount.toFixed(2),
    }));
    const { data: summaryRows, error: summaryError } = await supabase.from('vat_period_summaries')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('period_start', yearStart)
      .lte('period_start', period.to)
      .order('period_start', { ascending: true });
    if (summaryError) throw summaryError;

    const summaryDocuments = documents.flatMap((document: any) => Array.isArray(document.line_items) && document.line_items.length
      ? document.line_items.map((line: any) => ({ ...document, supply_type: line.supply_type, net_amount: line.net_amount, tax_rate: line.tax_rate, tax_amount: line.tax_amount }))
      : [document]);
    const summarySourceDocuments = [...summaryDocuments, ...issuedDocumentSummaries];
    const periodDocuments = [...documents, ...issuedDocumentSummaries].filter((document) =>
      document.transaction_date >= period.from && document.transaction_date <= period.to,
    );
    const periodSummaryDocuments = summarySourceDocuments.filter((document) => document.transaction_date >= period.from && document.transaction_date <= period.to);
    const periodSummary = (summaryRows ?? []).find((row: any) => row.period_start === period.from && row.period_end === period.to) ?? null;
    const rate = Number(profileResult.data?.standard_rate ?? 15);
    const periodDocumentTotals = summarizeVatDocuments(periodSummaryDocuments);
    const periodTotals = periodSummary
      ? summarizeVatPeriodInputs(periodSummary, rate)
      : {
        ...periodDocumentTotals,
        salesBase: periodDocumentTotals.salesNet,
        salesGross: new Decimal(periodDocumentTotals.salesNet).add(periodDocumentTotals.outputTax).toFixed(2),
        purchaseBase: periodDocumentTotals.purchaseNet,
        purchaseVatBeforeRecovery: periodDocumentTotals.inputTax,
      };
    const annualTotals = summarizeVatRowsWithDetail(
      summarySourceDocuments,
      summaryRows ?? [],
      rate,
    );
    const coveredRanges = (summaryRows ?? []).filter((row: any) => row.period_start && row.period_end);
    const unaggregatedDocuments = summarySourceDocuments.filter((document) =>
      !coveredRanges.some((row: any) => document.transaction_date >= row.period_start && document.transaction_date <= row.period_end),
    );
    const unaggregatedTotals = summarizeVatDocuments(unaggregatedDocuments);
    const aggregateStats = (summaryRows ?? []).reduce((totals: Record<string, Decimal>, row: any) => {
      const values = summarizeVatPeriodInputs(row, rate);
      totals.salesBase = totals.salesBase.add(values.salesBase);
      totals.salesGross = totals.salesGross.add(values.salesGross);
      totals.purchaseBase = totals.purchaseBase.add(values.purchaseBase);
      totals.purchaseVatBeforeRecovery = totals.purchaseVatBeforeRecovery.add(values.purchaseVatBeforeRecovery);
      return totals;
    }, { salesBase: new Decimal(0), salesGross: new Decimal(0), purchaseBase: new Decimal(0), purchaseVatBeforeRecovery: new Decimal(0) });
    const annualPaidAndReserved = summarizePaidAndReserved((summaryRows ?? []) as any[]);
    const annualSalesGross = aggregateStats.salesGross.add(unaggregatedTotals.salesNet).add(unaggregatedTotals.outputTax);
    const annualSalesBase = aggregateStats.salesBase.add(unaggregatedTotals.salesNet);
    const annualPurchaseBase = aggregateStats.purchaseBase.add(unaggregatedTotals.purchaseNet);
    const annualPurchaseVatBeforeRecovery = aggregateStats.purchaseVatBeforeRecovery.add(unaggregatedTotals.inputTax);
    const savedServices = Array.from(new Set(documents.flatMap((document) =>
      (Array.isArray(document.line_items) ? document.line_items : [])
        .map((line: { description?: unknown }) => typeof line.description === 'string' ? line.description.trim() : '')
        .filter(Boolean),
    ))).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({
      profile: profileResult.data,
      period,
      yearStart,
      periodSummary,
      periodTotals: { ...periodTotals, paidAmount: periodSummary?.paid_amount ?? '0', cashReservedAmount: periodSummary?.cash_reserved_amount ?? '0', filingStatus: periodSummary?.filing_status ?? 'NOT_FILED', dueDate: getVatPaymentDeadline(period.to) },
      annualTotals: {
        ...annualTotals,
        salesBase: annualSalesBase.toFixed(2),
        salesGross: annualSalesGross.toFixed(2),
        purchaseBase: annualPurchaseBase.toFixed(2),
        purchaseVatBeforeRecovery: annualPurchaseVatBeforeRecovery.toFixed(2),
        paidAmount: annualPaidAndReserved.paid.toFixed(2),
        cashReservedAmount: annualPaidAndReserved.cashReserved.toFixed(2),
      },
      documents: periodDocuments,
      service_catalog: savedServices,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: errorStatus(error.message) });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();

    if (body.action === 'save_profile') {
      const profile = vatProfileSchema.parse(body);
      await requireOrganizationAdmin(supabase, user.id, profile.organization_id);
      const { data: existing, error: existingError } = await supabase
        .from('vat_profiles')
        .select('id')
        .eq('organization_id', profile.organization_id)
        .maybeSingle();
      if (existingError) throw existingError;
      const profileValues = {
        ...profile,
        tax_registration_number: profile.tax_registration_number?.trim() || null,
        registration_date: profile.registration_date || null,
        updated_at: new Date().toISOString(),
      };
      const saveQuery = existing
        ? supabase.from('vat_profiles').update(profileValues).eq('id', existing.id)
        : supabase.from('vat_profiles').insert({ ...profileValues, created_by: user.id });
      const { data, error } = await saveQuery.select().single();
      if (error) throw error;
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        entity_type: 'vat_profile',
        entity_id: data.id,
        action: 'UPSERT',
        new_data: { ...data, tax_registration_number: data.tax_registration_number ? 'REDACTED' : null },
      });
      return NextResponse.json(data);
    }

    if (body.action === 'save_period_summary') {
      const summary = vatPeriodSummarySchema.parse(body);
      await requireOrganizationAdmin(supabase, user.id, summary.organization_id);
      const { data: profile, error: profileError } = await supabase.from('vat_profiles')
        .select('registration_status,filing_frequency,period_start_month')
        .eq('organization_id', summary.organization_id)
        .single();
      if (profileError?.code === 'PGRST116') throw new Error('VAT_PROFILE_REQUIRED');
      if (profileError) throw profileError;
      if (profile.registration_status !== 'REGISTERED') throw new Error('VAT_REGISTRATION_REQUIRED');

      const expectedPeriod = getVatPeriod(summary.period_start.slice(0, 7), profile.filing_frequency as VatFilingFrequency, Number(profile.period_start_month));
      if (expectedPeriod.from !== summary.period_start || expectedPeriod.to !== summary.period_end) throw new Error('VAT_SUMMARY_PERIOD_MISMATCH');
      const values = {
        ...summary,
        filed_at: summary.filed_at || null,
        filing_reference: summary.filing_reference?.trim() || null,
        paid_at: summary.paid_at || null,
        payment_reference: summary.payment_reference?.trim() || null,
        notes: summary.notes?.trim() || null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase.from('vat_period_summaries')
        .upsert({ ...values, created_by: user.id }, { onConflict: 'organization_id,period_start,period_end' })
        .select()
        .single();
      if (error) throw error;
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        entity_type: 'vat_period_summary',
        entity_id: data.id,
        action: 'UPSERT',
        new_data: data,
      });
      return NextResponse.json(data);
    }

    if (body.action === 'add_document') {
      const document = vatDocumentSchema.parse(body);
      await requireOrganizationAdmin(supabase, user.id, document.organization_id);
      const { data: profile, error: profileError } = await supabase
        .from('vat_profiles')
        .select('registration_status,standard_rate')
        .eq('organization_id', document.organization_id)
        .single();
      if (profileError?.code === 'PGRST116') throw new Error('VAT_PROFILE_REQUIRED');
      if (profileError) throw profileError;
      if (profile.registration_status !== 'REGISTERED') throw new Error('VAT_REGISTRATION_REQUIRED');

      const { data: organization, error: organizationError } = await supabase
        .from('organizations')
        .select('base_currency')
        .eq('id', document.organization_id)
        .single();
      if (organizationError) throw organizationError;
      const baseCurrency = String(organization.base_currency || 'SAR').toUpperCase();
      const { data: activeCurrencies, error: currencyError } = await supabase
        .from('currencies')
        .select('code')
        .eq('active', true)
        .in('code', [document.currency, baseCurrency]);
      if (currencyError) throw currencyError;
      if ((activeCurrencies ?? []).length !== new Set([document.currency, baseCurrency]).size) throw new Error('VAT_CURRENCY_NOT_ACTIVE');
      if (document.currency === baseCurrency && document.exchange_rate !== 1) throw new Error('VAT_SAME_CURRENCY_RATE_MUST_BE_ONE');

      let contact: { id: string; contact_type: string; name: string; vat_number: string | null } | null = null;
      if (document.counterparty_contact_id) {
        const { data, error } = await supabase.from('vat_contacts')
          .select('id,contact_type,name,vat_number')
          .eq('id', document.counterparty_contact_id)
          .eq('organization_id', document.organization_id)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('VAT_CONTACT_NOT_FOUND');
        const expectedType = document.document_type === 'SALES' ? 'CUSTOMER' : 'SUPPLIER';
        if (data.contact_type !== expectedType && data.contact_type !== 'BOTH') throw new Error('VAT_CONTACT_TYPE_MISMATCH');
        contact = data;
      }

      const lineCalculation = document.lines?.length ? calculateVatDocumentLines(document.lines, profile.standard_rate) : null;
      const supplyType = lineCalculation?.lines[0]?.supply_type ?? document.supply_type;
      const taxRate = supplyType === 'STANDARD' ? Number(profile.standard_rate) : 0;
      const sourceAmounts = lineCalculation ?? calculateVatAmounts(document.net_amount, taxRate);
      const fxRate = new Decimal(document.exchange_rate);
      const baseLines = lineCalculation?.lines.map((line) => convertVatLineToBase(line, fxRate.toString())) ?? null;
      const baseAmounts = baseLines ? {
        netAmount: baseLines.reduce((sum, line) => sum.plus(line.net_amount), new Decimal(0)).toDecimalPlaces(2).toFixed(2),
        taxAmount: baseLines.reduce((sum, line) => sum.plus(line.tax_amount), new Decimal(0)).toDecimalPlaces(2).toFixed(2),
        grossAmount: baseLines.reduce((sum, line) => sum.plus(line.gross_amount), new Decimal(0)).toDecimalPlaces(2).toFixed(2),
      } : {
        netAmount: convertVatAmountToBase(sourceAmounts.netAmount, fxRate.toString()),
        taxAmount: convertVatAmountToBase(sourceAmounts.taxAmount, fxRate.toString()),
        grossAmount: convertVatAmountToBase(sourceAmounts.grossAmount, fxRate.toString()),
      };
      const sourceTaxRate = lineCalculation ? (Number(sourceAmounts.netAmount) ? (Number(sourceAmounts.taxAmount) / Number(sourceAmounts.netAmount) * 100).toFixed(2) : '0.00') : taxRate.toFixed(2);
      const { data, error } = await supabase.from('vat_documents').insert({
        organization_id: document.organization_id,
        user_id: user.id,
        created_by: user.id,
        document_type: document.document_type,
        document_kind: document.document_kind,
        document_number: document.document_number,
        transaction_date: document.transaction_date,
        due_date: document.due_date,
        counterparty_contact_id: contact?.id ?? null,
        counterparty_name: contact?.name ?? document.counterparty_name,
        counterparty_tax_number: contact?.vat_number ?? (document.counterparty_tax_number?.trim() || null),
        supply_type: supplyType,
        net_amount: baseAmounts.netAmount,
        tax_rate: sourceTaxRate,
        tax_amount: baseAmounts.taxAmount,
        recoverable_percent: document.document_type === 'PURCHASE' ? document.recoverable_percent : 100,
        gross_amount: baseAmounts.grossAmount,
        line_items: baseLines,
        currency: baseCurrency,
        source_currency: document.currency,
        exchange_rate: fxRate.toString(),
        source_net_amount: sourceAmounts.netAmount,
        source_tax_amount: sourceAmounts.taxAmount,
        source_gross_amount: sourceAmounts.grossAmount,
        notes: document.notes?.trim() || null,
        asset_transaction_id: document.asset_transaction_id ?? null,
      }).select().single();
      if (error?.code === '23505') return NextResponse.json({ error: 'VAT_DOCUMENT_NUMBER_EXISTS' }, { status: 409 });
      if (error) throw error;
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        entity_type: 'vat_document',
        entity_id: data.id,
        action: 'CREATE',
        new_data: { id: data.id, organization_id: data.organization_id, document_type: data.document_type, document_number: data.document_number, transaction_date: data.transaction_date, net_amount: data.net_amount, tax_amount: data.tax_amount },
      });

      // Purchase VAT recognition is prepared in Financial Core at document creation.
      // Recognition remains non-cash; settlement is handled separately by Cash Management.
      if (document.document_type === 'PURCHASE') {
        if (document.asset_transaction_id) {
          const { data: eventId, error: bindError } = await supabase.rpc('bind_asset_purchase_vat_document', { p_document_id: data.id, p_transaction_id: document.asset_transaction_id });
          if (bindError) throw bindError;
          return NextResponse.json({ ...data, asset_transaction_id: document.asset_transaction_id, financial_core: { event_id: eventId, status: 'SINGLE_ASSET_PURCHASE_EVENT', recognition: 'ASSET_CAPEX_PLUS_INPUT_VAT' } }, { status: 201 });
        }
        const { data: entities, error: entityError } = await supabase.from('organization_entities')
          .select('id').eq('organization_id', document.organization_id).eq('active', true).limit(2);
        if (entityError) throw entityError;
        if (!entities || entities.length !== 1) throw new Error('VAT_FINANCIAL_ENTITY_REQUIRED');

        const { data: requiredClasses, error: classError } = await supabase.from('financial_classifications')
          .select('classification_type').eq('organization_id', document.organization_id)
          .in('classification_type', ['OPEX', 'TAX']);
        if (classError) throw classError;
        const types = new Set((requiredClasses ?? []).map((row: any) => row.classification_type));
        if (!types.has('OPEX') || !types.has('TAX')) throw new Error('VAT_FINANCIAL_CLASSIFICATIONS_REQUIRED');

        const { data: prepared, error: prepareError } = await supabase.rpc('prepare_vat_financial_event', {
          p_source_table: 'vat_documents',
          p_source_id: data.id,
          p_entity_id: entities[0].id,
          p_due_date: document.due_date,
        });
        if (prepareError) throw prepareError;
        const preparedRow = Array.isArray(prepared) ? prepared[0] : prepared;
        const financialEventId = typeof preparedRow === 'string' ? preparedRow : (preparedRow?.event_id ?? preparedRow?.id ?? null);
        return NextResponse.json({
          ...data,
          financial_core: { event_id: financialEventId, status: 'COMMITTED', recognition: 'PENDING_INDEPENDENT_APPROVAL' },
        }, { status: 201 });
      }

      return NextResponse.json(data, { status: 201 });
    }

    return NextResponse.json({ error: 'INVALID_VAT_ACTION' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: errorStatus(error.message) });
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    const organizationId = params.get('organization_id');
    const documentId = params.get('document_id');
    if (!organizationId || !documentId) return NextResponse.json({ error: 'VAT_DOCUMENT_ID_REQUIRED' }, { status: 400 });
    await requireOrganizationAdmin(supabase, user.id, organizationId);
    const { data, error } = await supabase
      .from('vat_documents')
      .delete()
      .eq('organization_id', organizationId)
      .eq('id', documentId)
      .select('id,document_number,document_type')
      .single();
    if (error) throw error;
    await supabase.from('audit_logs').insert({ user_id: user.id, entity_type: 'vat_document', entity_id: data.id, action: 'DELETE', old_data: data });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: errorStatus(error.message) });
  }
}
