import Decimal from 'decimal.js';
import type {StatementSourceSnapshot} from './financial-statement-source';
const Money=Decimal.clone({precision:50});
export function priorStatementPeriod(from:string,to:string){
 const previous=(s:string)=>{const[y,m,d]=s.split('-').map(Number),year=y-1,day=Math.min(d,new Date(Date.UTC(year,m,0)).getUTCDate());return `${year}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`};
 return{from:previous(from),to:previous(to)};
}
export function validStatementComparison(current:StatementSourceSnapshot,prior:StatementSourceSnapshot|null|undefined){
 if(!prior)return null;const expected=priorStatementPeriod(current.statements.from,current.statements.to);
 return current.origin===prior.origin&&current.scope===prior.scope&&current.statements.organizationId===prior.statements.organizationId&&current.statements.currency===prior.statements.currency&&prior.statements.from===expected.from&&prior.statements.to===expected.to?prior:null;
}
export function statementChange(current:string,prior:string|null|undefined,lowerIsBetter=false){
 if(prior===null||prior===undefined)return undefined;
 const before=new Money(prior),delta=new Money(current).minus(before),direction=delta.gt(0)?'up' as const:delta.lt(0)?'down' as const:'flat' as const;
 const tone=delta.isZero()?'neutral' as const:delta.gt(0)!==lowerIsBetter?'positive' as const:'negative' as const;
 return{direction,tone,text:before.isZero()?(delta.isZero()?'0.00%':(delta.gt(0)?'+':'')+delta.toFixed(2)):(delta.gt(0)?'+':'')+delta.div(before.abs()).times(100).toFixed(2)+'%',delta:delta.toFixed(4),percentage:before.isZero()?null:delta.div(before.abs()).times(100).toFixed(4)};
}
