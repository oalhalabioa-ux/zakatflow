import {z} from 'zod';

const organizationId=z.string().uuid();

function centerFeatureEnabled(pilot:string|undefined,organization:string|null){
 if(pilot===undefined)return process.env.FINANCIAL_CENTER_BRANCH_REGISTRY==='true';

 const candidate=organizationId.safeParse(pilot.trim().toLowerCase());
 return candidate.success&&organization===candidate.data;
}

export function centerReportsEnabled(organization:string|null){
 return centerFeatureEnabled(process.env.FINANCIAL_CENTER_REPORT_PILOT_ORGANIZATION,organization);
}

export function centerOpeningsEnabled(organization:string|null){
 return centerFeatureEnabled(process.env.FINANCIAL_CENTER_OPENING_PILOT_ORGANIZATION,organization);
}

export function centerOpeningPilotConfigured(){
 return process.env.FINANCIAL_CENTER_OPENING_PILOT_ORGANIZATION!==undefined;
}
