import {NextResponse} from 'next/server';
import {z} from 'zod';
import {isSameOriginRequest} from '@/lib/request-origin';
import {requireUser} from '@/services/auth';

type Context = {params: Promise<{id: string}>};
const link = z.strictObject({
  source: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(5).max(500),
  remove: z.boolean().default(false),
});

function failure(error: unknown) {
  const code = (error as {message?: string})?.message;
  const status = code === 'UNAUTHORIZED' ? 401
    : code === 'SALE_EXPENSE_ACCESS_DENIED' ? 403
    : code === 'SALE_EXPENSE_INPUT_INVALID' ? 400
    : code === 'SALE_EXPENSE_SOURCE_UNAVAILABLE' ? 422
    : code === 'SALE_EXPENSE_ALREADY_LINKED' || code === 'SALE_EXPENSE_SALE_INACTIVE' ? 409 : 500;
  return NextResponse.json({error: status === 500 ? 'SALE_EXPENSE_REQUEST_FAILED' : code}, {status});
}

export async function GET(_request: Request, {params}: Context) {
  const {id} = await params;
  if (!z.uuid().safeParse(id).success) return failure({message: 'SALE_EXPENSE_INPUT_INVALID'});
  try {
    const {supabase} = await requireUser();
    const {data, error} = await supabase.rpc('asset_sale_expenses', {p_sale_ids: [id]});
    if (error) throw error;
    return NextResponse.json(data, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, {params}: Context) {
  if (!isSameOriginRequest(request)) return failure({message: 'SALE_EXPENSE_ACCESS_DENIED'});
  const {id} = await params;
  const input = link.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !input.success) return failure({message: 'SALE_EXPENSE_INPUT_INVALID'});
  try {
    const {supabase} = await requireUser();
    const {data, error} = await supabase.rpc('link_asset_sale_expense', {
      p_sale_id: id, p_source: input.data.source, p_reason: input.data.reason, p_remove: input.data.remove,
    });
    if (error) throw error;
    return NextResponse.json({id: data});
  } catch (error) {
    return failure(error);
  }
}
