import { z } from 'zod';
import { analyze, MAX_MESSAGE_LENGTH } from '@/lib/analyze';
import { FieldSchema } from '@/lib/claim';
import { rateLimit } from '@/lib/rate-limit';
import { newTraceId, logEvent } from '@/lib/trace';

// Worst case: one extraction call plus two reply attempts, each capped by the LLM timeout.
export const maxDuration = 60;

const SimulateSchema = z.enum(['NONE', 'TIMEOUT', 'PROVIDER_ERROR', 'INVALID_JSON']);

const BodySchema = z.object({
  message: z.string().max(MAX_MESSAGE_LENGTH + 1).default(''),
  deal_id: z.string().max(40).optional(),
  picked_deal_id: z.string().max(40).optional(),
  field: FieldSchema.optional(),
  city: z.string().max(60).optional(),
  neighborhood: z.string().max(60).optional(),
  street: z.string().max(60).optional(),
  stated_value: z.number().finite().optional(),
  simulate: SimulateSchema.optional(),
  simulate_reply: SimulateSchema.optional(),
});

function json(body: object, status: number): Response {
  return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
  const trace_id = newTraceId();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';

  if (!rateLimit(ip).allowed) {
    logEvent({ trace_id, route: '/api/analyze', state: 'RATE_LIMITED' });
    return json(
      { state: 'RATE_LIMITED', trace_id, notices_he: ['בוצעו יותר מדי בקשות בדקה האחרונה. המתינו דקה ונסו שוב.'] },
      429,
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ state: 'ERROR', trace_id, notices_he: ['הבקשה אינה תקינה.'] }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ state: 'ERROR', trace_id, notices_he: ['הבקשה אינה תקינה.'] }, 400);
  }

  const debug = new URL(request.url).searchParams.get('debug') === '1';
  const { simulate, simulate_reply, ...rest } = parsed.data;
  try {
    const result = await analyze({
      ...rest,
      simulate: debug ? simulate : undefined,
      simulate_reply: debug ? simulate_reply : undefined,
    });
    return json(result, 200);
  } catch (err) {
    logEvent({ trace_id, route: '/api/analyze', state: 'ERROR', error_name: err instanceof Error ? err.name : 'unknown' });
    return json(
      { state: 'ERROR', trace_id, notices_he: ['אירעה תקלה. נסו שוב, ואם היא חוזרת העבירו לצוות הפיתוח את מזהה המעקב.'] },
      500,
    );
  }
}
