/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // unpdf bundles a serverless pdf.js build; keep it external so the Node route
  // handler loads it at runtime instead of bundling it.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
