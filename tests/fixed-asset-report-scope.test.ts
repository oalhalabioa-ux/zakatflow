import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {readFixedAssetReport, fixedReportQuery} from '../services/fixed-asset-report';
import {operationalReportScopeSchema} from '../lib/operational-report-scope';

const {login} = vi.hoisted(() => ({login: vi.fn()}));
vi.mock('../services/auth', () => ({requireUser: login}));

const owner = '11111111-2222-4333-8444-555555555555';
const org = '22222222-2222-4333-8444-555555555555';
const branch = '33333333-2222-4333-8444-555555555555';
const asset = '44444444-2222-4333-8444-555555555555';
const trace: URL[] = [];
let allow: boolean;
let matchingBranch: boolean;
function read(scope: object, query: object = {}) {
 return readFixedAssetReport(operationalReportScopeSchema.parse(scope), fixedReportQuery.parse(query));
}

beforeEach(() => {
 trace.length = 0;
 allow = true;
 matchingBranch = true;
 const fetch: typeof globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  trace.push(url);
  const table = url.pathname.split('/').at(-1);
  const acceptsObject = new Headers(init?.headers).get('accept') === 'application/vnd.pgrst.object+json';
  let data: unknown = [];
  if (table === 'profiles') data = {base_currency: 'SAR'};
  if (table === 'organization_members') data = acceptsObject ? {status: 'ACTIVE', role: 'OWNER'} : [{status: 'ACTIVE', role: 'OWNER'}];
  if (table === 'organizations') data = [{id: org, name: 'Synthetic', base_currency: 'SAR'}];
  if (table === 'has_organization_permission') data = allow;
  if (table === 'organization_entities') data = matchingBranch ? (acceptsObject ? {id: branch} : [{id: branch}]) : [];
  if (table === 'asset_accounts') data = [{
   id: asset, name: 'Synthetic machine', organization_id: url.searchParams.get('organization_id') === 'is.null' ? null : org,
   entity_id: null, cost_center_id: null, asset_class_code: 'PPE', asset_type: 'OTHER', asset_type_code: 'MACHINERY',
  }];
  return Response.json(data);
 };
 const supabase = createClient('https://test.invalid', 'test-key', {global: {fetch},
  auth: {persistSession: false, autoRefreshToken: false}});
 login.mockResolvedValue({supabase, user: {id: owner}});
});

describe('fixed asset report database scope', () => {
 it('keeps personal asset, transaction and lot reads within the signed-in owner', async () => {
  const report = await read({scope: 'PERSONAL'});
  expect(report.register[0]).toMatchObject({id: asset, organization: null});
  const sources = trace.filter(url => /\/(asset_accounts|lots|transactions)$/.test(url.pathname));
  expect(sources).toHaveLength(3);
  expect(sources.every(url => url.searchParams.get('user_id') === `eq.${owner}`)).toBe(true);
  expect(sources.every(url => url.searchParams.get('organization_id') === 'is.null')).toBe(true);
  expect(trace.some(url => url.pathname.endsWith('asset_lifecycle_commands'))).toBe(false);
 });

 it('refuses an unrelated branch or missing permission before touching report source rows', async () => {
  const scope = {scope: 'ORGANIZATION', organization_id: org, entity_id: branch};
  allow = false;
  await expect(read(scope)).rejects.toThrow('FIXED_ASSET_ACCESS_DENIED');
  allow = true;
  matchingBranch = false;
  await expect(read(scope)).rejects.toThrow('FIXED_ASSET_FILTER_SCOPE');
  expect(trace.some(url => url.pathname.endsWith('asset_accounts'))).toBe(false);
 });

 it('binds an authorized branch to its organization and traverses lots only by visible parent', async () => {
  await read({scope: 'ORGANIZATION', organization_id: org, entity_id: branch});
  const assetRead = trace.find(url => url.pathname.endsWith('asset_accounts'))!;
  const lotRead = trace.find(url => url.pathname.endsWith('lots'))!;
  const commands = trace.find(url => url.pathname.endsWith('asset_lifecycle_commands'))!;
  expect(assetRead.searchParams.get('entity_id')).toBe(`eq.${branch}`);
  expect(assetRead.searchParams.get('organization_id')).toBe(`in.(${org})`);
  expect(lotRead.searchParams.get('asset_account_id')).toBe(`in.(${asset})`);
  expect(lotRead.searchParams.has('organization_id')).toBe(false);
  expect(commands.searchParams.get('organization_id')).toBe(`in.(${org})`);
  expect(commands.searchParams.get('applied_at')).toBe('not.is.null');
 });
});
