import {it,expect} from 'vitest';
import {resolveCenterBranches,type CenterBranchRegistry} from '../lib/financial-center-branch-registry';
function fixture():CenterBranchRegistry{return{organizationId:'org',complete:true,revision:'1',branches:['old','new'],centerIds:['sales'],assignments:[{id:'a',organizationId:'org',centerId:'sales',branchId:'old',from:'2025-01-01',to:'2025-12-31',status:'APPROVED',approvedBy:'owner',revision:'1'},{id:'b',organizationId:'org',centerId:'sales',branchId:'new',from:'2026-01-01',to:null,status:'APPROVED',approvedBy:'owner',revision:'2'}]}}
it('preserves historical branch membership after a center transfer',()=>{
 const r=fixture();expect(resolveCenterBranches(r,'org','2025-01-01','2025-12-31')).toEqual([{id:'sales',branchId:'old'}]);
 expect(resolveCenterBranches(r,'org','2026-01-01','2026-12-31')).toEqual([{id:'sales',branchId:'new'}]);
 expect(()=>resolveCenterBranches(r,'org','2025-12-01','2026-01-31')).toThrow('CENTER_BRANCH_PERIOD_SPLIT_REQUIRED');
});
it('rejects overlaps, gaps and unapproved assignments without guessing HQ',()=>{
 let r=fixture();r.assignments[1].from='2025-12-31';expect(()=>resolveCenterBranches(r,'org','2026-01-01','2026-12-31')).toThrow('CENTER_BRANCH_ASSIGNMENT_OVERLAP');
 r=fixture();r.assignments[1].from='2026-02-01';expect(()=>resolveCenterBranches(r,'org','2026-01-01','2026-12-31')).toThrow('CENTER_BRANCH_PERIOD_INCOMPLETE');
 r=fixture();r.assignments[1].status='DRAFT';expect(()=>resolveCenterBranches(r,'org','2026-01-01','2026-12-31')).toThrow('CENTER_BRANCH_ASSIGNMENT_MISSING');
});
it('rejects foreign, incomplete, duplicate or malformed registry evidence',()=>{
 let r=fixture();expect(()=>resolveCenterBranches(r,'foreign','2026-01-01','2026-12-31')).toThrow('CENTER_BRANCH_REGISTRY_SCOPE_INVALID');
 r=fixture();r.assignments[1].branchId='foreign';expect(()=>resolveCenterBranches(r,'org','2026-01-01','2026-12-31')).toThrow('CENTER_BRANCH_ASSIGNMENT_INVALID');
 r=fixture();r.assignments[1].approvedBy=null;expect(()=>resolveCenterBranches(r,'org','2026-01-01','2026-12-31')).toThrow('CENTER_BRANCH_ASSIGNMENT_INVALID');
 r=fixture();expect(()=>resolveCenterBranches(r,'org','2026-02-30','2026-12-31')).toThrow('CENTER_BRANCH_REGISTRY_SCOPE_INVALID');
});
it('accepts an explicitly approved headquarters assignment',()=>{
 const r=fixture();r.assignments[1].branchId=null;expect(resolveCenterBranches(r,'org','2026-01-01','2026-12-31')).toEqual([{id:'sales',branchId:null}]);
});
