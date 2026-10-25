'use client';
import {useMemo,useState} from 'react';
import {installmentSchedule} from '../lib/debt-contracts';
export type DebtInstallment={amount:number;due_date:string};
export function automaticDebtInstallments(principal:string,count:string,first:string,date:string,frequencyMonths=1):DebtInstallment[]{const value=Number(principal),n=Number(count);if(!principal||!count||!Number.isFinite(value)||value<=0||!Number.isInteger(n)||n<1||n>48||!/^\d{4}-\d{2}-\d{2}$/.test(first)||first<date)return [];try{return installmentSchedule(value,n,first,frequencyMonths)}catch{return []}}
export function useDebtInstallments(principal:string,count:string,first:string,date:string,frequencyMonths=1){const key=JSON.stringify([principal,count,first,date,frequencyMonths]),automatic=useMemo(()=>automaticDebtInstallments(principal,count,first,date,frequencyMonths),[principal,count,first,date,frequencyMonths]);const [manual,setManual]=useState<{key:string;rows:DebtInstallment[]}|null>(null);const schedule=manual?.key===key?manual.rows:automatic;return {schedule,setSchedule:(rows:DebtInstallment[])=>setManual({key,rows}),reset:()=>setManual(null),edited:manual?.key===key};}
