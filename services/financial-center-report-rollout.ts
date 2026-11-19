import {z} from 'zod';

const organizationId=z.string().uuid();

function centerFeatureEnabled(setting:string|undefined){
 return (setting??process.env.FINANCIAL_CENTER_BRANCH_REGISTRY)==='true';
}

export function centerReportsEnabled(organization:string|null){
 const setting=process.env.FINANCIAL_CENTER_REPORTS_ENABLED;
 const previousPilot=process.env.FINANCIAL_CENTER_REPORT_PILOT_ORGANIZATION;
 // Preserve the current deployment while switching from the pilot to the common setting.
 if(setting===undefined&&previousPilot!==undefined){
  const candidate=organizationId.safeParse(previousPilot.trim().toLowerCase());
  return candidate.success&&organization===candidate.data;
 }
 return centerFeatureEnabled(setting);
}

export function centerOpeningsEnabled(){
 return centerFeatureEnabled(process.env.FINANCIAL_CENTER_OPENINGS_ENABLED);
}
