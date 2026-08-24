import type { Metadata } from "next";
import AuthCallbackPage from "../AuthCallbackPage";

// Temporary compatibility for recovery emails created by the previous
// `{{ .RedirectTo }}update-password.html` template.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "비밀번호 재설정",
};

export default function MalformedLegacyUpdatePasswordPage() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!supabaseUrl || !supabasePublishableKey) return <main className="loading-page"><strong>서버 연결 설정이 필요합니다.</strong><p>관리자에게 문의해 주세요.</p></main>;
  return <AuthCallbackPage kind="recovery" supabaseUrl={supabaseUrl} supabasePublishableKey={supabasePublishableKey} />;
}
