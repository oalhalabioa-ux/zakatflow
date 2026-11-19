import {expect,it} from 'vitest';
import {calculateLandDistribution} from './raw-land-distributions';

const owners={partners:[
 {name:'Landowner',cash:0,inKindLand:100,priority:2,profitShare:.4},
 {name:'Investor A',cash:75,inKindLand:0,priority:1,profitShare:.4},
 {name:'Investor B',cash:25,inKindLand:0,priority:1,profitShare:.2}
]};
const row=(year:number,equityCash:number,closingDebt=0)=>({year,equityCash,closingDebt});

it('reserves debt, returns capital by priority and splits short tiers pro rata',()=>{
 const result=calculateLandDistribution(owners,100,[row(2027,-50),row(2028,40,30)]);
 expect(result).toMatchObject({year:2028,distributable:60,debtReserve:30,issue:null});
 if(result.issue)throw Error(result.issue);
 expect(result.partners.map(partner=>partner.capitalReturned)).toEqual([0,45,15]);
 expect(result.partners.map(partner=>partner.profit)).toEqual([0,0,0]);
 expect(result.partners.map(partner=>partner.unrecoveredCapital)).toEqual([100,30,10]);
});

it('splits only the cash remaining after all capital is returned by the agreed profit shares',()=>{
 const result=calculateLandDistribution(owners,100,[row(2027,-75),row(2028,225)]);
 if(result.issue)throw Error(result.issue);
 expect(result.partners.map(partner=>partner.distribution)).toEqual([120,95,35]);
 expect(result.partners.reduce((sum,partner)=>sum+partner.distribution,0)).toBe(result.distributable);
});

it('blocks incomplete assumptions or an interim funding gap even if the final year recovers',()=>{
 expect(calculateLandDistribution(owners,100,[row(2027,-110),row(2028,250)])).toEqual({issue:'FUNDING',fundingGap:10});
 expect(calculateLandDistribution(owners,0,[row(2027,250)])).toEqual({issue:'LAND'});
 expect(calculateLandDistribution({partners:owners.partners.slice(0,2)},100,[row(2027,250)])).toEqual({issue:'SHARES'});
});

it('reports an uncovered closing debt balance without distributing cash',()=>{
 const result=calculateLandDistribution(owners,100,[row(2027,-80,50)]);
 expect(result).toMatchObject({issue:null,debtShortfall:30,distributable:0});
});
