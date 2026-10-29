import { z } from 'zod';

export const RawRowSchema = z.object({
  row_index: z.number(),
  source: z.string(),
  price_nis_raw: z.string(),
  price_nis: z.number().nullable(),
  csv_price_per_sqm: z.number().nullable(),
  deal_date_raw: z.string(),
});
export type RawRow = z.infer<typeof RawRowSchema>;

const nullableBool = z.boolean().nullable();

export const ProcessedDealSchema = z.object({
  deal_id: z.string(),
  status: z.enum(['VALID', 'CONFLICT', 'EXCLUDED']),
  include_in_stats: z.boolean(),
  city: z.string(),
  raw_city: z.string(),
  neighborhood: z.string().nullable(),
  street: z.string().nullable(),
  property_type: z.string(),
  rooms: z.number().nullable(),
  size_sqm: z.number().nullable(),
  floor: z.number().nullable(),
  total_floors: z.number().nullable(),
  year_built: z.number().nullable(),
  condition: z.string().nullable(),
  has_elevator: nullableBool,
  has_parking: nullableBool,
  has_balcony: nullableBool,
  has_safe_room: nullableBool,
  deal_date: z.string().nullable(),
  date_precision: z.enum(['day', 'month']),
  price_nis: z.number().nullable(),
  csv_price_per_sqm: z.number().nullable(),
  calculated_ppsm: z.number().nullable(),
  source: z.string(),
  flags: z.array(z.string()),
  explanations_he: z.array(z.string()),
  raw_rows: z.array(RawRowSchema),
  primary_row_index: z.number(),
  primary_reason: z.enum(['SINGLE', 'EXACT_DUP', 'PPSM_MATCH', 'SOURCE_ORDER']),
});
export type ProcessedDeal = z.infer<typeof ProcessedDealSchema>;

export const DatasetSchema = z.object({
  summary: z.object({
    raw_rows: z.number(),
    deals: z.number(),
    cities: z.number(),
    exact_duplicates: z.number(),
    conflicts: z.number(),
    excluded: z.number(),
    ppsm_mismatch_raw_rows: z.number(),
    month_only_dates: z.number(),
    latest_deal_date: z.string(),
  }),
  deals: z.array(ProcessedDealSchema),
});
export type Dataset = z.infer<typeof DatasetSchema>;
