import type { Metadata } from "next";
import AuthCallbackPage from "../auth/AuthCallbackPage";

// Keep previously sent confirmation emails valid without a redirect that could
// discard Supabase callback parameters.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "이메일 인증",
};

export default function LegacyConfirmSignupPage() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!supabaseUrl || !supabasePublishableKey) return <main className="loading-page"><strong>서버 연결 설정이 필요합니다.</strong><p>관리자에게 문의해 주세요.</p></main>;
  return <AuthCallbackPage kind="confirm" supabaseUrl={supabaseUrl} supabasePublishableKey={supabasePublishableKey} />;
}
