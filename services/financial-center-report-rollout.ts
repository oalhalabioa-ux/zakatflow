import {z} from 'zod';

const organizationId=z.string().uuid();

export function centerReportsEnabled(organization:string|null){
 const pilot=process.env.FINANCIAL_CENTER_REPORT_PILOT_ORGANIZATION;
 if(pilot===undefined)return process.env.FINANCIAL_CENTER_BRANCH_REGISTRY==='true';

 const candidate=organizationId.safeParse(pilot.trim().toLowerCase());
 return candidate.success&&organization===candidate.data;
}
