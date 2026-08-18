import { createWorkLogPdf, type WorkLogRecord } from "../approval-email/work-log-pdf";

export const dynamic = "force-dynamic";

type UserProfile = {
  id: string;
  role: "직원" | "관리자";
  name: string | null;
  email: string;
};

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
  return response.json() as Promise<{ id: string }>;
}

async function getProfile(accessToken: string, id: string) {
  const url = new URL(`${requiredEnv("SUPABASE_URL")}/rest/v1/user_roles`);
  url.searchParams.set("select", "id,role,name,email");
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: supabaseHeaders(accessToken), cache: "no-store" });
  if (!response.ok) throw new Error("사용자 정보를 확인하지 못했습니다.");
  const profiles = await response.json() as UserProfile[];
  return profiles[0] ?? null;
}

async function getWorkLog(accessToken: string, userId: string, week: string) {
  const url = new URL(`${requiredEnv("SUPABASE_URL")}/rest/v1/work_logs`);
  url.searchParams.set("select", "week,status,data");
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("week", `eq.${week}`);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: supabaseHeaders(accessToken), cache: "no-store" });
  if (!response.ok) throw new Error("업무일지를 확인하지 못했습니다.");
  const logs = await response.json() as WorkLogRecord[];
  return logs[0] ?? null;
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) return jsonError("로그인이 필요합니다.", 401);

    const authUser = await getAuthenticatedUser(accessToken);
    if (!authUser) return jsonError("로그인 정보가 유효하지 않습니다.", 401);

    const payload = await request.json() as { targetUserId?: unknown; week?: unknown };
    if (typeof payload.targetUserId !== "string" || typeof payload.week !== "string" || !WEEK_PATTERN.test(payload.week)) {
      return jsonError("PDF 저장 요청 형식이 올바르지 않습니다.", 400);
    }

    const requester = await getProfile(accessToken, authUser.id);
    if (!requester) return jsonError("사용자 정보를 확인하지 못했습니다.", 403);
    if (requester.role !== "관리자" && payload.targetUserId !== authUser.id) {
      return jsonError("다른 직원의 업무일지를 저장할 권한이 없습니다.", 403);
    }

    const employee = payload.targetUserId === requester.id
      ? requester
      : await getProfile(accessToken, payload.targetUserId);
    if (!employee || employee.role !== "직원") {
      return jsonError("PDF로 저장할 직원을 확인하지 못했습니다.", 404);
    }

    const storedLog = await getWorkLog(accessToken, employee.id, payload.week);
    const record: WorkLogRecord = storedLog ?? { week: payload.week, status: "작성중", data: null };
    const employeeName = employee.name ?? employee.email.split("@")[0];
    const pdfBytes = await createWorkLogPdf(record, employeeName, employee.email);
    const filename = `${payload.week.replace(/\s+/g, "_")}_업무일지.pdf`;
    const body = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;

    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="work-log.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("work log PDF generation failed", error instanceof Error ? error.message : error);
    return jsonError("PDF 파일을 만들지 못했습니다.", 500);
  }
}
