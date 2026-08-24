import type { Metadata } from "next";
import WorkLogApp from "./WorkLogApp";

export const metadata: Metadata = {
  title: "업무일지",
  description: "분당차병원 주간 업무일지 작성 및 서명 시스템",
};

export const dynamic = "force-dynamic";

export default function Home() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const siteUrl = (
    process.env.SITE_URL?.trim()
    || process.env.NEXT_PUBLIC_SITE_URL?.trim()
    || "https://smartmecworklog.vercel.app"
  ).replace(/\/+$/, "");

  if (!supabaseUrl || !supabasePublishableKey) {
    return (
      <main className="loading-page">
        <strong>서버 연결 설정이 필요합니다.</strong>
        <p>관리자에게 문의해 주세요.</p>
      </main>
    );
  }

  return (
    <WorkLogApp
      supabaseUrl={supabaseUrl}
      supabasePublishableKey={supabasePublishableKey}
      siteUrl={siteUrl}
    />
  );
}
