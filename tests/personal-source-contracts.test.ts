import {describe,expect,it} from 'vitest';
import {projectClassifiedPersonalActivity} from '../lib/personal-source-contracts';
const receipt={
 document_id:'24c48925-1fc4-4856-85e5-ef6734c318e5',
 transaction_id:'a5172bd2-c6d3-489e-8e9c-3d76eae23389',kind:'INCOME',category_code:'SERVICE_INCOME',
 description:'Explicit classification',entry_date:'2026-02-01',amount:'7.50',currency:'USD',
 base_amount:'28.125',base_currency:'SAR',is_reversal:false,
};

describe('classified personal report source',()=>{
 it('uses explicitly saved documents and keeps the later reversal in its own date and currency',()=>{
  const reversal={...receipt,transaction_id:'b897c148-baa8-4f3c-9274-ba6fe2bf146e',entry_date:'2026-03-02',
   amount:'-7.50',base_amount:'-28.125',is_reversal:true};
  expect(projectClassifiedPersonalActivity([receipt]).totals).toEqual([{currency:'SAR',income:'28.125',expense:'0',net:'28.125'}]);
  expect(projectClassifiedPersonalActivity([reversal]).totals).toEqual([{currency:'SAR',income:'-28.125',expense:'0',net:'-28.125'}]);
  expect(projectClassifiedPersonalActivity([receipt,reversal]).totals[0].net).toBe('0');
 });
 it('never guesses a category or counts the same source twice',()=>{
  expect(projectClassifiedPersonalActivity([]).totals).toEqual([]);
  expect(()=>projectClassifiedPersonalActivity([{...receipt,kind:'ADD'}])).toThrow();
  expect(()=>projectClassifiedPersonalActivity([receipt,receipt])).toThrow('PERSONAL_CLASSIFICATION_SOURCE_INVALID');
 });
});
