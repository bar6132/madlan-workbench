'use client';
import { useState } from 'react';
import { Card, CopyButton, DealChip, fmt, inputCls } from './bits';
import { fieldLabel } from '@/lib/copy';
import { verdictLabel } from '@/lib/templates';
import type { AnalyzeResult } from '@/lib/analyze';
import type { MarketContext } from '@/lib/market';

const verdictStyle: Record<string, string> = {
  RAW_VALUE_WRONG: 'bg-red-50 text-red-900 ring-red-200',
  RAW_VALUE_OK: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  SOURCES_CONFLICT: 'bg-amber-50 text-amber-900 ring-amber-200',
  CANNOT_DETERMINE: 'bg-slate-100 text-slate-800 ring-slate-300',
  DEAL_NOT_FOUND: 'bg-slate-100 text-slate-800 ring-slate-300',
};

export function ClaimCard({ r, busy, onField }: { r: AnalyzeResult; busy: boolean; onField: (f: string) => void }) {
  const field = r.facts?.field;
  if (!field) return null;
  return (
    <Card title="מה הבנו מהתלונה" tone="soft">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>{r.extraction === 'LLM' ? 'זוהה אוטומטית' : 'הוזן ידנית'}:</span>
        {r.facts?.deal_id && <DealChip id={r.facts.deal_id} />}
        <label className="flex items-center gap-2">
          <span className="text-slate-600">נושא התלונה</span>
          <select disabled={busy} value={field} onChange={(e) => onField(e.target.value)} className={`${inputCls} !w-auto`}>
            {Object.entries(fieldLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {r.claim?.customer_stated_value != null && <span>הסכום שצוין: ₪{fmt(r.claim.customer_stated_value)}</span>}
      </div>
    </Card>
  );
}

export function VerdictEvidence({ r }: { r: AnalyzeResult }) {
  const f = r.facts!;
  const d = r.deal;
  return (
    <Card title="תוצאת הבדיקה" id="evidence">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${verdictStyle[f.verdict]}`}>{verdictLabel[f.verdict]}</span>
        {f.deal_id && <DealChip id={f.deal_id} />}
      </div>
      <ul className="mb-4 list-disc space-y-1 ps-5 text-sm text-slate-800">
        {f.facts_he.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
      {d && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {d.city}{d.neighborhood ? `, ${d.neighborhood}` : ''}{d.street ? `, ${d.street}` : ''} · {d.rooms ?? '?'} חדרים · {d.size_sqm ?? 'שטח חסר'} מ&quot;ר · {d.deal_date ?? 'ללא תאריך'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-start text-xs text-slate-600">
                  <th className="py-2 text-start font-medium">שורה בקובץ</th>
                  <th className="text-start font-medium">מקור</th>
                  <th className="text-start font-medium">מחיר כפי שנרשם</th>
                  <th className="text-start font-medium">מחיר למ&quot;ר בקובץ</th>
                  <th className="text-start font-medium">מחיר למ&quot;ר מחושב</th>
                  <th className="text-start font-medium">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {d.raw_rows.map((row, i) => {
                  const calc = row.price_nis && d.size_sqm ? Math.round(row.price_nis / d.size_sqm) : null;
                  const isPrimary = i === d.primary_row_index;
                  return (
                    <tr key={row.row_index} className={`border-b border-slate-100 ${isPrimary ? 'bg-indigo-50/50' : ''}`}>
                      <td className="py-2">{row.row_index + 2}</td>
                      <td>{row.source}</td>
                      <td><bdi>{row.price_nis_raw}</bdi></td>
                      <td>{fmt(row.csv_price_per_sqm)}</td>
                      <td>{fmt(calc)} <span className="text-xs text-slate-500">(חושב)</span></td>
                      <td>{d.raw_rows.length > 1 ? (isPrimary ? 'מוצג במערכת' : 'רשומה נוספת') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {d.flags.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold text-slate-800">סימונים על העסקה</h3>
              <ul className="space-y-1 text-sm text-slate-700">
                {d.flags.map((flag, i) => (
                  <li key={flag}>
                    <span className="me-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      {flag === 'SOURCE_CONFLICT' && d.primary_reason === 'SOURCE_ORDER' ? 'הנחה' : 'חושב'}
                    </span>
                    {d.explanations_he[i]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function ReplyBox({ r }: { r: AnalyzeResult }) {
  const reply = r.reply!;
  const [text, setText] = useState(reply.text);
  return (
    <Card title="תשובה ללקוח">
      <div className="mb-2 flex items-center gap-3">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${reply.source === 'LLM' ? 'bg-indigo-50 text-indigo-900 ring-indigo-200' : 'bg-slate-100 text-slate-700 ring-slate-300'}`}>
          {reply.source === 'LLM' ? 'טיוטה שנוצרה ב-AI' : 'תבנית מוכנה'}
        </span>
        <span className="text-xs text-slate-500">כל המספרים נבדקו מול הנתונים. קראו וערכו לפני שליחה.</span>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} className={inputCls} aria-label="נוסח התשובה" />
      <div className="mt-2"><CopyButton text={text} label="העתקת התשובה" /></div>
    </Card>
  );
}

export function EscalationNote({ note }: { note: string }) {
  return (
    <Card title="הפניה לצוות הפיתוח" tone="soft">
      <pre className="mb-2 whitespace-pre-wrap rounded-md bg-white p-3 text-sm text-slate-800 ring-1 ring-slate-200">{note}</pre>
      <CopyButton text={note} label="העתקת ההפניה" />
    </Card>
  );
}

export function MarketPanel({ clean, raw }: { clean: MarketContext; raw: MarketContext | null }) {
  const [showRaw, setShowRaw] = useState(false);
  const m = showRaw && raw ? raw : clean;
  return (
    <Card title="הקשר שוק (להקשר בלבד)">
      <p className="mb-1 text-sm text-slate-700">{m.scope_he} · {m.window.from} עד {m.window.to} · {m.n} עסקאות</p>
      {m.stats ? (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-slate-500">מחיר חציוני</dt><dd className="font-semibold">₪{fmt(m.stats.median_price)}</dd></div>
          <div><dt className="text-xs text-slate-500">חציון למ&quot;ר</dt><dd className="font-semibold">₪{fmt(m.stats.median_ppsm)}</dd></div>
          <div><dt className="text-xs text-slate-500">רבעון תחתון</dt><dd>₪{fmt(m.stats.p25_price)}</dd></div>
          <div><dt className="text-xs text-slate-500">רבעון עליון</dt><dd>₪{fmt(m.stats.p75_price)}</dd></div>
        </dl>
      ) : (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{m.reason_he}</p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        נתוני הקובץ אינם כוללים מספר בית, שטח מרפסת או גינה, או מידע על תמ&quot;א 38, ולכן אין כאן הערכה אם מחיר מסוים סביר.
      </p>
      {raw && (
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} />
          הצגת החישוב על הנתונים הגולמיים, לפני ניקוי (להמחשה בלבד)
        </label>
      )}
    </Card>
  );
}
