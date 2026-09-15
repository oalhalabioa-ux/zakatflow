export type WorkflowStatus='DRAFT'|'IN_PROGRESS'|'ACCOUNTANT_REVIEW'|'SHARIA_REVIEW'|'APPROVED'|'REJECTED'|'PAID'|'CLOSED';
export type WorkflowStep='DATA_ENTRY'|'CALCULATION'|'ACCOUNTANT_REVIEW'|'SHARIA_REVIEW'|'APPROVAL'|'PAYMENT'|'REPORTING'|'CLOSED';
const transitions: Record<WorkflowStatus,WorkflowStatus[]>={
 DRAFT:['IN_PROGRESS'], IN_PROGRESS:['ACCOUNTANT_REVIEW','REJECTED'], ACCOUNTANT_REVIEW:['SHARIA_REVIEW','IN_PROGRESS','REJECTED'], SHARIA_REVIEW:['APPROVED','ACCOUNTANT_REVIEW','REJECTED'], APPROVED:['PAID'], PAID:['CLOSED'], REJECTED:['IN_PROGRESS'], CLOSED:[]
};
const step: Record<WorkflowStatus,WorkflowStep>={DRAFT:'DATA_ENTRY',IN_PROGRESS:'CALCULATION',ACCOUNTANT_REVIEW:'ACCOUNTANT_REVIEW',SHARIA_REVIEW:'SHARIA_REVIEW',APPROVED:'PAYMENT',PAID:'REPORTING',REJECTED:'DATA_ENTRY',CLOSED:'CLOSED'};
export function canTransition(from:WorkflowStatus,to:WorkflowStatus){return transitions[from]?.includes(to)??false}
export function transition(from:WorkflowStatus,to:WorkflowStatus){if(!canTransition(from,to)) throw new Error(`INVALID_TRANSITION:${from}->${to}`); return {status:to,current_step:step[to]};}
