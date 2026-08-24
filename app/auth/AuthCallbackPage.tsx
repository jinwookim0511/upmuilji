"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "../lib/supabase";

type CallbackKind = "confirm" | "recovery";
type CallbackState = "loading" | "ready" | "success" | "error";

type AuthCallbackPageProps = {
  kind: CallbackKind;
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export default function AuthCallbackPage({ kind, supabaseUrl, supabasePublishableKey }: AuthCallbackPageProps) {
  const supabase = useMemo(
    () => createSupabaseBrowserClient(supabaseUrl, supabasePublishableKey),
    [supabasePublishableKey, supabaseUrl],
  );
  const [state, setState] = useState<CallbackState>("loading");
  const [message, setMessage] = useState("이메일 링크를 확인하고 있습니다.");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;
    function activateSession() {
      if (!active) return;
      if (kind === "confirm") {
        setState("success");
        setMessage("이메일 인증이 완료되었습니다. 이제 로그인할 수 있습니다.");
      } else {
        setState("ready");
        setMessage("새 비밀번호를 입력해 주세요.");
      }
    }
    function fail(error: string) {
      if (!active) return;
      setState("error");
      setMessage(`링크를 확인하지 못했습니다: ${error}`);
    }

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) return;
      if (kind === "recovery" && event === "PASSWORD_RECOVERY") activateSession();
      if (kind === "confirm" && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) activateSession();
    });

    async function resolveSession() {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          const { data: sessionData } = await supabase.auth.getSession();
          if (!sessionData.session) return fail(error.message);
        }
      }
      const { data: sessionData, error } = await supabase.auth.getSession();
      if (error) return fail(error.message);
      if (sessionData.session) activateSession();
      else fail("유효한 인증 또는 비밀번호 재설정 링크가 아닙니다. 새 링크를 요청해 주세요.");
    }

    void resolveSession();
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [kind, supabase]);

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    if (password.length < 6) return setFormError("비밀번호는 6자 이상이어야 합니다.");
    if (password !== confirm) return setFormError("비밀번호가 일치하지 않습니다.");
    setFormError("");
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setFormError(`비밀번호를 변경하지 못했습니다: ${error.message}`);
    } else {
      await supabase.auth.signOut();
      setState("success");
      setMessage("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.");
    }
    setSubmitting(false);
  }

  const isRecovery = kind === "recovery";
  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="intro-mark">업</div>
        <p className="eyebrow">SMART WEEKLY LOG</p>
        <h1>{isRecovery ? "안전하게\n비밀번호를 바꿉니다." : "이메일 인증을\n완료합니다."}</h1>
        <p>{isRecovery ? "메일에서 열어 본인 확인이 완료된 뒤에만 새 비밀번호를 설정할 수 있습니다." : "인증이 끝나면 업무일지를 바로 이용할 수 있습니다."}</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-heading"><h2>{isRecovery ? "새 비밀번호 설정" : "이메일 인증"}</h2><p>{message}</p></div>
          {state === "loading" && <div className="spinner" aria-label="인증 링크 확인 중" />}
          {isRecovery && state === "ready" && (
            <form onSubmit={updatePassword}>
              <label>새 비밀번호<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="6자 이상" /></label>
              <label>새 비밀번호 확인<input type="password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="비밀번호 다시 입력" /></label>
              {formError && <div className="auth-feedback error" role="alert">{formError}</div>}
              <button className="button primary auth-submit" disabled={submitting}>{submitting ? "변경 중…" : "비밀번호 저장"}</button>
            </form>
          )}
          {state === "error" && <div className="auth-feedback error" role="alert">{message}</div>}
          {state === "success" && <div className="auth-feedback success" role="status">{message}</div>}
          {(state === "success" || state === "error") && <Link className="auth-return-link" href="/">로그인으로 돌아가기</Link>}
        </div>
      </section>
    </main>
  );
}
