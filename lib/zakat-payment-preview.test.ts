import {expect,it} from 'vitest';
import {zakatPaymentPreview as preview} from './zakat-payment-preview';
const base={amount:350,finalRemaining:350,carriedCredit:0,accountBalance:5000};
it('shows the proposed cash debit and remaining final liability',()=>expect(preview(base)).toMatchObject({debit:350,after:4650,remaining:0,carried:0,insufficient:false}));
it('carries excess without reducing an open-cycle estimate',()=>expect(preview({...base,amount:500,carriedCredit:20})).toMatchObject({remaining:0,carried:170}));
it('never subtracts a posted cash payment a second time',()=>expect(preview({...base,posted:true})).toMatchObject({debit:0,after:5000,remaining:350,carried:0}));
it('replaces the old allocation when editing a historical payment',()=>expect(preview({...base,amount:200,previousAllocated:100,previousCarried:50,carriedCredit:70})).toMatchObject({remaining:250,carried:20}));
it('keeps an unknown bank balance unknown',()=>expect(preview({...base,accountBalance:null})).toMatchObject({before:null,after:null,insufficient:false}));
it('identifies insufficient funds without pretending to post a payment',()=>expect(preview({...base,accountBalance:100})).toMatchObject({after:-250,insufficient:true}));
