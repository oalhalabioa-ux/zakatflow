// Read original HTML locally; execute calculator functions only, never their SAMPLE/default data or UI.
// Run with WATER_REFERENCE_HTML and LAND_REFERENCE_HTML; no network/database/auth credentials.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const waterPath=process.env.WATER_REFERENCE_HTML,landPath=process.env.LAND_REFERENCE_HTML;
assert.ok(waterPath&&landPath,'Both original HTML reference paths are required');
const bundle=await build({stdin:{contents:"export * from './lib/feasibility/water-model';export * from './lib/feasibility/raw-land';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const engine=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const waterHtml=fs.readFileSync(waterPath,'utf8'),landHtml=fs.readFileSync(landPath,'utf8');
function calculator(html,start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a,'Original calculator boundaries missing');return html.slice(a,b);}
const waterCalc=calculator(waterHtml,'function calc(){','function statusBadge(');
const landCalc=calculator(landHtml,'function fraction(','function recompute(');
const sha=s=>createHash('sha256').update(s).digest('hex');
function compare(a,b,path=''){
 if(typeof b==='number'){assert.ok(Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10),path+': '+a+' != '+b);return;}
 if(b===null){assert.equal(a,null,path);return;}
 if(Array.isArray(b)){assert.equal(a.length,b.length,path);b.forEach((v,i)=>compare(a[i],v,path+'.'+i));return;}
 Object.entries(b).forEach(([k,v])=>compare(a[k],v,path+'.'+k));
}
const m=engine.createWaterModel();
Object.assign(m.deal,{landArea:1000,landValue:20000,rightValue:7000,investorLoan:20000,loanYears:4,loanStart:1,loanInterest:5});
Object.assign(m.capex,{buildings:60000,line:10000,contingencyPct:10,workingCapital:5000});
Object.assign(m.ops,{bottlesHour:1200,hoursDay:8,daysMonth:25,bottlesCarton:12,litersBottle:1,priceCarton:12,variableCarton:3,fixedMonth:2000,life:10,
 horizon:5,discountRate:10,nwcPct:10,taxRate:15,priceGrowth:2,costGrowth:3,fixedGrowth:2,maintenancePct:2,util:[50,60,70,80,90]});
const water=[];
for(const [i,mode] of ['transfer','lease','right'].entries()){
 const input=structuredClone(m);input.deal.landMode=mode;if(mode==='lease')input.deal.leaseMonth=400;
 const sc=input.scenarios[i];input.ops.priceCarton*=sc.price/100;input.ops.variableCarton*=sc.cost/100;input.ops.util=input.ops.util.map(v=>Math.min(100,v*sc.volume/100));
 const context=vm.createContext({S:{...input,legal:[],tasks:[]}});
 const original=vm.runInContext('const num=x=>Number(x)||0;'+waterCalc+';calc()',context,{timeout:1000});
 const expected={hard:original.hard,contingency:original.contingency,investment:original.capex,cashRequired:original.cashRequired,land:original.landContrib,
  shareholderLoan:original.shareholderLoan,totalLoan:original.totalLoan,investorEquity:original.investorEquityAll,totalEquity:original.totalEquity,
  investorShare:original.invPct,partnerShare:original.ownerPct,npv:original.projectNPV,cashNpv:original.cashNPV,irr:original.IRR,payback:original.payback,breakEven:original.breakeven,
  flows:Array.from(original.fcfArr),annual:Array.from(original.years,y=>({revenue:y.revenue,variable:y.cogs,fixed:y.fixed,ebitda:y.ebitda,tax:y.taxes,freeCashFlow:y.fcf,principal:y.principal,interest:y.interest,debtBalance:y.loanBalance,afterDebt:y.afterDebt}))};
 compare(engine.evaluateWater(input),expected,'water '+mode);water.push({input,expected});
}
const land=[];
for(const mode of ['reference','compound'])for(const financing of ['reference','dynamic']){
 const input=engine.createRawLand();input.project={startYear:2030,years:4,discountRate:.1};
 Object.assign(input.site,{areaAfterPriorTransfers:1000,excludedValley:200,serviceRatio:.25,landPricePerNetSqm:10});
 Object.assign(input.cost,{developmentPerNetSqm:4900/800,studies:1000,developerFeeRate:.05,marketingRate:.02,contingencyRate:.1,landAcquisitionFees:100});
 Object.assign(input.finance,{facility:3000,interestBudgetRate:.1,benchmarkRate:.08,spreadRate:.02,interestMode:financing});
 input.sales.priceMode=mode;input.sales.mix=[{name:'Synthetic use',share:1,price:100,enabled:true,annualGrowthAdjustment:0}];
 input.sales.scenarios[2]={name:'Synthetic base',priceMultiplier:1.05,annualGrowth:.1,initialPricePremium:.05,costMultiplier:1.2,salesDelayYears:1};
 input.waterfall.incentiveRate=.1;
 const source={...input,sales:{...input.sales,scenarioMultipliers:input.sales.scenarios.map((s,i)=>({...s,key:String(i)}))}};
 const ctx=vm.createContext({model:source});
 const original=vm.runInContext(landCalc+";calc('2')",ctx,{timeout:1000});
 const expected={net:original.net,saleArea:original.sell,land:original.land,revenue:original.revenue,totalCost:original.totalCost,gross:original.grossProfit,
  incentive:original.incentive,profit:original.netProfit,npv:original.npv,peakCashDeficit:original.peakCashDeficit,
  annual:Array.from(original.annual,y=>({year:y.calendarYear,soldArea:y.salesArea,salesValue:y.sales,cashCost:y.cashCosts,draw:y.draw,repayment:y.repay,closingDebt:y.debt,projectCash:y.projectCash,equityCash:y.equityCash}))};
 compare(engine.evaluateRawLand(input),expected,'land '+mode+' '+financing);land.push({input,expected});
}
const fixture={source:{waterCalculatorSha256:sha(waterCalc),landCalculatorSha256:sha(landCalc),method:'Calculator-only VM with synthetic inputs; no original saved study/default numbers'},water,land};
if(process.argv.includes('--write'))fs.writeFileSync('tests/feasibility/original-template-golden.json',JSON.stringify(fixture,null,2)+'\n');
console.log(JSON.stringify({passed:true,waterCases:water.length,landCases:land.length,source:fixture.source}));
