import {buildLiquidityForecast,lowestForecastBalance} from './liquidity-forecast';

/** Same cash/forecast sources and transfer treatment as the liquidity workspace. */
export function platformLiquiditySummary(data:any,today:string) {
  const available=data.accounts.reduce((s:number,a:any)=>s+Number(a.current_balance_base||0)-Number(a.restricted_balance_base||0)-Number(a.uncleared_balance_base||0),0);
  const weeks=buildLiquidityForecast(available,data.flows.filter((f:any)=>!f.transfer_id),today,13);
  const balance=(key:string)=>data.counterparty_balances.reduce((s:number,b:any)=>s+Number(b[key]||0),0);
  return {weeks,available,receivables:balance('receivable_balance'),payables:balance('payable_balance'),overdueReceivables:balance('overdue_receivable'),overduePayables:balance('overdue_payable'),
    forecastIn:weeks.reduce((s,w)=>s+w.inflow,0),forecastOut:weeks.reduce((s,w)=>s+w.outflow,0),lowest:lowestForecastBalance(available,weeks)};
}
