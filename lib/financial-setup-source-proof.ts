/** Treat zero-opening as a verified condition, not a default for unknown fields.
 * Only server-provided original source rows may be inspected.
 * This does not attest atomic financial consistency or source ownership.
 */
export type ZeroOpeningProof={
 workspace:{status?:string}|null;
 source:{revision:string;rows:Array<{
  sourceIssue:string|null;
  vouchers:Array<{debit:string|number|null;credit:string|number|null}>;
 }>};
};
const zero=(v:unknown):boolean=>
 (typeof v==='number'&&Number.isFinite(v)&&v===0)||
 (typeof v==='string'&&/^0+(?:\.0+)?$/.test(v));
export function hasVerifiedZeroOpening(input:ZeroOpeningProof):boolean{
 if(!input||input.workspace!==null||!input.source||
  !/^[0-9a-f]{32}$/i.test(input.source.revision)||
  !Array.isArray(input.source.rows))return false;
 return input.source.rows.every(row=>row.sourceIssue===null&&
  Array.isArray(row.vouchers)&&row.vouchers.every(v=>zero(v.debit)&&zero(v.credit)));
}
