import {requireUser} from './auth';
import {summarizeRealizedProfit, type AssetSale, type SaleAllocation, type SaleExpense, type SalePosting, type SaleReceipt} from '@/lib/asset-realized-profit';

const PAGE_SIZE = 200;
const BATCH_SIZE = 75;

async function readRows<T>(read: (start: number, end: number) => PromiseLike<{data: unknown; error: unknown}>) {
  const rows: T[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const {data, error} = await read(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function readLinked<T>(keys: string[], read: (keys: string[], start: number, end: number) => PromiseLike<{data: unknown; error: unknown}>) {
  const rows: T[] = [];
  for (let start = 0; start < keys.length; start += BATCH_SIZE) {
    const batch = keys.slice(start, start + BATCH_SIZE);
    rows.push(...await readRows<T>((from, to) => read(batch, from, to)));
  }
  return rows;
}

export async function readAssetRealizedProfits(scope: 'PERSONAL' | 'ORGANIZATION') {
  const {supabase, user} = await requireUser();
  const personal = scope === 'PERSONAL';
  const sales = await readRows<AssetSale>((from, to) => {
    const query = supabase.from('transactions').select('id,user_id,organization_id,asset_account_id,asset_accounts!transactions_asset_account_id_fkey!inner(id),transaction_date,transfer_id,quantity::text,unit_price::text,gross_value::text,base_value::text,base_currency,currency,metadata')
      .eq('transaction_type', 'SALE').order('id').range(from, to);
    return personal ? query.eq('user_id', user.id).is('organization_id', null) : query.not('organization_id', 'is', null);
  });
  const ids = sales.map(row => row.id);
  const [allocations, receipts, postings, expenses] = await Promise.all([
    personal ? readLinked<SaleAllocation>(ids, (batch, from, to) => supabase.from('transaction_allocations')
      .select('transaction_id,quantity::text,value_base::text,lots(user_id,organization_id,asset_account_id)')
      .eq('user_id', user.id).in('transaction_id', batch).order('id').range(from, to)) : [],
    personal ? readLinked<SaleReceipt>(ids, (batch, from, to) => supabase.from('transactions')
      .select('id,user_id,organization_id,asset_account_id,transaction_date,transfer_id,base_value::text,base_currency,metadata')
      .eq('user_id', user.id).is('organization_id', null).eq('transaction_type', 'ADD').eq('metadata->>source', 'sale_proceeds')
      .in('metadata->>sale_transaction_id', batch).order('id').range(from, to)) : [],
    personal ? [] : readLinked<SalePosting>(ids, (batch, from, to) => supabase.from('asset_lifecycle_commands')
      .select('id,transaction_id,asset_account_id,financial_event_id,organization_id,operation_date,applied_at,quantity::text,amount::text,book_effect::text,vat_amount::text,financial_events(status,source_module,source_record_id,base_currency)')
      .eq('operation', 'SALE').in('transaction_id', batch).order('id').range(from, to)),
    readLinked<SaleExpense>(ids, (batch, from, to) => supabase.rpc('asset_sale_expenses', {p_sale_ids: batch})
      .order('sale_id').order('source_id').range(from, to)),
  ]);
  const reversals = personal ? await readLinked<{reversal_of_transaction_id: string}>([...ids, ...receipts.map(row => row.id)],
    (batch, from, to) => supabase.from('transactions').select('reversal_of_transaction_id')
      .eq('user_id', user.id).is('organization_id', null).in('reversal_of_transaction_id', batch)
      .or('metadata->>asset_deleted.is.null,metadata->>asset_deleted.neq.true').order('id').range(from, to)) : [];
  const allowed = new Set((await readRows<{id: string}>((from, to) => {
    const query = supabase.from('asset_accounts').select('id').order('id').range(from, to);
    return personal ? query.eq('user_id', user.id).is('organization_id', null) : query.not('organization_id', 'is', null);
  })).map(row => row.id));
  const report = summarizeRealizedProfit({sales, allocations, receipts, postings, expenses,
    reversed: new Set(reversals.map(row => row.reversal_of_transaction_id))});
  return Object.fromEntries([...report].filter(([id]) => allowed.has(id)));
}
