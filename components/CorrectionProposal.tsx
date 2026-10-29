'use client';
import { useState } from 'react';
import { Banner, Card, CopyButton, fmt, inputCls, primaryBtn } from './bits';
import { fieldInfo, type CorrectionField, type SuggestionResult } from '@/lib/correction-core';
import { statusLabel } from '@/lib/copy';
import { verdictLabel } from '@/lib/templates';
import type { Preview } from '@/lib/corrections';
import type { ProcessedDeal, RawRow } from '@/lib/types';

const FIELDS = Object.keys(fieldInfo) as CorrectionField[];
const CLIENT_TIMEOUT_MS = 15_000;

function parseNumber(s: string): number | null {
  const t = s.replace(/[₪,\s]/g, '');
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

const cur = (r: RawRow, f: CorrectionField) => (f === 'price_nis' ? r.price_nis : f === 'size_sqm' ? r.size_sqm : r.csv_price_per_sqm);
const n = (x: number | null | undefined) => (x == null ? 'לא ידוע' : fmt(x));

export function CorrectionProposal({ deal, suggestions }: { deal: ProcessedDeal; suggestions: SuggestionResult }) {
  const dealId = deal.deal_id;
  const rows = deal.raw_rows;
  const place = [deal.street, deal.neighborhood, deal.city].filter(Boolean).join(', ');
  const [rowIndex, setRowIndex] = useState(rows[0]?.row_index ?? 0);
  const [field, setField] = useState<CorrectionField>('price_nis');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);

  const row = rows.find((r) => r.row_index === rowIndex) ?? rows[0];

  function fill(s: SuggestionResult['suggestions'][number]) {
    setRowIndex(s.row_index);
    setField(s.field);
    setValue(String(s.value));
    setReason(`${s.label_he}. ${s.assumption_he}`.slice(0, 300));
    setSource('חישוב: מחיר העסקה ÷ שטח, מתוך אותה שורה בקובץ');
    setPreview(null);
    setErrors([]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPreview(null);
    const v = parseNumber(value);
    if (v === null) {
      setErrors(['הערך החדש חייב להיות מספר שלם, למשל 1800000.']);
      return;
    }
    setBusy(true);
    setErrors([]);
    const ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch('/api/corrections/preview', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ deal_id: dealId, row_index: rowIndex, field, new_value: v, reason, source_of_info: source }),
      });
      const j = await res.json();
      if (j.ok) setPreview(j.preview as Preview);
      else setErrors(j.errors_he ?? ['אירעה תקלה. נסו שוב.']);
    } catch {
      setErrors(['לא הצלחנו להתחבר לשרת. בדקו את החיבור ונסו שוב.']);
    } finally {
      clearTimeout(kill);
      setBusy(false);
    }
  }

  const p = preview;
  return (
    <Card title="הצעת תיקון נתונים">
      <details>
        <summary className="cursor-pointer text-sm font-medium text-indigo-900">
          הלקוח צודק, או שיש נתון שצריך לתקן? פתחו כדי להכין בקשת תיקון
        </summary>
        <div className="mt-3 space-y-4">
          <p className="text-sm text-slate-700">
            כאן לא משנים את הקובץ. מכינים בקשת תיקון, רואים מה היה משתנה אילו אושרה, ומעבירים אותה לצוות הפיתוח. תיקון מאושר נכנס רק לעותק v2 של הקובץ, ולעולם לא למקור.
          </p>

          <div className="space-y-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <div>
              <p className="text-sm font-semibold text-slate-900">על איזו עסקה מדובר</p>
              <p className="text-sm text-slate-800">
                <bdi className="font-medium">{dealId}</bdi> · {place} · {deal.property_type}
                {deal.rooms !== null && ` · ${deal.rooms} חדרים`}
                {deal.size_sqm !== null && ` · ${deal.size_sqm} מ"ר`}
                {deal.deal_date && <> · <bdi>{deal.deal_date}</bdi></>}
              </p>
            </div>
            {deal.explanations_he.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-900">מה המערכת מצאה בנתונים של העסקה</p>
                <ul className="list-disc space-y-1 ps-5 text-sm text-slate-800">
                  {deal.explanations_he.map((t) => <li key={t}>{t}</li>)}
                </ul>
              </div>
            )}
            <div>
              <p className="mb-1 text-sm font-semibold text-slate-900">מה רשום בקובץ המקורי ({rows.length === 1 ? 'רשומה אחת' : `${rows.length} רשומות`})</p>
              <div className="overflow-x-auto rounded-md bg-white ring-1 ring-slate-200">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead className="text-xs text-slate-600">
                    <tr>{['שורה בקובץ', 'מקור הדיווח', 'מחיר', 'שטח (מ"ר)', 'מחיר למ"ר שנרשם', 'תאריך'].map((h) => <th key={h} scope="col" className="px-2 py-1.5 text-start font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {rows.map((r) => {
                      const hit = (f: CorrectionField) => (r.row_index === rowIndex && f === field ? 'bg-amber-50 font-semibold text-amber-900' : '');
                      return (
                        <tr key={r.row_index}>
                          <td className="px-2 py-1.5 text-slate-600" dir="ltr">{r.row_index + 2}</td>
                          <td className="px-2 py-1.5">{r.source}</td>
                          <td className={`px-2 py-1.5 ${hit('price_nis')}`} dir="ltr">{n(r.price_nis)}</td>
                          <td className={`px-2 py-1.5 ${hit('size_sqm')}`} dir="ltr">{n(r.size_sqm)}</td>
                          <td className={`px-2 py-1.5 ${hit('price_per_sqm')}`} dir="ltr">{n(r.csv_price_per_sqm)}</td>
                          <td className="px-2 py-1.5" dir="ltr">{r.deal_date_raw}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-slate-500">&quot;שורה בקובץ&quot; היא מספר השורה בקובץ ה-CSV המקורי, כדי שצוות הפיתוח ימצא אותה. התא המסומן בצהוב הוא מה שיתוקן.</p>
            </div>
          </div>

          {(suggestions.suggestions.length > 0 || suggestions.cannot_derive_he.length > 0) && (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="text-sm font-semibold text-slate-900">תיקון אפשרי שהמערכת מצאה</p>
              {suggestions.suggestions.map((s) => (
                <div key={`${s.row_index}-${s.field}`} className="space-y-1">
                  <p className="text-sm text-slate-800">{s.label_he}</p>
                  <p className="text-xs text-slate-600"><span className="font-medium">הנחה:</span> {s.assumption_he}</p>
                  <button type="button" onClick={() => fill(s)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100">
                    מילוי הטופס בתיקון הזה
                  </button>
                </div>
              ))}
              {suggestions.cannot_derive_he.map((t) => <p key={t} className="text-sm text-amber-900">{t}</p>)}
            </div>
          )}

          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {rows.length > 1 ? (
                <div>
                  <label htmlFor="cp-row" className="mb-1 block text-xs text-slate-600">איזו רשומה לתקן</label>
                  <select id="cp-row" value={rowIndex} onChange={(e) => { setRowIndex(Number(e.target.value)); setPreview(null); }} className={inputCls}>
                    {rows.map((r) => <option key={r.row_index} value={r.row_index}>הדיווח של {r.source} · מחיר {n(r.price_nis)} (שורה {r.row_index + 2})</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <p className="mb-1 text-xs text-slate-600">הרשומה שתתוקן</p>
                  <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800 ring-1 ring-slate-200">הרשומה היחידה של העסקה בקובץ (שורה {rows[0].row_index + 2}, {rows[0].source})</p>
                </div>
              )}
              <div>
                <label htmlFor="cp-field" className="mb-1 block text-xs text-slate-600">מה לתקן</label>
                <select id="cp-field" value={field} onChange={(e) => { setField(e.target.value as CorrectionField); setPreview(null); }} className={inputCls}>
                  {FIELDS.map((f) => <option key={f} value={f}>{fieldInfo[f].he} · כרגע בקובץ: {n(row ? cur(row, f) : null)}</option>)}
                </select>
              </div>
            </div>
            <p className="text-sm text-slate-700">הערך בקובץ כרגע: <bdi className="font-semibold">{n(row ? cur(row, field) : null)}</bdi></p>
            <div>
              <label htmlFor="cp-value" className="mb-1 block text-xs text-slate-600">הערך הנכון (מספר שלם)</label>
              <input id="cp-value" dir="ltr" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className={inputCls} placeholder="1800000" />
            </div>
            <div>
              <label htmlFor="cp-reason" className="mb-1 block text-xs text-slate-600">למה זה הערך הנכון</label>
              <textarea id="cp-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder={'למשל: הלקוח שלח את חוזה המכר, ובו מצוין מחיר של 1,800,000 ש"ח'} />
            </div>
            <div>
              <label htmlFor="cp-source" className="mb-1 block text-xs text-slate-600">ממה נלקח המידע (חוזה, מסמך, אישור מהלקוח…)</label>
              <input id="cp-source" maxLength={200} value={source} onChange={(e) => setSource(e.target.value)} className={inputCls} placeholder="למשל: חוזה מכר שצורף לפנייה, או אישור מרשות המסים" />
            </div>
            <button type="submit" disabled={busy || !value.trim() || !reason.trim() || !source.trim()} className={primaryBtn}>
              {busy ? 'בודקים…' : 'תצוגה מקדימה של ההשפעה'}
            </button>
          </form>

          {errors.length > 0 && <Banner kind="warn" text={errors.join(' ')} />}

          {p && (
            <div className="space-y-3" aria-live="polite">
              <h3 className="text-sm font-semibold text-slate-900">מה היה משתנה אילו התיקון היה בקובץ</h3>
              <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-600">
                    <tr><th scope="col" className="px-3 py-2 text-start font-medium"></th><th scope="col" className="px-3 py-2 text-start font-medium">היום</th><th scope="col" className="px-3 py-2 text-start font-medium">אחרי התיקון</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    <tr><th scope="row" className="px-3 py-2 text-start font-normal text-slate-600">סטטוס</th><td className="px-3 py-2">{statusLabel[p.before.status]}</td><td className="px-3 py-2 font-semibold">{statusLabel[p.after.status]}</td></tr>
                    <tr><th scope="row" className="px-3 py-2 text-start font-normal text-slate-600">מחיר שמוצג</th><td className="px-3 py-2" dir="ltr">₪{n(p.before.price_nis)}</td><td className="px-3 py-2 font-semibold" dir="ltr">₪{n(p.after.price_nis)}</td></tr>
                    <tr><th scope="row" className="px-3 py-2 text-start font-normal text-slate-600">מחיר למ&quot;ר (חושב)</th><td className="px-3 py-2" dir="ltr">{n(p.before.calculated_ppsm)}</td><td className="px-3 py-2 font-semibold" dir="ltr">{n(p.after.calculated_ppsm)}</td></tr>
                    <tr><th scope="row" className="px-3 py-2 text-start font-normal text-slate-600">בחישובי שוק</th><td className="px-3 py-2">{p.before.include_in_stats ? 'כן' : 'לא'}</td><td className="px-3 py-2 font-semibold">{p.after.include_in_stats ? 'כן' : 'לא'}</td></tr>
                    <tr><th scope="row" className="px-3 py-2 text-start font-normal text-slate-600">תוצאת הבדיקה</th><td className="px-3 py-2">{verdictLabel[p.verdict.before]}</td><td className="px-3 py-2 font-semibold">{verdictLabel[p.verdict.after]}</td></tr>
                    <tr><th scope="row" className="px-3 py-2 text-start font-normal text-slate-600">הקשר שוק</th><td className="px-3 py-2">{p.market.before.n} עסקאות{p.market.before.stats ? ` · חציון ₪${n(p.market.before.stats.median_price)}` : ''}</td><td className="px-3 py-2 font-semibold">{p.market.after.n} עסקאות{p.market.after.stats ? ` · חציון ₪${n(p.market.after.stats.median_price)}` : ''}</td></tr>
                  </tbody>
                </table>
              </div>
              <ul className="list-disc space-y-1 ps-5 text-sm text-slate-800">
                {p.change_lines_he.map((l) => <li key={l}>{l}</li>)}
              </ul>
              {p.notes_he.map((t) => <p key={t} className="text-xs text-slate-500">{t}</p>)}

              <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                <p className="mb-2 text-sm font-semibold text-slate-900">מה מעבירים הלאה</p>
                <pre className="mb-2 whitespace-pre-wrap rounded-md bg-white p-3 text-sm text-slate-800 ring-1 ring-slate-200">{p.request_text}</pre>
                <div className="flex flex-wrap gap-2">
                  <CopyButton text={p.request_text} label="העתקת הבקשה לצוות הפיתוח" />
                  <CopyButton text={JSON.stringify(p.json_entry, null, 2)} label="העתקת רשומה ל-corrections.approved.json" />
                  <CopyButton text={p.csv_patch_he} label="העתקת השינוי בקובץ" />
                </div>
                <p className="mt-2 text-xs text-slate-500">אחרי אישור: הוסיפו את הרשומה לקובץ התיקונים המאושרים והריצו <bdi>python scripts/apply_corrections.py</bdi>. התוצאה נכנסת לעותק v2 בלבד.</p>
              </div>
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}
