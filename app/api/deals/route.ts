import { NextResponse } from 'next/server';
import { loadDataset } from '@/lib/data';
import { parseExplorerParams, queryDeals, toSummary } from '@/lib/explorer';

// The dataset is a static file, so the answer for a given URL never changes between deploys.
export async function GET(req: Request) {
  const raw = Object.fromEntries(new URL(req.url).searchParams);
  const r = queryDeals(loadDataset().deals, parseExplorerParams(raw));
  return NextResponse.json(
    { total: r.total, page: r.page, pages: r.pages, items: r.items.map(toSummary) },
    { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
  );
}
