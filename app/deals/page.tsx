import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Card, inputCls, primaryBtn } from '@/components/bits';
import { StatusBadge } from '@/components/DealBits';
import { fmt } from '@/lib/format';
import { flagLabel, sortLabel, statusLabel } from '@/lib/copy';
import { loadDataset } from '@/lib/data';
import { SORTS, buildFacets, parseExplorerParams, queryDeals, type ExplorerParams } from '@/lib/explorer';

export const metadata: Metadata = { title: 'מאגר עסקאות | מדלן-בדק' };

function href(p: ExplorerParams, page: number): string {
  const q = new URLSearchParams();
  for (const k of ['q', 'city', 'status', 'property_type', 'flag', 'source'] as const) if (p[k]) q.set(k, p[k]);
  if (p.min_price !== null) q.set('min_price', String(p.min_price));
  if (p.max_price !== null) q.set('max_price', String(p.max_price));
  if (p.sort !== 'date_desc') q.set('sort', p.sort);
  if (page > 1) q.set('page', String(page));
  const s = q.toString();
  return s ? `/deals?${s}` : '/deals';
}

function Select({ name, label, value, options }: { name: string; label: string; value: string; options: Array<[string, string]> }) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-xs text-slate-600">{label}</label>
      <select id={name} name={name} defaultValue={value} className={inputCls}>
        <option value="">הכול</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

// searchParams is runtime data, so it is read inside Suspense and the route can still prerender its shell.
export default function DealsPage(props: PageProps<'/deals'>) {
  return (
    <Suspense fallback={<p role="status" className="mx-auto w-full max-w-4xl px-4 py-6 text-sm text-slate-600 sm:px-6">טוענים את מאגר העסקאות…</p>}>
      <DealsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function DealsContent({ searchParams }: { searchParams: PageProps<'/deals'>['searchParams'] }) {
  const p = parseExplorerParams(await searchParams);
  const ds = loadDataset();
  const facets = buildFacets(ds.deals);
  const r = queryDeals(ds.deals, p);
  const s = ds.summary;
  const stats: Array<[string, number]> = [
    ['שורות בקובץ', s.raw_rows], ['עסקאות ייחודיות', s.deals], ['ערים', s.cities],
    ['סתירות בין מקורות', s.conflicts], ['מוחרגות מהסטטיסטיקה', s.excluded], ['מחיר למ"ר לא תואם', s.ppsm_mismatch_raw_rows],
  ];

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">מאגר עסקאות</h1>
        <p className="text-sm text-slate-600">
          כל העסקאות בקובץ, כולל אלה שהוחרגו או שיש בהן סתירה. אפשר לחפש לפי מזהה, רחוב או עיר, ולפתוח כל עסקה לראות את הרשומות המקוריות ומה נמצא בהן.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, n]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <dd className="text-xl font-bold text-slate-900">{fmt(n)}</dd>
            <dt className="text-xs text-slate-600">{label}</dt>
          </div>
        ))}
      </dl>

      <Card title="חיפוש וסינון">
        <form method="get" action="/deals" className="space-y-3">
          <div>
            <label htmlFor="q" className="mb-1 block text-xs text-slate-600">חיפוש חופשי (מזהה עסקה, רחוב, שכונה, עיר)</label>
            <input id="q" name="q" defaultValue={p.q} className={inputCls} placeholder="למשל: בן גוריון חולון, או D100124" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Select name="city" label="עיר" value={p.city} options={facets.cities.map((f) => [f.value, `${f.value} (${f.count})`])} />
            <Select name="property_type" label="סוג נכס" value={p.property_type} options={facets.property_types.map((f) => [f.value, `${f.value} (${f.count})`])} />
            <Select name="status" label="סטטוס" value={p.status} options={facets.statuses.map((f) => [f.value, `${statusLabel[f.value] ?? f.value} (${f.count})`])} />
            <Select name="flag" label="סימון" value={p.flag} options={facets.flags.map((f) => [f.value, `${flagLabel[f.value] ?? f.value} (${f.count})`])} />
            <Select name="source" label="מקור דיווח" value={p.source} options={facets.sources.map((f) => [f.value, `${f.value} (${f.count})`])} />
            <Select name="sort" label="מיון" value={p.sort} options={SORTS.map((k) => [k, sortLabel[k]])} />
            <div>
              <label htmlFor="min_price" className="mb-1 block text-xs text-slate-600">מחיר מינימום (₪)</label>
              <input id="min_price" name="min_price" inputMode="numeric" dir="ltr" defaultValue={p.min_price ?? ''} className={inputCls} />
            </div>
            <div>
              <label htmlFor="max_price" className="mb-1 block text-xs text-slate-600">מחיר מקסימום (₪)</label>
              <input id="max_price" name="max_price" inputMode="numeric" dir="ltr" defaultValue={p.max_price ?? ''} className={inputCls} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className={primaryBtn}>חיפוש</button>
            <Link href="/deals" className="text-sm text-slate-600 underline">ניקוי</Link>
          </div>
        </form>
      </Card>

      <p role="status" className="text-sm text-slate-700">
        {r.total === 0 ? 'לא נמצאו עסקאות. נסו להסיר מסנן או לקצר את החיפוש.' : `${fmt(r.total)} עסקאות · עמוד ${r.page} מתוך ${r.pages}`}
      </p>

      {r.items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                {['מזהה', 'מיקום', 'נכס', 'מחיר', 'למ"ר', 'תאריך', 'סטטוס'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 text-start font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.items.map((d) => (
                <tr key={d.deal_id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link href={`/deals/${d.deal_id}`} className="font-medium text-indigo-900 underline"><bdi>{d.deal_id}</bdi></Link>
                  </td>
                  <td className="px-3 py-2 text-slate-800">{d.city}<span className="block text-xs text-slate-500">{[d.neighborhood, d.street].filter(Boolean).join(' · ') || '—'}</span></td>
                  <td className="px-3 py-2 text-slate-700">{d.property_type}<span className="block text-xs text-slate-500">{d.rooms ?? '—'} חד׳ · {d.size_sqm ?? '—'} מ״ר</span></td>
                  <td className="px-3 py-2 text-slate-900" dir="ltr">{d.price_nis === null ? '—' : `₪${fmt(d.price_nis)}`}</td>
                  <td className="px-3 py-2 text-slate-700" dir="ltr">{d.calculated_ppsm === null ? '—' : fmt(d.calculated_ppsm)}</td>
                  <td className="px-3 py-2 text-slate-700" dir="ltr">{d.deal_date ?? '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={d.status} flags={d.flags.length} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {r.pages > 1 && (
        <nav aria-label="עמודים" className="flex items-center justify-between text-sm">
          {r.page > 1 ? <Link href={href(p, r.page - 1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-800 hover:bg-slate-100">→ הקודם</Link> : <span />}
          {r.page < r.pages ? <Link href={href(p, r.page + 1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-800 hover:bg-slate-100">הבא ←</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
