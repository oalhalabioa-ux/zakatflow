import {z} from 'zod';
import {requireUser} from './auth';
import {assertLiveStatements,liveStatementSource} from './financial-statement-live';
import {statementQuery} from '../lib/financial-statement-source';
import {validateGroupControlScope} from '../lib/financial-group-control';
import {reviewControlledGroupSources} from '../lib/financial-group-source-review';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
const uuid=z.string().uuid(),date=z.string().date(),percent=z.string().regex(/^\d{1,3}(\.\d{1,6})?$/);
const registrySchema=z.object({rootOrganizationId:uuid,from:date,to:date,
 expectedOrganizationIds:z.array(uuid).min(1).max(100),authorizedOrganizationIds:z.array(uuid).min(1).max(100),
 registry:z.object({complete:z.literal(true),revision:z.string().regex(/^[a-f0-9]{32}$/),relationshipCount:z.number().int().nonnegative().max(1000)}).strict(),
 relationships:z.array(z.object({parentOrganizationId:uuid,subsidiaryOrganizationId:uuid,effectiveFrom:date,effectiveTo:date.nullable(),directEconomicInterestPercent:percent,directVotingInterestPercent:percent,controlBasis:z.enum(['VOTING','CONTRACTUAL','OTHER']),controlAssessmentId:uuid,assessmentStatus:z.literal('APPROVED')}).strict()).max(1000)
}).strict();
/** Authenticated registered-group worksheet. No final consolidation claim:
 * acquisition, NCI, FX and approved source-bound eliminations remain separate.
 * The complete graph comes from the server, never the user's visible subset.
 */
export async function liveRegisteredGroupSource(input:unknown){
 assertLiveStatements();const q=statementQuery.parse(input),{supabase}=await requireUser();
 async function registry(){
  const r=await supabase.rpc('financial_group_registered_scope',{p_root:q.organization,p_from:q.from,p_to:q.to});
  if(r.error)throw Error(/DENIED/.test(r.error.message)?'REPORTING_ACCESS_DENIED':'REPORTING_GROUP_REGISTRY_UNAVAILABLE');
  const parsed=registrySchema.safeParse(r.data);
  if(!parsed.success||parsed.data.rootOrganizationId!==q.organization||parsed.data.from!==q.from||parsed.data.to!==q.to)throw Error('REPORTING_GROUP_REGISTRY_INVALID');
  validateGroupControlScope(parsed.data);return parsed.data;
 }
 const before=await registry(),sources=[];
 for(const organization of before.expectedOrganizationIds)sources.push(await liveStatementSource({...q,organization}));
 const result=reviewControlledGroupSources(before,sources);
 for(const source of sources)assertStableFinancialReplay(source,await liveStatementSource({...q,organization:source.statements.organizationId}));
 assertStableFinancialReplay(before,await registry());
 return result;
}
