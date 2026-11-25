import { redirect } from 'next/navigation';
import { invoiceRegisterHref } from '@/lib/invoice-register-navigation';

// Existing bookmarks retain their company/branch context in the unified register.
export default async function InvoiceRegisterPage({ params,searchParams }: {
 params:Promise<{locale:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>;
}) {
 const [{locale},query]=await Promise.all([params,searchParams]);
 redirect(invoiceRegisterHref(locale,query));
}
