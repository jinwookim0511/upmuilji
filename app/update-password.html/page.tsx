import type { Metadata } from "next";
import AuthCallbackPage from "../auth/AuthCallbackPage";

// Existing password-reset emails used this path. Render the page directly so
// Supabase's URL fragment is preserved for implicit-flow recovery links.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "비밀번호 재설정",
};

export default function LegacyUpdatePasswordPage() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!supabaseUrl || !supabasePublishableKey) return <main className="loading-page"><strong>서버 연결 설정이 필요합니다.</strong><p>관리자에게 문의해 주세요.</p></main>;
  return <AuthCallbackPage kind="recovery" supabaseUrl={supabaseUrl} supabasePublishableKey={supabasePublishableKey} />;
}
