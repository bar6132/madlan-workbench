'use client';
import { useState, type ReactNode } from 'react';

import { fmt } from '@/lib/format';
export { fmt };

export function Card({ title, children, id, tone }: { title?: string; children: ReactNode; id?: string; tone?: 'plain' | 'soft' }) {
  return (
    <section id={id} className={`rounded-xl border border-slate-200 p-4 sm:p-5 ${tone === 'soft' ? 'bg-slate-50' : 'bg-white'} shadow-sm`}>
      {title && <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>}
      {children}
    </section>
  );
}

export function Banner({ kind, text }: { kind: 'info' | 'warn' | 'error'; text: string }) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
    error: 'border-red-300 bg-red-50 text-red-900',
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {text}
    </div>
  );
}

export function CopyButton({ text, label = 'העתקה' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  }
  return (
    <button type="button" onClick={copy} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100">
      {done ? 'הועתק ✓' : label}
    </button>
  );
}

export function DealChip({ id }: { id: string }) {
  return (
    <button
      type="button"
      onClick={() => document.getElementById('evidence')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
      className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-sm font-medium text-indigo-900 ring-1 ring-indigo-200 hover:bg-indigo-100"
    >
      <bdi>{id}</bdi>
    </button>
  );
}

export const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';
export const primaryBtn =
  'rounded-md bg-indigo-700 px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50';
