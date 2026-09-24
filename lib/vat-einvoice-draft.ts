import Decimal from 'decimal.js';
import { z } from 'zod';

const taxCategorySchema = z.enum(['S', 'Z', 'E', 'O']);

const invoiceLineSchema = z.object({
  item_name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  quantity: z.coerce.number().finite().positive().max(1_000_000_000),
  unit_code: z.string().trim().min(1).max(10).default('PCE'),
  unit_price: z.coerce.number().finite().nonnegative().max(1_000_000_000),
  discount_amount: z.coerce.number().finite().nonnegative().max(1_000_000_000).default(0),
  tax_category: taxCategorySchema.default('S'),
  tax_rate: z.coerce.number().finite().min(0).max(100).default(15),
  tax_exemption_reason_code: z.string().trim().max(20).optional().nullable(),
  tax_exemption_reason: z.string().trim().max(500).optional().nullable(),
}).superRefine((line, context) => {
  if (line.tax_category === 'S' && line.tax_rate === 0) {
    context.addIssue({ code: 'custom', message: 'STANDARD_TAX_RATE_REQUIRED', path: ['tax_rate'] });
  }
  if (line.tax_category !== 'S' && line.tax_rate !== 0) {
    context.addIssue({ code: 'custom', message: 'ZERO_TAX_RATE_REQUIRED', path: ['tax_rate'] });
  }
  if (line.tax_category === 'Z' || line.tax_category === 'E') {
    if (!line.tax_exemption_reason_code || !line.tax_exemption_reason) {
      context.addIssue({ code: 'custom', message: 'TAX_TREATMENT_REASON_REQUIRED', path: ['tax_exemption_reason_code'] });
    }
  }
});

export const vatEInvoiceDraftSchema = z.object({
  organization_id: z.string().uuid(),
  connection_id: z.string().uuid().optional().nullable(),
  invoice_number: z.string().trim().min(1).max(100),
  document_type: z.enum(['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']).default('INVOICE'),
  invoice_category: z.enum(['STANDARD', 'SIMPLIFIED']),
  issue_date: z.string().date(),
  issue_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'INVALID_ISSUE_TIME'),
  currency: z.literal('SAR').default('SAR'),
  seller_name: z.string().trim().min(1).max(200),
  seller_vat_number: z.string().trim().regex(/^3\d{13}3$/, 'INVALID_SELLER_VAT_NUMBER'),
  seller_address: z.string().trim().min(1).max(250),
  seller_city: z.string().trim().min(1).max(120),
  seller_building_number: z.string().trim().regex(/^\d{4}$/, 'INVALID_SELLER_BUILDING_NUMBER'),
  seller_district: z.string().trim().min(1).max(120),
  seller_additional_number: z.string().trim().regex(/^\d{4}$/, 'INVALID_SELLER_ADDITIONAL_NUMBER'),
  seller_postal_code: z.string().trim().regex(/^\d{5}$/, 'INVALID_SELLER_POSTAL_CODE'),
  seller_country_code: z.literal('SA').default('SA'),
  buyer_name: z.string().trim().max(200).optional().nullable(),
  buyer_vat_number: z.string().trim().regex(/^3\d{13}3$/, 'INVALID_BUYER_VAT_NUMBER').optional().nullable(),
  buyer_address: z.string().trim().max(250).optional().nullable(),
  buyer_city: z.string().trim().max(120).optional().nullable(),
  buyer_building_number: z.string().trim().regex(/^\d{4}$/, 'INVALID_BUYER_BUILDING_NUMBER').optional().nullable(),
  buyer_district: z.string().trim().max(120).optional().nullable(),
  buyer_additional_number: z.string().trim().regex(/^\d{4}$/, 'INVALID_BUYER_ADDITIONAL_NUMBER').optional().nullable(),
  buyer_postal_code: z.string().trim().regex(/^\d{5}$/, 'INVALID_BUYER_POSTAL_CODE').optional().nullable(),
  buyer_country_code: z.literal('SA').default('SA'),
  payment_means_code: z.string().trim().max(10).optional().nullable(),
  billing_reference: z.string().trim().max(100).optional().nullable(),
  preceding_invoice_id: z.string().uuid().optional().nullable(),
  note_reason: z.string().trim().max(500).optional().nullable(),
  lines: z.array(invoiceLineSchema).min(1).max(500),
}).superRefine((invoice, context) => {
  if (invoice.invoice_category === 'STANDARD') {
    if (!invoice.buyer_name?.trim()) context.addIssue({ code: 'custom', message: 'STANDARD_BUYER_REQUIRED', path: ['buyer_name'] });
    if (!invoice.buyer_address?.trim()) context.addIssue({ code: 'custom', message: 'STANDARD_BUYER_ADDRESS_REQUIRED', path: ['buyer_address'] });
    if (!invoice.buyer_city?.trim()) context.addIssue({ code: 'custom', message: 'STANDARD_BUYER_CITY_REQUIRED', path: ['buyer_city'] });
    if (!invoice.buyer_district?.trim()) context.addIssue({ code: 'custom', message: 'STANDARD_BUYER_DISTRICT_REQUIRED', path: ['buyer_district'] });
    if (!invoice.buyer_postal_code) context.addIssue({ code: 'custom', message: 'STANDARD_BUYER_POSTAL_REQUIRED', path: ['buyer_postal_code'] });
    if (invoice.buyer_country_code === 'SA' && !invoice.buyer_building_number) {
      context.addIssue({ code: 'custom', message: 'STANDARD_BUYER_BUILDING_REQUIRED', path: ['buyer_building_number'] });
    }
  }
  if (invoice.document_type !== 'INVOICE') {
    if (!invoice.preceding_invoice_id && !invoice.billing_reference?.trim()) {
      context.addIssue({ code: 'custom', message: 'NOTE_INVOICE_REFERENCE_REQUIRED', path: ['billing_reference'] });
    }
    if (!invoice.note_reason?.trim()) context.addIssue({ code: 'custom', message: 'NOTE_REASON_REQUIRED', path: ['note_reason'] });
  }
});

export type VatEInvoiceDraft = z.infer<typeof vatEInvoiceDraftSchema>;

function amount(value: Decimal) {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function calculateVatEInvoiceDraft(draft: VatEInvoiceDraft) {
  let lineExtensionTotal = new Decimal(0);
  const taxBases = new Map<string, { taxCategory: string; taxRate: Decimal; taxableAmount: Decimal }>();
  const lines = draft.lines.map((line, index) => {
    const grossLine = new Decimal(line.quantity).mul(line.unit_price);
    const discount = new Decimal(line.discount_amount);
    if (discount.greaterThan(grossLine)) throw new Error(`LINE_DISCOUNT_EXCEEDS_AMOUNT:${index + 1}`);
    const lineExtension = amount(grossLine.minus(discount));
    const tax = amount(lineExtension.mul(line.tax_rate).div(100));
    const gross = lineExtension.plus(tax);
    lineExtensionTotal = lineExtensionTotal.plus(lineExtension);
    const key = `${line.tax_category}:${line.tax_rate.toFixed(2)}`;
    const currentBase = taxBases.get(key) ?? {
      taxCategory: line.tax_category,
      taxRate: new Decimal(line.tax_rate),
      taxableAmount: new Decimal(0),
    };
    currentBase.taxableAmount = currentBase.taxableAmount.plus(lineExtension);
    taxBases.set(key, currentBase);
    return {
      ...line,
      line_number: index + 1,
      line_extension_amount: lineExtension.toFixed(2),
      tax_amount: tax.toFixed(2),
      gross_amount: gross.toFixed(2),
    };
  });

  const totalExclusive = amount(lineExtensionTotal);
  const taxBreakdowns = Array.from(taxBases.values(), (breakdown) => {
    const taxableAmount = amount(breakdown.taxableAmount);
    const taxAmount = breakdown.taxCategory === 'O' ? new Decimal(0) : amount(taxableAmount.mul(breakdown.taxRate).div(100));
    return {
      tax_category: breakdown.taxCategory,
      tax_rate: breakdown.taxRate.toFixed(2),
      taxable_amount: taxableAmount.toFixed(2),
      tax_amount: taxAmount.toFixed(2),
    };
  });
  const totalTax = amount(taxBreakdowns.reduce((total, breakdown) => total.plus(breakdown.tax_amount), new Decimal(0)));
  const totalInclusive = amount(totalExclusive.plus(totalTax));
  return {
    lines,
    taxBreakdowns,
    totals: {
      line_extension_amount: totalExclusive.toFixed(2),
      allowance_total_amount: '0.00',
      tax_exclusive_amount: totalExclusive.toFixed(2),
      tax_total_amount: totalTax.toFixed(2),
      tax_inclusive_amount: totalInclusive.toFixed(2),
      payable_amount: totalInclusive.toFixed(2),
    },
  };
}
