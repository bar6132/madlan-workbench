import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  outputFileTracingIncludes: {
    // Every route that reads the datasets at runtime; without this the files are missing from the serverless bundle.
    '/api/analyze': ['./data/deals.processed.json'],
    '/api/deals': ['./data/deals.processed.json'],
    '/api/corrections/preview': ['./data/deals.processed.json'],
    '/deals': ['./data/deals.processed.json'],
    '/deals/[id]': ['./data/deals.processed.json'],
    '/corrections': ['./data/deals.processed.json', './data/deals.v2.processed.json', './data/corrections.approved.json'],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
