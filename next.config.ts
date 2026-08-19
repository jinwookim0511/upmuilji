import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";

const nextConfig: NextConfig = {
  webpack(config, { webpack }) {
    const fontBase64 = readFileSync(path.join(
      process.cwd(),
      "app",
      "api",
      "approval-email",
      "NanumGothic-Regular.ttf",
    )).toString("base64");
    config.plugins.push(new webpack.DefinePlugin({
      PDF_FONT_BASE64: JSON.stringify(fontBase64),
    }));
    return config;
  },
};

export default nextConfig;
