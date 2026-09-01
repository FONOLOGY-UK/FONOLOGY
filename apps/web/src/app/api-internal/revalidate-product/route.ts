import { revalidatePath } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * On-demand revalidation for `/shop/[slug]` — see apps/api/src/lib/revalidate.ts
 * for the full bug/fix writeup. The PDP is fully static
 * (`generateStaticParams` + `dynamicParams = false`, no `revalidate`
 * interval), so nothing ever refreshes it after an admin edit short of a
 * full rebuild, unless something explicitly tells Next.js to. This is that
 * something: the API calls it right after a product update that could
 * change purchasability (a category move — `kind` is derived from
 * `category_id`, see `products_derive_kind`, 0064_mandatory_categories.sql)
 * commits.
 *
 * Authenticated with `INTERNAL_PROXY_SECRET` — the same shared secret
 * `/api-proxy/*` uses to prove a client-IP header came from apps/api and not
 * an arbitrary caller, reused here for the opposite direction (apps/api
 * proving a revalidation request came from itself, not an arbitrary POST
 * trying to force-bust cache pages for free). Unset secret -> this route
 * 401s on every call, same "not configured, correctly inert" shape as the
 * rate-limiter trust check on the other side.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.INTERNAL_PROXY_SECRET;
  if (!secret || req.headers.get('x-internal-proxy-secret') !== secret) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const slug = typeof body?.slug === 'string' ? body.slug : null;
  if (!slug) return NextResponse.json({ error: 'slug is required.' }, { status: 400 });

  revalidatePath(`/shop/${slug}`, 'page');
  return NextResponse.json({ revalidated: true, slug });
}
