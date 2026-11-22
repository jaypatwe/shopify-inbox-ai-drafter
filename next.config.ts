import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The catalog CSVs are read at runtime; make sure they ship with the deployment.
  outputFileTracingIncludes: { "/*": ["./data/**/*"] },
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
