'use client';
import { useState } from 'react';
import { Card, inputCls, primaryBtn } from './bits';
import { examples, fieldLabel } from '@/lib/copy';
import type { ProcessedDeal } from '@/lib/types';

const MAX = 800;

export function ComplaintForm({ busy, onSubmit }: { busy: boolean; onSubmit: (b: Record<string, unknown>) => void }) {
  const [message, setMessage] = useState('');
  const [dealId, setDealId] = useState('');
  const submit = (m: string) => onSubmit({ message: m, ...(dealId.trim() ? { deal_id: dealId.trim() } : {}) });
  return (
    <Card title="הודעת הלקוח">
      <form onSubmit={(e) => { e.preventDefault(); submit(message); }} className="space-y-3">
        <label className="block text-sm text-slate-700" htmlFor="msg">הדביקו כאן את מה שהלקוח כתב</label>
        <textarea id="msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MAX} rows={4}
          className={inputCls} placeholder="לדוגמה: המחיר למ&quot;ר בעסקה לא הגיוני" />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <label className="mb-1 block text-xs text-slate-600" htmlFor="did">מזהה עסקה (לא חובה)</label>
            <input id="did" dir="ltr" value={dealId} onChange={(e) => setDealId(e.target.value)} className={inputCls} placeholder="D100124" />
          </div>
          <button type="submit" disabled={busy || (!message.trim() && !dealId.trim())} className={primaryBtn}>בדיקה</button>
          <span className="ms-auto text-xs text-slate-500">{message.length}/{MAX}</span>
        </div>
      </form>
      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="mb-2 text-xs text-slate-600">דוגמאות לתלונות:</p>
        <div className="flex flex-wrap gap-2">
          {examples.map((ex) => (
            <button key={ex} type="button" disabled={busy} onClick={() => { setMessage(ex); onSubmit({ message: ex }); }}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-start text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              {ex}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function ManualForm({ busy, onSubmit, message }: { busy: boolean; onSubmit: (b: Record<string, unknown>) => void; message: string }) {
  const [dealId, setDealId] = useState('');
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');
  const [field, setField] = useState('price');
  const [stated, setStated] = useState('');
  return (
    <Card title="מילוי ידני של הפרטים" tone="soft">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
        e.preventDefault();
        const n = Number(stated.replace(/,/g, ''));
        onSubmit({
          message, field,
          ...(dealId.trim() ? { deal_id: dealId.trim() } : {}),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(street.trim() ? { street: street.trim() } : {}),
          ...(stated.trim() && Number.isFinite(n) ? { stated_value: n } : {}),
        });
      }}>
        <div><label className="mb-1 block text-xs text-slate-600" htmlFor="m-did">מזהה עסקה</label>
          <input id="m-did" dir="ltr" className={inputCls} value={dealId} onChange={(e) => setDealId(e.target.value)} placeholder="D100124" /></div>
        <div><label className="mb-1 block text-xs text-slate-600" htmlFor="m-field">על מה הלקוח מתלונן</label>
          <select id="m-field" className={inputCls} value={field} onChange={(e) => setField(e.target.value)}>
            {Object.entries(fieldLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label className="mb-1 block text-xs text-slate-600" htmlFor="m-city">עיר (אם אין מזהה)</label>
          <input id="m-city" className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs text-slate-600" htmlFor="m-street">רחוב (אם אין מזהה)</label>
          <input id="m-street" className={inputCls} value={street} onChange={(e) => setStreet(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs text-slate-600" htmlFor="m-val">הסכום שהלקוח מציין (₪, לא חובה)</label>
          <input id="m-val" dir="ltr" inputMode="numeric" className={inputCls} value={stated} onChange={(e) => setStated(e.target.value)} /></div>
        <div className="flex items-end"><button type="submit" disabled={busy || (!dealId.trim() && !street.trim())} className={primaryBtn}>המשך עם הפרטים</button></div>
      </form>
    </Card>
  );
}

export function CandidatePicker({ candidates, busy, onPick }: { candidates: ProcessedDeal[]; busy: boolean; onPick: (id: string) => void }) {
  return (
    <Card title="בחרו את העסקה הנכונה">
      <ul className="divide-y divide-slate-100">
        {candidates.map((d) => (
          <li key={d.deal_id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <bdi className="font-medium text-indigo-800">{d.deal_id}</bdi>
            <span>{d.city}{d.neighborhood ? `, ${d.neighborhood}` : ''}{d.street ? `, ${d.street}` : ''}</span>
            <span className="text-slate-600">{d.rooms ?? '?'} חדרים · {d.size_sqm ?? '?'} מ&quot;ר · {d.deal_date ?? 'ללא תאריך'}</span>
            <span className="text-slate-600">₪{d.price_nis?.toLocaleString('en-US') ?? '—'}</span>
            <button type="button" disabled={busy} onClick={() => onPick(d.deal_id)} className="ms-auto rounded-md border border-indigo-300 px-3 py-1 text-indigo-800 hover:bg-indigo-50 disabled:opacity-50">בחירה</button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
