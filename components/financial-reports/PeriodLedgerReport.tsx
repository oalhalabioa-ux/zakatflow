'use client';

import {useState} from 'react';
import {ledgerEntryColumns,trialBalanceColumns,type LedgerAccount,type LedgerReportView,type PeriodLedger} from '../../lib/financial-period-ledger';
import {ReportCard} from './ReportCharts';

const pageSize=50;

export default function PeriodLedgerReport({
 ledger,view,en,account,selectAccount,openAccount,printing,scopeLabel,
}:{
 ledger:PeriodLedger;view:LedgerReportView;en:boolean;account?:LedgerAccount;
 selectAccount:(id:string)=>void;openAccount:(id:string)=>void;printing:boolean;scopeLabel:string;
}){
 const [page,setPage]=useState(0);
 const t=(ar:string,english:string)=>en?english:ar, labelIndex=en?2:1;
 if(view==='trial-balance')return <div data-statement-ready={view}>
  <ReportCard>
   <p className="fs-source-note">{scopeLabel}</p>
   <div className="fs-table-scroll"><table className="fs-table">
    <thead><tr><th scope="col">{t('الحساب','Account')}</th>{trialBalanceColumns.map(column=><th key={column[0]} scope="col">{column[labelIndex]}</th>)}</tr></thead>
    <tbody>
     {ledger.accounts.map(row=><tr key={row.id} data-ledger-account={row.id}>
      <th scope="row"><button type="button" className="fs-outline" onClick={()=>openAccount(row.id)}><bdi>{row.id}</bdi> · {en?row.en:row.ar}</button></th>
      {trialBalanceColumns.map(([key])=><td key={key}><bdi dir="ltr">{row[key]}</bdi></td>)}
     </tr>)}
     {!ledger.accounts.length&&<tr><td colSpan={7}>{t('لا توجد أرصدة أو حركات للفترة المختارة.','No balances or movements for the selected period.')}</td></tr>}
    </tbody>
    <tfoot><tr><th scope="row">{t('الإجمالي','Total')}</th>
     {trialBalanceColumns.map(([key])=><td key={key}><bdi dir="ltr">{ledger.totals[key]}</bdi></td>)}</tr></tfoot>
   </table></div>
  </ReportCard>
 </div>;

 const entries=account?.entries??[],lastPage=Math.max(0,Math.ceil(entries.length/pageSize)-1);
 const currentPage=Math.min(page,lastPage);
 const visible=printing?entries:entries.slice(currentPage*pageSize,(currentPage+1)*pageSize);
 // Journal IDs are available in the export. Preserve a readable table on screen and print.
 const visibleColumns=ledgerEntryColumns.slice(0,5);
 return <div data-statement-ready={view}>
  <ReportCard>
   <p className="fs-source-note">{scopeLabel}</p>
   <label className="fs-ledger-controls">{t('الحساب','Account')} <select value={account?.id??''} onChange={e=>{setPage(0);selectAccount(e.target.value)}} disabled={!account}>
    {!account&&<option value="">{t('لا توجد حسابات للفترة','No accounts for the period')}</option>}
    {ledger.accounts.map(row=><option value={row.id} key={row.id}>{row.id} · {en?row.en:row.ar}</option>)}
   </select></label>
   {account&&<p><strong><bdi>{account.id}</bdi> · {en?account.en:account.ar}</strong>
    {' · '}{t('رصيد أول الفترة','Opening balance')} <bdi dir="ltr">{account.opening}</bdi>
    {' · '}{t('رصيد آخر الفترة','Closing balance')} <bdi dir="ltr">{account.closing}</bdi>
   </p>}
   {account&&<p className="fs-source-note">{t('الرصيد المدين موجب والدائن سالب.','Debit balances are positive. Credit balances are negative.')}</p>}
   <div className="fs-table-scroll"><table className="fs-table">
    <thead><tr>{visibleColumns.map(column=><th scope="col" key={column[0]}>{column[labelIndex]}</th>)}</tr></thead>
    <tbody>{visible.map((line,index)=><tr key={line.journalId+'-'+index} data-journal-id={line.journalId}>
     {visibleColumns.map(([key])=><td key={key}>{key==='reference'?<><bdi>{line.reference}</bdi>{line.reversesJournalId&&<small> · {t('عكس','Reversal')}</small>}</>:<bdi dir="ltr">{line[key]}</bdi>}</td>)}
    </tr>)}{!entries.length&&<tr><td colSpan={visibleColumns.length}>{t('لا توجد حركات للحساب خلال الفترة.','No account movements during this period.')}</td></tr>}</tbody>
   </table></div>
   {lastPage>0&&<div className="fs-ledger-controls">
    <button type="button" className="fs-outline" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>{t('السابق','Previous')}</button>
    <span>{currentPage+1} / {lastPage+1}</span>
    <button type="button" className="fs-outline" disabled={currentPage===lastPage} onClick={()=>setPage(currentPage+1)}>{t('التالي','Next')}</button>
   </div>}
  </ReportCard>
 </div>;
}
