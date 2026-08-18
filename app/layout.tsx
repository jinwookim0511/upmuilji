import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  const origin = `${protocol}://${host}`;
  const socialImage = `${origin}/og.svg`;

  return {
    title: {
      default: "업무일지",
      template: "%s | 업무일지",
    },
    description: "분당차병원 주간 업무일지 작성 및 서명 시스템",
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title: "업무일지",
      description: "주간 업무 기록 · 출퇴근 · 서명",
      images: [{ url: socialImage, width: 1200, height: 630, alt: "업무일지 웹 시스템" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "업무일지",
      description: "주간 업무 기록 · 출퇴근 · 서명",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
