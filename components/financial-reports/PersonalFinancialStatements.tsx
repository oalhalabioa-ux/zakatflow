'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {riyadhToday} from '../../lib/financial-register';
import {priorStatementPeriod,statementRowComparison} from '../../lib/financial-statement-comparison';
import {STATEMENT_HUB_TITLES} from '../../lib/financial-statement-summary';
import type {PersonalReport} from '../../lib/personal-financial-reports';
import type {StatementView} from '../../lib/financial-statement-source';
import {personalStatementComparison,personalStatementCurrencies,personalStatementExport,personalStatementRows,type PersonalStatementView} from '../../lib/personal-statement-presentation';
import {ComboChart,Donut,ReportCard} from './ReportCharts';
import {Metric} from './ReportPages';
import {StatementReportTable,statementAmount} from './SourceStatementTable';
import StatementReportHeader,{type StatementFileKind} from './StatementReportHeader';
import StatementReportLayout from './StatementReportLayout';
import {downloadStatementFile} from './downloadStatementFile';
import './financial-reports-suite.css';
import './financial-reporting-source.css';

const views = ['income','position','cash-flow'] as const;
type Period = {from:string;to:string};
type Reports = {current:PersonalReport;previous:PersonalReport|null};

async function readPersonalReport(period:Period,signal?:AbortSignal,comparison=false) {
  const response=await fetch('/api/financial-reporting/personal?'+new URLSearchParams(period),{cache:'no-store',signal});
  if(response.status===401||response.status===403)throw Error('UNAUTHORIZED');
  if(!response.ok){
    if(comparison)return null;
    throw Error('UNAVAILABLE');
  }
  const report:PersonalReport=await response.json();
  if(report.scope!=='PERSONAL'||report.basis!=='CURRENT_PERSONAL_REGISTER_ESTIMATE'||
    report.from!==period.from||report.to!==period.to)throw Error('UNAVAILABLE');
  return report;
}

async function readReports(period:Period,signal?:AbortSignal):Promise<Reports>{
  const current=await readPersonalReport(period,signal);
  if(!current)throw Error('UNAVAILABLE');
  const previous=await readPersonalReport(priorStatementPeriod(period.from,period.to),signal,true);
  return {current,previous:personalStatementComparison(current,previous)};
}

export default function PersonalFinancialStatements({english=false,initialView='overview'}:{english?:boolean;initialView?:PersonalStatementView}){
  const [view,setView]=useState(initialView);
  const [from,setFrom]=useState(()=>riyadhToday().slice(0,4)+'-01-01'),[to,setTo]=useState(riyadhToday);
  const [reports,setReports]=useState<Reports|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [menuOpen,setMenuOpen]=useState(false),[exporting,setExporting]=useState(false),[refresh,setRefresh]=useState(0);
  const t=(ar:string,en:string)=>english?en:ar;
  const periodValid=Boolean(from&&to&&from<=to&&to<=riyadhToday());
  const displayed=reports?.current.from===from&&reports.current.to===to?reports:null;
  const currencies=displayed?personalStatementCurrencies(displayed.current,view):[];
  const key=[from,to,view,english,refresh].join('|'),active=useRef('');
  useLayoutEffect(()=>{active.current=key;return()=>{active.current='';};},[key]);
  useEffect(()=>{setView(initialView);setMenuOpen(false);},[initialView]);

  useEffect(()=>{
    setReports(null);setError('');setMenuOpen(false);
    if(!periodValid){setLoading(false);return;}
    const abort=new AbortController();
    setLoading(true);
    readReports({from,to},abort.signal)
      .then(snapshot=>{if(!abort.signal.aborted)setReports(snapshot);})
      .catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'UNAVAILABLE');})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[from,to,refresh,periodValid]);

  function openView(next:PersonalStatementView){
    setView(next);setMenuOpen(false);
    const url=new URL(window.location.href);
    if(next==='overview')url.searchParams.delete('screen');else url.searchParams.set('screen',next);
    window.history.replaceState(null,'',url);
  }

  const hasFigures=Boolean(displayed&&currencies.some(currency=>
    personalStatementRows(displayed.current,view,currency,english).some(row=>row.value!=='')));
  async function exportReport(kind:StatementFileKind){
    if(!hasFigures||loading||exporting)return;
    setExporting(true);setError('');
    try{
      const fresh=await readReports({from,to});
      if(active.current!==key)return;
      setReports(fresh);
      const rows=personalStatementExport(fresh.current,view,english,fresh.previous);
      if(kind==='pdf'){
        await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
        if(active.current===key)window.print();
      }else{
        await downloadStatementFile(rows,kind,`yaqeen-personal-statements-${view}-${from}-${to}`,view,english,()=>active.current===key);
      }
    }catch(cause){
      if(active.current!==key)return;
      const message=cause instanceof Error?cause.message:'';
      if(message==='UNAUTHORIZED'||message==='UNAVAILABLE')setReports(null);
      if(message!=='PERSONAL_EXPORT_DATA_REQUIRED')setError(message==='UNAUTHORIZED'?message:'EXPORT_FAILED');
    }finally{setExporting(false);}
  }

  return <main className="fs-root fs-connected fs-connected-statements fs-personal-statements" dir={english?'ltr':'rtl'} lang={english?'en':'ar'}>
    <div className="fs-surface" data-screen={view}>
      <StatementReportHeader view={view} en={english} description={t('النطاق الشخصي · من الأرصدة والحركات والمستندات المثبتة','Personal scope · from verified balances, movements and documents')}
        disabled={loading||exporting||!hasFigures} menuOpen={menuOpen} setMenuOpen={setMenuOpen}
        onRefresh={()=>setRefresh(value=>value+1)} onExport={exportReport}/>
      <div className="fs-filter-strip"><div className="fs-filters is-open">
        <label>{t('من تاريخ','From date')}<input type="date" value={from} max={to} onChange={event=>setFrom(event.target.value)}/></label>
        <label>{t('إلى تاريخ','To date')}<input type="date" value={to} min={from} max={riyadhToday()} onChange={event=>setTo(event.target.value)}/></label>
        <span>{t('الفترة السابقة','Previous period')}{displayed?.previous?' · '+displayed.previous.from+' — '+displayed.previous.to:''}</span>
      </div></div>
      {displayed&&<p className="fs-personal-statement-print-context">{from} — {to}{displayed.previous&&' · '+displayed.previous.from+' — '+displayed.previous.to}</p>}
      <nav className="fs-personal-statement-navigation" aria-label={t('القوائم المالية','Financial statements')}>
        {(['overview',...views] as const).map(id=><button className="fs-outline" type="button" key={id} aria-current={view===id?'page':undefined}
          onClick={()=>openView(id)}>{STATEMENT_HUB_TITLES[id][english?1:0]}</button>)}
      </nav>
      {loading&&<p className="fs-source-loading" role="status">{t('جارٍ التحقق من السجلات الشخصية…','Validating personal registers…')}</p>}
      {!periodValid&&<p className="fs-source-note" role="status">{t('حدّد بداية ونهاية الفترة لعرض القوائم.','Choose a reporting period to view the statements.')}</p>}
      {error&&<p className="fs-source-error" role="alert">{error==='UNAUTHORIZED'?t('سجّل الدخول مجددًا لعرض سجلاتك.','Sign in again to view your registers.'):
        error==='EXPORT_FAILED'?t('تعذّر تجهيز التصدير بعد إعادة التحقق من المصدر.','The export could not be prepared after rechecking the source.'):
        t('تعذّر التحقق من السجلات الشخصية لهذه الفترة.','The personal registers could not be verified for this period.')}</p>}
      {displayed&&view==='overview'&&<>
        {hasFigures&&currencies.map(currency=>{
          const rows=personalStatementRows(displayed.current,view,currency,english).filter(row=>row.value!=='');
          return rows.length>0&&<div className="fs-metrics five" key={currency}>
            {rows.map(row=><Metric key={row.id} label={row.label} value={statementAmount(row.value)} unit={currency} change={null}/>)}
          </div>;
        })}
        <div className="fs-index-layout"><div className="fs-statement-links">
          {views.map(id=><ReportCard key={id} className="fs-statement-link" title={STATEMENT_HUB_TITLES[id][english?1:0]}>
            <button className="fs-outline" type="button" onClick={()=>openView(id)}>{t('عرض القائمة','Open statement')}</button>
          </ReportCard>)}
        </div></div>
      </>}
      {displayed&&view!=='overview'&&<>
        {!hasFigures&&<p className="fs-source-note" role="status">{t('لا توجد أرقام مثبتة لهذه القائمة في الفترة المحددة.','There are no verified figures for this statement in the selected period.')}</p>}
        {currencies.map(currency=><PersonalCurrencyStatement key={[view,currency,from,to].join('|')} view={view} currency={currency}
          reports={displayed} en={english}/>)}
      </>}
    </div>
  </main>;
}

function PersonalCurrencyStatement({view,currency,reports,en}:{view:StatementView;currency:string;reports:Reports;en:boolean}){
  const t=(ar:string,english:string)=>en?english:ar;
  const rows=personalStatementRows(reports.current,view,currency,en);
  const previous=reports.previous?personalStatementRows(reports.previous,view,currency,en):undefined;
  const index=new Map(rows.map(row=>[row.id,row]));
  const previousIndex=new Map(previous?.map(row=>[row.id,row]));
  const metricIds=view==='income'?['INCOME','EXPENSE','net']:view==='position'?['assets','liabilities','net-worth']:['opening','OPERATING','movement','closing'];
  const title=STATEMENT_HUB_TITLES[view][en?1:0]+' · '+currency;
  const analysis=view==='income'?t('تغطي القائمة المستندات والعقود التي أمكن إثباتها وتصنيفها خلال الفترة.',
    'The statement covers documents and contracts that could be verified and classified during the period.'):
    view==='position'?t('تعرض القائمة الأرصدة في تاريخ نهاية الفترة، وتوضح الإيضاحات البند الذي لا يتوفر له دليل تاريخي.',
      'Balances are shown at the end of the period. Notes identify individual items without historical evidence.'):
      t('تُفصل الحركات غير المصنّفة عن الأنشطة المثبتة، وتُستبعد التحويلات الداخلية المطابقة من تصنيف النشاط.',
      'Unclassified movements are separate from verified activities. Matched internal transfers are excluded from activity classification.');
  const categories=(view==='income'?['INCOME','EXPENSE']:['OPERATING','INVESTING','FINANCING','UNCLASSIFIED'])
    .flatMap(id=>{const row=index.get(id);return row?.value?[row]:[];});
  const chartAvailable=categories.length>0&&categories.every(row=>Math.abs(Number(row.value))<=Number.MAX_SAFE_INTEGER);
  const chartHasPrevious=chartAvailable&&categories.every(row=>{
    const amount=previousIndex.get(row.id)?.value;
    return Boolean(amount)&&Math.abs(Number(amount))<=Number.MAX_SAFE_INTEGER;
  });
  const assetParts=['cash','receivables','investments','other-assets'].map(id=>Number(index.get(id)?.value||NaN));
  const assets=index.get('assets')?.value;
  const showComposition=Boolean(assets&&Number(assets)>0)&&assetParts.every(value=>value>=0&&value<=Number.MAX_SAFE_INTEGER);

  return <section className="fs-source-statements" data-statement-ready={view} aria-label={title}>
    <div className="fs-metrics four">{metricIds.flatMap(id=>{
      const metric=index.get(id);
      if(!metric?.value)return [];
      const trend=statementRowComparison(metric.value,previousIndex.get(id)?.value).change;
      return [<Metric key={id} label={metric.label} value={statementAmount(metric.value)} unit={currency}
        change={null} trend={trend?.percentage!==null?trend:undefined} icon={metric.icon}/>];
    })}</div>
    <StatementReportLayout view={view}>
      <ReportCard className={view==='income'?'fs-income-main':undefined} title={title} icon="file">
        <StatementReportTable view={view} rows={rows} previous={previous} en={en} caption={title} notes delta showKnownPrior/>
      </ReportCard>
      <div className="fs-stack">
        {view==='position'&&showComposition&&assets&&<ReportCard title={t('تركيبة المركز المالي','Financial position composition')} icon="target">
          <div className="fs-donut-legend">
            <Donut value={statementAmount(assets)} label={t('إجمالي الأصول','Total assets')} parts={assetParts} colors={['#10243A','#C6A35D','#205347','#8B9FB3']}/>
            <dl>{['cash','receivables','investments','other-assets'].map(id=>{
              const row=index.get(id)!;
              return <div key={id}><dt>{row.label}</dt><dd>{statementAmount(row.value)}</dd></div>;
            })}</dl>
          </div>
        </ReportCard>}
        {view!=='position'&&chartAvailable&&<ReportCard title={t('تحليل البنود المثبتة','Verified items analysis')}>
          <ComboChart en={en} unit={currency} labels={categories.map(row=>row.label)} first={categories.map(row=>Number(row.value))}
            second={chartHasPrevious?categories.map(row=>Number(previousIndex.get(row.id)?.value)):undefined}
            names={[t('الفترة الحالية','Current period'),chartHasPrevious?t('الفترة السابقة','Previous period'):undefined]}/>
        </ReportCard>}
        <ReportCard title={t('ملخص وتحليلات','Summary & analysis')} icon="target"><p>{analysis}</p></ReportCard>
      </div>
    </StatementReportLayout>
  </section>;
}
