import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatasetSchema, type Dataset, type ProcessedDeal } from './types';

let cache: { ds: Dataset; byId: Map<string, ProcessedDeal> } | null = null;

function load() {
  if (!cache) {
    const file = path.join(process.cwd(), 'data', 'deals.processed.json');
    const ds = DatasetSchema.parse(JSON.parse(readFileSync(file, 'utf-8')));
    cache = { ds, byId: new Map(ds.deals.map((d) => [d.deal_id, d])) };
  }
  return cache;
}

export function loadDataset(): Dataset {
  return load().ds;
}

export function getDeal(id: string): ProcessedDeal | undefined {
  return load().byId.get(id);
}
