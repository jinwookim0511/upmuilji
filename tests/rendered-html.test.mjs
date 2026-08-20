import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps Supabase values out of tracked source", async () => {
  const [page, supabaseClient, exampleEnv, gitignore] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/supabase.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);

  assert.match(page, /process\.env\.SUPABASE_URL/);
  assert.match(page, /process\.env\.SUPABASE_PUBLISHABLE_KEY/);
  assert.match(supabaseClient, /createSupabaseBrowserClient/);
  assert.doesNotMatch(
    `${page}\n${supabaseClient}\n${exampleEnv}`,
    /sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  );
  assert.match(exampleEnv, /^SUPABASE_URL=$/m);
  assert.match(exampleEnv, /^SUPABASE_PUBLISHABLE_KEY=$/m);
  assert.match(gitignore, /^\.env\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
});

test("uses the Vercel-compatible Next.js and Node mail runtimes", async () => {
  const [packageJson, mailRoute] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/approval-email/route.ts", import.meta.url), "utf8"),
  ]);
  const pkg = JSON.parse(packageJson);

  assert.equal(pkg.scripts.dev, "next dev");
  assert.equal(pkg.scripts.build, "next build --webpack");
  assert.equal(pkg.scripts.start, "next start");
  assert.equal(typeof pkg.dependencies.next, "string");
  assert.equal(typeof pkg.dependencies.nodemailer, "string");
  assert.match(mailRoute, /nodemailer\.createTransport/);
  assert.match(mailRoute, /new URL\(request\.url\)\.origin/);
  assert.doesNotMatch(mailRoute, /cloudflare:sockets|chatgpt\.site/);
});

test("lets employees choose a range for past-week bulk submission", async () => {
  const workLogApp = await readFile(new URL("../app/WorkLogApp.tsx", import.meta.url), "utf8");

  assert.match(workLogApp, /function BulkSubmitRangeDialog/);
  assert.match(workLogApp, /상신할 기간을 선택하세요/);
  assert.match(workLogApp, /pastWeeks\s*\.slice\(startIndex, endIndex \+ 1\)/);
  assert.match(workLogApp, /isBulkSubmittable\(statusMap\[week\] \?\? "작성중"\)/);
  assert.match(workLogApp, /disabled=\{!targets\.length\}/);
});

test("saves an employee's draft before signing out", async () => {
  const workLogApp = await readFile(new URL("../app/WorkLogApp.tsx", import.meta.url), "utf8");
  const logoutStart = workLogApp.indexOf("async function logout()");
  const logoutEnd = workLogApp.indexOf("function openPdfDialog()", logoutStart);
  const logout = workLogApp.slice(logoutStart, logoutEnd);

  assert.notEqual(logoutStart, -1);
  assert.notEqual(logoutEnd, -1);
  assert.match(logout, /profile\?\.role === "직원" && dirtyRef\.current/);
  assert.match(logout, /const saved = await saveCurrent\(false\)/);
  assert.ok(logout.indexOf("await saveCurrent(false)") < logout.indexOf("await supabase.auth.signOut()"));
  assert.match(workLogApp, /className="logout" onClick=\{logout\} disabled=\{saving\}/);
});

test("restores the last selected week after a reload", async () => {
  const workLogApp = await readFile(new URL("../app/WorkLogApp.tsx", import.meta.url), "utf8");

  assert.match(workLogApp, /upmuilji:last-selected-week:\$\{userId\}/);
  assert.match(workLogApp, /savedWeek && weeks\.includes\(savedWeek\) \? savedWeek : null/);
  assert.match(workLogApp, /setSelectedWeek\(savedWeekSelection\(nextProfile\.id, weeks\) \?\? closestWeekToToday\(weeks\)\)/);
  assert.match(workLogApp, /saveWeekSelection\(profile\.id, selectedWeek\)/);
  assert.match(workLogApp, /const sessionUserId = session\?\.user\.id \?\? null/);
  assert.match(workLogApp, /\}, \[flash, profile\?\.id, sessionUserEmail, sessionUserId, supabase, weeks\]\)/);
  assert.match(workLogApp, /if \(profile\) saveWeekSelection\(profile\.id, week\);[\s\S]*setSelectedWeek\(week\)/);
  assert.doesNotMatch(workLogApp, /\}, \[flash, session, supabase, weeks\]\)/);
  assert.match(workLogApp, /const restoredWeekUserRef = useRef<string \| null>\(null\)/);
  assert.match(workLogApp, /if \(restoredWeekUserRef\.current !== nextProfile\.id\) \{[\s\S]*restoredWeekUserRef\.current = nextProfile\.id;[\s\S]*setSelectedWeek\(savedWeekSelection/);
  assert.match(workLogApp, /if \(event === "SIGNED_OUT"\) restoredWeekUserRef\.current = null/);
  assert.match(workLogApp, /if \(!sessionUserId \|\| profile\?\.id === sessionUserId\) return;/);
});

test("autosaves employee drafts across interactions and browser exit", async () => {
  const [workLogApp, migration] = await Promise.all([
    readFile(new URL("../app/WorkLogApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819075850_protect_admin_work_log_content.sql", import.meta.url), "utf8"),
  ]);

  assert.match(workLogApp, /const AUTO_SAVE_DEBOUNCE_MS = 800/);
  assert.match(workLogApp, /keepalive: true/);
  assert.match(workLogApp, /window\.addEventListener\("beforeunload", persistDraftOnExit\)/);
  assert.match(workLogApp, /window\.addEventListener\("pagehide", persistDraftOnExit\)/);
  assert.match(workLogApp, /window\.addEventListener\("blur", persistDraftOnExit\)/);
  assert.match(workLogApp, /document\.addEventListener\("visibilitychange", saveWhenHidden\)/);
  assert.doesNotMatch(workLogApp, /addEventListener\("focus",[^\n]*(loadLog|loadProfile|loadStatusMap)/);
  assert.match(workLogApp, /document\.addEventListener\("click", saveAfterInteraction\)/);
  assert.match(workLogApp, /document\.addEventListener\("change", saveAfterInteraction\)/);
  assert.match(workLogApp, /async function selectView\(nextView: View\)[\s\S]*await saveBeforeAction/);
  assert.match(workLogApp, /async function selectFilter\(nextFilter: string\)[\s\S]*await saveBeforeAction/);
  assert.match(workLogApp, /if \(profile\?\.role !== "직원" \|\| !canEdit\) return;/);
  assert.match(workLogApp, /const nextWeekData = updater\(weekDataRef\.current\)/);
  assert.match(workLogApp, /draftSnapshotRef\.current = \{[\s\S]*data: nextWeekData,[\s\S]*version: draftVersionRef\.current/);
  assert.match(workLogApp, /const version = draftVersionRef\.current;[\s\S]*data: weekDataRef\.current/);

  assert.match(migration, /create trigger enforce_admin_work_log_status_only/);
  assert.match(migration, /create policy work_logs_insert_authenticated/);
  assert.match(migration, /user_roles\.role = '직원'/);
  assert.match(migration, /new\.data is distinct from old\.data/);
  assert.match(migration, /role = '관리자'/);
  assert.match(migration, /errcode = '42501'/);
});

test("generates Korean PDFs with a subsetted Nanum Gothic font", async () => {
  const [packageJson, nextConfig, pdfGenerator] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/approval-email/work-log-pdf.ts", import.meta.url), "utf8"),
  ]);
  const pkg = JSON.parse(packageJson);

  assert.equal(pkg.dependencies.pdfkit, "0.19.1");
  assert.equal(pkg.dependencies["@fontsource/nanum-gothic"], undefined);
  assert.equal(pkg.dependencies["pdf-lib"], undefined);
  assert.equal(pkg.dependencies["@pdf-lib/fontkit"], undefined);
  assert.equal(pkg.dependencies["@fontsource/nanum-gothic-coding"], undefined);
  assert.match(nextConfig, /NanumGothic-Regular\.ttf/);
  assert.match(pdfGenerator, /import PDFDocument from "pdfkit"/);
  assert.match(pdfGenerator, /registerFont\(FONT_NAME, fontData\)/);
  assert.match(pdfGenerator, /creates a subset and adds only glyphs used/);
  assert.doesNotMatch(pdfGenerator, /subset:\s*false|NanumGothicCoding/);
});
