import { describe, expect, it } from 'vitest';
import { vatDocumentSchema, vatProfileSchema } from './validation/schemas';

const profile = {
  organization_id: '6df22f7f-97bd-4e36-9c77-66e38f433e41',
  registration_status: 'REGISTERED',
  filing_frequency: 'QUARTERLY',
  standard_rate: 15,
  period_start_month: 1,
};

describe('VAT validation', () => {
  it('requires a registration number for registered organizations', () => {
    expect(vatProfileSchema.safeParse(profile).success).toBe(false);
    expect(vatProfileSchema.safeParse({ ...profile, tax_registration_number: '310000000000003' }).success).toBe(true);
    expect(vatProfileSchema.safeParse({ ...profile, standard_rate: 5, tax_registration_number: '310000000000003' }).success).toBe(false);
  });

  it('prevents classifying sales input VAT as recoverable', () => {
    const sale = {
      organization_id: profile.organization_id,
      document_type: 'SALES',
      document_kind: 'INVOICE',
      document_number: 'INV-100',
      transaction_date: '2026-09-01',
      counterparty_name: 'Test customer',
      supply_type: 'STANDARD',
      net_amount: 100,
      recoverable_percent: 80,
    };
    expect(vatDocumentSchema.safeParse(sale).success).toBe(false);
    expect(vatDocumentSchema.safeParse({ ...sale, recoverable_percent: 100 }).success).toBe(true);
  });
});
