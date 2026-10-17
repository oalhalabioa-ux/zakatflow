import {expect,it} from 'vitest';
import {yaqeenRecentAccountingDocuments as rows} from './yaqeen-recent-documents';
const doc={id:'a',document_type:'SALES',document_kind:'INVOICE',document_number:'INV1',transaction_date:'2026-10-17',gross_amount:'115',currency:'USD',cash_flow:{settlement_status:'PARTIAL'}};
it('does not present a partial company group as a complete recent list',()=>{expect(rows([{documents:[doc]},null])).toEqual([])});
it('excludes e-invoice tax fragments and credit notes and preserves native amount and status',()=>{const result=rows([{documents:[doc,{...doc,id:'split',is_einvoice:true},{...doc,id:'note',document_kind:'CREDIT_NOTE'}]}]);expect(result).toHaveLength(1);expect(result[0]).toMatchObject({amount:'115',currency:'USD',status:'PARTIAL'})});
