import {z} from 'zod';
import {requireUser} from './auth';
import {requireOrganizationMember} from './organization-access';
import {organizationScopeIds, type WorkspaceOrganization} from '../lib/workspace-organization';
import type {OperationalReportScope} from '../lib/operational-report-scope';
import {buildFixedAssetReport, fixedReportToday, type FixedAssetRecord, type FixedCommand,
 type FixedLot, type FixedOperation} from '../lib/fixed-asset-report';

const LIMIT = 20_000;
export const fixedReportQuery = z.object({
 view: z.enum(['register', 'depreciation', 'exits']).default('register'),
 from: z.iso.date().optional(), to: z.iso.date().optional(),
 offset: z.coerce.number().int().min(0).max(LIMIT).default(0),
 query: z.string().trim().max(120).default(''), category: z.enum(['PPE', 'INTANGIBLE', 'LEGACY_REAL_ESTATE']).optional(),
 center: z.uuid().optional(), state: z.enum(['ACTIVE', 'EXITED', 'PENDING', 'UNVERIFIED']).optional(), full: z.enum(['0', '1']).default('0'),
 sort: z.enum(['name', 'acquisition']).default('name'), order: z.enum(['asc', 'desc']).default('asc'),
}).refine(value => !value.from || !value.to || value.from <= value.to);

type Context = Awaited<ReturnType<typeof requireUser>>;

async function rows<T>(query: () => any): Promise<T[]> {
 const result: T[] = [];
 const size = 500;
 for (let offset = 0; offset <= LIMIT; offset += size) {
  const {data, error} = await query().order('id').range(offset, offset + size - 1);
  if (error) throw error;
  result.push(...(data ?? []));
  if (result.length > LIMIT) break;
  if (!data || data.length < size) return result;
 }
 throw Error('FIXED_ASSET_REPORT_LIMIT');
}

async function linked<T>(ids: string[], query: (ids: string[]) => any) {
 const result: T[] = [];
 const size = 100;
 for (let start = 0; start < ids.length; start += size * 4) {
  const tasks = [];
  for (let index = start; index < Math.min(start + size * 4, ids.length); index += size) {
   tasks.push(rows<T>(() => query(ids.slice(index, index + size))));
  }
  for (const batch of await Promise.all(tasks)) result.push(...batch);
  if (result.length > LIMIT) throw Error('FIXED_ASSET_REPORT_LIMIT');
 }
 return result;
}

async function loadScope({supabase, user}: Context, scope: OperationalReportScope, center?: string) {
 const currencies = new Map<string | null, string>();
 if (scope.scope === 'PERSONAL') {
  if (center) throw Error('FIXED_ASSET_FILTER_SCOPE');
  const profile = await supabase.from('profiles').select('base_currency').eq('id', user.id).single();
  if (profile.error) throw profile.error;
  if (!profile.data?.base_currency) throw Error('FIXED_ASSET_BASE_CURRENCY');
  currencies.set(null, profile.data.base_currency);
  return {ids: [], currencies};
 }
 const root = scope.organization_id!;
 await requireOrganizationMember(supabase, user.id, root);
 const organizations = await rows<WorkspaceOrganization>(() => {
  const query = supabase.from('organizations').select('id,name,base_currency,parent_organization_id,organization_kind');
  return scope.group ? query : query.eq('id', root);
 });
 if (!organizations.some(org => org.id === root)) throw Error('ORGANIZATION_ACCESS_REQUIRED');
 const ids = [...organizationScopeIds(organizations, root, scope.group)];
 await Promise.all(ids.map(async id => {
  if (id !== root) await requireOrganizationMember(supabase, user.id, id);
  const permission = await supabase.rpc('has_organization_permission', {p_organization_id: id, p_permission: 'assets.view'});
  if (permission.error) throw permission.error;
  if (permission.data !== true) throw Error('FIXED_ASSET_ACCESS_DENIED');
 }));
 for (const {id, base_currency} of organizations) {
  if (!ids.includes(id)) continue;
  if (!base_currency) throw Error('FIXED_ASSET_BASE_CURRENCY');
  currencies.set(id, base_currency);
 }
 const filters = [
  {table: 'organization_entities', id: scope.entity_id},
  {table: 'organization_cost_centers', id: center},
 ];
 for (const filter of filters) {
  if (!filter.id) continue;
  const result = await supabase.from(filter.table).select('id').eq('id', filter.id).in('organization_id', ids).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw Error('FIXED_ASSET_FILTER_SCOPE');
 }
 return {ids, currencies};
}

export async function readFixedAssetReport(scope: OperationalReportScope, options: z.infer<typeof fixedReportQuery>) {
 const context = await requireUser();
 const {supabase, user} = context;
 const {ids, currencies} = await loadScope(context, scope, options.center);
 const personal = scope.scope === 'PERSONAL';
 const to = options.to ?? fixedReportToday();
 const from = options.from ?? `${to.slice(0, 4)}-01-01`;
 if (from > to) throw Error('FIXED_ASSET_FILTER_SCOPE');
 const scoped = (query: any) => personal ? query.eq('user_id', user.id).is('organization_id', null) : query.in('organization_id', ids);
 const search = options.query.toLocaleLowerCase();
 const assets = (await rows<FixedAssetRecord>(() => {
  let query = scoped(supabase.from('asset_accounts')
   .select('id,name,organization_id,entity_id,cost_center_id,asset_class_code,asset_type,asset_type_code'))
   .eq('ownership_scope', scope.scope)
   .or('asset_class_code.in.(PPE,INTANGIBLE),and(asset_class_code.is.null,asset_type.eq.REAL_ESTATE)')
   .or('metadata->>archived.is.null,metadata->>archived.neq.true');
  if (scope.entity_id) query = query.eq('entity_id', scope.entity_id);
  if (options.center) query = query.eq('cost_center_id', options.center);
  if (options.category === 'LEGACY_REAL_ESTATE') query = query.is('asset_class_code', null);
  else if (options.category) query = query.eq('asset_class_code', options.category);
  return query;
 })).filter(asset => !search || `${asset.name} ${asset.asset_type_code ?? ''}`.toLocaleLowerCase().includes(search));
 const assetIds = assets.map(asset => asset.id);
 const [lots, operations, commands] = await Promise.all([
  linked<FixedLot>(assetIds, batch => {
   let query = supabase.from('lots')
    .select('id,asset_account_id,original_quantity::text,remaining_quantity::text,original_value_base::text,remaining_value_base::text,acquisition_date,metadata,source:transactions!lots_source_transaction_id_fkey(id,transaction_type,base_currency,metadata)')
    .in('asset_account_id', batch);
   // The parent asset and RLS scope institutional legacy lots whose own organization_id is NULL.
   if (personal) query = query.eq('user_id', user.id).is('organization_id', null);
   return query;
  }),
  linked<FixedOperation>(assetIds, batch => {
   let query = scoped(supabase.from('transactions').select(
    'id,asset_account_id,transaction_date,transaction_type,base_currency,base_value::text,reference,created_at,reversal_of_transaction_id,metadata',
   )).in('asset_account_id', batch)
    .or('transaction_type.eq.SALE,metadata->>operation.in.(DEPRECIATION,SALE,DISPOSAL),metadata->>reason.eq.DISPOSAL_ZERO_VALUE,reversal_of_transaction_id.not.is.null');
   if (personal) query = query.gte('transaction_date', from);
   return query;
  }),
  personal ? [] : linked<FixedCommand>(assetIds, batch => supabase.from('asset_lifecycle_commands')
   .select('id,transaction_id,applied_at,lot_states').in('organization_id', ids).in('asset_account_id', batch)
   .not('applied_at', 'is', null).not('transaction_id', 'is', null)),
 ]);
 return buildFixedAssetReport({assets, lots, operations, commands, currencies, from, to, personal,
  view: options.view, offset: options.full === '1' ? 0 : options.offset, limit: options.full === '1' ? LIMIT : 25,
  sort: options.sort, order: options.order, state: options.state,
 });
}
