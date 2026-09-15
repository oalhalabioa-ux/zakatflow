import { z } from 'zod';

export const planSchema = z.enum(['FREE','FAMILY','PROFESSIONAL','BUSINESS','ENTERPRISE']);
export type PlanCode = z.infer<typeof planSchema>;

export const PLAN_LIMITS: Record<PlanCode, { members:number; entities:number; assessments:number }> = {
  FREE: { members: 1, entities: 1, assessments: 3 },
  FAMILY: { members: 6, entities: 5, assessments: 24 },
  PROFESSIONAL: { members: 10, entities: 25, assessments: 120 },
  BUSINESS: { members: 50, entities: 100, assessments: 1000 },
  ENTERPRISE: { members: 1000, entities: 1000, assessments: 100000 },
};

export function canCreate(current:number, plan:PlanCode, resource:'members'|'entities'|'assessments') {
  return current < PLAN_LIMITS[plan][resource];
}
