import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/approval-email": ["./app/api/approval-email/NanumGothicCoding-Regular.ttf"],
    "/api/work-log-pdf": ["./app/api/approval-email/NanumGothicCoding-Regular.ttf"],
  },
};

export default nextConfig;
