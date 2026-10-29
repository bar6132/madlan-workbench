# Madlan Dispute Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public Hebrew RTL web app where a CSM pastes a customer complaint and gets a verified verdict, evidence, a guarded reply draft and an escalation note.

**Architecture:** An offline Python (pandas) pipeline cleans the CSV into `data/deals.processed.json`. A Next.js app loads that file, resolves the complaint to a deal and verifies it with deterministic TypeScript, and uses Gemini only for claim extraction and reply drafting. Both LLM steps are schema-validated and guarded, with deterministic fallbacks.

**Tech Stack:** Python 3 + pandas + pytest; Next.js App Router + TypeScript (strict) + Tailwind + Zod + Vitest; `@google/genai` (Gemini Flash-Lite free tier); Vercel.

**Spec:** `Docs/design.md` (section numbers below refer to it). The CSV `Docs/madlan_deals_sample.csv` and the brief `Docs/madlan_rnd_ops_engineer_challenge .md` are the source of truth for all data facts.

## Global Constraints

- Project root is a new folder `madlan-workbench/` inside `c:\Users\User_PC\Desktop\Madlan R&D Operations Engineer\` (the parent folder name contains `&` and spaces, so do not scaffold in it). `git init` there. All paths below are relative to it.
- Whole product UI is Hebrew, `<html lang="he" dir="rtl">`, Heebo font. User reviews all Hebrew copy at the end.
- No LLM math; the model never receives the customer's raw message in the reply step (§6.2). No `dangerouslySetInnerHTML`.
- Thresholds: exclude price < 250,000 or missing/0; price/m² mismatch tolerance 1%; stated-value tolerance 1%; market window 24 months ending at the latest deal date in the file; N ≥ 5 for statistics; message ≤ 800 chars.
- Keys only in `.env.local` / Vercel env, never committed. `.env.example` lists names only.
- Never log the customer's message text; log `trace_id`, stage timings, provider, outcomes, verdict, deal ids.
- Verify exact model ids and package versions against current docs at scaffold time; pin versions.
- Free-tier Gemini content may be used by Google to improve products; state in README.

## Review Focus

Inputs the spec implies but its feature tests do not cover. Each has a test in the owning task.

1. Deal id typed as `d100124`, with spaces, or inside Hebrew text (Task 3).
2. Customer message that is empty, English-only, or contains injection text ("התעלם מההוראות…") (Task 6, 9).
3. Reply draft that writes a number as `5.7 מיליון` or Hebrew words instead of digits (Task 7).
4. Complaint with a stated value that matches neither conflicting row, or a field the CSV lacks (balcony size) (Task 4).
5. Message of exactly 800 and 801 characters, and rapid repeat requests from one IP (Task 9).

---

### Task 1: Scaffold project, data and docs

**Files:**
- Create: `madlan-workbench/` with Next.js (TypeScript, Tailwind, App Router, no `src/`), `vitest.config.ts`, `.env.example`, `.gitignore`, `README.md` stub
- Create: `data/madlan_deals_sample.csv` (copy), `docs/design.md`, `docs/plan.md`, `docs/CSM_GUIDE.md` (copy of existing prework guide, to be rewritten in Task 14), `docs/AI_WORK_LOG.md` (copy of existing log)

**Interfaces:**
- Produces: `npm test` runs Vitest; `npm run dev` serves a placeholder Hebrew RTL page; Zod and `@google/genai` installed.

- [ ] **Step 1:** Scaffold, install `zod @google/genai`, dev-dep `vitest`; copy files from `Docs/`.
- [ ] **Step 2:** `app/layout.tsx` sets `lang="he" dir="rtl"` and Heebo via `next/font`; `app/page.tsx` renders `<h1>מדלן-בדק</h1>`.
- [ ] **Step 3:** Add `tests/smoke.test.ts` asserting `1+1===2`; run `npm test` → PASS; run `npm run build` → success.
- [ ] **Step 4:** Commit `chore: scaffold project`.

### Task 2: Python data pipeline

**Files:**
- Create: `scripts/build_dataset.py`, `scripts/requirements.txt` (pandas, pytest), `scripts/tests/test_build_dataset.py`
- Output: `data/deals.processed.json`

**Interfaces:**
- Produces JSON `{ summary, deals: ProcessedDeal[] }`, UTF-8, Hebrew not escaped. `ProcessedDeal` (exact keys): `deal_id`, `status` (`VALID|CONFLICT|EXCLUDED`), `include_in_stats` (bool), `city` (canonical), `raw_city`, `neighborhood|null`, `street|null`, `property_type`, `rooms|null`, `size_sqm|null`, `floor|null`, `total_floors|null`, `year_built|null`, `condition|null`, `has_elevator|has_parking|has_balcony|has_safe_room` (`bool|null`), `deal_date|null` (`YYYY-MM-DD`, or `YYYY-MM` when month-only), `date_precision` (`day|month`), `price_nis|null`, `csv_price_per_sqm|null`, `calculated_ppsm|null`, `source`, `flags: string[]`, `explanations_he: string[]`, `raw_rows: RawRow[]`, `primary_row_index` (index into `raw_rows`), `primary_reason` (`SINGLE|EXACT_DUP|PPSM_MATCH|SOURCE_ORDER`). `RawRow`: `{ row_index, source, price_nis_raw, price_nis|null, csv_price_per_sqm|null, deal_date_raw }`.
- Flag ids: `EXACT_DUPLICATE, SOURCE_CONFLICT, PPSM_MISMATCH, PRICE_INVALID, PRICE_BELOW_THRESHOLD, TIMELINE_CONTRADICTION, NEW_BUILD_OLD_YEAR, PPSM_OUTLIER, CITY_NORMALIZED, MONTH_ONLY_DATE, MISSING_SIZE`.
- `summary`: `{ raw_rows, deals, cities, exact_duplicates, conflicts, excluded, ppsm_mismatch_raw_rows, month_only_dates, latest_deal_date }`.

- [ ] **Step 1: Write failing tests** in `test_build_dataset.py` using the real CSV, asserting: `summary.raw_rows==530`, `deals==520`, `cities==18`, `exact_duplicates==6`, `conflicts==4`, `excluded==2`, `ppsm_mismatch_raw_rows==29`, `month_only_dates==26`; set of cities equals the 18 names in §4; property types equal the six in §4 (no padding); `D100124` primary price 5727000 / source `רשות המסים` / `primary_reason=="PPSM_MATCH"` and the other raw row 5429440; `D100017` primary 1919000 Tax; `D100032` primary 5141000 source `בעל נכס`; `D100303` primary 6064000 `בעל נכס`; `D100313` `calculated_ppsm==80628`, `csv_price_per_sqm==58234`, flag `PPSM_MISMATCH`; `D100251` and `D100317` `status=="EXCLUDED"`, `include_in_stats==False`; `TIMELINE_CONTRADICTION` flagged set equals `{D100056,D100415,D100212,D100378,D100244}`; `NEW_BUILD_OLD_YEAR` count 83; `D100001` and `D100193` flagged `PPSM_OUTLIER` and total outliers ≤ 10; `D100017.deal_date=="2025-06-15"`, `D100303.deal_date=="2024-02-26"`; `D100311.has_parking is None`; every `has_*` is `True/False/None`; day-first holds (no parsed date has month > 12).
- [ ] **Step 2:** Run `pytest scripts/tests -v` → FAIL (script missing).
- [ ] **Step 3: Implement `build(csv_path: str, out_path: str) -> dict` in `scripts/build_dataset.py`** following §6.1 and §4 exactly: trim all strings; city map to 18 names (include hyphen/space/`ב"ש`/`ת"א`/English variants); parse prices (strip `₪`, commas, quotes), rooms via regex, booleans three-state, dates day-first with month-name → `YYYY-MM`; recompute ppsm = `round(price/size)`; group by `deal_id`; exact duplicates collapse; conflicts choose primary by ppsm match, else source order Tax > broker > owner (`primary_reason` says which); exclusion and flag rules from §6.1; outlier rule = per-city Tukey fence on valid `calculated_ppsm`, `k` tuned until the two named outliers are flagged and the count stays ≤ 10; Hebrew `explanations_he` per flag, plain language, no causes. `__main__` runs it with default paths and accepts an optional `--out <path>` (Task 3's stale check uses it).
- [ ] **Step 4:** Run `python scripts/build_dataset.py` then `pytest scripts/tests -v` → PASS. Spot-check three explanation strings by eye.
- [ ] **Step 5:** Commit `feat: python data pipeline and processed dataset`.

### Task 3: TypeScript data layer and resolver

**Files:**
- Create: `lib/types.ts`, `lib/data.ts`, `lib/resolver.ts`, `tests/data.test.ts`, `tests/resolver.test.ts`

**Interfaces:**
- `lib/types.ts`: Zod schemas and inferred types `ProcessedDeal`, `RawRow`, `Dataset` mirroring Task 2 keys exactly.
- `lib/data.ts`: `loadDataset(): Dataset` (reads and Zod-validates `data/deals.processed.json`, cached); `getDeal(id: string): ProcessedDeal | undefined`.
- `lib/resolver.ts`: `normalizeDealId(input: string): string | null` (accepts `d100124`, ` D100 124 `, ids inside text → `D100124`); `resolve(q: { deal_ids: string[]; city?: string; neighborhood?: string; street?: string; stated_value?: number|null }): Resolution` where `Resolution = {kind:'FOUND', deal:ProcessedDeal} | {kind:'AMBIGUOUS', candidates:ProcessedDeal[]} | {kind:'NOT_FOUND'}`.

- [ ] **Step 1: Write failing tests:** dataset loads and has 520 deals; **stale check:** re-running `build()` (via `python scripts/build_dataset.py --out <tmp>` through `child_process`) produces JSON deep-equal to the committed file; `normalizeDealId('d100124')==='D100124'`, `' D100 124 '`→same, `'שלום'`→`null`, `'בדקו את d100313 בבקשה'`→`'D100313'`; `resolve` with unknown id → NOT_FOUND; known id → FOUND; a real (city, street) pair from the dataset having ≥2 deals (find it in the test by grouping) → AMBIGUOUS with those candidates; city alias `'ת"א'` resolves like canonical (use shared alias map exported from `lib/data.ts`); excluded deals are still found.
- [ ] **Step 2:** Run `npm test` → FAIL.
- [ ] **Step 3:** Implement per signatures. Resolution order: ids first, else city+street(+neighborhood), narrowed by `stated_value` ±1% against any raw row price; never pick when more than one remains.
- [ ] **Step 4:** Run `npm test` → PASS. Commit `feat: dataset loader and deal resolver`.

### Task 4: Verifier

**Files:**
- Create: `lib/verifier.ts`, `lib/copy.ts` (Hebrew strings), `tests/verifier.test.ts`

**Interfaces:**
- Consumes: `ProcessedDeal`, `Resolution` (Task 3).
- Produces: `type Field = 'price'|'price_per_sqm'|'size'|'date'|'rooms'|'two_prices'|'other'`; `type Verdict = 'RAW_VALUE_WRONG'|'RAW_VALUE_OK'|'SOURCES_CONFLICT'|'CANNOT_DETERMINE'|'DEAL_NOT_FOUND'`; `verifyClaim(deal: ProcessedDeal | undefined, field: Field, stated_value?: number|null): VerifiedFacts` where `VerifiedFacts = { verdict, field, deal_id: string|null, rule_ids: string[], facts_he: string[], allowed_numbers: number[], allowed_deal_ids: string[], rows: RawRow[], conflict?: { primary: {source:string; price:number}, other: {source:string; price:number}, reason_he: string } }`.

- [ ] **Step 1: Write failing tests** (§5.1 table, §14 rules): `D100313`+`price_per_sqm` → `RAW_VALUE_WRONG`, `allowed_numbers` contains 10401000, 129, 58234, 80628; `D100251`+`price` → `RAW_VALUE_WRONG`; `D100317`+`price` → `RAW_VALUE_WRONG`; `D100124`+`two_prices` → `SOURCES_CONFLICT`, conflict primary 5727000 vs other 5429440, `facts_he` includes the "price/m² matches this report" reason; `D100124`+`price` with `stated_value=5429440` → `SOURCES_CONFLICT`, rule `STATED_MATCHES_NONPRIMARY`; `D100124`+`price` with `stated_value=1234567` → verdict unchanged and `facts_he` contains "הערך שצוין אינו מופיע בנתונים"; `D100032`+`two_prices` → conflict reason mentions no Tax Authority row (sources owner/broker only); a clean VALID deal with no flags+`price` → `RAW_VALUE_OK` and text containing "אינם מאפשרים לקבוע אם המחיר סביר"; `D100223`+`size` (missing size) → `CANNOT_DETERMINE`; any deal+`other` → `CANNOT_DETERMINE`; `undefined` deal → `DEAL_NOT_FOUND`; `facts_he` never contains the words altered/"שונה" cause-words from the banned list in Task 7.
- [ ] **Step 2:** Run `npm test` → FAIL.
- [ ] **Step 3:** Implement as a table of rules per field returning rule ids; all Hebrew strings in `lib/copy.ts`.
- [ ] **Step 4:** Run `npm test` → PASS. Commit `feat: deterministic claim verifier`.

### Task 5: Market context

**Files:** Create `lib/market.ts`, `tests/market.test.ts`

**Interfaces:** `marketContext(deal: ProcessedDeal, opts?: { raw?: boolean }): MarketContext` where `MarketContext = { scope_he: string; window: {from:string; to:string}; n: number; stats: { median_price:number; median_ppsm:number; p25_price:number; p75_price:number } | null; reason_he?: string; basis: 'CLEAN'|'RAW' }`.

- [ ] **Step 1: Write failing tests:** window ends at `summary.latest_deal_date` and starts 24 months earlier; `n<5` → `stats===null` and `reason_he` contains "אין מספיק עסקאות להשוואה"; excluded deals never counted in CLEAN; CONFLICT deal counts once (primary row); month-only dates count by calendar month; `raw:true` includes excluded rows and sets `basis:'RAW'`; for חולון 4 rooms with default window, n equals a count computed independently in the test from the JSON.
- [ ] **Step 2–4:** Run → FAIL; implement scope = same city + same neighborhood if it has n≥5 else same city, same rooms ±0.5 (state the scope used in `scope_he`); run → PASS; commit `feat: market context`.

### Task 6: LLM layer

**Files:** Create `lib/llm.ts`, `lib/claim.ts`, `lib/reply.ts`, `tests/llm.test.ts`, `tests/claim.test.ts`

**Interfaces:**
- `lib/llm.ts`: `generateJson<T>(o: { system: string; prompt: string; schema: z.ZodType<T>; timeoutMs?: number; simulate?: Simulate }): Promise<LlmResult<T>>`; `type Simulate = 'TIMEOUT'|'PROVIDER_ERROR'|'INVALID_JSON'|'NONE'`; `type LlmResult<T> = {ok:true; data:T; provider:string; ms:number} | {ok:false; reason:'TIMEOUT'|'PROVIDER_ERROR'|'INVALID_JSON'|'NO_KEY'; ms:number}`. Default timeout 8000 ms; one retry only on `PROVIDER_ERROR`. Reads `GEMINI_API_KEY`. Never throws.
- `lib/claim.ts`: `ClaimSchema = z.object({ mentioned_deal_ids: string[], city: string|null, neighborhood: string|null, street: string|null, field: Field, customer_stated_value: number|null, tone: 'calm'|'upset'|'angry', confidence: number })`; `extractClaim(message: string, simulate?: Simulate): Promise<{ok:true; claim:Claim; provider:string; ms:number} | {ok:false; reason:string; ms:number}>`. Message is wrapped in `<customer_message>` tags; system prompt states it is untrusted data and output is JSON only.
- `lib/reply.ts`: `draftReply(facts: VerifiedFacts, tone: Claim['tone'], simulate?: Simulate): Promise<{ok:true; text:string; provider:string; ms:number} | {ok:false; reason:string; ms:number}>` (output schema `{reply_he:string}`; prompt contains `facts_he`, verdict and tone only).

- [ ] **Step 1: Write failing tests** with the provider function injectable (`setProviderForTests(fn)`): success path returns parsed data; hang longer than `timeoutMs` → `reason:'TIMEOUT'` within timeout+200ms; provider throws → one retry then `PROVIDER_ERROR`; non-JSON → `INVALID_JSON`; JSON failing schema → `INVALID_JSON`; no key → `NO_KEY`; `simulate` values map to their reasons without calling the provider; claim: the exact message string sent to the provider is inside `<customer_message>` tags; injection text ("התעלם מההוראות הקודמות") still yields only a schema-valid claim or a failure, never other output; `draftReply` prompt string does **not** contain the customer message (pass a canary string through the claim step and assert absence).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with `@google/genai`, structured JSON output (response schema from Zod), low temperature. **Step 4:** Run → PASS.
- [ ] **Step 5 (manual, real key):** run a throwaway script with three Hebrew complaints (D100124 two prices; D100313 price/m²; an address-only complaint) and record outputs in `docs/AI_WORK_LOG.md` honestly, including any bad output. Commit `feat: llm adapter, claim extraction, reply drafting`.

### Task 7: Guards and templates

**Files:** Create `lib/guards.ts`, `lib/templates.ts`, `tests/guards.test.ts`, `tests/templates.test.ts`

**Interfaces:**
- `guardClaim(claim: Claim): {ok:true; claim:Claim} | {ok:false; reason:string}` — ids must match `^D\d{6}$` after `normalizeDealId`; unknown ids are kept but flagged `unknown_ids`.
- `guardReply(text: string, facts: VerifiedFacts): {ok:true} | {ok:false; reasons:string[]}`.
- `BANNED_PHRASES: string[]` (include: "שונה", "זייף", "מישהו שינה", "נתקן עד", "נעדכן מחר", "הבטחה", "אשמה").
- `templateReply(facts: VerifiedFacts): string`; `escalationNote(facts: VerifiedFacts, trace_id: string): string`.

- [ ] **Step 1: Write failing tests:** `guardReply` rejects invented id `D100999`; rejects a number not in `allowed_numbers` (e.g. 5300000 when facts say 5429440/5727000); accepts `5,727,000`, `₪5,727,000`, `5727000`; **rejects `5.7 מיליון`** and `"שלושה מיליון"` (mixed forms not supported); rejects each banned phrase; accepts a reply using only allowed numbers/ids. `templateReply` for each of the 5 verdicts contains only allowed numbers (run through `guardReply`), is Hebrew, and mentions both figures for `SOURCES_CONFLICT`. `escalationNote` contains trace id, deal id, rule ids and the line saying what is unknown.
- [ ] **Step 2–4:** Run → FAIL; implement numeral extraction (regex over digits with separators, strip `₪`, percent handled) and number-word rejection; run → PASS. Commit `feat: reply guard, templates, escalation note`.

### Task 8: Orchestrator

**Files:** Create `lib/analyze.ts`, `lib/trace.ts`, `tests/analyze.test.ts`

**Interfaces:**
- `lib/trace.ts`: `newTraceId(): string` (`trc_` + 8 hex); `logEvent(e: Record<string, unknown>): void` (single-line JSON to stdout; throws if `message` or `reply_text` key present).
- `lib/analyze.ts`: `analyze(input: { message: string; deal_id?: string; picked_deal_id?: string; simulate?: Simulate }): Promise<AnalyzeResult>`; `AnalyzeResult = { trace_id; state: 'RESOLVED'|'AMBIGUOUS'|'NOT_FOUND'|'MANUAL_NEEDED'|'INVALID_INPUT'; claim: Claim|null; extraction: 'LLM'|'MANUAL'|'FAILED'; candidates: ProcessedDeal[]; deal: ProcessedDeal|null; facts: VerifiedFacts|null; evidence_rows: RawRow[]; market: MarketContext|null; reply: { text:string; source:'LLM'|'TEMPLATE'; guard_failures:string[] }|null; escalation_note: string|null; notices_he: string[]; timings_ms: Record<string, number> }`.

- [ ] **Step 1: Write failing tests** (LLM mocked): happy path D100124 two-prices → `RESOLVED`, verdict `SOURCES_CONFLICT`, reply source `LLM`; reply guard fails twice → reply source `TEMPLATE` with `guard_failures`; extraction `TIMEOUT` with `deal_id` field filled → `extraction:'MANUAL'`, state `RESOLVED`, template reply; extraction fails and no id → `MANUAL_NEEDED`; ambiguous address → `AMBIGUOUS` with candidates and no facts; unknown id → `NOT_FOUND`; `picked_deal_id` skips ambiguity; empty message and no id → `INVALID_INPUT`; message of 800 chars OK, 801 → `INVALID_INPUT`; English-only message with no id → `MANUAL_NEEDED` (not an error); `CANNOT_DETERMINE` verdict produces an escalation note; `logEvent` never contains the message text (spy on stdout, canary string).
- [ ] **Step 2–4:** Run → FAIL; implement stage-by-stage per §5.1, timing each stage; run → PASS. Commit `feat: analysis orchestrator`.

### Task 9: API route, rate limit, safe errors

**Files:** Create `app/api/analyze/route.ts`, `lib/rate-limit.ts`, `tests/api.test.ts`

**Interfaces:** `POST /api/analyze` body validated by Zod (`message` string ≤800, `deal_id?`, `picked_deal_id?`, `simulate?` honored only when `?debug=1` query present); returns `AnalyzeResult` JSON with HTTP 200 for every handled state, 400 for invalid JSON body, 429 body `{ state:'RATE_LIMITED', notices_he:[…], trace_id }`, 500 body `{ state:'ERROR', notices_he:['אירעה תקלה. נסו שוב או העבירו לצוות הפיתוח עם מזהה המעקב.'], trace_id }` with no stack. `export const maxDuration` set so it exceeds the model timeout (verify Vercel limit). `rateLimit(ip: string, now?: number): {allowed:boolean}` — sliding window 15 requests/minute/IP, in memory (best effort).

- [ ] **Step 1: Write failing tests:** 16th request in a minute from one IP → 429 shape; other IP unaffected; non-JSON body → 400; thrown error inside `analyze` (mock) → 500 shape with no `stack` or error text; `simulate` ignored without `?debug=1`.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS. Commit `feat: analyze api route`.

### Task 10: Hebrew RTL interface

**Files:** Create `app/page.tsx` (client), `components/` (`ComplaintForm`, `ClaimCard`, `CandidatePicker`, `VerdictEvidence`, `ReplyBox`, `EscalationNote`, `MarketPanel`, `DealChip`), `lib/view.ts`, `tests/view.test.ts`

**Interfaces:** `toView(r: AnalyzeResult | {state:'RATE_LIMITED'|'ERROR'; notices_he:string[]; trace_id:string}): ViewState` — a pure function returning which sections show (`{ banner?: {kind:'info'|'warn'|'error'; text_he:string}; showManualForm: boolean; showPicker: boolean; showVerdict: boolean; showReply: boolean; replyLabel_he: 'טיוטה שנוצרה ב-AI'|'תבנית מוכנה'|null; showEscalation: boolean; showMarket: boolean }`).

- [ ] **Step 1: Write failing tests** for `toView` across all states: `MANUAL_NEEDED` shows manual form and banner "הבנת התלונה אוטומטית אינה זמינה כרגע"; `AMBIGUOUS` shows picker only; `NOT_FOUND` shows banner; `RESOLVED` with template reply labels `תבנית מוכנה`; `CANNOT_DETERMINE` shows escalation; rate-limited and error states show banner with trace id and no other sections.
- [ ] **Step 2–4:** Run → FAIL; implement `toView` then components with Tailwind logical utilities; order per §7; loading state with elapsed seconds counter; five example-complaint chips from §14; copy buttons for reply and escalation; deal ids as chips that scroll to the evidence row; evidence panel shows raw row(s) beside cleaned values, source badge, rule text, and labels "חושב" vs "הנחה"; market panel toggle raw/clean labeled as illustration; phone-width layout.
- [ ] **Step 5 (manual):** run `npm run dev`, walk the five demo complaints at desktop and 390px width, confirm RTL punctuation and no overflow. Commit `feat: hebrew rtl interface`.

### Task 11: Debug panel and failure simulator

**Files:** Create `components/DebugPanel.tsx`; modify `app/page.tsx`

- [ ] **Step 1:** Show the panel only when URL has `?debug=1`: last `trace_id`, per-stage timings, provider, guard failures, and a select for `Simulate` (`NONE|TIMEOUT|PROVIDER_ERROR|INVALID_JSON`) sent with `?debug=1`.
- [ ] **Step 2 (manual):** with each simulate option confirm: TIMEOUT/PROVIDER_ERROR on extraction → manual form with the right banner; on reply → template reply; INVALID_JSON same; no spinner stuck longer than the timeout. Commit `feat: debug panel and failure simulator`.

### Task 12: Real-model Hebrew quality pass and e2e smoke

**Files:** Create `tests/e2e-smoke.test.ts` (calls `POST /api/analyze` on the dev server with the mocked provider env flag), update `docs/AI_WORK_LOG.md`

- [ ] **Step 1:** With the real key, run the five demo complaints plus three unscripted ones in Hebrew slang; record any extraction miss or reply the guard rejected, and adjust prompts only (not guards).
- [ ] **Step 2:** Smoke test: D100124 complaint returns `RESOLVED`, `SOURCES_CONFLICT`, reply contains `5,727,000` and `5,429,440` digits only; run `npm test` fully → all PASS. Commit `test: e2e smoke and prompt tuning`.

### Task 13: Deploy

**Files:** Modify `README.md`, add `vercel.json` only if `maxDuration` needs it

- [ ] **Step 1:** Push to GitHub, connect Vercel, set `GEMINI_API_KEY` in Vercel env; confirm build uses committed `deals.processed.json` (no Python at runtime).
- [ ] **Step 2:** Open the public URL; run the five demo complaints and one forced failure (`?debug=1` TIMEOUT); confirm a trace id appears in Vercel logs and no message text is logged. Record the URL in the README.

### Task 14: Deliverables

**Files:** Rewrite `docs/CSM_GUIDE.md` (one Hebrew page: what the app does, what it cannot do, how to read each verdict, a customer reply for "המספר הזה שגוי", when to escalate and how to copy the trace id; no English section); complete `README.md` (setup, assumptions §14, what was cut §10, rate-limit and log-retention caveats, free-tier data note); finish `docs/AI_WORK_LOG.md` (real events only: three prior catches, the doc-audit findings from this session, anything from Tasks 6 and 12); `docs/DEMO_SCRIPT.md` (the customer-moment walkthrough with the five complaints).

- [ ] **Step 1:** Write all four documents from the app's real behavior; user reviews Hebrew copy.
- [ ] **Step 2:** Final `npm test`, `pytest scripts/tests`, `npm run build` all pass; commit `docs: csm guide, readme, ai log, demo script`.
