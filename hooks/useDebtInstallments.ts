'use client';
import {useMemo,useState} from 'react';
import {installmentSchedule} from '../lib/debt-contracts';
export type DebtInstallment={amount:number;due_date:string};
export function automaticDebtInstallments(principal:string,count:string,first:string,date:string,frequencyMonths=1):DebtInstallment[]{const value=Number(principal),n=Number(count);if(!principal||!count||!Number.isFinite(value)||value<=0||!Number.isInteger(n)||n<1||n>48||!/^\d{4}-\d{2}-\d{2}$/.test(first)||first<date)return [];try{return installmentSchedule(value,n,first,frequencyMonths)}catch{return []}}
export function useDebtInstallments(principal:string,count:string,first:string,date:string,frequencyMonths=1,savedSchedule?:DebtInstallment[]){const key=JSON.stringify([principal,count,first,frequencyMonths]),automatic=useMemo(()=>automaticDebtInstallments(principal,count,first,date,frequencyMonths),[principal,count,first,date,frequencyMonths]);const [manual,setManual]=useState<{key:string;rows:DebtInstallment[]}|null>(()=>savedSchedule?{key,rows:savedSchedule.map(r=>({...r}))}:null);const schedule=manual?.key===key?manual.rows:automatic;return {schedule,setSchedule:(rows:DebtInstallment[])=>setManual({key,rows}),reset:()=>setManual(null),edited:manual?.key===key};}

export function savedInstallmentFrequency(rows?:DebtInstallment[]){if(!rows||rows.length<2)return 1;const [a,b]=rows;const months=(Number(b.due_date.slice(0,4))-Number(a.due_date.slice(0,4)))*12+Number(b.due_date.slice(5,7))-Number(a.due_date.slice(5,7));return [1,3,6,12].includes(months)?months:1;}
