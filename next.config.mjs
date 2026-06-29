/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // unpdf bundles a serverless pdf.js build; @napi-rs/canvas ships a native .node
  // binary used (optionally) for PDF→image rendering in the AI vision fallback.
  // Keep both external so the Node route handler loads them at runtime instead of
  // bundling them (the native binary must never be webpack-bundled, and neither
  // reaches a client bundle — both are only dynamically imported server-side).
  // @prisma/client is kept external so the generated client + query engine are
  // loaded at runtime on the server (never bundled, never reaches a client bundle).
  // It is not imported by any route yet; this is forward-looking for the next pass.
  serverExternalPackages: ["unpdf", "@napi-rs/canvas", "@prisma/client"],
  // SEO: avoid two near-duplicate RBC pages competing for the same intent. The
  // bank-specific pages use the established /convert-<bank>-bank-statement-to-csv
  // pattern (matching the TD page), so the shorter /rbc-statement-to-csv URL is
  // consolidated into it with a permanent redirect.
  async redirects() {
    return [
      {
        source: "/rbc-statement-to-csv",
        destination: "/convert-rbc-bank-statement-to-csv",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
