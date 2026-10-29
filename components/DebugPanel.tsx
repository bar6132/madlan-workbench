'use client';
import { inputCls } from './bits';
import type { ApiResponse } from '@/lib/view';

export type SimulateValue = 'NONE' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'INVALID_JSON';
const OPTIONS: SimulateValue[] = ['NONE', 'TIMEOUT', 'PROVIDER_ERROR', 'INVALID_JSON'];

export function DebugPanel(props: {
  res: ApiResponse | null;
  simulate: SimulateValue;
  simulateReply: SimulateValue;
  onSimulate: (v: SimulateValue) => void;
  onSimulateReply: (v: SimulateValue) => void;
}) {
  const r = props.res;
  const detail = r && 'timings_ms' in r ? { timings_ms: r.timings_ms, debug: r.debug, extraction: r.extraction } : {};
  return (
    <details open className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-slate-100" dir="ltr">
      <summary className="cursor-pointer text-sm font-semibold">Debug (R&amp;D)</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          Simulate extraction failure
          <select className={`${inputCls} mt-1 text-slate-900`} value={props.simulate} onChange={(e) => props.onSimulate(e.target.value as SimulateValue)}>
            {OPTIONS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        <label className="text-xs">
          Simulate reply-model failure
          <select className={`${inputCls} mt-1 text-slate-900`} value={props.simulateReply} onChange={(e) => props.onSimulateReply(e.target.value as SimulateValue)}>
            {OPTIONS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
      </div>
      {r && (
        <pre className="mt-3 overflow-x-auto text-xs text-slate-200">
          {JSON.stringify({ trace_id: r.trace_id, state: r.state, ...detail }, null, 1)}
        </pre>
      )}
    </details>
  );
}
