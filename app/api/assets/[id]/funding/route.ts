import { NextResponse } from "next/server";
import { z } from "zod";
import { purchaseFundingFromCashMovement } from "../../../../../lib/personal-purchase-funding";
import { requireUser } from "../../../../../services/auth";

const privateResponse = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "ASSET_FUNDING_INPUT_INVALID" }, { status: 400, headers: privateResponse });
  try {
    const { supabase, user } = await requireUser();
    const scoped = <Columns extends string>(table: string, columns: Columns) =>
      supabase.from(table).select(columns).eq("user_id", user.id).is("organization_id", null);
    const { data: asset, error: assetError } = await scoped("asset_accounts", "id,metadata")
      .eq("id", id.data).eq("ownership_scope", "PERSONAL").maybeSingle();
    if (assetError) throw assetError;
    if (!asset) return NextResponse.json({ error: "ASSET_NOT_FOUND" }, { status: 404, headers: privateResponse });

    const empty = () => NextResponse.json({ payment: null }, { headers: privateResponse });
    const requestId = z.uuid().safeParse(asset.metadata?.acquisition_request_id);
    if (!requestId.success) return empty();
    const { data: purchase, error: purchaseError } = await scoped("transactions", "id,metadata")
      .eq("asset_account_id", asset.id).eq("transaction_type", "PURCHASE")
      .eq("metadata->>acquisition_request_id", requestId.data).maybeSingle();
    if (purchaseError) throw purchaseError;
    const cashId = z.uuid().safeParse(purchase?.metadata?.purchase_funding?.withdrawal_id);
    if (!purchase || !cashId.success) return empty();

    const { data: movement, error: movementError } = await scoped("transactions", "id,transaction_type,transaction_date,metadata,reference")
      .eq("id", cashId.data).eq("metadata->>purchase_transaction_id", purchase.id).maybeSingle();
    if (movementError) throw movementError;
    const evidence = movement && purchaseFundingFromCashMovement(movement);
    if (!movement || !evidence) return empty();
    const { data: reversal, error: reversalError } = await scoped("transactions", "id,transaction_date")
      .eq("transaction_type", "REVERSAL").eq("reversal_of_transaction_id", movement.id).maybeSingle();
    if (reversalError) throw reversalError;

    return NextResponse.json({
      payment: {
        id: movement.id, date: movement.transaction_date, reference: movement.reference,
        amount: evidence.payment_amount, currency: evidence.payment_currency,
        acquisitionCost: evidence.asset_basis_base, baseCurrency: evidence.base_currency,
        reversedOn: reversal?.transaction_date ?? null,
      },
    }, { headers: privateResponse });
  } catch (error) {
    const unauthenticated = error instanceof Error && error.message === "UNAUTHORIZED";
    return NextResponse.json({ error: unauthenticated ? "UNAUTHORIZED" : "ASSET_FUNDING_READ_FAILED" },
      { status: unauthenticated ? 401 : 500, headers: privateResponse });
  }
}
