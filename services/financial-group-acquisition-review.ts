import {z} from 'zod';
import {statementQuery} from '../lib/financial-statement-source';
import {groupAcquisitionMeasurementSchema,measureGroupAcquisition} from '../lib/financial-group-acquisition';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
import {liveRegisteredGroupReviewContext} from './financial-group-registered-source';

const request=z.object({query:statementQuery,measurement:groupAcquisitionMeasurementSchema}).strict();
/** Authenticated draft calculation only. Registry and currency come from live
 * authorized sources; acquisition valuations remain unverified user inputs.
 * This endpoint neither approves evidence nor contributes amounts to reports. */
export async function reviewGroupAcquisition(input:unknown){
 if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
 const {query,measurement}=request.parse(input);
 if(measurement.parentOrganizationId!==query.organization)throw Error('GROUP_ACQUISITION_SCOPE_MISMATCH');
 const before=await liveRegisteredGroupReviewContext(query);
 if(before.control.rootOrganizationId!==query.organization||before.control.from!==query.from||before.control.to!==query.to)throw Error('GROUP_ACQUISITION_SCOPE_MISMATCH');
 const calculation=measureGroupAcquisition(before.control,measurement,before.preflight.wholeEntityRollup.currency);
 // Re-read both membership/control and financial sources before returning any
 // numbers. Revocation or changes during the calculation fail the entire read.
 assertStableFinancialReplay(before,await liveRegisteredGroupReviewContext(query));
 return{status:'UNAPPROVED_ACQUISITION_REVIEW' as const,consolidated:false as const,
  issuanceReady:false as const,evidenceVerified:false as const,persisted:false as const,
  basis:'USER_ENTERED_ACQUISITION_MEASUREMENT' as const,
  query,registryRevision:before.control.registry.revision,calculation};
}

const evidenceQuery={query:statementQuery,id:z.string().uuid()};
const reason=z.string().trim().min(8).max(1000);
const evidenceCommand=z.discriminatedUnion('action',[
 z.object({...evidenceQuery,action:z.literal('SAVE'),measurement:groupAcquisitionMeasurementSchema}).strict(),
 z.object({...evidenceQuery,action:z.literal('APPROVE'),reason}).strict(),
 z.object({...evidenceQuery,action:z.literal('REVOKE'),reason}).strict(),
 z.object({...evidenceQuery,action:z.literal('READ')}).strict(),
]);

/** Store the exact measurement reviewed by an authorized human. */
export async function commandGroupAcquisitionEvidence(input:unknown){
 if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
 const command=evidenceCommand.parse(input);
 const {requireUser}=await import('./auth');
 const {assertLiveStatements}=await import('./financial-statement-live');
 assertLiveStatements();
 if(command.action==='SAVE')await reviewGroupAcquisition({query:command.query,measurement:command.measurement});
 const {supabase}=await requireUser();
 const result=await supabase.rpc('financial_group_acquisition_evidence_command',{
  p_action:command.action,p_id:command.id,p_root:command.query.organization,p_from:command.query.from,p_to:command.query.to,
  p_measurement:command.action==='SAVE'?command.measurement:null,p_reason:'reason' in command?command.reason:null,
 });
 if(result.error)throw Error(result.error.message.match(/(?:GROUP_(?:ACQUISITION|CONTROL)|REPORTING)_[A-Z_]+/)?.[0]??'REPORTING_UNAVAILABLE');
 return result.data;
}
