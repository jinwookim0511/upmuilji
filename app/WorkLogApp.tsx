"use client";

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./lib/supabase";
import { createZip, type ZipEntry } from "./lib/zip";

type Role = "직원" | "관리자";
type View = "journal" | "leave" | "special";
type AuthMode = "login" | "signup";
type AuthFeedbackTone = "error" | "success";
type AuthFeedback = { tone: AuthFeedbackTone; message: string } | null;

type RoleRow = {
  id: string;
  role: Role;
  name: string | null;
  email: string;
};

type Task = {
  날짜?: string;
  업무내용: string;
  진행률: string;
};

type Attendance = {
  date: string;
  start_time: string;
  end_time: string;
  leave_type: string;
};

type SpecialTask = {
  날짜: string;
  요일: string;
  "시작 시각": string;
  "소요 시간": string;
  "업무 내용": string;
  진행률: string;
};

type WeekData = {
  daily: Task[];
  attendance: Attendance[];
  special: SpecialTask[];
  weekly_goals: Task[];
  weekly_comment: string;
};

type LogRow = {
  id?: number;
  user_id: string;
  email: string;
  week: string;
  status: string;
  data: Partial<WeekData> | null;
};

type BulkApprovalProgress = {
  active: boolean;
  phase: "signing" | "refreshing" | "mailing" | "complete";
  completed: number;
  total: number;
  currentWeek: string;
};

type DraftSnapshot = {
  accessToken: string;
  userId: string;
  email: string;
  week: string;
  status: string;
  data: WeekData;
  version: number;
};

const DAYS = ["월", "화", "수", "목", "금"];
const LEAVE_TYPES = ["-", "연차", "반차", "반반차", "그외법정휴가", "경조사", "병가", "공휴일"];
const AUTO_SAVE_DEBOUNCE_MS = 800;
const AUTO_SAVE_INTERVAL_MS = 30 * 1000;
const KOREAN_COLLATOR = new Intl.Collator("ko-KR", { sensitivity: "base" });

function employeeSelectionStorageKey(adminId: string) {
  return `upmuilji:last-selected-employee:${adminId}`;
}

function savedEmployeeSelection(adminId: string) {
  try {
    return window.localStorage.getItem(employeeSelectionStorageKey(adminId));
  } catch {
    return null;
  }
}

function saveEmployeeSelection(adminId: string, email: string) {
  try {
    window.localStorage.setItem(employeeSelectionStorageKey(adminId), email);
  } catch {
    // The selection is a browser convenience only, so storage failures should not block navigation.
  }
}

function weekSelectionStorageKey(userId: string) {
  return `upmuilji:last-selected-week:${userId}`;
}

function savedWeekSelection(userId: string, weeks: string[]) {
  try {
    const savedWeek = window.localStorage.getItem(weekSelectionStorageKey(userId));
    return savedWeek && weeks.includes(savedWeek) ? savedWeek : null;
  } catch {
    return null;
  }
}

function saveWeekSelection(userId: string, week: string) {
  try {
    window.localStorage.setItem(weekSelectionStorageKey(userId), week);
  } catch {
    // The selection is a browser convenience only, so storage failures should not block navigation.
  }
}

function employeeSortName(user: RoleRow) {
  return (user.name ?? user.email).trim();
}

function mondayOfWeek(week: string) {
  const match = week.match(/(\d+)년\s*(\d+)월\s*(\d+)주차/);
  if (!match) return new Date();
  const [, yearText, monthText, weekText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const weekNumber = Number(weekText);
  if (year === 2026 && month === 1 && weekNumber === 0) return new Date(2025, 11, 29);
  const first = new Date(year, month - 1, 1);
  const daysUntilMonday = (8 - first.getDay()) % 7;
  return new Date(year, month - 1, 1 + daysUntilMonday + (weekNumber - 1) * 7);
}

function currentWeekMonday() {
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function isBulkSubmittable(status: string) {
  return ["작성중", "반려"].includes(status);
}

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortDate(value: Date) {
  return `${String(value.getMonth() + 1).padStart(2, "0")}.${String(value.getDate()).padStart(2, "0")}`;
}

function generateWeeks() {
  const weeks = ["2026년 1월 0주차"];
  const cursor = new Date(2026, 0, 1);
  while (cursor.getDay() !== 1) cursor.setDate(cursor.getDate() + 1);
  while (cursor.getFullYear() === 2026) {
    const month = cursor.getMonth();
    const first = new Date(2026, month, 1);
    const firstMonday = new Date(2026, month, 1 + ((8 - first.getDay()) % 7));
    const weekNumber = Math.floor((cursor.getTime() - firstMonday.getTime()) / 604800000) + 1;
    weeks.push(`2026년 ${month + 1}월 ${weekNumber}주차`);
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function closestWeekToToday(weeks: string[], today = new Date()) {
  const reference = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return weeks.reduce((closest, week) => {
    const monday = mondayOfWeek(week);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const distance = reference < monday
      ? monday.getTime() - reference.getTime()
      : reference > friday
        ? reference.getTime() - friday.getTime()
        : 0;
    const closestMonday = mondayOfWeek(closest);
    const closestFriday = new Date(closestMonday);
    closestFriday.setDate(closestMonday.getDate() + 4);
    const closestDistance = reference < closestMonday
      ? closestMonday.getTime() - reference.getTime()
      : reference > closestFriday
        ? reference.getTime() - closestFriday.getTime()
        : 0;
    return distance < closestDistance ? week : closest;
  }, weeks[0]);
}

function blankTask(): Task {
  return { 업무내용: "", 진행률: "" };
}

function blankSpecial(): SpecialTask {
  return { 날짜: "", 요일: "", "시작 시각": "", "소요 시간": "60분", "업무 내용": "", 진행률: "" };
}

function defaultWeekData(week: string): WeekData {
  const monday = mondayOfWeek(week);
  const daily: Task[] = [];
  const attendance: Attendance[] = [];
  for (let index = 0; index < 5; index += 1) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const dateText = isoDate(date);
    daily.push({ ...blankTask(), 날짜: dateText }, { ...blankTask(), 날짜: dateText });
    attendance.push({ date: dateText, start_time: "", end_time: "", leave_type: "-" });
  }
  return {
    daily,
    attendance,
    special: [blankSpecial()],
    weekly_goals: [blankTask(), blankTask(), blankTask(), blankTask()],
    weekly_comment: "",
  };
}

function normalizeData(week: string, value: Partial<WeekData> | null | undefined): WeekData {
  const fallback = defaultWeekData(week);
  return {
    daily: Array.isArray(value?.daily) ? value.daily : fallback.daily,
    attendance: Array.isArray(value?.attendance) ? value.attendance : fallback.attendance,
    special: Array.isArray(value?.special) && value.special.length ? value.special : fallback.special,
    weekly_goals: Array.isArray(value?.weekly_goals) && value.weekly_goals.length ? value.weekly_goals : fallback.weekly_goals,
    weekly_comment: value?.weekly_comment ?? "",
  };
}

function statusClass(status: string) {
  if (status === "서명 완료") return "status-complete";
  if (status === "서명 대기") return "status-waiting";
  if (status === "반려") return "status-rejected";
  if (status.includes("만 서명")) return "status-partial";
  return "status-draft";
}

function durationMinutes(value: string) {
  if (!value) return 0;
  if (value.includes("시간") && value.includes("분")) {
    const [hours, minutes] = value.split("시간");
    return Math.round(Number(hours.trim() || 0) * 60 + Number(minutes.replace("분", "").trim() || 0));
  }
  if (value.includes("시간")) return Math.round(Number(value.replace("시간", "").trim() || 0) * 60);
  if (value.includes("분")) return Math.round(Number(value.replace("분", "").trim() || 0));
  return Math.round(Number(value || 0) * 60);
}

type WorkLogAppProps = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export default function WorkLogApp({ supabaseUrl, supabasePublishableKey }: WorkLogAppProps) {
  const supabase = useMemo(
    () => createSupabaseBrowserClient(supabaseUrl, supabasePublishableKey),
    [supabasePublishableKey, supabaseUrl],
  );
  const weeks = useMemo(() => generateWeeks(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<RoleRow | null>(null);
  const [users, setUsers] = useState<RoleRow[]>([]);
  const [selectedEmail, setSelectedEmail] = useState("");
  const [selectedWeek, setSelectedWeek] = useState(weeks[0]);
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("작성중");
  const [weekData, setWeekData] = useState<WeekData>(() => defaultWeekData(weeks[0]));
  const [view, setView] = useState<View>("journal");
  const [filter, setFilter] = useState("전체");
  const [defaultStart, setDefaultStart] = useState("09:00");
  const [defaultEnd, setDefaultEnd] = useState("18:00");
  const [leaveTotal, setLeaveTotal] = useState(15);
  const [historyLogs, setHistoryLogs] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfStartWeek, setPdfStartWeek] = useState(weeks[0]);
  const [pdfEndWeek, setPdfEndWeek] = useState(weeks[0]);
  const [bulkSubmitDialogOpen, setBulkSubmitDialogOpen] = useState(false);
  const [bulkSubmitStartWeek, setBulkSubmitStartWeek] = useState(weeks[0]);
  const [bulkSubmitEndWeek, setBulkSubmitEndWeek] = useState(weeks[0]);
  const [pdfCompleted, setPdfCompleted] = useState(0);
  const [pdfTotal, setPdfTotal] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [bulkProgress, setBulkProgress] = useState<BulkApprovalProgress | null>(null);
  const weekDataRef = useRef(weekData);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const draftVersionRef = useRef(0);
  const draftSnapshotRef = useRef<DraftSnapshot | null>(null);
  const loadLogRequestRef = useRef(0);
  const bulkApprovingRef = useRef(false);
  const saveCurrentRef = useRef<(showMessage?: boolean) => Promise<boolean>>(async () => false);
  const selectWeekRef = useRef<(week: string) => Promise<void>>(async () => undefined);
  const sessionUserId = session?.user.id ?? null;
  const sessionUserEmail = session?.user.email ?? "";

  const currentUser = useMemo(() => {
    if (!profile) return null;
    if (profile.role !== "관리자") return profile;
    return users.find((user) => user.email === selectedEmail) ?? profile;
  }, [profile, selectedEmail, users]);

  const subRole = useMemo(() => {
    const name = profile?.name ?? "";
    if (name.includes("(부센터장)")) return "부센터장";
    if (name.includes("(센터장)")) return "센터장";
    return profile?.role === "관리자" ? "관리자" : "직원";
  }, [profile]);

  const selectedMonday = useMemo(() => mondayOfWeek(selectedWeek), [selectedWeek]);
  const selectedFriday = useMemo(() => {
    const value = new Date(selectedMonday);
    value.setDate(value.getDate() + 4);
    return value;
  }, [selectedMonday]);

  const pastWeeks = useMemo(() => {
    const monday = currentWeekMonday();
    return weeks.filter((week) => mondayOfWeek(week) < monday);
  }, [weeks]);

  const filteredWeeks = useMemo(() => {
    return weeks.filter((week) => {
      const current = statusMap[week] ?? "작성중";
      if (filter === "부센터장 서명 전") return ["서명 대기", "센터장만 서명"].includes(current);
      if (filter === "센터장 서명 전") return ["서명 대기", "부센터장만 서명"].includes(current);
      if (filter === "서명 완료") return current === "서명 완료";
      if (filter === "작성중") return ["작성중", "반려"].includes(current);
      return true;
    });
  }, [filter, statusMap, weeks]);

  const canEdit = profile?.role === "직원" && ["작성중", "반려"].includes(status);

  useLayoutEffect(() => {
    weekDataRef.current = weekData;
    draftSnapshotRef.current = session?.access_token && currentUser && profile?.role === "직원" && canEdit
      ? {
          accessToken: session.access_token,
          userId: currentUser.id,
          email: currentUser.email,
          week: selectedWeek,
          status,
          data: weekData,
          version: draftVersionRef.current,
        }
      : null;
  }, [canEdit, currentUser, profile?.role, selectedWeek, session?.access_token, status, weekData]);

  useEffect(() => {
    if (!bulkProgress?.active && !pdfExporting) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function blockKeyboard(event: KeyboardEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("keydown", blockKeyboard, true);
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", blockKeyboard, true);
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [bulkProgress?.active, pdfExporting]);

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBusy(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setUsers([]);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!sessionUserId) return;
    let active = true;
    async function loadProfile() {
      setBusy(true);
      const { data, error } = await supabase
        .from("user_roles")
        .select("id, role, name, email")
        .eq("id", sessionUserId)
        .maybeSingle();
      if (!active) return;
      if (error) flash(`사용자 정보를 불러오지 못했습니다: ${error.message}`);
      const nextProfile: RoleRow = data ?? {
        id: sessionUserId,
        email: sessionUserEmail,
        name: sessionUserEmail.split("@")[0] || "사용자",
        role: "직원",
      };
      setProfile(nextProfile);
      setSelectedWeek(savedWeekSelection(nextProfile.id, weeks) ?? closestWeekToToday(weeks));

      if (nextProfile.role === "관리자") {
        const { data: staff } = await supabase.from("user_roles").select("id, role, name, email");
        const staffRows = ((staff ?? []) as RoleRow[])
          .filter((item) => item.role !== "관리자")
          .sort((left, right) => KOREAN_COLLATOR.compare(employeeSortName(left), employeeSortName(right)) || left.email.localeCompare(right.email));
        const previousEmail = savedEmployeeSelection(nextProfile.id);
        const initialEmail = staffRows.some((item) => item.email === previousEmail)
          ? previousEmail!
          : staffRows[0]?.email ?? nextProfile.email;
        setUsers(staffRows);
        setSelectedEmail(initialEmail);
      } else {
        setUsers([nextProfile]);
        setSelectedEmail(nextProfile.email);
      }
      setBusy(false);
    }
    loadProfile();
    return () => {
      active = false;
    };
  }, [flash, sessionUserEmail, sessionUserId, supabase, weeks]);

  useEffect(() => {
    if (!profile || !weeks.includes(selectedWeek)) return;
    saveWeekSelection(profile.id, selectedWeek);
  }, [profile, selectedWeek, weeks]);

  const loadStatusMap = useCallback(async (email: string) => {
    if (!email) return;
    const { data } = await supabase.from("work_logs").select("week, status").eq("email", email);
    const nextMap: Record<string, string> = {};
    (data ?? []).forEach((row) => {
      nextMap[row.week] = row.status;
    });
    setStatusMap(nextMap);
  }, [supabase]);

  const loadLog = useCallback(async (week: string, email: string) => {
    if (!sessionUserId || !email) return;
    const requestId = loadLogRequestRef.current + 1;
    loadLogRequestRef.current = requestId;
    setBusy(true);
    let query = supabase.from("work_logs").select("id, user_id, email, week, status, data").eq("week", week);
    query = profile?.role === "관리자" ? query.eq("email", email) : query.eq("user_id", sessionUserId);
    const { data, error } = await query.limit(1).maybeSingle();
    if (requestId !== loadLogRequestRef.current) return;
    if (error) flash(`업무일지를 불러오지 못했습니다: ${error.message}`);
    const nextWeekData = normalizeData(week, data?.data);
    setStatus(data?.status ?? "작성중");
    weekDataRef.current = nextWeekData;
    setWeekData(nextWeekData);
    draftVersionRef.current += 1;
    dirtyRef.current = false;
    setDirty(false);
    setBusy(false);
  }, [flash, profile?.role, sessionUserId, supabase]);

  const loadLeaveTotal = useCallback(async (email: string) => {
    const { data } = await supabase.from("leave_entitlements").select("total_days").eq("email", email).maybeSingle();
    setLeaveTotal(data?.total_days ?? 15);
  }, [supabase]);

  const loadHistory = useCallback(async (email: string) => {
    if (!email) return;
    const { data } = await supabase
      .from("work_logs")
      .select("id, user_id, email, week, status, data")
      .eq("email", email)
      .order("week", { ascending: true });
    setHistoryLogs((data ?? []) as LogRow[]);
  }, [supabase]);

  useEffect(() => {
    if (!selectedEmail) return;
    // These loaders synchronize the journal with the newly selected user/week.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatusMap(selectedEmail);
    loadLeaveTotal(selectedEmail);
    loadLog(selectedWeek, selectedEmail);
  }, [loadLeaveTotal, loadLog, loadStatusMap, selectedEmail, selectedWeek]);

  useEffect(() => {
    if (!selectedEmail || view === "journal") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHistory(selectedEmail);
  }, [loadHistory, selectedEmail, view]);

  function markChanged(updater: (value: WeekData) => WeekData) {
    if (profile?.role !== "직원" || !canEdit) return;
    const nextWeekData = updater(weekDataRef.current);
    draftVersionRef.current += 1;
    weekDataRef.current = nextWeekData;
    if (draftSnapshotRef.current) {
      draftSnapshotRef.current = {
        ...draftSnapshotRef.current,
        data: nextWeekData,
        version: draftVersionRef.current,
      };
    }
    setWeekData(nextWeekData);
    dirtyRef.current = true;
    setDirty(true);
  }

  async function saveCurrent(showMessage = true) {
    const snapshot = draftSnapshotRef.current;
    if (!snapshot || profile?.role !== "직원") return false;
    if (!dirtyRef.current) return true;
    if (savePromiseRef.current) {
      const saved = await savePromiseRef.current;
      if (!saved || !dirtyRef.current) return saved;
      return saveCurrentRef.current(showMessage);
    }

    savingRef.current = true;
    setSaving(true);
    const version = draftVersionRef.current;
    const payload = {
      user_id: snapshot.userId,
      email: snapshot.email,
      week: snapshot.week,
      status: snapshot.status,
      data: weekDataRef.current,
    };
    const savePromise = (async () => {
      const { error } = await supabase.from("work_logs").upsert(payload, { onConflict: "user_id,week" });
      if (error) {
        flash(`저장하지 못했습니다: ${error.message}`);
        return false;
      }
      setStatusMap((current) => ({ ...current, [payload.week]: payload.status }));
      if (draftVersionRef.current === version && draftSnapshotRef.current?.week === payload.week) {
        dirtyRef.current = false;
        setDirty(false);
      }
      if (showMessage) flash("업무일지를 저장했습니다.");
      return true;
    })();
    savePromiseRef.current = savePromise;
    const saved = await savePromise;
    if (savePromiseRef.current === savePromise) savePromiseRef.current = null;
    savingRef.current = false;
    setSaving(false);
    return saved;
  }

  async function saveBeforeAction(action: () => void | Promise<void>) {
    while (profile?.role === "직원" && dirtyRef.current) {
      const saved = await saveCurrentRef.current(false);
      if (!saved) return false;
    }
    await action();
    return true;
  }

  const persistDraftOnExit = useCallback(() => {
    const snapshot = draftSnapshotRef.current;
    if (!snapshot || !dirtyRef.current) return;
    const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/work_logs?on_conflict=user_id%2Cweek`;
    void fetch(endpoint, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${snapshot.accessToken}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        user_id: snapshot.userId,
        email: snapshot.email,
        week: snapshot.week,
        status: snapshot.status,
        data: snapshot.data,
      }),
    }).then((response) => {
      if (response.ok && draftVersionRef.current === snapshot.version && draftSnapshotRef.current?.week === snapshot.week) {
        dirtyRef.current = false;
        setDirty(false);
      }
    }).catch(() => {
      // The normal debounced save remains the fallback if the browser cancels an exit request.
    });
  }, [supabasePublishableKey, supabaseUrl]);

  async function logout() {
    if (profile?.role === "직원" && dirtyRef.current) {
      const saved = await saveCurrent(false);
      if (!saved) return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) flash(`로그아웃하지 못했습니다: ${error.message}`);
  }

  async function openPdfDialog() {
    await saveBeforeAction(() => {
      setPdfStartWeek(selectedWeek);
      setPdfEndWeek(selectedWeek);
      setPdfDialogOpen(true);
    });
  }

  async function downloadPdfRange() {
    if (!session?.access_token || !currentUser || pdfExporting) return;
    const accessToken = session.access_token;
    const startIndex = weeks.indexOf(pdfStartWeek);
    const endIndex = weeks.indexOf(pdfEndWeek);
    if (startIndex < 0 || endIndex < startIndex) {
      flash("종료 주차는 시작 주차와 같거나 이후여야 합니다.");
      return;
    }
    const rangeWeeks = weeks.slice(startIndex, endIndex + 1);
    setPdfDialogOpen(false);
    setPdfExporting(true);
    setPdfCompleted(0);
    setPdfTotal(rangeWeeks.length);
    try {
      if (profile?.role === "직원" && dirtyRef.current && rangeWeeks.includes(selectedWeek)) {
        const saved = await saveCurrent(false);
        if (!saved) return;
      }

      const entries = new Array<ZipEntry>(rangeWeeks.length);
      const controller = new AbortController();
      let nextIndex = 0;
      async function worker() {
        while (nextIndex < rangeWeeks.length) {
          const index = nextIndex;
          nextIndex += 1;
          const week = rangeWeeks[index];
          const response = await fetch("/api/work-log-pdf", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ targetUserId: currentUser!.id, week }),
            signal: controller.signal,
          });
          if (!response.ok) {
            const details = await response.json().catch(() => null) as { message?: string } | null;
            throw new Error(details?.message ?? `${week} PDF를 만들지 못했습니다.`);
          }
          entries[index] = {
            filename: `${week.replace(/\s+/g, "_")}_업무일지.pdf`,
            bytes: new Uint8Array(await response.arrayBuffer()),
          };
          setPdfCompleted((current) => current + 1);
        }
      }
      try {
        await Promise.all(Array.from({ length: Math.min(3, rangeWeeks.length) }, () => worker()));
      } catch (error) {
        controller.abort();
        throw error;
      }

      const zipBytes = createZip(entries);
      const zipBody = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer;
      const downloadUrl = URL.createObjectURL(new Blob([zipBody], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${pdfStartWeek.replace(/\s+/g, "_")}_${pdfEndWeek.replace(/\s+/g, "_")}_업무일지.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      flash(`${rangeWeeks.length}개 주차의 PDF를 ZIP 파일로 저장했습니다.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "PDF 파일을 만들지 못했습니다.");
    } finally {
      setPdfExporting(false);
    }
  }

  useLayoutEffect(() => {
    saveCurrentRef.current = saveCurrent;
  });

  useEffect(() => {
    if (profile?.role !== "직원" || !canEdit) return;
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void saveCurrentRef.current(false);
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [canEdit, dirty, profile?.role, selectedWeek, status, weekData]);

  useEffect(() => {
    if (profile?.role !== "직원" || !canEdit) return;
    const timer = window.setInterval(async () => {
      if (!dirtyRef.current || savingRef.current) return;
      const saved = await saveCurrentRef.current(false);
      if (saved) flash("작성 중인 업무일지를 자동 저장했습니다.");
    }, AUTO_SAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [canEdit, flash, profile?.role, selectedWeek]);

  useEffect(() => {
    if (profile?.role !== "직원" || !canEdit) return;
    function saveWhenHidden() {
      if (document.visibilityState === "hidden") persistDraftOnExit();
    }
    window.addEventListener("beforeunload", persistDraftOnExit);
    window.addEventListener("pagehide", persistDraftOnExit);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("beforeunload", persistDraftOnExit);
      window.removeEventListener("pagehide", persistDraftOnExit);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [canEdit, persistDraftOnExit, profile?.role]);

  useEffect(() => {
    if (profile?.role !== "직원") return;
    function saveAfterInteraction(event: Event) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("button, select, a, [role='button'], [role='menuitem']")) return;
      window.setTimeout(() => {
        if (dirtyRef.current) void saveCurrentRef.current(false);
      }, 0);
    }
    document.addEventListener("click", saveAfterInteraction);
    document.addEventListener("change", saveAfterInteraction);
    return () => {
      document.removeEventListener("click", saveAfterInteraction);
      document.removeEventListener("change", saveAfterInteraction);
    };
  }, [profile?.role]);

  async function updateCurrentStatus(nextStatus: string) {
    if (profile?.role !== "관리자" || !currentUser) return false;
    setSaving(true);
    const { data: updated, error } = await supabase
      .from("work_logs")
      .update({ status: nextStatus })
      .eq("user_id", currentUser.id)
      .eq("week", selectedWeek)
      .eq("status", status)
      .select("id")
      .maybeSingle();
    setSaving(false);
    if (error) {
      flash(`상태를 변경하지 못했습니다: ${error.message}`);
      return false;
    }
    if (!updated) {
      await loadStatusMap(currentUser.email);
      await loadLog(selectedWeek, currentUser.email);
      flash("업무일지 상태가 이미 변경되었습니다. 최신 상태를 다시 불러왔습니다.");
      return false;
    }
    setStatus(nextStatus);
    setStatusMap((current) => ({ ...current, [selectedWeek]: nextStatus }));
    flash(`상태를 '${nextStatus}'(으)로 변경했습니다.`);
    return true;
  }

  async function selectWeek(week: string) {
    if (week === selectedWeek || savingRef.current) return;
    await saveBeforeAction(() => {
      if (profile) saveWeekSelection(profile.id, week);
      setSelectedWeek(week);
    });
  }

  useEffect(() => {
    selectWeekRef.current = selectWeek;
  });

  useEffect(() => {
    function handleWeekShortcut(event: KeyboardEvent) {
      if (!event.shiftKey || event.repeat || view !== "journal") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const previous = event.key === "ArrowLeft" || event.key === "ArrowUp";
      const next = event.key === "ArrowRight" || event.key === "ArrowDown";
      if (!previous && !next) return;
      const currentIndex = filteredWeeks.indexOf(selectedWeek);
      if (currentIndex < 0) return;
      const nextIndex = Math.min(filteredWeeks.length - 1, Math.max(0, currentIndex + (previous ? -1 : 1)));
      if (nextIndex === currentIndex) return;
      event.preventDefault();
      void selectWeekRef.current(filteredWeeks[nextIndex]);
    }
    window.addEventListener("keydown", handleWeekShortcut);
    return () => window.removeEventListener("keydown", handleWeekShortcut);
  }, [filteredWeeks, selectedWeek, view]);

  async function selectUser(email: string) {
    if (dirty && canEdit && !(await saveCurrent(false))) return;
    if (profile?.role === "관리자") saveEmployeeSelection(profile.id, email);
    setSelectedEmail(email);
  }

  async function selectView(nextView: View) {
    if (nextView === view) return;
    await saveBeforeAction(async () => {
      setView(nextView);
      if (nextView !== "journal") await loadHistory(selectedEmail);
    });
  }

  async function selectFilter(nextFilter: string) {
    if (nextFilter === filter) return;
    await saveBeforeAction(() => setFilter(nextFilter));
  }

  function fillDefaultTimes() {
    markChanged((current) => ({
      ...current,
      attendance: current.attendance.map((item) => ({
        ...item,
        start_time: item.start_time || defaultStart,
        end_time: item.end_time || defaultEnd,
      })),
    }));
  }

  async function submitCurrent() {
    if (!session?.user || !currentUser || profile?.role !== "직원" || savingRef.current) return;
    if (!window.confirm("현재 주차를 서명 대기 상태로 상신하시겠습니까?")) return;
    fillDefaultTimes();
    const dataWithTimes: WeekData = {
      ...weekData,
      attendance: weekData.attendance.map((item) => ({
        ...item,
        start_time: item.start_time || defaultStart,
        end_time: item.end_time || defaultEnd,
      })),
    };
    setWeekData(dataWithTimes);
    savingRef.current = true;
    setSaving(true);
    const payload = {
      user_id: currentUser!.id,
      email: currentUser!.email,
      week: selectedWeek,
      status: "서명 대기",
      data: dataWithTimes,
    };
    const { error } = await supabase.from("work_logs").upsert(payload, { onConflict: "user_id,week" });
    savingRef.current = false;
    setSaving(false);
    if (error) return flash(`상신하지 못했습니다: ${error.message}`);
    setStatus("서명 대기");
    setStatusMap((current) => ({ ...current, [selectedWeek]: "서명 대기" }));
    dirtyRef.current = false;
    setDirty(false);
    flash("서명 대기로 상신했습니다.");
  }

  function nextApprovalStatus(current: string) {
    if (current === "서명 대기" && subRole === "부센터장") return "부센터장만 서명";
    if (current === "서명 대기" && subRole === "센터장") return "센터장만 서명";
    if (current === "부센터장만 서명" && subRole === "센터장") return "서명 완료";
    if (current === "센터장만 서명" && subRole === "부센터장") return "서명 완료";
    return current;
  }

  async function approveCurrent() {
    const next = nextApprovalStatus(status);
    if (next === status) return flash("현재 계정에서 서명할 수 없는 상태입니다.");
    if (!window.confirm(`${selectedWeek} 업무일지에 ${subRole} 서명을 추가하시겠습니까?`)) return;
    const approved = await updateCurrentStatus(next);
    if (!approved || !currentUser) return;
    setSaving(true);
    const mailed = await sendApprovalEmail(currentUser.id, [selectedWeek]);
    setSaving(false);
    flash(mailed
      ? `서명을 완료하고 직원과 ${subRole}에게 메일을 보냈습니다.`
      : "서명은 완료했지만 메일을 보내지 못했습니다.");
  }

  async function rejectCurrent() {
    if (!window.confirm("이 업무일지를 반려하시겠습니까?")) return;
    await updateCurrentStatus("반려");
  }

  async function openBulkSubmitDialog() {
    if (profile?.role === "직원" && dirtyRef.current && !(await saveCurrentRef.current(false))) return;
    const eligibleWeeks = pastWeeks.filter((week) => isBulkSubmittable(statusMap[week] ?? "작성중"));
    if (!eligibleWeeks.length) {
      flash("상신할 과거 주차가 없습니다.");
      return;
    }
    setBulkSubmitStartWeek(eligibleWeeks[0]);
    setBulkSubmitEndWeek(eligibleWeeks[eligibleWeeks.length - 1]);
    setBulkSubmitDialogOpen(true);
  }

  async function bulkSubmit() {
    if (!session?.user || profile?.role !== "직원" || savingRef.current) return;
    const startIndex = pastWeeks.indexOf(bulkSubmitStartWeek);
    const endIndex = pastWeeks.indexOf(bulkSubmitEndWeek);
    if (startIndex < 0 || endIndex < startIndex) {
      flash("종료 주차는 시작 주차와 같거나 이후여야 합니다.");
      return;
    }
    const targets = pastWeeks
      .slice(startIndex, endIndex + 1)
      .filter((week) => isBulkSubmittable(statusMap[week] ?? "작성중"));
    if (!targets.length) return flash("선택한 기간에 상신할 주차가 없습니다.");
    if (!window.confirm(`${bulkSubmitStartWeek}부터 ${bulkSubmitEndWeek}까지 상신 대상 ${targets.length}개 주차를 일괄 상신하시겠습니까?`)) return;
    setBulkSubmitDialogOpen(false);
    savingRef.current = true;
    setBusy(true);
    let success = 0;
    let failed = 0;
    try {
      for (const week of targets) {
        const { data: row, error: readError } = await supabase.from("work_logs").select("data").eq("user_id", session.user.id).eq("week", week).maybeSingle();
        if (readError) {
          failed += 1;
          continue;
        }
        const data = normalizeData(week, row?.data);
        data.attendance = data.attendance.map((item) => ({ ...item, start_time: item.start_time || defaultStart, end_time: item.end_time || defaultEnd }));
        const { error } = await supabase.from("work_logs").upsert({ user_id: session.user.id, email: profile.email, week, status: "서명 대기", data }, { onConflict: "user_id,week" });
        if (error) failed += 1;
        else success += 1;
      }
      await loadStatusMap(selectedEmail);
      await loadLog(selectedWeek, selectedEmail);
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
    flash(failed ? `${success}개 주차를 상신했고, ${failed}개는 처리하지 못했습니다.` : `${success}개 주차를 상신했습니다.`);
  }

  async function bulkApprove() {
    if (profile?.role !== "관리자" || !currentUser || bulkApprovingRef.current) return;
    const targets = weeks.filter((week) => nextApprovalStatus(statusMap[week] ?? "작성중") !== (statusMap[week] ?? "작성중"));
    if (!targets.length) return flash("현재 서명할 업무일지가 없습니다.");
    if (!window.confirm(`${currentUser.name ?? currentUser.email}님의 업무일지 ${targets.length}건을 일괄 서명하시겠습니까?`)) return;
    bulkApprovingRef.current = true;
    setBulkProgress({ active: true, phase: "signing", completed: 0, total: targets.length, currentWeek: targets[0] });
    const approvedWeeks: string[] = [];
    try {
      for (const [index, week] of targets.entries()) {
        setBulkProgress({ active: true, phase: "signing", completed: index, total: targets.length, currentWeek: week });
        const currentStatus = statusMap[week] ?? "작성중";
        const next = nextApprovalStatus(currentStatus);
        const { data: updated, error } = await supabase
          .from("work_logs")
          .update({ status: next })
          .eq("user_id", currentUser.id)
          .eq("week", week)
          .eq("status", currentStatus)
          .select("id")
          .maybeSingle();
        if (!error && updated) approvedWeeks.push(week);
        setBulkProgress({ active: true, phase: "signing", completed: index + 1, total: targets.length, currentWeek: week });
      }
      setBulkProgress({ active: true, phase: "refreshing", completed: targets.length, total: targets.length, currentWeek: "" });
      await loadStatusMap(selectedEmail);
      await loadLog(selectedWeek, selectedEmail);
      setBulkProgress({ active: true, phase: "mailing", completed: targets.length, total: targets.length, currentWeek: "" });
      const mailed = approvedWeeks.length > 0
        ? await sendApprovalEmail(currentUser.id, approvedWeeks)
        : false;
      setBulkProgress({ active: true, phase: "complete", completed: targets.length, total: targets.length, currentWeek: "" });
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      flash(approvedWeeks.length === 0
        ? "서명된 업무일지가 없습니다."
        : mailed
          ? `${approvedWeeks.length}건을 서명하고 직원과 ${subRole}에게 메일을 보냈습니다.`
          : `${approvedWeeks.length}건은 서명했지만 메일을 보내지 못했습니다.`);
    } catch {
      flash(approvedWeeks.length
        ? `${approvedWeeks.length}건 서명 후 작업이 중단되었습니다. 최신 상태를 확인해 주세요.`
        : "일괄 서명을 완료하지 못했습니다. 다시 시도해 주세요.");
      await loadStatusMap(selectedEmail);
      await loadLog(selectedWeek, selectedEmail);
    } finally {
      bulkApprovingRef.current = false;
      setBulkProgress(null);
    }
  }

  async function sendApprovalEmail(targetUserId: string, approvedWeeks: string[]) {
    if (!session?.access_token || !approvedWeeks.length) return false;
    try {
      const response = await fetch("/api/approval-email", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ targetUserId, weeks: approvedWeeks }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function changeLeaveTotal(value: number) {
    setLeaveTotal(value);
    if (profile?.role !== "직원") return;
    const { error } = await supabase.from("leave_entitlements").upsert({ email: profile.email, total_days: value, updated_at: new Date().toISOString() });
    if (error) flash(`연차 일수를 저장하지 못했습니다: ${error.message}`);
  }

  if (!session) return <AuthScreen busy={busy} supabase={supabase} />;
  if (!profile || !currentUser) return <LoadingScreen message="사용자 정보를 불러오는 중입니다" />;

  const leaveRows = historyLogs.flatMap((log) => (log.data?.attendance ?? [])
    .filter((item) => item.leave_type && item.leave_type !== "-")
    .map((item) => ({ ...item, week: log.week })));
  const usedLeave = leaveRows.reduce((sum, item) => sum + ({ 연차: 1, 반차: 0.5, 반반차: 0.25 }[item.leave_type] ?? 0), 0);
  const specialRows = historyLogs.flatMap((log) => (log.data?.special ?? [])
    .filter((item) => item["업무 내용"] || item.날짜)
    .map((item) => ({ ...item, week: log.week })));
  const specialMinutes = specialRows.reduce((sum, item) => sum + durationMinutes(item["소요 시간"]), 0);

  return (
    <div className="app-shell">
      <aside className="sidebar no-print">
        <div className="brand">
          <span className="brand-mark">업</span>
          <div><strong>업무일지</strong><small>Weekly Work Log</small></div>
        </div>

        <div className="profile-card">
          <div className="avatar">{(profile.name ?? profile.email).slice(0, 1)}</div>
          <div><strong>{profile.name ?? profile.email.split("@")[0]}</strong><span>{subRole}</span></div>
        </div>

        {profile.role === "관리자" && (
          <label className="field-label">직원 선택
            <select value={selectedEmail} onChange={(event) => selectUser(event.target.value)}>
              {users.map((user) => <option key={user.id} value={user.email}>{user.name ?? "이름 없음"} · {user.email}</option>)}
            </select>
          </label>
        )}

        <nav className="side-nav" aria-label="주요 화면">
          <button className={view === "journal" ? "active" : ""} onClick={() => selectView("journal")}><span>▤</span> 주간 업무일지</button>
          <button className={view === "leave" ? "active" : ""} onClick={() => selectView("leave")}><span>◷</span> 휴가 사용 내역</button>
          <button className={view === "special" ? "active" : ""} onClick={() => selectView("special")}><span>⌁</span> 특근 모아보기</button>
        </nav>
        <p className="week-shortcut-hint"><span>주차 이동</span><kbd>Shift</kbd><b>+</b><kbd>←</kbd><b>/</b><kbd>→</kbd></p>

        {view === "journal" && (
          <div className="side-actions">
            <button onClick={openPdfDialog} disabled={pdfExporting || busy || saving}>
              {pdfExporting ? "PDF 생성 중…" : "기간별 PDF 저장"}
            </button>
            {profile.role === "직원" && <button onClick={openBulkSubmitDialog} disabled={busy || saving}>과거 주차 일괄 상신</button>}
            {profile.role === "관리자" && <button onClick={bulkApprove}>대기 문서 일괄 서명</button>}
          </div>
        )}

        <div className="sidebar-spacer" />

        {profile.role === "직원" && (
          <div className="compact-settings">
            <strong>기본 출퇴근 시간</strong>
            <div className="time-row"><input value={defaultStart} onChange={(e) => setDefaultStart(e.target.value)} aria-label="기본 출근 시간" /><span>—</span><input value={defaultEnd} onChange={(e) => setDefaultEnd(e.target.value)} aria-label="기본 퇴근 시간" /></div>
            <button className="text-button" onClick={fillDefaultTimes}>빈 시간에 적용</button>
            <label>연차 최대 사용가능 수
              <select value={leaveTotal} onChange={(event) => changeLeaveTotal(Number(event.target.value))}>
                {Array.from({ length: 25 }, (_, index) => index + 1).map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
          </div>
        )}

        <button className="logout" onClick={logout} disabled={saving}>로그아웃</button>
      </aside>

      <main className="main-area">
        {view !== "journal" && (
          <header className="topbar no-print">
            <h1>{view === "leave" ? "휴가 사용 내역" : "특근 모아보기"}</h1>
          </header>
        )}

        {view === "journal" && (
          <>
            <section className="toolbar no-print">
              <label>주차
                <select value={selectedWeek} onChange={(event) => selectWeek(event.target.value)} aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown" title="Shift + 방향키로 주차 이동">
                  {filteredWeeks.map((week) => <option key={week}>{week}</option>)}
                </select>
              </label>
              <label>보기
                <select value={filter} onChange={(event) => selectFilter(event.target.value)}>
                  <option>전체</option><option>부센터장 서명 전</option><option>센터장 서명 전</option><option>서명 완료</option><option>작성중</option>
                </select>
              </label>
              <div className={`status-pill ${statusClass(status)}`}>{status}</div>
              <div className="toolbar-spacer" />
              {profile.role === "직원" && canEdit && <button className="button secondary" onClick={() => saveCurrent()} disabled={saving}>{saving ? "저장 중…" : dirty ? "변경사항 저장" : "저장됨"}</button>}
              {profile.role === "직원" && canEdit && <button className="button primary" onClick={submitCurrent}>서명 대기 상신</button>}
              {profile.role === "관리자" && ["서명 대기", "부센터장만 서명", "센터장만 서명"].includes(status) && <button className="button primary" onClick={approveCurrent}>{subRole} 서명</button>}
              {profile.role === "관리자" && status !== "작성중" && status !== "반려" && <button className="button danger" onClick={rejectCurrent}>반려</button>}
            </section>

            <section className="journal print-area">
              <div className="journal-heading">
                <div className="week-range"><strong className="print-only">{selectedWeek} 업무일지 · </strong>{isoDate(selectedMonday)} — {isoDate(selectedFriday)}</div>
                <div className="approval-box">
                  <span>결재</span>
                  <div><small>부센터장</small><strong>{["부센터장만 서명", "서명 완료"].includes(status) ? "✓" : ""}</strong></div>
                  <div><small>센터장</small><strong>{["센터장만 서명", "서명 완료"].includes(status) ? "✓" : ""}</strong></div>
                </div>
              </div>
              <SectionTitle number="01" title="금주 목표" subtitle="이번 주에 달성할 핵심 목표를 기록하세요" />
              <div className="weekly-overview-grid">
                <div>
                  <div className="task-table goals-table">
                    <div className="table-head"><span>목표 내용</span><span>진행률</span><span /></div>
                    {weekData.weekly_goals.map((task, index) => (
                      <TaskRow key={index} task={task} disabled={!canEdit} onChange={(field, value) => markChanged((current) => ({ ...current, weekly_goals: current.weekly_goals.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }))} onRemove={() => markChanged((current) => ({ ...current, weekly_goals: current.weekly_goals.filter((_, itemIndex) => itemIndex !== index) }))} />
                    ))}
                  </div>
                  {canEdit && <button className="add-row no-print" onClick={() => markChanged((current) => ({ ...current, weekly_goals: [...current.weekly_goals, blankTask()] }))}>＋ 목표 추가</button>}
                </div>

                <label className="weekly-note"><span>주간 메모</span><textarea disabled={!canEdit} value={weekData.weekly_comment} onChange={(event) => markChanged((current) => ({ ...current, weekly_comment: event.target.value }))} placeholder="이번 주 공유할 내용이나 특이사항을 입력하세요" /></label>
              </div>

              <SectionTitle number="02" title="요일별 업무 내역" subtitle="출퇴근, 휴가와 업무 진행 상황을 함께 관리합니다" />
              <div className="days-grid">
                {DAYS.map((day, dayIndex) => {
                  const date = new Date(selectedMonday); date.setDate(date.getDate() + dayIndex);
                  const dateText = isoDate(date);
                  const attendance = weekData.attendance.find((item) => item.date === dateText) ?? { date: dateText, start_time: "", end_time: "", leave_type: "-" };
                  const tasks = weekData.daily.filter((item) => item.날짜 === dateText);
                  return (
                    <article className="day-card" key={dateText}>
                      <header><div><strong>{day}</strong><span>{formatShortDate(date)}</span></div><div className="attendance"><label>출근<input disabled={!canEdit} value={attendance.start_time} onChange={(event) => markChanged((current) => ({ ...current, attendance: current.attendance.map((item) => item.date === dateText ? { ...item, start_time: event.target.value } : item) }))} /></label><label>퇴근<input disabled={!canEdit} value={attendance.end_time} onChange={(event) => markChanged((current) => ({ ...current, attendance: current.attendance.map((item) => item.date === dateText ? { ...item, end_time: event.target.value } : item) }))} /></label><label>휴가<select disabled={!canEdit} value={attendance.leave_type} onChange={(event) => markChanged((current) => ({ ...current, attendance: current.attendance.map((item) => item.date === dateText ? { ...item, leave_type: event.target.value } : item) }))}>{LEAVE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label></div></header>
                      <div className="task-table"><div className="table-head"><span>업무 내용</span><span>진행률</span><span /></div>{tasks.map((task, taskIndex) => {
                        const absoluteIndex = weekData.daily.findIndex((item, index) => item.날짜 === dateText && weekData.daily.filter((candidate, candidateIndex) => candidateIndex <= index && candidate.날짜 === dateText).length - 1 === taskIndex);
                        return <TaskRow key={`${dateText}-${taskIndex}`} task={task} disabled={!canEdit} onChange={(field, value) => markChanged((current) => ({ ...current, daily: current.daily.map((item, index) => index === absoluteIndex ? { ...item, [field]: value } : item) }))} onRemove={() => markChanged((current) => ({ ...current, daily: current.daily.filter((_, index) => index !== absoluteIndex) }))} />;
                      })}</div>
                      {canEdit && <button className="add-row no-print" onClick={() => markChanged((current) => ({ ...current, daily: [...current.daily, { ...blankTask(), 날짜: dateText }] }))}>＋ 업무 추가</button>}
                    </article>
                  );
                })}
              </div>

              <SectionTitle number="03" title="특근 및 초과 근무" subtitle="업무 시간과 내용을 분 단위로 기록합니다" />
              <div className="special-table">
                <div className="special-head"><span>날짜</span><span>요일</span><span>시작</span><span>소요 시간</span><span>업무 내용</span><span>진행률</span><span /></div>
                {weekData.special.map((item, index) => <SpecialRow key={index} item={item} disabled={!canEdit} onChange={(field, value) => markChanged((current) => ({ ...current, special: current.special.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row) }))} onRemove={() => markChanged((current) => ({ ...current, special: current.special.filter((_, rowIndex) => rowIndex !== index) }))} />)}
              </div>
              {canEdit && <button className="add-row no-print" onClick={() => markChanged((current) => ({ ...current, special: [...current.special, blankSpecial()] }))}>＋ 특근 내역 추가</button>}
            </section>
          </>
        )}

        {view === "leave" && <HistoryView title="휴가 사용 현황" metric={`잔여 ${leaveTotal - usedLeave}일`} summary={`총 발생 ${leaveTotal}일 · 사용 ${usedLeave}일`} columns={["주차", "날짜", "구분", "출근", "퇴근"]} rows={leaveRows.map((row) => [row.week, row.date, row.leave_type, row.start_time, row.end_time])} empty="기록된 휴가 내역이 없습니다." />}
        {view === "special" && <HistoryView title="특근 누적 현황" metric={`${Math.floor(specialMinutes / 60)}시간 ${specialMinutes % 60}분`} summary={`총 ${specialRows.length}건의 특근 기록`} columns={["주차", "날짜", "시작", "소요", "업무 내용"]} rows={specialRows.map((row) => [row.week, row.날짜, row["시작 시각"], row["소요 시간"], row["업무 내용"]])} empty="기록된 특근 내역이 없습니다." />}
      </main>

      {bulkProgress?.active && <BulkApprovalOverlay progress={bulkProgress} />}
      {pdfDialogOpen && <PdfRangeDialog weeks={weeks} startWeek={pdfStartWeek} endWeek={pdfEndWeek} onStartChange={setPdfStartWeek} onEndChange={setPdfEndWeek} onClose={() => setPdfDialogOpen(false)} onDownload={downloadPdfRange} />}
      {bulkSubmitDialogOpen && <BulkSubmitRangeDialog weeks={pastWeeks} statusMap={statusMap} startWeek={bulkSubmitStartWeek} endWeek={bulkSubmitEndWeek} onStartChange={setBulkSubmitStartWeek} onEndChange={setBulkSubmitEndWeek} onClose={() => setBulkSubmitDialogOpen(false)} onSubmit={bulkSubmit} />}
      {!bulkProgress?.active && (busy || saving || pdfExporting) && <div className="loading-overlay"><div className="spinner" /><span>{pdfExporting ? `${pdfCompleted} / ${pdfTotal}개 PDF 생성 후 압축 중입니다` : saving ? "저장 중입니다" : "데이터를 불러오는 중입니다"}</span></div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

function PdfRangeDialog({ weeks, startWeek, endWeek, onStartChange, onEndChange, onClose, onDownload }: {
  weeks: string[];
  startWeek: string;
  endWeek: string;
  onStartChange: (week: string) => void;
  onEndChange: (week: string) => void;
  onClose: () => void;
  onDownload: () => void;
}) {
  const startIndex = weeks.indexOf(startWeek);
  const endIndex = weeks.indexOf(endWeek);
  const count = startIndex >= 0 && endIndex >= startIndex ? endIndex - startIndex + 1 : 0;
  const startDate = mondayOfWeek(startWeek);
  const endDate = mondayOfWeek(endWeek);
  endDate.setDate(endDate.getDate() + 4);
  return (
    <div className="pdf-range-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <section className="pdf-range-dialog" role="dialog" aria-modal="true" aria-labelledby="pdf-range-title">
        <span className="pdf-range-kicker">PDF 일괄 저장</span>
        <h2 id="pdf-range-title">저장할 기간을 선택하세요</h2>
        <p>선택 기간의 각 주차를 개별 PDF로 만든 뒤 하나의 ZIP 파일로 압축합니다.</p>
        <div className="pdf-range-fields">
          <label>시작 주차
            <select value={startWeek} onChange={(event) => onStartChange(event.target.value)}>
              {weeks.map((week) => <option key={week}>{week}</option>)}
            </select>
          </label>
          <span aria-hidden="true">→</span>
          <label>종료 주차
            <select value={endWeek} onChange={(event) => onEndChange(event.target.value)}>
              {weeks.map((week) => <option key={week}>{week}</option>)}
            </select>
          </label>
        </div>
        <div className={`pdf-range-summary ${count ? "" : "invalid"}`}>
          <strong>{count ? `${count}개 주차` : "기간 확인 필요"}</strong>
          <span>{count ? `${isoDate(startDate)} — ${isoDate(endDate)}` : "종료 주차를 시작 주차 이후로 선택하세요."}</span>
        </div>
        <div className="pdf-range-actions">
          <button type="button" className="button secondary" onClick={onClose}>취소</button>
          <button type="button" className="button primary" onClick={onDownload} disabled={!count}>{count ? `${count}개 PDF 압축 저장` : "기간을 확인하세요"}</button>
        </div>
      </section>
    </div>
  );
}

function BulkSubmitRangeDialog({ weeks, statusMap, startWeek, endWeek, onStartChange, onEndChange, onClose, onSubmit }: {
  weeks: string[];
  statusMap: Record<string, string>;
  startWeek: string;
  endWeek: string;
  onStartChange: (week: string) => void;
  onEndChange: (week: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const startIndex = weeks.indexOf(startWeek);
  const endIndex = weeks.indexOf(endWeek);
  const rangeWeeks = startIndex >= 0 && endIndex >= startIndex ? weeks.slice(startIndex, endIndex + 1) : [];
  const targets = rangeWeeks.filter((week) => isBulkSubmittable(statusMap[week] ?? "작성중"));
  const startDate = mondayOfWeek(startWeek);
  const endDate = mondayOfWeek(endWeek);
  endDate.setDate(endDate.getDate() + 4);
  return (
    <div className="pdf-range-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <section className="pdf-range-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-submit-range-title">
        <span className="pdf-range-kicker">과거 주차 일괄 상신</span>
        <h2 id="bulk-submit-range-title">상신할 기간을 선택하세요</h2>
        <p>선택한 과거 기간 중 작성중 또는 반려 상태인 주차만 서명 대기로 상신합니다.</p>
        <div className="pdf-range-fields">
          <label>시작 주차
            <select value={startWeek} onChange={(event) => onStartChange(event.target.value)}>
              {weeks.map((week) => <option key={week}>{week}</option>)}
            </select>
          </label>
          <span aria-hidden="true">→</span>
          <label>종료 주차
            <select value={endWeek} onChange={(event) => onEndChange(event.target.value)}>
              {weeks.map((week) => <option key={week}>{week}</option>)}
            </select>
          </label>
        </div>
        <div className={`pdf-range-summary ${rangeWeeks.length && targets.length ? "" : "invalid"}`}>
          <strong>{rangeWeeks.length ? `${targets.length}개 상신 대상` : "기간 확인 필요"}</strong>
          <span>{rangeWeeks.length ? `${isoDate(startDate)} — ${isoDate(endDate)} · 선택 ${rangeWeeks.length}개 주차` : "종료 주차를 시작 주차 이후로 선택하세요."}</span>
        </div>
        <div className="pdf-range-actions">
          <button type="button" className="button secondary" onClick={onClose}>취소</button>
          <button type="button" className="button primary" onClick={onSubmit} disabled={!targets.length}>{targets.length ? `${targets.length}개 주차 상신` : "상신 대상 없음"}</button>
        </div>
      </section>
    </div>
  );
}

function BulkApprovalOverlay({ progress }: { progress: BulkApprovalProgress }) {
  const percent = progress.phase === "signing"
    ? Math.round((progress.completed / Math.max(progress.total, 1)) * 85)
    : progress.phase === "refreshing" ? 90 : progress.phase === "mailing" ? 96 : 100;
  const title = progress.phase === "signing"
    ? "대기 문서를 일괄 서명하고 있습니다"
    : progress.phase === "refreshing"
      ? "서명 결과를 확인하고 있습니다"
      : progress.phase === "mailing"
        ? "PDF 인쇄본을 생성하고 메일을 보내고 있습니다"
        : "일괄 서명 처리가 완료되었습니다";
  const detail = progress.phase === "signing"
    ? `${progress.completed} / ${progress.total}건 완료${progress.currentWeek ? ` · ${progress.currentWeek}` : ""}`
    : progress.phase === "refreshing"
      ? "최신 결재 상태를 불러오는 중입니다"
      : progress.phase === "mailing"
        ? `${progress.total}개 주차의 PDF 첨부 작업을 진행 중입니다`
        : `${progress.completed}건의 처리를 마쳤습니다`;

  return (
    <div className="bulk-progress-overlay" role="alertdialog" aria-modal="true" aria-labelledby="bulk-progress-title" aria-describedby="bulk-progress-detail">
      <div className="bulk-progress-card">
        <div className="bulk-progress-icon" aria-hidden="true"><div className="spinner" /></div>
        <span className="bulk-progress-kicker">일괄 결재 진행 중</span>
        <h2 id="bulk-progress-title">{title}</h2>
        <p id="bulk-progress-detail">{detail}</p>
        <div className="bulk-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="일괄 서명 진행률">
          <div className="bulk-progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="bulk-progress-meta"><strong>{percent}%</strong><span>완료될 때까지 화면을 닫거나 새로고침하지 마세요.</span></div>
      </div>
    </div>
  );
}

function AuthScreen({
  busy,
  supabase,
}: {
  busy: boolean;
  supabase: ReturnType<typeof createSupabaseBrowserClient>;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<AuthFeedback>(null);

  function showFeedback(message: string, tone: AuthFeedbackTone) {
    setFeedback({ message, tone });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "signup" && password !== confirm) return showFeedback("비밀번호가 일치하지 않습니다.", "error");
    if (password.length < 6) return showFeedback("비밀번호는 6자 이상이어야 합니다.", "error");
    setFeedback(null);
    setSubmitting(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const errorText = error.message.toLowerCase();
        const emailNotRegistered = error.code === "user_not_found" || errorText.includes("user not found") || errorText.includes("email not found");
        const invalidCredentials = error.code === "invalid_credentials" || errorText === "invalid login credentials";
        showFeedback(
          emailNotRegistered
            ? "등록되지 않은 이메일입니다. 이메일 주소를 확인해 주세요."
            : invalidCredentials
              ? "이메일 또는 비밀번호가 올바르지 않습니다. 비밀번호를 다시 확인해 주세요."
              : error.message,
          "error",
        );
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name }, emailRedirectTo: window.location.origin },
      });
      if (error) showFeedback(error.message, "error");
      else if (!data.session) showFeedback("가입 확인 메일을 보냈습니다. 메일의 링크를 누른 후 로그인하세요. 혹시 메일이 보이지 않으면 메일 스팸함과 입력하신 메일 주소를 다시 확인해주세요.", "success");
      else showFeedback("회원가입이 완료되었습니다.", "success");
    }
    setSubmitting(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="intro-mark">업</div>
        <p className="eyebrow">SMART WEEKLY LOG</p>
        <h1>한 주의 업무를<br />명료하게 기록합니다.</h1>
        <p>업무 목표부터 출퇴근, 휴가, 특근과 관리자 서명까지 하나의 흐름으로 관리하세요.</p>
        <div className="intro-features"><span>주간 업무 기록</span><span>2단계 서명</span><span>휴가·특근 집계</span></div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setFeedback(null); }}>로그인</button><button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setFeedback(null); }}>회원가입</button></div>
          <div className="auth-heading"><h2>{mode === "login" ? "다시 만나 반갑습니다" : "업무일지 시작하기"}</h2><p>{mode === "login" ? "등록된 계정으로 로그인하세요." : "실명과 이메일로 새 계정을 만드세요."}</p></div>
          <form onSubmit={submit}>
            {mode === "signup" && <label>이름<input required value={name} onChange={(event) => { setName(event.target.value); setFeedback(null); }} placeholder="실명 입력" /></label>}
            <label>이메일<input type="email" required value={email} onChange={(event) => { setEmail(event.target.value); setFeedback(null); }} placeholder="email@company.com" /></label>
            <label>비밀번호<input type="password" required value={password} onChange={(event) => { setPassword(event.target.value); setFeedback(null); }} placeholder="6자 이상" /></label>
            {mode === "signup" && <label>비밀번호 확인<input type="password" required value={confirm} onChange={(event) => { setConfirm(event.target.value); setFeedback(null); }} placeholder="비밀번호 다시 입력" /></label>}
            {feedback && <div className={`auth-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.message}</div>}
            <button className="button primary auth-submit" disabled={submitting || busy}>{submitting ? "처리 중…" : mode === "login" ? "로그인" : "가입하기"}</button>
          </form>
          <small className="auth-footnote">계정 및 업무 데이터는 기존 Supabase 프로젝트와 동일하게 연결됩니다.</small>
        </div>
      </section>
    </main>
  );
}

function LoadingScreen({ message }: { message: string }) {
  return <main className="loading-page"><div className="spinner" /><p>{message}</p></main>;
}

function SectionTitle({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return <div className="section-title"><span>{number}</span><div><h3>{title}</h3><p>{subtitle}</p></div></div>;
}

function TaskRow({ task, disabled, onChange, onRemove }: { task: Task; disabled: boolean; onChange: (field: "업무내용" | "진행률", value: string) => void; onRemove: () => void }) {
  return <div className="task-row"><input disabled={disabled} value={task.업무내용 ?? ""} onChange={(event) => onChange("업무내용", event.target.value)} placeholder="업무 내용을 입력하세요" /><input disabled={disabled} value={task.진행률 ?? ""} onChange={(event) => onChange("진행률", event.target.value)} placeholder="0%" />{!disabled ? <button className="remove-row no-print" onClick={onRemove} aria-label="행 삭제">×</button> : <span />}</div>;
}

function SpecialRow({ item, disabled, onChange, onRemove }: { item: SpecialTask; disabled: boolean; onChange: (field: keyof SpecialTask, value: string) => void; onRemove: () => void }) {
  return <div className="special-row"><input disabled={disabled} value={item.날짜 ?? ""} onChange={(e) => onChange("날짜", e.target.value)} placeholder="2026-01-01" /><input disabled={disabled} value={item.요일 ?? ""} onChange={(e) => onChange("요일", e.target.value)} placeholder="월" /><input disabled={disabled} value={item["시작 시각"] ?? ""} onChange={(e) => onChange("시작 시각", e.target.value)} placeholder="18:00" /><input disabled={disabled} value={item["소요 시간"] ?? ""} onChange={(e) => onChange("소요 시간", e.target.value)} placeholder="60분" /><input disabled={disabled} value={item["업무 내용"] ?? ""} onChange={(e) => onChange("업무 내용", e.target.value)} placeholder="특근 업무 내용" /><input disabled={disabled} value={item.진행률 ?? ""} onChange={(e) => onChange("진행률", e.target.value)} placeholder="100%" />{!disabled ? <button className="remove-row no-print" onClick={onRemove} aria-label="행 삭제">×</button> : <span />}</div>;
}

function HistoryView({ title, metric, summary, columns, rows, empty }: { title: string; metric: string; summary: string; columns: string[]; rows: string[][]; empty: string }) {
  return <section className="history-view"><div className="history-summary"><div><p>{title}</p><strong>{metric}</strong><span>{summary}</span></div><div className="summary-art">{rows.length}</div></div><div className="history-table"><div className="history-head">{columns.map((column) => <span key={column}>{column}</span>)}</div>{rows.length ? rows.map((row, index) => <div className="history-row" key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <span key={cellIndex}>{cell || "-"}</span>)}</div>) : <div className="empty-state"><strong>아직 기록이 없습니다</strong><p>{empty}</p></div>}</div></section>;
}
