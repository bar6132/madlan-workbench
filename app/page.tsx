'use client';
import { useRef, useState, useSyncExternalStore } from 'react';
import { Banner } from '@/components/bits';
import { CandidatePicker, ComplaintForm, ManualForm } from '@/components/Forms';
import { DebugPanel, type SimulateValue } from '@/components/DebugPanel';
import { CorrectionProposal } from '@/components/CorrectionProposal';
import { suggestFixes } from '@/lib/correction-core';
import { ClaimCard, EscalationNote, MarketPanel, ReplyBox, VerdictEvidence } from '@/components/Results';
import { toView, type ApiResponse } from '@/lib/view';
import { debugEnabled } from '@/lib/debug';
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
  // The URL is the source of truth for ?debug=1 and ?deal=...; empty on the server, real value after hydration.
  const search = useSyncExternalStore(() => () => {}, () => window.location.search, () => '');
  const urlParams = new URLSearchParams(search);
  const debug = debugEnabled() && urlParams.get('debug') === '1';
  const presetDeal = (urlParams.get('deal') ?? '').slice(0, 12);
  const [lastMessage, setLastMessage] = useState('');
  const [simulate, setSimulate] = useState<SimulateValue>('NONE');
  const [simulateReply, setSimulateReply] = useState<SimulateValue>('NONE');


  async function run(body: Record<string, unknown>) {
    last.current = body;
    setLastMessage(String(body.message ?? ''));
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
  const message = lastMessage;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">מדלן-בדק</h1>
        <p className="text-sm text-slate-600">שולחן בירור תלונות: מדביקים הודעת לקוח, מקבלים בדיקה מול הנתונים, הוכחות ותשובה מוכנה.</p>
      </header>

      <ComplaintForm key={presetDeal} initialDealId={presetDeal} busy={busy} onSubmit={run} />

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
      {!busy && r && view?.showReply && <ReplyBox key={`reply-${r.trace_id}`} r={r} />}
      {!busy && r?.deal && view?.showVerdict && (
        <CorrectionProposal key={`correction-${r.trace_id}`} deal={r.deal} suggestions={suggestFixes(r.deal)} />
      )}
      {!busy && r?.escalation_note && view?.showEscalation && <EscalationNote note={r.escalation_note} />}
      {!busy && r?.market && view?.showMarket && <MarketPanel clean={r.market} raw={r.market_raw} />}

      {debug && (
        <DebugPanel res={res} simulate={simulate} simulateReply={simulateReply} onSimulate={setSimulate} onSimulateReply={setSimulateReply} />
      )}
    </main>
  );
}
