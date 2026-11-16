import {describe,it,expect} from 'vitest';
import {hasVerifiedZeroOpening,type ZeroOpeningProof} from '../lib/financial-setup-source-proof';
const empty:ZeroOpeningProof={
 workspace:null,source:{revision:'a'.repeat(32),rows:[]}
};
const row=(debit:string|number|null,credit:string|number|null):ZeroOpeningProof=>({
 ...empty,source:{...empty.source,rows:[{sourceIssue:null,vouchers:[{debit,credit}]}]}
});
describe('verified zero-opening source evidence',()=>{
 it('permits a truly empty new organization with a source revision',()=>{
  expect(hasVerifiedZeroOpening(empty)).toBe(true);
 });
 it('permits explicit zero source amounts',()=>{
  expect(hasVerifiedZeroOpening(row('0.0000',0))).toBe(true);
 });
 it('does not convert empty, missing, or nonnumeric amounts to zero',()=>{
  expect(hasVerifiedZeroOpening(row('',0))).toBe(false);
  expect(hasVerifiedZeroOpening(row(null,0))).toBe(false);
  expect(hasVerifiedZeroOpening(row('not reported',0))).toBe(false);
 });
 it('requires both sides to be verified zero',()=>{
  expect(hasVerifiedZeroOpening(row('0.0000','100'))).toBe(false);
 });
 it('blocks a draft or approved opening even when its rows are zero',()=>{
  expect(hasVerifiedZeroOpening({...empty,workspace:{status:'DRAFT'}})).toBe(false);
  expect(hasVerifiedZeroOpening({...empty,workspace:{status:'APPROVED'}})).toBe(false);
 });
 it('does not claim success for an unknown source revision or a source issue',()=>{
  expect(hasVerifiedZeroOpening({...empty,source:{...empty.source,revision:''}})).toBe(false);
  expect(hasVerifiedZeroOpening({...empty,source:{...empty.source,rows:[{sourceIssue:'SOURCE_CURRENCY_MISMATCH',vouchers:[]}]}})).toBe(false);
 });
});
