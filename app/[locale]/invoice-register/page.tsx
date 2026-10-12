import { redirect } from 'next/navigation';

// Keep existing bookmarks in the same tabbed tax and invoice workspace.
export default async function InvoiceRegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/vat?section=unified`);
}
