import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const blockedService=vi.hoisted(()=>({call:vi.fn(()=>{throw new Error('UNEXPECTED_FINANCIAL_SERVICE_CALL')})}));
vi.mock("../services/auth",()=>({requireUser:blockedService.call}));
vi.mock("../services/debt-collection",()=>({recordDebtFollowup:blockedService.call,debtCollectionWorkspace:blockedService.call}));
vi.mock("../services/participation-contracts",()=>({participationAction:blockedService.call,participationWorkspace:blockedService.call}));
vi.mock("../services/debt-operations",()=>({debtOperationWorkspace:blockedService.call,debtOperationAction:blockedService.call}));
vi.mock("../services/debt-party-directory",()=>({mutateDebtParty:blockedService.call,debtPartyDirectory:blockedService.call}));
vi.mock("../services/advances",()=>({advanceWorkspace:blockedService.call,advanceAction:blockedService.call}));
vi.mock("../services/organization-access",()=>({requireOrganizationMember:blockedService.call}));
vi.mock("@/services/financial-events",()=>({financialEventDetail:blockedService.call,financialEventContext:blockedService.call,executeFinancialEventAction:blockedService.call,financialEventWorkspace:blockedService.call}));
vi.mock("../services/debt-payroll",()=>({debtPayrollAction:blockedService.call,debtPayrollWorkspace:blockedService.call}));
vi.mock("@/services/auth",()=>({requireUser:blockedService.call}));
vi.mock("@/services/asset-financial-review",()=>({actOnAssetFinancialReview:blockedService.call,assetFinancialReview:blockedService.call}));
vi.mock("../services/asset-entry-fx",()=>({resolveAssetEntryFx:blockedService.call}));
vi.mock("@/services/asset-operation-workspace",()=>({assetOperationWorkspace:blockedService.call}));
vi.mock("@/services/transactions",()=>({reverseTransaction:blockedService.call}));
vi.mock("../services/payables",()=>({payableDetail:blockedService.call,actOnPayable:blockedService.call}));
beforeEach(()=>vi.clearAllMocks());
afterEach(()=>expect(blockedService.call).not.toHaveBeenCalled());
declare global {interface ImportMeta {glob(pattern:string):Record<string,()=>Promise<unknown>>}}
vi.mock('@/services/financial-budget',()=>({configureFinancialBudget:blockedService.call,financialBudgetContext:blockedService.call,financialBudgetReport:blockedService.call,financialBudgetSetup:blockedService.call,financialBudgetDrilldown:blockedService.call,financialBudgetConsolidated:blockedService.call}));
const routes=import.meta.glob('../app/api/**/route.ts');
const targets=[["app/api/financial-budget/route.ts",["POST"]],["app/api/debt-categories/route.ts", ["POST"]], ["app/api/debt-collection/route.ts", ["POST"]], ["app/api/participation-contracts/route.ts", ["POST"]], ["app/api/debt-operations/route.ts", ["POST"]], ["app/api/debt-parties/route.ts", ["POST"]], ["app/api/advances/route.ts", ["POST"]], ["app/api/debt-settlement-options/route.ts", ["POST"]], ["app/api/financial-events/route.ts", ["POST"]], ["app/api/debt-payroll/route.ts", ["POST"]], ["app/api/assets/purchase/route.ts", ["PATCH", "POST"]], ["app/api/assets/financial-review/route.ts", ["POST"]], ["app/api/assets/opening/route.ts", ["POST"]], ["app/api/assets/lifecycle/route.ts", ["PATCH"]], ["app/api/transactions/[id]/route.ts", ["PATCH"]], ["app/api/payables/[id]/route.ts", ["POST"]]] as const;
for(const [path,methods] of targets)describe(path,()=>{
 for(const method of methods){
  for(const origin of ['https://yaqeenbiz.com','https://www.yaqeenbiz.com','https://app.yaqeenbiz.com'])it(method+' reaches JSON validation behind hosted TLS: '+origin,async()=>{
   const route=await routes['../'+path]() as Record<string,(r:Request,c:unknown)=>Promise<Response>>;
   // Malformed JSON deliberately stops execution before auth, services or any financial write.
   const r=await route[method](new Request('http://localhost:3000/api/test',{method,headers:{origin,'sec-fetch-site':'same-origin'},body:'{'}),{params:Promise.resolve({id:'11111111-1111-4111-8111-111111111111'})});
   expect(r.ok).toBe(false);expect((await r.json()).error).not.toBe('ORIGIN_REQUIRED');
  });
  it(method+' rejects missing and foreign origins before reading the body',async()=>{
   const route=await routes['../'+path]() as Record<string,(r:Request,c:unknown)=>Promise<Response>>;
   for(const headers of [{},{origin:'https://evil.test','sec-fetch-site':'same-origin'},{origin:'https://www.yaqeenbiz.com','sec-fetch-site':'same-site'},{origin:'https://www.yaqeenbiz.com','sec-fetch-site':'cross-site'}]){
    const r=await route[method](new Request('http://localhost:3000/api/test',{method,headers:headers as Record<string,string>,body:'{'}),{params:Promise.resolve({id:'11111111-1111-4111-8111-111111111111'})});
    expect(r.ok).toBe(false);expect((await r.json()).error).toBe('ORIGIN_REQUIRED');
   }
  });
 }
});
it('prevents reintroducing raw browser/internal origin comparisons in API routes',()=>{
 function scan(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(join(dir,e.name)):e.name==='route.ts'?[join(dir,e.name)]:[])}
 for(const path of scan('app/api'))expect(readFileSync(path,'utf8'),path).not.toMatch(/headers\.get\(['"]origin['"]\)\s*!==\s*new URL\(|new URL\([^)]*\)\.origin\s*!==\s*\w+\.headers\.get\(['"]origin['"]\)/);
});
