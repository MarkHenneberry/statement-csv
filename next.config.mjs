/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // unpdf bundles a serverless pdf.js build; @napi-rs/canvas ships a native .node
  // binary used (optionally) for PDF→image rendering in the AI vision fallback.
  // Keep both external so the Node route handler loads them at runtime instead of
  // bundling them (the native binary must never be webpack-bundled, and neither
  // reaches a client bundle — both are only dynamically imported server-side).
  serverExternalPackages: ["unpdf", "@napi-rs/canvas"],
};

export default nextConfig;
