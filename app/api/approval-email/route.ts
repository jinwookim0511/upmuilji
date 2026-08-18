import nodemailer from "nodemailer";
import { createWorkLogPdf, type WorkLogRecord } from "./work-log-pdf";
import { createZip } from "../../lib/zip";

export const dynamic = "force-dynamic";

type UserProfile = {
  id: string;
  role: "직원" | "관리자";
  name: string | null;
  email: string;
};

const EMAIL_PATTERN = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
const WEEK_PATTERN = /^\d{4}년\s+\d{1,2}월\s+\d{1,2}주차$/;

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, message }, { status });
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경값이 없습니다.`);
  return value;
}

function supabaseHeaders(accessToken: string) {
  return {
    apikey: requiredEnv("SUPABASE_PUBLISHABLE_KEY"),
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
}

async function getAuthenticatedUser(accessToken: string) {
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/auth/v1/user`, {
    headers: supabaseHeaders(accessToken),
    cache: "no-store",
  });
  if (!response.ok) return null;
  return response.json() as Promise<{ id: string; email?: string }>;
}

async function getProfiles(accessToken: string, id: string) {
  const url = new URL(`${requiredEnv("SUPABASE_URL")}/rest/v1/user_roles`);
  url.searchParams.set("select", "id,role,name,email");
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: supabaseHeaders(accessToken), cache: "no-store" });
  if (!response.ok) throw new Error("사용자 정보를 확인하지 못했습니다.");
  return response.json() as Promise<UserProfile[]>;
}

async function getWorkLogs(accessToken: string, userId: string) {
  const url = new URL(`${requiredEnv("SUPABASE_URL")}/rest/v1/work_logs`);
  url.searchParams.set("select", "week,status,data");
  url.searchParams.set("user_id", `eq.${userId}`);
  const response = await fetch(url, { headers: supabaseHeaders(accessToken), cache: "no-store" });
  if (!response.ok) throw new Error("결재 상태를 확인하지 못했습니다.");
  return response.json() as Promise<WorkLogRecord[]>;
}

function getSignerRole(name: string | null) {
  if (name?.includes("(부센터장)")) return "부센터장";
  if (name?.includes("(센터장)")) return "센터장";
  return null;
}

async function sendApprovalMail(options: {
  recipients: string[];
  employeeName: string;
  signerName: string;
  signerRole: string;
  approvals: WorkLogRecord[];
  attachments: Array<{ filename: string; bytes: Uint8Array; contentType: "application/pdf" | "application/zip" }>;
  siteUrl: string;
}) {
  const host = requiredEnv("SMTP_HOST");
  const port = Number(requiredEnv("SMTP_PORT"));
  const username = requiredEnv("SMTP_USER");
  const password = requiredEnv("SMTP_PASSWORD");
  const sender = requiredEnv("SMTP_SENDER_EMAIL");
  if (!Number.isInteger(port) || port <= 0 || !EMAIL_PATTERN.test(sender)) {
    throw new Error("메일 서버 설정이 올바르지 않습니다.");
  }

  const details = options.approvals.map((item) => `- ${item.week}: ${item.status}`).join("\n");
  const body = [
    `${options.employeeName}님의 업무일지가 결재되었습니다.`,
    "",
    `서명자: ${options.signerName} (${options.signerRole})`,
    "결재 내역:",
    details,
    "",
    options.approvals.length > 1
      ? "각 주차의 PDF 인쇄본은 하나의 ZIP 압축 파일로 첨부되었습니다."
      : "해당 주차의 PDF 인쇄본을 첨부했습니다.",
    "업무일지 웹사이트에서 상세 내용을 확인해 주세요.",
    options.siteUrl,
  ].join("\n");
  const subject = options.approvals.length === 1
    ? `[업무일지] ${options.approvals[0].week} ${options.signerRole} 서명 알림`
    : `[업무일지] ${options.approvals.length}건 ${options.signerRole} 일괄 서명 알림`;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: username, pass: password },
  });

  await transporter.sendMail({
    from: { name: "업무일지", address: sender },
    to: options.recipients,
    subject,
    text: body,
    attachments: options.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: Buffer.from(attachment.bytes),
      contentType: attachment.contentType,
    })),
  });
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) return jsonError("로그인이 필요합니다.", 401);

    const authUser = await getAuthenticatedUser(accessToken);
    if (!authUser) return jsonError("로그인 정보가 유효하지 않습니다.", 401);

    const [signer] = await getProfiles(accessToken, authUser.id);
    const signerRole = getSignerRole(signer?.name ?? null);
    if (!signer || signer.role !== "관리자" || !signerRole || signer.email !== authUser.email) {
      return jsonError("결재 메일을 보낼 권한이 없습니다.", 403);
    }

    const payload = await request.json() as { targetUserId?: unknown; weeks?: unknown };
    if (typeof payload.targetUserId !== "string" || !Array.isArray(payload.weeks)) {
      return jsonError("메일 발송 요청 형식이 올바르지 않습니다.", 400);
    }
    const weeks = [...new Set(payload.weeks.filter((week): week is string => typeof week === "string"))];
    if (!weeks.length || weeks.length > 60 || weeks.some((week) => !WEEK_PATTERN.test(week))) {
      return jsonError("결재 주차 정보가 올바르지 않습니다.", 400);
    }

    const [employee] = await getProfiles(accessToken, payload.targetUserId);
    if (!employee || employee.role !== "직원" || !EMAIL_PATTERN.test(employee.email) || !EMAIL_PATTERN.test(signer.email)) {
      return jsonError("메일 수신자 정보를 확인하지 못했습니다.", 400);
    }

    const logs = await getWorkLogs(accessToken, employee.id);
    const byWeek = new Map(logs.map((item) => [item.week, item]));
    const approvals = weeks.map((week) => byWeek.get(week)).filter((item): item is WorkLogRecord => Boolean(item));
    const allowedStatuses = signerRole === "부센터장"
      ? new Set(["부센터장만 서명", "서명 완료"])
      : new Set(["센터장만 서명", "서명 완료"]);
    if (approvals.length !== weeks.length || approvals.some((item) => !allowedStatuses.has(item.status))) {
      return jsonError("결재 상태가 확인되지 않아 메일을 보내지 않았습니다.", 409);
    }

    const employeeName = employee.name ?? employee.email.split("@")[0];
    const pdfAttachments = await Promise.all(approvals.map(async (approval) => ({
      filename: `${approval.week.replace(/\s+/g, "_")}_업무일지.pdf`,
      bytes: await createWorkLogPdf(approval, employeeName, employee.email),
    })));
    const attachments = pdfAttachments.length > 1
      ? [{
        filename: `${employeeName}_업무일지_결재본.zip`,
        bytes: createZip(pdfAttachments),
        contentType: "application/zip" as const,
      }]
      : pdfAttachments.map((attachment) => ({ ...attachment, contentType: "application/pdf" as const }));
    const recipients = [...new Set([employee.email, signer.email])];
    await sendApprovalMail({
      recipients,
      employeeName,
      signerName: signer.name ?? signer.email.split("@")[0],
      signerRole,
      approvals,
      attachments,
      siteUrl: new URL(request.url).origin,
    });
    return Response.json({ ok: true, recipients: recipients.length, attachments: attachments.length });
  } catch (error) {
    console.error("approval email failed", error instanceof Error ? error.message : error);
    return jsonError("결재는 완료되었지만 메일 발송에 실패했습니다.", 502);
  }
}
