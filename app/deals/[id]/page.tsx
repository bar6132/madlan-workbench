import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Card } from '@/components/bits';
import { StatusBadge } from '@/components/DealBits';
import { CorrectionProposal } from '@/components/CorrectionProposal';
import { MarketPanel } from '@/components/Results';
import { suggestFixes } from '@/lib/correction-core';
import { fmt } from '@/lib/format';
import { flagLabel, he } from '@/lib/copy';
import { getDeal, loadDataset } from '@/lib/data';
import { marketContext } from '@/lib/market';
import { normalizeDealId } from '@/lib/resolver';

export function generateStaticParams() {
  return loadDataset().deals.map((d) => ({ id: d.deal_id }));
}

const tri = (v: boolean | null) => (v === null ? 'לא ידוע' : v ? 'כן' : 'לא');

const PRIMARY_REASON: Record<string, string> = {
  SINGLE: 'רשומה אחת בלבד בקובץ',
  EXACT_DUP: 'הרשומה הופיעה פעמיים באותם נתונים בדיוק',
  PPSM_MATCH: he.conflictReasonPpsm,
  SOURCE_ORDER: he.conflictReasonOrder,
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{children}</dd>
    </div>
  );
}

// params is read inside Suspense so the page shell can be prerendered (Next 16 Cache Components).
export default function DealPage(props: PageProps<'/deals/[id]'>) {
  return (
    <Suspense fallback={<p role="status" className="mx-auto w-full max-w-4xl px-4 py-6 text-sm text-slate-600 sm:px-6">טוענים את פרטי העסקה…</p>}>
      <DealContent params={props.params} />
    </Suspense>
  );
}

async function DealContent({ params }: { params: PageProps<'/deals/[id]'>['params'] }) {
  const { id } = await params;
  const deal = getDeal(normalizeDealId(decodeURIComponent(id)) ?? '');
  if (!deal) notFound();

  const market = marketContext(deal);
  const marketRaw = marketContext(deal, { raw: true });
  const place = [deal.street, deal.neighborhood, deal.city].filter(Boolean).join(', ');
  const ppsmMismatch = deal.flags.includes('PPSM_MISMATCH');

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <Link href="/deals" className="text-sm text-slate-600 underline">→ חזרה למאגר העסקאות</Link>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900"><bdi>{deal.deal_id}</bdi></h1>
        <StatusBadge status={deal.status} />
        <Link
          href={`/?deal=${deal.deal_id}`}
          className="ms-auto rounded-md bg-indigo-700 px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-800"
        >
          בדיקת תלונה על העסקה
        </Link>
      </header>
      <p className="text-slate-700">{place}</p>

      {deal.flags.length > 0 && (
        <Card title="מה נמצא בנתונים של עסקה זו">
          <ul className="mb-3 flex flex-wrap gap-2">
            {deal.flags.map((f) => (
              <li key={f} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-800 ring-1 ring-slate-300">{flagLabel[f] ?? f}</li>
            ))}
          </ul>
          <ul className="list-disc space-y-1 ps-5 text-sm text-slate-800">
            {deal.explanations_he.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </Card>
      )}

      <Card title="פרטי העסקה">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <Fact label="מחיר"><span dir="ltr">{deal.price_nis === null ? '—' : `₪${fmt(deal.price_nis)}`}</span></Fact>
          <Fact label="מחיר למ״ר (מחושב)"><span dir="ltr">{fmt(deal.calculated_ppsm)}</span></Fact>
          <Fact label="מחיר למ״ר (כפי שנרשם בקובץ)"><span dir="ltr">{fmt(deal.csv_price_per_sqm)}</span>{ppsmMismatch && <span className="ms-1 text-xs text-amber-900">לא תואם</span>}</Fact>
          <Fact label="תאריך"><span dir="ltr">{deal.deal_date ?? '—'}</span>{deal.date_precision === 'month' && <span className="ms-1 text-xs text-slate-500">(חודש בלבד)</span>}</Fact>
          <Fact label="סוג נכס">{deal.property_type}</Fact>
          <Fact label="חדרים">{deal.rooms ?? '—'}</Fact>
          <Fact label="שטח (מ״ר)">{deal.size_sqm ?? '—'}</Fact>
          <Fact label="קומה">{deal.floor ?? '—'}{deal.total_floors !== null && ` מתוך ${deal.total_floors}`}</Fact>
          <Fact label="שנת בנייה">{deal.year_built ?? '—'}</Fact>
          <Fact label="מצב">{deal.condition ?? '—'}</Fact>
          <Fact label="מעלית">{tri(deal.has_elevator)}</Fact>
          <Fact label="חניה">{tri(deal.has_parking)}</Fact>
          <Fact label="מרפסת">{tri(deal.has_balcony)}</Fact>
          <Fact label="ממ״ד">{tri(deal.has_safe_room)}</Fact>
        </dl>
        <p className="mt-3 text-xs text-slate-500">&quot;לא ידוע&quot; פירושו שהערך חסר בקובץ, לא שהוא &quot;לא&quot;. בקובץ אין מספר בית, שטח מרפסת או גינה.</p>
      </Card>

      <Card title={`הרשומות המקוריות בקובץ (${deal.raw_rows.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="text-xs text-slate-600">
              <tr>{['שורה', 'מקור', 'מחיר כפי שנרשם', 'מחיר למ״ר בקובץ', 'תאריך כפי שנרשם', ''].map((h, i) => <th key={i} scope="col" className="py-1.5 pe-3 text-start font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deal.raw_rows.map((row, i) => (
                <tr key={row.row_index}>
                  <td className="py-2 pe-3 text-slate-600" dir="ltr">{row.row_index}</td>
                  <td className="py-2 pe-3 text-slate-900">{row.source}</td>
                  <td className="py-2 pe-3 text-slate-900" dir="ltr">{row.price_nis_raw || '—'}</td>
                  <td className="py-2 pe-3 text-slate-700" dir="ltr">{fmt(row.csv_price_per_sqm)}</td>
                  <td className="py-2 pe-3 text-slate-700" dir="ltr">{row.deal_date_raw || '—'}</td>
                  <td className="py-2">{deal.raw_rows.length > 1 && i === deal.primary_row_index && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-900 ring-1 ring-indigo-200">מוצגת במערכת</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {deal.raw_rows.length > 1 && <p className="mt-2 text-sm text-slate-700">למה זו הרשומה שמוצגת: {PRIMARY_REASON[deal.primary_reason]}.</p>}
      </Card>

      <CorrectionProposal deal={deal} suggestions={suggestFixes(deal)} />

      <MarketPanel clean={market} raw={marketRaw} />
    </main>
  );
}
