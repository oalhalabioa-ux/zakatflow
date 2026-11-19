import {branchFixture} from './branch-report-fixture';
import {statementSourceEnvelope} from '../../lib/financial-statement-source';
import type {SourceBoundAdjustment} from '../../lib/financial-group-source-bound-adjustments';
import type {GroupControlPreflight} from '../../lib/financial-group-control';
const parent='10000000-0000-4000-8000-000000000001',child='10000000-0000-4000-8000-000000000002';
function source(org:string,type:'REVENUE'|'EXPENSE'){
 const p=statementSourceEnvelope.parse(branchFixture().source);p.origin='LIVE_CANONICAL_EVENTS';p.organizationId=org;p.controls={cashClosing:'500.0000'};
 p.accounts=p.accounts.map(a=>({...a,id:a.id+'01',reportingCode:a.id,organizationId:org}));p.opening=p.opening.map(a=>({...a,accountId:a.accountId+'01'}));
 const event=p.events.find(e=>e.eventType===type)!;event.organizationId=org;event.lines=[event.lines[0]];
 event.lines[0]={...event.lines[0],id:event.lines[0].id.split(':')[0]+':BASE',classificationId:event.lines[0].classificationId.split(':')[0]+':BASE'};
 const rule=p.policy.rules.find(r=>r.eventType===type)!;
 p.events=[event];p.policy.organizationId=org;p.policy.rules=[{...rule,organizationId:org,classificationId:event.lines[0].classificationId,debitAccountId:rule.debitAccountId+'01',creditAccountId:rule.creditAccountId+'01'}];
 p.coverage={...p.coverage,eventCount:1,lineCount:1};return p;
}
export function sourceBoundGroupFixture(){
 const sources=[source(parent,'REVENUE'),source(child,'EXPENSE')];
 const control:GroupControlPreflight={rootOrganizationId:parent,from:sources[0].from,to:sources[0].to,expectedOrganizationIds:[parent,child],authorizedOrganizationIds:[parent,child],registry:{complete:true,revision:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',relationshipCount:1},relationships:[{parentOrganizationId:parent,subsidiaryOrganizationId:child,effectiveFrom:sources[0].from,effectiveTo:null,directEconomicInterestPercent:'100',directVotingInterestPercent:'100',controlBasis:'VOTING',controlAssessmentId:'30000000-0000-4000-8000-000000000003',assessmentStatus:'APPROVED'}]};
 const ref=(i:number,accountId:string)=>({organizationId:sources[i].organizationId,eventId:sources[i].events[0].id,lineId:sources[i].events[0].lines[0].id,accountId});
 const entry:SourceBoundAdjustment={id:'20000000-0000-4000-8000-000000000001',kind:'INTERCOMPANY_BALANCE',date:'2026-12-31',amount:'50',reason:'Reciprocal invoice and bill reconciliation',debitSource:ref(1,'210001'),creditSource:ref(0,'110001')};
 return{sources,control,entry,ref};
}
