import React from 'react';
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.stubGlobal('React',React);
import {automaticDebtInstallments,useDebtInstallments} from '../hooks/useDebtInstallments';
import DebtInstallmentTable,{debtScheduleCheck} from './DebtInstallmentTable';
function Preview({count}:{count:string}){const {schedule,setSchedule}=useDebtInstallments('30000',count,'2026-10-31','2026-10-15');return <DebtInstallmentTable schedule={schedule} onChange={setSchedule} principal={30000} currency="SAR" minDate="2026-10-15"/>}
it('immediately renders three dates and amounts without a generate-button interaction',()=>{const html=renderToStaticMarkup(<Preview count="3"/>);expect(html.match(/type="date"/g)).toHaveLength(3);expect(html.match(/value="10000"/g)).toHaveLength(3);for(const date of ['2026-10-31','2026-11-30','2026-12-31'])expect(html).toContain('value="'+date+'"');expect(html).toContain('المجموع مطابق لأصل المبلغ')});
it('regenerates the visible distribution when count changes and preserves exact principal',()=>{expect(renderToStaticMarkup(<Preview count="2"/>).match(/value="15000"/g)).toHaveLength(2);const rows=automaticDebtInstallments('100','3','2026-01-31','2026-01-01');expect(rows.map(r=>r.due_date)).toEqual(['2026-01-31','2026-02-28','2026-03-31']);expect(debtScheduleCheck(rows,100).valid).toBe(true)});
it('does not generate invalid schedules or allow mismatched amounts and base rounding',()=>{for(const [value,count,first]of [['','3','2026-10-31'],['100','2.5','2026-10-31'],['100','49','2026-10-31'],['100','3','2026-01-01']])expect(automaticDebtInstallments(value,count,first,'2026-10-15')).toEqual([]);expect(debtScheduleCheck([{amount:90,due_date:'2026-10-31'}],100).valid).toBe(false);expect(debtScheduleCheck([{amount:.3333,due_date:'2026-10-31'},{amount:.3333,due_date:'2026-11-30'},{amount:.3334,due_date:'2026-12-31'}],1,3.75).baseMatches).toBe(false)});
