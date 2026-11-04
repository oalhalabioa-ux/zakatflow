import {it,expect} from 'vitest';
import {isFiscalReviewRequest} from '../lib/fiscal-review';
it('permits only the fictional read-only screen on an explicitly enabled Preview',()=>{
 const preview={VERCEL_ENV:'preview',FISCAL_YEAR_REVIEW_PREVIEW:'true'};
 expect(isFiscalReviewRequest('/ar/preview/fiscal-years',preview)).toBe(true);
 expect(isFiscalReviewRequest('/en/preview/fiscal-years',preview)).toBe(true);
 for(const path of ['/ar/settings/financial/fiscal-years','/ar/preview/fiscal-years/admin','/api/financial-reporting/fiscal','/ar/opening-balances'])expect(isFiscalReviewRequest(path,preview)).toBe(false);
 expect(isFiscalReviewRequest('/ar/preview/fiscal-years',{...preview,VERCEL_ENV:'production'})).toBe(false);
 expect(isFiscalReviewRequest('/ar/preview/fiscal-years',{VERCEL_ENV:'preview'})).toBe(false);
});
