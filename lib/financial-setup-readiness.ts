import {type FinancialSetupMode,type FinancialSetupStep} from './financial-setup-steps';
import type {PostingPolicyReadiness} from './financial-setup-posting-evidence';

export type SetupStatus='NOT_STARTED'|'IN_PROGRESS'|'BLOCKED'|'READY';
// Only these seven source-backed financial requirements determine financial
// preflight. Administrative steps are tracked separately and NEVER silently
// converted into an accounting, legal or regulatory certification.
export const FINANCIAL_SETUP_SOURCE_GATES=['organization','chart','fiscal','posting','banking','opening','users'] as const;

export type FinancialSetupReadiness={
 organizationId:string;
 mode:FinancialSetupMode|null;
 fiscalStart:string|null;
 statuses:Record<FinancialSetupStep,SetupStatus>;
 ready:boolean;
 sourceChecked:boolean;
 posting?:PostingPolicyReadiness;
 // A source preflight is not a statutory audit or atomic revision certificate.
 certification:'READ_ONLY_SOURCE_PREFLIGHT'|'NOT_CERTIFIED';
};
export type SetupEvidence={
 organizationId:string;
 mode:FinancialSetupMode|null;
 fiscalStart:string|null;
 organizationValid:boolean;
 chartPostableRetained:boolean;
 fiscalCalendarValid:boolean;
 approvedPostingPolicy:boolean;
 postingEvidence?:PostingPolicyReadiness;
 bankAccountPresent:boolean;
 approvedOpening:boolean;
 zeroOpeningVerified:boolean;
 ownerRoleVisible:boolean;
 sourceChecked:boolean;
 sourceVerified:boolean;
};
export function financialSetupReadiness(e:SetupEvidence):FinancialSetupReadiness{
 const statuses:Record<FinancialSetupStep,SetupStatus>={
  organization:e.organizationValid?'READY':'BLOCKED',
  // Branches/organization structure are reviewed separately by the user.
  // Their existence is not proof of accounting readiness, and an org without
  // subsidiaries must still be able to complete independent financial setup.
  structure:'NOT_STARTED',
  // Legal/VAT setup uses its own authorized source; the finance-only
  // preflight must never claim statutory compliance for an unknown country.
  regulatory:'NOT_STARTED',
  chart:e.chartPostableRetained?'READY':'IN_PROGRESS',
  fiscal:e.fiscalCalendarValid?'READY':'IN_PROGRESS',
  posting:e.approvedPostingPolicy?'READY':'IN_PROGRESS',
  banking:e.bankAccountPresent?'READY':'IN_PROGRESS',
  opening:e.mode===null?'NOT_STARTED':
   e.mode==='EXISTING'?(e.approvedOpening?'READY':'IN_PROGRESS'):
    e.zeroOpeningVerified?'READY':'BLOCKED',
  users:e.ownerRoleVisible?'READY':'BLOCKED',
  review:'BLOCKED',
  finished:'BLOCKED',
 };
 const base=FINANCIAL_SETUP_SOURCE_GATES;
 const prerequisites=base.every(s=>statuses[s]==='READY');
 const ready=prerequisites&&e.sourceChecked&&e.sourceVerified;
 statuses.review=ready?'READY':'BLOCKED';
 statuses.finished=ready?'READY':'BLOCKED';
 return {organizationId:e.organizationId,mode:e.mode,fiscalStart:e.fiscalStart,statuses,ready,sourceChecked:e.sourceChecked,
  posting:e.postingEvidence,certification:ready?'READ_ONLY_SOURCE_PREFLIGHT':'NOT_CERTIFIED'};
}
