import { z } from 'zod';
import { requireUser } from './auth';

const amount = z.string().regex(/^\d{1,14}\.\d{2}$/);
const document = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  receivable_id: z.string().uuid(),
  document_date: z.string().date(),
  kind: z.enum(['FEE_INVOICE', 'EXTERNAL_EVIDENCE', 'SIMPLIFIED_INVOICE']),
  net_amount: amount.refine(value => value !== '0.00'),
  tax_amount: amount,
});

/** The issuer records net income at the document date. Collections are outside this reader. */
export async function readPersonalProfessionalIncome(from: string, to: string) {
  const { user, supabase } = await requireUser();
  const documents = new Map<string, z.infer<typeof document>>();
  const pageSize = 500;
  const limit = 5000;
  for (let start = 0; start <= limit; start += pageSize) {
    const end = Math.min(start + pageSize - 1, limit);
    const { data, error } = await supabase.from('personal_income_documents')
      .select('id,owner_id,receivable_id,document_date,kind,net_amount::text,tax_amount::text')
      .eq('owner_id', user.id).not('receivable_id', 'is', null).neq('kind', 'TAX_DRAFT')
      .gte('document_date', from).lte('document_date', to).order('document_date').order('id')
      .range(start, end);
    const page = document.array().safeParse(data);
    if (error || !page.success) throw Error('PERSONAL_PROFESSIONAL_INCOME_SOURCE_UNAVAILABLE');
    for (const row of page.data) {
      if (row.owner_id !== user.id || row.document_date < from || row.document_date > to || documents.has(row.id))
        throw Error('PERSONAL_PROFESSIONAL_INCOME_SOURCE_INVALID');
      documents.set(row.id, row);
    }
    if (documents.size > limit) break;
    if (page.data.length < end - start + 1) return [...documents.values()].map(row => ({
      documentId: row.id, receivableId: row.receivable_id, date: row.document_date, kind: row.kind,
      currency: 'SAR' as const, net: row.net_amount, tax: row.tax_amount,
    }));
  }
  throw Error('PERSONAL_PROFESSIONAL_INCOME_SOURCE_LIMIT');
}
