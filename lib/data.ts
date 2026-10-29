import { existsSync, readFileSync } from 'node:fs';
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

// The v2 dataset is built from a COPY of the CSV with approved corrections applied (scripts/apply_corrections.py).
// It is only used to show what approved corrections changed; the app's checks always run on the main dataset.
let v2Cache: Dataset | null | undefined;
export function loadDatasetV2(): Dataset | null {
  if (v2Cache === undefined) {
    const file = path.join(process.cwd(), 'data', 'deals.v2.processed.json');
    v2Cache = existsSync(file) ? DatasetSchema.parse(JSON.parse(readFileSync(file, 'utf-8'))) : null;
  }
  return v2Cache;
}
