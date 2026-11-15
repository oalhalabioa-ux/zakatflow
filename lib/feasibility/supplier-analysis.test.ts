import {describe,it,expect} from 'vitest';
import {createStudy,evaluateStudy,type StudySupplier} from './engine';
import {compareSupplierQuotes} from './supplier-analysis';

const quote=(id:string,vendor:string,item:string,offer:number):StudySupplier=>({id,vendor,item,offer,notes:''});

describe('isolated, unapproved supplier quote comparison',()=>{
 it('compares only multiple distinct vendors for an identically named line item',()=>{
  const report=compareSupplierQuotes([
   quote('1','Supplier A',' Bottling  line ',120000),
   quote('2','Supplier B','bottling LINE',90000),
   quote('3','Supplier C','Utilities',50000)
  ]);
  expect(report.incompleteCount).toBe(0);
  expect(report.groups).toHaveLength(2);
  expect(report.groups[0]).toMatchObject({
   item:'Bottling line',quoteCount:2,vendorCount:2,comparable:true,
   lowestOffer:90000,highestOffer:120000,lowestVendors:['Supplier B'],
   priceSpread:30000,spreadPercent:25,issues:[]
  });
  expect(report.groups[1]).toMatchObject({comparable:false,issues:['SINGLE_VENDOR']});
 });
 it('does not count repeated offers from the same vendor as independent competition',()=>{
  const report=compareSupplierQuotes([
   quote('1','Acme','Equipment',100),quote('2',' ACME ','equipment',90),
   quote('3','Other','Equipment',120)
  ]);
  expect(report.groups[0]).toMatchObject({
   quoteCount:3,vendorCount:2,comparable:false,lowestOffer:null,
   priceSpread:null,issues:['DUPLICATE_VENDOR']
  });
 });
 it('excludes empty, zero, excessive and nonfinite prices; preserves tied low offers',()=>{
  const report=compareSupplierQuotes([
   quote('1','A','Mixer',300),quote('2','B','Mixer',300),quote('3','C','Mixer',500),
   quote('4','D','Mixer',0),quote('5','E','Mixer',Infinity),
   quote('6','F','Mixer',1_000_000_000_001),quote('7',' ','Mixer',100),
   quote('8','G','  ',200)
  ]);
  expect(report.incompleteCount).toBe(5);
  expect(report.groups[0]).toMatchObject({
   vendorCount:3,lowestVendors:['A','B'],lowestOffer:300,highestOffer:500,
   priceSpread:200,spreadPercent:40
  });
 });
 it('does not crash on malformed entries from a legacy browser backup',()=>{
  const malformed=[null,{id:'x',vendor:null,item:'Pump',offer:100},{id:'y',vendor:'Acme',item:'Pump',offer:'100'}] as unknown as StudySupplier[];
  expect(compareSupplierQuotes(malformed)).toEqual({groups:[],incompleteCount:3});
 });
 it('never changes CAPEX, equity, cash flows or the Financial Core ledger',()=>{
  const study=createStudy('6357a708-bae2-4634-9296-490404b1d8a4','Project','INDUSTRIAL');
  study.capex=[{id:'equipment',label:'Equipment',amount:200000,category:'EQUIPMENT'}];
  study.unitPrice=30;study.monthlyUnits=1000;
  study.suppliers=[quote('1','One','Equipment',150000),quote('2','Two','Equipment',170000)];
  const before=evaluateStudy(study);
  expect(compareSupplierQuotes(study.suppliers).groups[0].lowestOffer).toBe(150000);
  expect(evaluateStudy(study)).toEqual(before);
  expect(study.capex[0].amount).toBe(200000);
 });
});
