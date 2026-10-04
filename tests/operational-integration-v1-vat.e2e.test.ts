import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const QA_PROJECT_REF = 'wtzgzmcgcqouziqzsfnl'
const QA_URL = `https://${QA_PROJECT_REF}.supabase.co`
const ORGANIZATION_ID = '85acbac0-e8b4-434c-a22b-3ec13b55e1a7'
const REQUIRED_TYPES = ['REVENUE', 'OPEX', 'TAX', 'PAYABLE'] as const

type Classification = {
  id: string
  code: string
  name: string
  classification_type: string
  organization_id: string
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY
const ownerEmail = process.env.E2E_OWNER_EMAIL
const ownerPassword = process.env.E2E_OWNER_PASSWORD

if (process.env.E2E_REQUIRE_CONFIG === 'true') {
  if (supabaseUrl !== QA_URL) throw new Error('E2E_QA_SUPABASE_TARGET_MISMATCH')
  if (!anonKey) throw new Error('E2E_QA_PUBLISHABLE_KEY_MISSING')
  if (!ownerEmail || !ownerPassword) throw new Error('E2E_OWNER_CREDENTIALS_MISSING')
}

const client: SupabaseClient = createClient(QA_URL, anonKey ?? 'missing', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

let classificationId = ''
let revenueStatus: 'Existing' | 'Created' = 'Existing'

async function readClassifications(): Promise<Classification[]> {
  const { data, error } = await client
    .from('financial_classifications')
    .select('id,code,name,classification_type,organization_id')
    .eq('organization_id', ORGANIZATION_ID)

  if (error) throw new Error('E2E_CLASSIFICATION_READ_FAILED')
  return (data ?? []) as Classification[]
}

describe('Operational Integration V1 VAT prerequisites', () => {
  beforeAll(async () => {
    const { data, error } = await client.auth.signInWithPassword({
      email: ownerEmail ?? '',
      password: ownerPassword ?? '',
    })

    if (error || !data.user || !data.session) {
      throw new Error('E2E_OWNER_AUTHENTICATION_FAILED')
    }

    const { data: canEdit, error: permissionError } = await client.rpc(
      'has_organization_permission',
      {
        p_organization_id: ORGANIZATION_ID,
        p_permission: 'organization.edit',
      },
    )

    if (permissionError || canEdit !== true) {
      throw new Error('E2E_OWNER_RLS_PERMISSION_FAILED')
    }

    const classifications = await readClassifications()
    let revenue = classifications.find(
      (item) => item.classification_type === 'REVENUE',
    )

    if (!revenue) {
      const { data: created, error: createError } = await client
        .from('financial_classifications')
        .insert({
          organization_id: ORGANIZATION_ID,
          code: 'P2F-REVENUE',
          name: 'Phase 2F QA Revenue',
          classification_type: 'REVENUE',
          created_by: data.user.id,
        })
        .select('id,code,name,classification_type,organization_id')
        .single()

      if (createError || !created) {
        const retry = (await readClassifications()).find(
          (item) => item.classification_type === 'REVENUE',
        )
        if (!retry) throw new Error('E2E_REVENUE_CREATE_FAILED')
        revenue = retry
      } else {
        revenueStatus = 'Created'
        revenue = created as Classification
      }
    }

    classificationId = revenue.id
  })

  it('authenticates the Owner and uses the normal RLS path', async () => {
    const { data, error } = await client.auth.getUser()
    expect(error).toBeNull()
    expect(data.user?.id).toBeTruthy()
  })

  it('has exactly the required classification prerequisites', async () => {
    const classifications = await readClassifications()
    const types = new Set(classifications.map((item) => item.classification_type))

    for (const type of REQUIRED_TYPES) {
      expect(types.has(type)).toBe(true)
    }

    expect(classificationId).toMatch(/^[0-9a-f-]{36}$/i)
    console.log(`OPERATIONAL_QA_REVENUE_STATUS=${revenueStatus}`)
    console.log(`OPERATIONAL_QA_CLASSIFICATION_ID=${classificationId}`)
    console.log(`OPERATIONAL_QA_TYPES=${REQUIRED_TYPES.join(',')}`)
  })

  afterAll(async () => {
    await client.auth.signOut()
  })
})
