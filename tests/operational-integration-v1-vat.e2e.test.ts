import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const QA_PROJECT_REF = 'wtzgzmcgcqouziqzsfnl'
const QA_URL = `https://${QA_PROJECT_REF}.supabase.co`
const ORGANIZATION_ID = '85acbac0-e8b4-434c-a22b-3ec13b55e1a7'
const REQUIRED_TYPES = ['REVENUE', 'OPEX', 'TAX', 'PAYABLE'] as const

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY
const ownerEmail = process.env.E2E_OWNER_EMAIL
const ownerPassword = process.env.E2E_OWNER_PASSWORD
const adminEmail = process.env.E2E_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD

if (process.env.E2E_REQUIRE_CONFIG === 'true') {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== QA_URL) throw new Error('E2E_QA_SUPABASE_TARGET_MISMATCH')
  if (!anonKey) throw new Error('E2E_QA_PUBLISHABLE_KEY_MISSING')
  if (!ownerEmail || !ownerPassword || !adminEmail || !adminPassword) throw new Error('E2E_CREDENTIALS_MISSING')
}

function client(): SupabaseClient {
  return createClient(QA_URL, anonKey ?? 'missing', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
const owner = client()
const admin = client()

let revenueId = ''
let entityId = ''
let invoiceId = ''
let eventId = ''
let ownerUserId = ''
let cashBefore = new Map<string, number>()

function numeric(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (value !== null && value !== undefined && Number.isFinite(Number(value))) return Number(value)
  }
  return NaN
}

async function signIn(c: SupabaseClient, email?: string, password?: string) {
  const { data, error } = await c.auth.signInWithPassword({ email: email ?? '', password: password ?? '' })
  if (error || !data.user || !data.session) throw new Error('E2E_AUTHENTICATION_FAILED')
  return data.user
}

async function classifications() {
  const { data, error } = await owner.from('financial_classifications')
    .select('id,classification_type').eq('organization_id', ORGANIZATION_ID)
  if (error) throw error
  return data ?? []
}

describe('Operational Integration V1 VAT sales recognition', () => {
  beforeAll(async () => {
    const ownerUser = await signIn(owner, ownerEmail, ownerPassword)
    ownerUserId = ownerUser.id
    await signIn(admin, adminEmail, adminPassword)

    const { data: canEdit, error: permissionError } = await owner.rpc('has_organization_permission', {
      p_organization_id: ORGANIZATION_ID, p_permission: 'organization.edit',
    })
    if (permissionError || canEdit !== true) throw new Error('E2E_OWNER_RLS_PERMISSION_FAILED')

    let rows = await classifications()
    let revenue = rows.find((x) => x.classification_type === 'REVENUE')
    if (!revenue) {
      const { data, error } = await owner.from('financial_classifications').insert({
        organization_id: ORGANIZATION_ID, code: 'P2F-REVENUE',
        name: 'Phase 2F QA Revenue', classification_type: 'REVENUE', created_by: ownerUserId,
      }).select('id,classification_type').single()
      if (error || !data) throw new Error('E2E_REVENUE_CREATE_FAILED')
      revenue = data
      rows = await classifications()
    }
    revenueId = revenue.id
    for (const type of REQUIRED_TYPES) expect(rows.some((x) => x.classification_type === type)).toBe(true)

    const { data: entities, error: entityError } = await owner.from('organization_entities')
      .select('id').eq('organization_id', ORGANIZATION_ID).eq('active', true).limit(2)
    if (entityError || !entities || entities.length !== 1) throw new Error('E2E_FINANCIAL_ENTITY_REQUIRED')
    entityId = entities[0].id

    const { data: accounts, error: accountError } = await owner.from('liquidity_accounts')
      .select('id,current_balance').eq('organization_id', ORGANIZATION_ID).eq('active', true)
    if (accountError) throw accountError
    cashBefore = new Map((accounts ?? []).map((a) => [a.id, Number(a.current_balance ?? 0)]))
  }, 30000)

  it('authenticates Owner and independent Admin through normal RLS sessions', async () => {
    expect((await owner.auth.getUser()).data.user?.id).toBeTruthy()
    expect((await admin.auth.getUser()).data.user?.id).toBeTruthy()
    expect(revenueId).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('creates and issues a 100 + 15 VAT sales invoice and prepares one committed Core event', async () => {
    const { data: profile, error: profileError } = await owner.from('vat_profiles').select('*')
      .eq('organization_id', ORGANIZATION_ID).single()
    if (profileError || !profile) throw new Error('E2E_VAT_PROFILE_REQUIRED')

    let { data: contact, error: contactError } = await owner.from('vat_contacts').select('*')
      .eq('organization_id', ORGANIZATION_ID).in('contact_type', ['CUSTOMER', 'BOTH']).limit(1).maybeSingle()
    if (contactError) throw contactError
    if (!contact) {
      const created = await owner.from('vat_contacts').insert({
        organization_id: ORGANIZATION_ID, contact_type: 'CUSTOMER', name: 'Operational VAT E2E Customer',
        street: 'QA Street', building_number: '1234', district: 'QA District', additional_number: '5678',
        city: 'Riyadh', postal_code: '12345', country_code: 'SA', created_by: ownerUserId,
      }).select('*').single()
      if (created.error || !created.data) throw new Error('E2E_VAT_CONTACT_CREATE_FAILED')
      contact = created.data
    }

    const today = new Date().toISOString().slice(0, 10)
    const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    const number = `E2E-VAT-${Date.now()}`
    const header = {
      organization_id: ORGANIZATION_ID, buyer_contact_id: contact.id, invoice_number: number,
      document_type: 'INVOICE', invoice_category: 'STANDARD', issue_date: today, due_date: due,
      issue_time: '12:00:00', currency: 'SAR', exchange_rate: 1,
      seller_name: profile.registered_name, seller_vat_number: profile.tax_registration_number,
      seller_address: profile.seller_street, seller_building_number: profile.seller_building_number,
      seller_district: profile.seller_district, seller_additional_number: profile.seller_additional_number,
      seller_city: profile.seller_city, seller_postal_code: profile.seller_postal_code, seller_country_code: 'SA',
      buyer_name: contact.name, buyer_address: contact.street ?? 'QA Street',
      buyer_building_number: contact.building_number ?? '1234', buyer_district: contact.district ?? 'QA District',
      buyer_additional_number: contact.additional_number ?? '5678', buyer_city: contact.city ?? 'Riyadh',
      buyer_postal_code: contact.postal_code ?? '12345', buyer_country_code: 'SA',
      line_extension_amount: 100, allowance_total_amount: 0, tax_exclusive_amount: 100,
      tax_total_amount: 15, tax_inclusive_amount: 115, payable_amount: 115, tax_total_amount_sar: 15,
      status: 'DRAFT', created_by: ownerUserId,
    }
    const inserted = await owner.from('vat_einvoices').insert(header).select('id').single()
    if (inserted.error || !inserted.data) throw new Error(`E2E_INVOICE_CREATE_FAILED:${inserted.error?.message ?? ''}`)
    invoiceId = inserted.data.id
    const line = await owner.from('vat_einvoice_lines').insert({
      invoice_id: invoiceId, line_number: 1, item_name: 'Operational integration service',
      quantity: 1, unit_code: 'PCE', unit_price: 100, discount_amount: 0,
      tax_category: 'S', tax_rate: 15, line_extension_amount: 100, tax_amount: 15, gross_amount: 115,
    })
    if (line.error) throw new Error(`E2E_INVOICE_LINE_FAILED:${line.error.message}`)

    const issued = await owner.rpc('issue_vat_einvoice', { p_invoice_id: invoiceId })
    if (issued.error) throw new Error(`E2E_INVOICE_ISSUE_FAILED:${issued.error.message}`)

    const prepared = await owner.rpc('prepare_vat_financial_event', {
      p_source_table: 'vat_einvoices', p_source_id: invoiceId, p_entity_id: entityId, p_due_date: due,
    })
    if (prepared.error) throw new Error(`E2E_VAT_PREPARE_FAILED:${prepared.error.message}`)
    const raw = Array.isArray(prepared.data) ? prepared.data[0] : prepared.data
    eventId = typeof raw === 'string' ? raw : (raw?.event_id ?? raw?.id ?? '')
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/i)

    // Idempotency: preparing the same issued source again must return the same event.
    const retry = await owner.rpc('prepare_vat_financial_event', {
      p_source_table: 'vat_einvoices', p_source_id: invoiceId, p_entity_id: entityId, p_due_date: due,
    })
    if (retry.error) throw retry.error
    const retryRaw = Array.isArray(retry.data) ? retry.data[0] : retry.data
    const retryId = typeof retryRaw === 'string' ? retryRaw : (retryRaw?.event_id ?? retryRaw?.id ?? '')
    expect(retryId).toBe(eventId)

    const { data: event } = await owner.from('financial_events').select('*').eq('id', eventId).single()
    expect(event?.status).toBe('COMMITTED')
    expect(event?.source_module).toBe('VAT_INTEGRATION')
  }, 30000)

  it('records Revenue 100 + Output VAT 15 + Receivable 115 with no cash movement', async () => {
    const { data: lines, error: lineError } = await owner.from('financial_event_lines').select('*').eq('event_id', eventId)
    if (lineError) throw lineError
    const classRows = await classifications()
    const typeById = new Map(classRows.map((x) => [x.id, x.classification_type]))
    const revenue = (lines ?? []).find((x) => typeById.get(x.classification_id) === 'REVENUE')
    const tax = (lines ?? []).find((x) => typeById.get(x.classification_id) === 'TAX')
    expect(Math.abs(numeric(revenue ?? {}, ['base_amount', 'amount']))).toBe(100)
    expect(Math.abs(numeric(tax ?? {}, ['base_amount', 'amount']))).toBe(15)

    const { data: obligations, error: obligationError } = await owner.from('financial_event_obligations').select('*').eq('event_id', eventId)
    if (obligationError) throw obligationError
    expect(obligations?.length).toBe(1)
    const obligation = obligations![0] as Record<string, unknown>
    expect(String(obligation.obligation_type ?? obligation.direction ?? '')).toContain('RECEIVABLE')
    expect(Math.abs(numeric(obligation, ['settleable_amount', 'settleable_base_amount']))).toBe(115)

    const { data: settlements, error: settlementError } = await owner.from('liquidity_settlements').select('id').eq('financial_event_id', eventId)
    if (settlementError) throw settlementError
    expect(settlements ?? []).toHaveLength(0)

    const { data: accounts, error: accountError } = await owner.from('liquidity_accounts')
      .select('id,current_balance').eq('organization_id', ORGANIZATION_ID).eq('active', true)
    if (accountError) throw accountError
    for (const account of accounts ?? []) expect(Number(account.current_balance ?? 0)).toBe(cashBefore.get(account.id) ?? 0)
  })

  it('requires independent approval, posts recognition once, and still does not settle cash', async () => {
    const approval = await admin.rpc('approve_financial_event', { p_event_id: eventId, p_note: 'Operational VAT E2E approval' })
    if (approval.error) throw new Error(`E2E_VAT_APPROVAL_FAILED:${approval.error.message}`)

    const post = await owner.rpc('post_vat_financial_event', { p_event_id: eventId })
    if (post.error) throw new Error(`E2E_VAT_POST_FAILED:${post.error.message}`)

    const { data: event, error: eventError } = await owner.from('financial_events').select('status').eq('id', eventId).single()
    if (eventError) throw eventError
    expect(event.status).toBe('ACTUAL')

    const { data: bindings, error: bindingError } = await owner.from('financial_vat_source_bindings').select('event_id')
      .eq('organization_id', ORGANIZATION_ID).eq('source_table', 'vat_einvoices').eq('source_record_id', invoiceId)
    if (bindingError) throw bindingError
    expect(bindings ?? []).toHaveLength(1)
    expect(bindings?.[0]?.event_id).toBe(eventId)

    const { data: settlements, error: settlementError } = await owner.from('liquidity_settlements').select('id').eq('financial_event_id', eventId)
    if (settlementError) throw settlementError
    expect(settlements ?? []).toHaveLength(0)

    const { data: accounts, error: accountError } = await owner.from('liquidity_accounts')
      .select('id,current_balance').eq('organization_id', ORGANIZATION_ID).eq('active', true)
    if (accountError) throw accountError
    for (const account of accounts ?? []) expect(Number(account.current_balance ?? 0)).toBe(cashBefore.get(account.id) ?? 0)

    console.log(`VAT_E2E_INVOICE_ID=${invoiceId}`)
    console.log(`VAT_E2E_EVENT_ID=${eventId}`)
    console.log('VAT_E2E_RECOGNITION=REVENUE_100,VAT_15,RECEIVABLE_115')
    console.log('VAT_E2E_CASH_MOVEMENT=0')
  }, 30000)

  afterAll(async () => {
    await owner.auth.signOut()
    await admin.auth.signOut()
  })
})

describe('Operational Integration V1 VAT purchase recognition', () => {
  it('prepares purchase 100 + VAT 15 as OPEX + TAX + PAYABLE with no cash movement', async () => {
    const { data: accountsBefore } = await owner.from('liquidity_accounts').select('id,current_balance').eq('organization_id', ORGANIZATION_ID).eq('active', true)
    const before = new Map((accountsBefore ?? []).map((a) => [a.id, Number(a.current_balance ?? 0)]))
    let { data: supplier } = await owner.from('vat_contacts').select('*').eq('organization_id', ORGANIZATION_ID).in('contact_type', ['SUPPLIER','BOTH']).limit(1).maybeSingle()
    if (!supplier) {
      throw new Error('E2E_VAT_SUPPLIER_FIXTURE_REQUIRED')
    }
    const today = new Date().toISOString().slice(0,10)
    const inserted = await owner.from('vat_documents').insert({
      organization_id: ORGANIZATION_ID, user_id: ownerUserId, created_by: ownerUserId, document_type: 'PURCHASE', document_kind: 'INVOICE',
      document_number: 'E2E-PURCHASE-' + Date.now(), transaction_date: today, counterparty_contact_id: supplier.id, counterparty_name: supplier.name,
      counterparty_tax_number: supplier.vat_number ?? null, supply_type: 'STANDARD', net_amount: 100, tax_rate: 15, tax_amount: 15,
      recoverable_percent: 100, gross_amount: 115, currency: 'SAR', source_currency: 'SAR', exchange_rate: 1,
      source_net_amount: 100, source_tax_amount: 15, source_gross_amount: 115, line_items: null, notes: 'Operational Integration V1 Purchase VAT E2E'
    }).select('id').single()
    if (inserted.error || !inserted.data) throw new Error('E2E_PURCHASE_CREATE_FAILED:' + (inserted.error?.message ?? ''))
    const purchaseId = inserted.data.id
    const prepared = await owner.rpc('prepare_vat_financial_event', { p_source_table: 'vat_documents', p_source_id: purchaseId, p_entity_id: entityId, p_due_date: today })
    if (prepared.error) throw new Error('E2E_PURCHASE_PREPARE_FAILED:' + prepared.error.message)
    const raw = Array.isArray(prepared.data) ? prepared.data[0] : prepared.data
    const purchaseEventId = typeof raw === 'string' ? raw : (raw?.event_id ?? raw?.id ?? '')
    const retry = await owner.rpc('prepare_vat_financial_event', { p_source_table: 'vat_documents', p_source_id: purchaseId, p_entity_id: entityId, p_due_date: today })
    if (retry.error) throw retry.error
    const rr = Array.isArray(retry.data) ? retry.data[0] : retry.data
    expect(typeof rr === 'string' ? rr : (rr?.event_id ?? rr?.id ?? '')).toBe(purchaseEventId)
    const { data: lines, error: lineError } = await owner.from('financial_event_lines').select('*').eq('event_id', purchaseEventId)
    if (lineError) throw lineError
    const classRows = await classifications()
    const typeById = new Map(classRows.map((x) => [x.id, x.classification_type]))
    expect(Math.abs(numeric((lines ?? []).find((x) => typeById.get(x.classification_id) === 'OPEX') ?? {}, ['base_amount','amount']))).toBe(100)
    expect(Math.abs(numeric((lines ?? []).find((x) => typeById.get(x.classification_id) === 'TAX') ?? {}, ['base_amount','amount']))).toBe(15)
    const { data: obligations, error: obligationError } = await owner.from('financial_event_obligations').select('*').eq('event_id', purchaseEventId)
    if (obligationError) throw obligationError
    expect(obligations ?? []).toHaveLength(1)
    expect(String(obligations?.[0]?.obligation_type ?? '')).toContain('PAYABLE')
    expect(Math.abs(numeric((obligations?.[0] ?? {}) as Record<string, unknown>, ['settleable_amount','settleable_base_amount']))).toBe(115)
    const approval = await admin.rpc('approve_financial_event', { p_event_id: purchaseEventId, p_note: 'Operational Purchase VAT E2E approval' })
    if (approval.error) throw new Error('E2E_PURCHASE_APPROVAL_FAILED:' + approval.error.message)
    const post = await owner.rpc('post_vat_financial_event', { p_event_id: purchaseEventId })
    if (post.error) throw new Error('E2E_PURCHASE_POST_FAILED:' + post.error.message)
    const { data: event } = await owner.from('financial_events').select('status').eq('id', purchaseEventId).single()
    expect(event?.status).toBe('ACTUAL')
    const { data: settlements } = await owner.from('liquidity_settlements').select('id').eq('financial_event_id', purchaseEventId)
    expect(settlements ?? []).toHaveLength(0)
    const { data: accountsAfter } = await owner.from('liquidity_accounts').select('id,current_balance').eq('organization_id', ORGANIZATION_ID).eq('active', true)
    for (const account of accountsAfter ?? []) expect(Number(account.current_balance ?? 0)).toBe(before.get(account.id) ?? 0)
    console.log('VAT_PURCHASE_E2E_RECOGNITION=OPEX_100,INPUT_VAT_15,PAYABLE_115')
    console.log('VAT_PURCHASE_E2E_CASH_MOVEMENT=0')
  }, 30000)
})
