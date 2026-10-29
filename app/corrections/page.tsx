import type { Metadata } from 'next';
import Link from 'next/link';
import { Card } from '@/components/bits';
import { StatusBadge } from '@/components/DealBits';
import { fieldInfo } from '@/lib/correction-core';
import { loadApproved } from '@/lib/corrections';
import { flagLabel } from '@/lib/copy';
import { getDeal, loadDataset, loadDatasetV2 } from '@/lib/data';
import { fmt } from '@/lib/format';

export const metadata: Metadata = { title: 'תיקונים מאושרים | מדלן-בדק' };

const STEPS = [
  'מנציג השירות: ליד כל בדיקה יש "הצעת תיקון". מזינים את הערך הנכון, למה הוא נכון וממה נלקח המידע, ורואים מה היה משתנה.',
  'מעבירים את הבקשה לצוות הפיתוח (כפתור ההעתקה). המערכת אינה שומרת ואינה משנה שום דבר.',
  'אחרי אישור, הרשומה נוספת לקובץ data/corrections.approved.json (עם שם המאשר ותאריך).',
  'מריצים python scripts/apply_corrections.py. הסקריפט מעתיק את הקובץ המקורי ל-v2, משנה בו רק את התאים המאושרים (ועוצר אם הערך הקיים אינו מה שציפו לו), ובונה מחדש את מערך הנתונים של v2.',
];

export default function CorrectionsPage() {
  const approved = loadApproved();
  const main = loadDataset();
  const v2 = loadDatasetV2();
  const mismatchNow = main.summary.ppsm_mismatch_raw_rows;
  const mismatchV2 = v2?.summary.ppsm_mismatch_raw_rows;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">תיקונים מאושרים (עותק v2)</h1>
        <p className="text-sm text-slate-600">
          קובץ העסקאות המקורי נשאר כפי שהתקבל. תיקונים מאושרים נכנסים לעותק v2 בלבד, וכאן רואים מה הם שינו.
        </p>
      </header>

      <Card title="איך תיקון נעשה">
        <ol className="list-decimal space-y-2 ps-5 text-sm text-slate-800">
          {STEPS.map((s) => <li key={s}>{s}</li>)}
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          הבדיקות והתשובות באפליקציה רצות תמיד על הקובץ המקורי. עותק v2 משמש כדי לוודא שהתיקונים עובדים, לפני שמחליטים להחליף את הנתונים.
        </p>
      </Card>

      <Card title="השוואה בין המקור ל-v2">
        {v2 ? (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-slate-500">עסקאות</dt><dd className="font-semibold text-slate-900">{fmt(main.summary.deals)} ← {fmt(v2.summary.deals)}</dd></div>
            <div><dt className="text-xs text-slate-500">שורות עם מחיר למ&quot;ר לא תואם</dt><dd className="font-semibold text-slate-900">{mismatchNow} ← {mismatchV2}</dd></div>
            <div><dt className="text-xs text-slate-500">מוחרגות מהסטטיסטיקה</dt><dd className="font-semibold text-slate-900">{main.summary.excluded} ← {v2.summary.excluded}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-slate-700">עדיין לא נבנה עותק v2. הריצו את scripts/apply_corrections.py.</p>
        )}
      </Card>

      <section aria-labelledby="applied" className="space-y-3">
        <h2 id="applied" className="text-lg font-semibold text-slate-900">התיקונים ({approved.length})</h2>
        {approved.length === 0 && <p className="text-sm text-slate-700">עדיין אין תיקונים מאושרים.</p>}
        {approved.map((a) => {
          const before = getDeal(a.deal_id);
          const after = v2?.deals.find((d) => d.deal_id === a.deal_id);
          const gone = before && after ? before.flags.filter((f) => !after.flags.includes(f)) : [];
          return (
            <Card key={`${a.deal_id}-${a.row_index}-${a.field}`}>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={`/deals/${a.deal_id}`} className="text-lg font-bold text-indigo-900 underline"><bdi>{a.deal_id}</bdi></Link>
                {before && <StatusBadge status={before.status} />}
                {after && before && after.status !== before.status && <><span aria-hidden>←</span><StatusBadge status={after.status} /></>}
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-slate-500">מה תוקן</dt><dd className="text-slate-900">{fieldInfo[a.field].he}, שורה {a.row_index + 2}</dd></div>
                <div><dt className="text-xs text-slate-500">הערך</dt><dd className="font-semibold text-slate-900" dir="ltr">{a.old_value === null ? '—' : fmt(a.old_value)} → {fmt(a.new_value)}</dd></div>
                <div><dt className="text-xs text-slate-500">אושר על ידי</dt><dd className="text-slate-900">{a.approved_by ?? 'טרם אושר'}</dd></div>
              </dl>
              <p className="mt-2 text-sm text-slate-800"><span className="text-xs text-slate-500">סיבה: </span>{a.reason}</p>
              <p className="text-sm text-slate-800"><span className="text-xs text-slate-500">מקור המידע: </span>{a.source_of_info}</p>
              {gone.length > 0 && <p className="mt-2 text-sm text-emerald-900">בעותק v2 הוסר הסימון: {gone.map((f) => flagLabel[f] ?? f).join(', ')}</p>}
            </Card>
          );
        })}
      </section>
    </main>
  );
}
