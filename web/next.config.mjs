// FastAPI backend target. Override with API_TARGET for a remote/LAN host.
const API_TARGET = process.env.API_TARGET || "http://127.0.0.1:8000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Proxy every /api/* call to the FastAPI backend so the browser talks
  // same-origin and device headers / cookies / multipart all just work.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_TARGET}/api/:path*` }];
  },
};

export default nextConfig;
