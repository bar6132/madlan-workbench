import { CorrectionSchema } from '@/lib/correction-core';
import { previewCorrection } from '@/lib/corrections';
import { getDeal } from '@/lib/data';
import { rateLimit } from '@/lib/rate-limit';
import { logEvent, newTraceId } from '@/lib/trace';

// Preview only: nothing is stored or written. The free text (reason, source) is never logged.
function json(body: object, status: number): Response {
  return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
  const trace_id = newTraceId();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  if (!rateLimit(ip).allowed) {
    logEvent({ trace_id, route: '/api/corrections/preview', state: 'RATE_LIMITED' });
    return json({ ok: false, trace_id, errors_he: ['בוצעו יותר מדי בקשות בדקה האחרונה. המתינו דקה ונסו שוב.'] }, 429);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, trace_id, errors_he: ['הבקשה אינה תקינה.'] }, 400);
  }
  const parsed = CorrectionSchema.safeParse(raw);
  if (!parsed.success) {
    const missingText = parsed.error.issues.some((i) => i.path[0] === 'reason' || i.path[0] === 'source_of_info');
    return json({
      ok: false, trace_id,
      errors_he: [missingText ? 'יש למלא סיבה ומקור למידע (לפחות כמה מילים): תיקון בלי מקור אינו נבדק.' : 'הנתונים שהוזנו אינם תקינים. בדקו שהערך החדש הוא מספר שלם.'],
    }, 422);
  }

  try {
    const c = parsed.data;
    const deal = getDeal(c.deal_id);
    if (!deal) return json({ ok: false, trace_id, errors_he: ['העסקה לא נמצאה בקובץ.'] }, 404);
    const r = previewCorrection(deal, c, trace_id);
    logEvent({ trace_id, route: '/api/corrections/preview', deal_id: c.deal_id, field: c.field, outcome: r.ok ? 'PREVIEW' : 'REJECTED' });
    return r.ok ? json({ ok: true, trace_id, preview: r.preview }, 200) : json({ ok: false, trace_id, errors_he: r.errors_he }, 422);
  } catch (err) {
    logEvent({ trace_id, route: '/api/corrections/preview', state: 'ERROR', error_name: err instanceof Error ? err.name : 'unknown' });
    return json({ ok: false, trace_id, errors_he: ['אירעה תקלה. נסו שוב, ואם היא חוזרת העבירו לצוות הפיתוח את מזהה המעקב.'] }, 500);
  }
}
