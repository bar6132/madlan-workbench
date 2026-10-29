import type { AnalyzeResult } from './analyze';

export interface ErrorResponse {
  state: 'RATE_LIMITED' | 'ERROR';
  notices_he: string[];
  trace_id: string;
}
export type ApiResponse = AnalyzeResult | ErrorResponse;

export interface ViewState {
  banner?: { kind: 'info' | 'warn' | 'error'; text_he: string };
  showManualForm: boolean;
  showPicker: boolean;
  showVerdict: boolean;
  showReply: boolean;
  replyLabel_he: 'טיוטה שנוצרה ב-AI' | 'תבנית מוכנה' | null;
  showEscalation: boolean;
  showMarket: boolean;
}

const NONE: ViewState = {
  showManualForm: false, showPicker: false, showVerdict: false, showReply: false,
  replyLabel_he: null, showEscalation: false, showMarket: false,
};

export function toView(r: ApiResponse): ViewState {
  const notices = r.notices_he.join(' ');
  switch (r.state) {
    case 'RATE_LIMITED':
    case 'ERROR':
      return { ...NONE, banner: { kind: 'error', text_he: `${notices} (מזהה מעקב: ${r.trace_id})` } };
    case 'INVALID_INPUT':
      return { ...NONE, banner: { kind: 'warn', text_he: notices } };
    case 'OUT_OF_SCOPE':
      return { ...NONE, showReply: true, replyLabel_he: 'תבנית מוכנה', banner: { kind: 'warn', text_he: notices } };
    case 'MANUAL_NEEDED':
      return { ...NONE, showManualForm: true, banner: { kind: 'warn', text_he: notices } };
    case 'AMBIGUOUS':
      return {
        ...NONE, showPicker: true,
        banner: { kind: 'info', text_he: ['נמצאו כמה עסקאות שמתאימות לתיאור. בחרו את העסקה הנכונה כדי להמשיך.', notices].filter(Boolean).join(' ') },
      };
    case 'NOT_FOUND':
    case 'RESOLVED': {
      const notFound = r.state === 'NOT_FOUND';
      return {
        showManualForm: false, showPicker: false,
        showVerdict: !!r.facts,
        showReply: !!r.reply,
        replyLabel_he: r.reply ? (r.reply.source === 'LLM' ? 'טיוטה שנוצרה ב-AI' : 'תבנית מוכנה') : null,
        showEscalation: !!r.escalation_note,
        showMarket: !notFound && !!r.market,
        banner: notFound
          ? { kind: 'warn', text_he: ['לא נמצאה עסקה כזו בקובץ הנתונים.', notices].filter(Boolean).join(' ') }
          : notices ? { kind: 'info', text_he: notices } : undefined,
      };
    }
  }
}
