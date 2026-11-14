import {compileEventLedger} from './financial-event-ledger';
import {normalizeStatementSource,statementSourceEnvelope,type StatementQuery} from './financial-statement-source';
import {projectDimensionalStatements,type DimensionEvidence} from './financial-dimensional-statements';
import {aggregateDimensionalOpenings,type DimensionalOpeningWorkspace,type DimensionalOpeningDistribution} from './financial-dimensional-openings';
export type EventDimensionEvidence=Omit<DimensionEvidence,'opening'|'movements'>&{
 links:readonly {eventId:string;lineId:string;branchId:string|null;centerId:string|null}[];
};
/** Joins original recognition lines to BOTH compiled GL legs. Evidence must be
 * read and revalidated by an authenticated server, never supplied by the client.
 * This compiler does not certify persisted access, registry or approval freshness.
 */
export function compileDimensionalEventStatements(raw:unknown,query:StatementQuery,evidence:EventDimensionEvidence,
 workspace:DimensionalOpeningWorkspace|null,distribution:DimensionalOpeningDistribution|null){
 normalizeStatementSource(raw,query);
 const envelope=statementSourceEnvelope.parse(raw),{source}=compileEventLedger(envelope);
 if(evidence.organizationId!==source.organizationId||(workspace!==null&&workspace.id!==envelope.openingSourceId))
  throw Error('DIMENSION_SOURCE_SCOPE_INVALID');
 const links=new Map(evidence.links.map(l=>[JSON.stringify([l.eventId,l.lineId]),l]));
 if(links.size!==evidence.links.length)throw Error('DIMENSION_SOURCE_LINK_DUPLICATE');
 const events=new Map(envelope.events.map(e=>[e.id,e]));
 const movements:DimensionEvidence['movements'][number][]=[];
 let consumed=0;
 for(const journal of source.journals){
  const event=events.get(journal.id);
  if(!event||journal.lines.length!==event.lines.length*2)throw Error('DIMENSION_SOURCE_LINEAGE_INVALID');
  event.lines.forEach((line,index)=>{
   const link=links.get(JSON.stringify([event.id,line.id]));
   if(!link)throw Error('DIMENSION_SOURCE_LINK_MISSING');
   consumed++;
   for(const lineIndex of [index*2,index*2+1]){
    const leg=journal.lines[lineIndex];
    movements.push({journalId:journal.id,lineIndex,allocations:[{
     branchId:link.branchId,centerId:link.centerId,debit:leg.debit,credit:leg.credit,
    }]});
   }
  });
 }
 if(consumed!==links.size)throw Error('DIMENSION_SOURCE_LINK_EXTRA');
 const firstActivity=source.opening.length===0&&envelope.openingSourceId===`FIRST_ACTIVITY:${source.fiscalStart}`;
 if(firstActivity&&(workspace!==null||distribution!==null))throw Error('DIMENSION_OPENING_SOURCE_STALE');
 if(!firstActivity&&(!workspace||!distribution))throw Error('DIMENSION_OPENING_APPROVAL_REQUIRED');
 const opening=firstActivity?[]:aggregateDimensionalOpenings(source,workspace!,distribution!);
 return projectDimensionalStatements(source,{...evidence,opening,movements});
}
