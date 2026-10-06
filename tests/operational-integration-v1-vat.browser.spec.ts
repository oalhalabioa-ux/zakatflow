import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const QA_PROJECT_REF = 'wtzgzmcgcqouziqzsfnl'
const QA_URL = `https://${QA_PROJECT_REF}.supabase.co`
const APP_URL = process.env.E2E_APP_URL ?? 'http://127.0.0.1:3000'
const ORGANIZATION_ID = '85acbac0-e8b4-434c-a22b-3ec13b55e1a7'
const SUPPLIER_ID = 'c52ba260-1299-4633-9517-6eed98eeedd8'

test('purchase 100 + VAT 15 prepares one committed Core event without moving cash', async ({ page }) => {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY
  const email = process.env.E2E_OWNER_EMAIL
  const password = process.env.E2E_OWNER_PASSWORD
  expect(anonKey).toBeTruthy()
  expect(email).toBeTruthy()
  expect(password).toBeTruthy()

  const qa = createClient(QA_URL, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
  const auth = await qa.auth.signInWithPassword({ email: email!, password: password! })
  if (auth.error) throw auth.error

  const beforeResult = await qa.from('liquidity_accounts')
    .select('id,current_balance').eq('organization_id', ORGANIZATION_ID).eq('active', true)
  if (beforeResult.error) throw beforeResult.error
  const before = new Map((beforeResult.data ?? []).map(a => [a.id, Number(a.current_balance ?? 0)]))

  // Seed the authenticated Supabase SSR cookie from the already-proven QA login.
  // This keeps the test focused on the real /api/vat operational path rather than UI redirects.
  const session = auth.data.session
  if (!session) throw new Error('E2E_SESSION_REQUIRED')
  const cookieName = `sb-${QA_PROJECT_REF}-auth-token`
  const cookieValue = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  await page.context().addCookies([{
    name: cookieName,
    value: cookieValue,
    url: APP_URL,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  }])
  await page.goto(`${APP_URL}/en`)

  const today = new Date().toISOString().slice(0, 10)
  const documentNumber = `E2E-PURCHASE-${Date.now()}`
  const result = await page.evaluate(async ({ organizationId, supplierId, today, documentNumber }) => {
    const response = await fetch('/api/vat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'add_document',
        organization_id: organizationId,
        document_type: 'PURCHASE',
        document_kind: 'INVOICE',
        document_number: documentNumber,
        transaction_date: today,
        counterparty_contact_id: supplierId,
        counterparty_name: 'Phase 2F QA Supplier',
        counterparty_tax_number: null,
        supply_type: 'STANDARD',
        net_amount: 100,
        lines: [{ description: 'Operational Integration V1 Purchase', unit: 'PCE', quantity: 1, unit_price: 100, discount_amount: 0, supply_type: 'STANDARD' }],
        currency: 'SAR',
        exchange_rate: 1,
        recoverable_percent: 100,
        notes: 'Browser E2E operational purchase recognition'
      })
    })
    return { status: response.status, body: await response.json() }
  }, { organizationId: ORGANIZATION_ID, supplierId: SUPPLIER_ID, today, documentNumber })

  expect(result.status, JSON.stringify(result.body)).toBe(201)
  expect(Number(result.body.net_amount)).toBe(100)
  expect(Number(result.body.tax_amount)).toBe(15)
  expect(Number(result.body.gross_amount)).toBe(115)
  expect(result.body.financial_core?.status).toBe('COMMITTED')
  expect(result.body.financial_core?.recognition).toBe('PENDING_INDEPENDENT_APPROVAL')
  const eventId = result.body.financial_core?.event_id
  expect(eventId).toMatch(/^[0-9a-f-]{36}$/i)

  const entities = await qa.from('organization_entities')
    .select('id').eq('organization_id', ORGANIZATION_ID).eq('active', true).limit(2)
  if (entities.error || !entities.data || entities.data.length !== 1) throw new Error('E2E_FINANCIAL_ENTITY_REQUIRED')

  const retry = await qa.rpc('prepare_vat_financial_event', {
    p_source_table: 'vat_documents',
    p_source_id: result.body.id,
    p_entity_id: entities.data[0].id,
    p_due_date: today,
  })
  if (retry.error) throw retry.error
  const retryRaw = Array.isArray(retry.data) ? retry.data[0] : retry.data
  const retryId = typeof retryRaw === 'string' ? retryRaw : (retryRaw?.event_id ?? retryRaw?.id ?? '')
  expect(retryId).toBe(eventId)

  const afterResult = await qa.from('liquidity_accounts')
    .select('id,current_balance').eq('organization_id', ORGANIZATION_ID).eq('active', true)
  if (afterResult.error) throw afterResult.error
  for (const account of afterResult.data ?? []) {
    expect(Number(account.current_balance ?? 0)).toBe(before.get(account.id) ?? 0)
  }

  console.log(`VAT_PURCHASE_BROWSER_E2E_DOCUMENT_ID=${result.body.id}`)
  console.log(`VAT_PURCHASE_BROWSER_E2E_EVENT_ID=${eventId}`)
  console.log('VAT_PURCHASE_BROWSER_E2E=NET_100,INPUT_VAT_15,GROSS_115,CORE_COMMITTED')
  console.log('VAT_PURCHASE_BROWSER_E2E_CASH_MOVEMENT=0')

  await qa.auth.signOut()
})
