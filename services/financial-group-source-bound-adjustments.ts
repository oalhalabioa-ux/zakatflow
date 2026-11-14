import {z} from 'zod';
import {statementQuery} from '../lib/financial-statement-source';
import {sourceBoundAdjustmentSchema,previewSourceBoundGroupEliminations} from '../lib/financial-group-source-bound-adjustments';
import {liveRegisteredGroupEvidence} from './financial-group-registered-source';
const request=z.object({query:statementQuery,entries:z.array(sourceBoundAdjustmentSchema).max(200)}).strict();
/** Read-only evidence-bound worksheet. No approval, company posting or export. */
export async function liveSourceBoundGroupPreview(input:unknown){
 if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
 const {query,entries}=request.parse(input);
 const {control,rawSources}=await liveRegisteredGroupEvidence(query);
 return previewSourceBoundGroupEliminations(control,rawSources,entries);
}
