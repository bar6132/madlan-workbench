'use client';
import { useEffect, useRef, useState } from 'react';
import { Banner } from '@/components/bits';
import { CandidatePicker, ComplaintForm, ManualForm } from '@/components/Forms';
import { DebugPanel, type SimulateValue } from '@/components/DebugPanel';
import { ClaimCard, EscalationNote, MarketPanel, ReplyBox, VerdictEvidence } from '@/components/Results';
import { toView, type ApiResponse } from '@/lib/view';
import type { AnalyzeResult } from '@/lib/analyze';

const CLIENT_TIMEOUT_MS = 70_000;
const NETWORK_ERROR: ApiResponse = {
  state: 'ERROR', trace_id: 'לא זמין',
  notices_he: ['לא הצלחנו להתחבר לשרת או שהבקשה ארכה זמן רב מדי. בדקו את החיבור ונסו שוב.'],
};

export default function Home() {
  const [res, setRes] = useState<ApiResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const last = useRef<Record<string, unknown>>({});
  const [debug, setDebug] = useState(false);
  const [simulate, setSimulate] = useState<SimulateValue>('NONE');
  const [simulateReply, setSimulateReply] = useState<SimulateValue>('NONE');

  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).get('debug') === '1');
  }, []);

  async function run(body: Record<string, unknown>) {
    last.current = body;
    setBusy(true);
    setElapsed(0);
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    const ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS);
    try {
      const r = await fetch(`/api/analyze${debug ? '?debug=1' : ''}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(debug ? { ...body, simulate, simulate_reply: simulateReply } : body), signal: ctrl.signal,
      });
      setRes((await r.json()) as ApiResponse);
    } catch {
      setRes(NETWORK_ERROR);
    } finally {
      clearTimeout(kill);
      clearInterval(tick);
      setBusy(false);
    }
  }

  const view = res ? toView(res) : null;
  const r = res && 'facts' in res ? (res as AnalyzeResult) : null;
  const message = String(last.current.message ?? '');

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">מדלן-בדק</h1>
        <p className="text-sm text-slate-600">שולחן בירור תלונות: מדביקים הודעת לקוח, מקבלים בדיקה מול הנתונים, הוכחות ותשובה מוכנה.</p>
      </header>

      <ComplaintForm busy={busy} onSubmit={run} />

      {busy && (
        <div role="status" className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          בודקים מול הנתונים… {elapsed} שניות
        </div>
      )}

      {!busy && view?.banner && <Banner kind={view.banner.kind} text={view.banner.text_he} />}
      {!busy && view?.showManualForm && <ManualForm busy={busy} message={message} onSubmit={run} />}
      {!busy && view?.showPicker && r && (
        <CandidatePicker candidates={r.candidates} busy={busy} onPick={(id) => run({ ...last.current, picked_deal_id: id })} />
      )}
      {!busy && r && view?.showVerdict && (
        <>
          <ClaimCard r={r} busy={busy} onField={(f) => run({ ...last.current, field: f })} />
          <VerdictEvidence r={r} />
        </>
      )}
      {!busy && r && view?.showReply && <ReplyBox key={r.trace_id} r={r} />}
      {!busy && r?.escalation_note && view?.showEscalation && <EscalationNote note={r.escalation_note} />}
      {!busy && r?.market && view?.showMarket && <MarketPanel clean={r.market} raw={r.market_raw} />}

      {debug && (
        <DebugPanel res={res} simulate={simulate} simulateReply={simulateReply} onSimulate={setSimulate} onSimulateReply={setSimulateReply} />
      )}
    </main>
  );
}
