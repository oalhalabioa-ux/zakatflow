import {z} from 'zod';
const uuid=z.string().uuid(),date=z.string().date(),revision=z.string().regex(/^\d+$/),money=z.string().regex(/^\d{1,20}(\.\d{1,4})?$/);
const part=z.object({branchId:uuid.nullable(),centerId:uuid.nullable(),debit:money,credit:money}).strict();
const workspace=z.object({id:uuid,organizationId:uuid,fiscalStart:date,currency:z.string().regex(/^[A-Z]{3}$/),version:z.number().int().positive(),digest:z.string().regex(/^[a-f0-9]{32}$/),status:z.literal('APPROVED'),items:z.array(z.object({itemId:z.string().min(1),accountId:z.string().min(1),debit:money,credit:money}).strict()).max(10000)}).strict();
const distribution=z.object({id:uuid,organizationId:uuid,openingWorkspaceId:uuid,openingVersion:z.number().int().positive(),openingDigest:z.string().regex(/^[a-f0-9]{32}$/),status:z.literal('APPROVED'),approvedBy:uuid,revision,entries:z.record(z.string(),z.array(part).max(1000))}).strict();
export const frozenDimensionEvidence=z.object({status:z.literal('FROZEN_DIMENSION_EVIDENCE'),closureId:uuid,organizationId:uuid,from:date,to:date,sourceRevision:z.string().min(1),capturedAt:z.string().datetime({offset:true}),evidence:z.object({status:z.literal('CAPTURED'),
 registry:z.object({organizationId:uuid,complete:z.literal(true),revision,branches:z.array(uuid).max(1000),centerIds:z.array(uuid).max(1000),assignments:z.array(z.object({id:uuid,organizationId:uuid,centerId:uuid,branchId:uuid.nullable(),from:date,to:date.nullable(),status:z.literal('APPROVED'),approvedBy:uuid,revision}).strict()).max(20000)}).strict(),
 workspace:workspace.nullable(),distribution:distribution.nullable(),
 links:z.array(z.object({eventId:uuid,lineId:z.string().min(1),branchId:uuid.nullable(),centerId:uuid.nullable()}).strict()).max(20000),
 names:z.array(z.object({id:uuid,name:z.string().min(1)}).strict()).max(1000)
}).strict()}).strict();
