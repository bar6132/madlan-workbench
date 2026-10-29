import { statusLabel } from '@/lib/copy';

const STATUS_STYLE: Record<string, string> = {
  VALID: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  CONFLICT: 'bg-amber-50 text-amber-900 ring-amber-200',
  EXCLUDED: 'bg-red-50 text-red-900 ring-red-200',
};

export function StatusBadge({ status, flags = 0 }: { status: string; flags?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-800 ring-slate-300'}`}>
        {statusLabel[status] ?? status}
      </span>
      {flags > 0 && status === 'VALID' && <span className="text-xs text-slate-500">{flags} סימונים</span>}
    </span>
  );
}
