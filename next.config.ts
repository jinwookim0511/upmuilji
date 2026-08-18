import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/approval-email": ["./node_modules/@fontsource/nanum-gothic-coding/files/nanum-gothic-coding-korean-400-normal.woff"],
    "/api/work-log-pdf": ["./node_modules/@fontsource/nanum-gothic-coding/files/nanum-gothic-coding-korean-400-normal.woff"],
  },
};

export default nextConfig;
