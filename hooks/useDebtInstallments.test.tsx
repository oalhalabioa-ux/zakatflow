import React from 'react';
import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {automaticDebtInstallments,savedInstallmentFrequency,useDebtInstallments} from './useDebtInstallments';
function Schedule({saved}:{saved?:Array<{amount:number;due_date:string}>}){const {schedule}=useDebtInstallments('300','2','2026-11-07','2026-10-01',3,saved);return <output>{JSON.stringify(schedule)}</output>}
it('restores unequal amounts and custom dates on the first render without waiting for an effect',()=>{const rows=[{amount:75,due_date:'2026-11-07'},{amount:225,due_date:'2027-02-19'}];const output=renderToStaticMarkup(<Schedule saved={rows}/>);expect(output).toContain('225');expect(output).toContain('2027-02-19');expect(output).not.toContain('150');expect(savedInstallmentFrequency(rows)).toBe(3);expect(rows[1].amount).toBe(225);});
it('still generates a new equal quarterly schedule when no saved schedule exists',()=>{const rows=automaticDebtInstallments('300','2','2026-11-07','2026-10-01',3);expect(rows).toEqual([{amount:150,due_date:'2026-11-07'},{amount:150,due_date:'2027-02-07'}]);expect(renderToStaticMarkup(<Schedule/>)).toContain('2027-02-07');});
