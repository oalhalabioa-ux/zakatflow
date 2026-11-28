'use client';
import type {ReactNode} from 'react';
import {Icon} from './FinancialReportsPilot';
import {STATEMENT_HUB_TITLES, type StatementHubView} from '../../lib/financial-statement-summary';

export type StatementFileKind = 'csv' | 'xlsx' | 'pdf';

export default function StatementReportHeader({view,en,description,disabled,menuOpen,setMenuOpen,onRefresh,onExport,children}:{
  view:StatementHubView;en:boolean;description:string;disabled:boolean;
  menuOpen:boolean;setMenuOpen:(open:boolean)=>void;onRefresh:()=>void;onExport:(kind:StatementFileKind)=>Promise<void>;children?:ReactNode;
}){
  const title = STATEMENT_HUB_TITLES[view][en ? 1 : 0];
  const t = (ar:string, english:string) => en ? english : ar;
  const icon = view === 'position' ? 'layers' : view === 'overview' || view === 'kpis' ? 'chart' : view === 'statements' ? 'file' : 'coins';
  function select(kind:StatementFileKind) {
    setMenuOpen(false);
    return onExport(kind);
  }
  return <header className="fs-page-header">
    <div><span className="fs-page-icon"><Icon name={icon} size={34}/></span><h1>{title}</h1><p>{description}</p></div>
    <div className="fs-page-actions">
      {children}
      <button type="button" onClick={()=>{setMenuOpen(false);onRefresh();}} aria-label={t('تحديث','Refresh')}><Icon name="chart" size={18}/></button>
      <div className="fs-export-control">
        <button type="button" className="fs-gold" disabled={disabled} aria-expanded={menuOpen&&!disabled}
          onClick={()=>setMenuOpen(!menuOpen)}><Icon name="download" size={20}/>{t('تصدير التقرير','Export report')}</button>
        {menuOpen&&!disabled&&<div className="fs-export-menu">
          <button type="button" onClick={()=>select('csv')}>CSV</button>
          <button type="button" onClick={()=>select('xlsx')}>Excel</button>
          <button type="button" onClick={()=>select('pdf')}>{t('طباعة / حفظ PDF','Print / Save PDF')}</button>
        </div>}
      </div>
    </div>
  </header>;
}
