import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";

type Task = {
  날짜?: string;
  업무내용?: string;
  진행률?: string;
};

type Attendance = {
  date?: string;
  start_time?: string;
  end_time?: string;
  leave_type?: string;
};

type SpecialTask = {
  날짜?: string;
  요일?: string;
  "시작 시각"?: string;
  "소요 시간"?: string;
  "업무 내용"?: string;
  진행률?: string;
};

export type WorkLogRecord = {
  week: string;
  status: string;
  data: {
    daily?: Task[];
    attendance?: Attendance[];
    special?: SpecialTask[];
    weekly_goals?: Task[];
    weekly_comment?: string;
  } | null;
};

type PdfContext = {
  document: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  y: number;
};

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 34;
const CONTENT_WIDTH = A4[0] - MARGIN * 2;
const LINE = rgb(0.76, 0.79, 0.82);
const INK = rgb(0.12, 0.15, 0.19);
const MUTED = rgb(0.36, 0.4, 0.45);
const PALE = rgb(0.95, 0.96, 0.97);
const ACCENT = rgb(0.08, 0.39, 0.32);

function fontBytes() {
  return readFile(path.join(
    process.cwd(),
    "node_modules",
    "@fontsource",
    "nanum-gothic-coding",
    "files",
    "nanum-gothic-coding-korean-400-normal.woff",
  ));
}

function mondayOfWeek(week: string) {
  const match = week.match(/(\d+)년\s*(\d+)월\s*(\d+)주차/);
  if (!match) return new Date();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const weekNumber = Number(match[3]);
  if (year === 2026 && month === 1 && weekNumber === 0) return new Date(2025, 11, 29);
  const first = new Date(year, month - 1, 1);
  const firstMonday = 1 + ((8 - first.getDay()) % 7);
  return new Date(year, month - 1, firstMonday + (weekNumber - 1) * 7);
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clean(value: unknown, fallback = "-") {
  const text = typeof value === "string" ? value.replace(/\r/g, "").trim() : "";
  return text || fallback;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const character of paragraph) {
      const candidate = line + character;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

function newPage(context: PdfContext) {
  context.page = context.document.addPage(A4);
  context.y = A4[1] - MARGIN;
}

function ensureSpace(context: PdfContext, height: number) {
  if (context.y - height < MARGIN) newPage(context);
}

function drawText(context: PdfContext, value: string, x: number, y: number, size = 9, color = INK) {
  context.page.drawText(value, { x, y, size, font: context.font, color });
}

function sectionTitle(context: PdfContext, number: string, title: string) {
  ensureSpace(context, 30);
  context.page.drawRectangle({ x: MARGIN, y: context.y - 18, width: CONTENT_WIDTH, height: 22, color: PALE });
  drawText(context, number, MARGIN + 7, context.y - 12, 8, ACCENT);
  drawText(context, title, MARGIN + 31, context.y - 13, 11, INK);
  context.y -= 29;
}

function tableRow(context: PdfContext, cells: string[], widths: number[], options?: { header?: boolean; minHeight?: number }) {
  const size = options?.header ? 8 : 8.5;
  const padding = 5;
  const wrapped = cells.map((cell, index) => wrapText(clean(cell), context.font, size, widths[index] - padding * 2));
  const lineHeight = size + 3;
  const height = Math.max(options?.minHeight ?? 22, ...wrapped.map((lines) => lines.length * lineHeight + padding * 2));
  ensureSpace(context, height);
  let x = MARGIN;
  for (let index = 0; index < cells.length; index += 1) {
    context.page.drawRectangle({
      x,
      y: context.y - height,
      width: widths[index],
      height,
      color: options?.header ? PALE : rgb(1, 1, 1),
      borderColor: LINE,
      borderWidth: 0.6,
    });
    wrapped[index].forEach((line, lineIndex) => {
      drawText(context, line, x + padding, context.y - padding - size - lineIndex * lineHeight, size, options?.header ? MUTED : INK);
    });
    x += widths[index];
  }
  context.y -= height;
}

function drawApproval(context: PdfContext, status: string) {
  const x = A4[0] - MARGIN - 154;
  const y = context.y - 34;
  const widths = [34, 60, 60];
  const labels = ["결재", "부센터장", "센터장"];
  let cursor = x;
  labels.forEach((label, index) => {
    context.page.drawRectangle({ x: cursor, y, width: widths[index], height: 34, borderColor: LINE, borderWidth: 0.7, color: index === 0 ? PALE : rgb(1, 1, 1) });
    drawText(context, label, cursor + 5, y + 20, index === 0 ? 8 : 7.5, MUTED);
    const signed = index === 1
      ? ["부센터장만 서명", "서명 완료"].includes(status)
      : index === 2 && ["센터장만 서명", "서명 완료"].includes(status);
    if (signed) drawText(context, "서명", cursor + 18, y + 6, 9, ACCENT);
    cursor += widths[index];
  });
}

export async function createWorkLogPdf(record: WorkLogRecord, employeeName: string, employeeEmail: string) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(await fontBytes(), { subset: true });
  const context: PdfContext = { document, page: document.addPage(A4), font, y: A4[1] - MARGIN };
  const monday = mondayOfWeek(record.week);
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  const data = record.data ?? {};

  drawText(context, "주간 업무일지", MARGIN, context.y - 1, 18, INK);
  drawText(context, `${record.week}  ·  ${isoDate(monday)} — ${isoDate(friday)}`, MARGIN, context.y - 20, 9, MUTED);
  drawText(context, `작성자  ${employeeName} (${employeeEmail})`, MARGIN, context.y - 36, 8.5, MUTED);
  drawApproval(context, record.status);
  context.y -= 52;

  sectionTitle(context, "01", "금주 목표 및 주간 메모");
  tableRow(context, ["목표 내용", "진행률"], [CONTENT_WIDTH - 82, 82], { header: true });
  const goals = data.weekly_goals?.filter((item) => clean(item.업무내용, "") || clean(item.진행률, "")) ?? [];
  if (goals.length) goals.forEach((item) => tableRow(context, [clean(item.업무내용), clean(item.진행률)], [CONTENT_WIDTH - 82, 82]));
  else tableRow(context, ["기록 없음", "-"], [CONTENT_WIDTH - 82, 82]);
  context.y -= 7;
  tableRow(context, ["주간 메모", clean(data.weekly_comment, "기록 없음")], [82, CONTENT_WIDTH - 82], { minHeight: 32 });
  context.y -= 10;

  sectionTitle(context, "02", "요일별 업무 내역");
  const attendance = data.attendance ?? [];
  const daily = data.daily ?? [];
  ["월", "화", "수", "목", "금"].forEach((day, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    const dateText = isoDate(date);
    const time = attendance.find((item) => item.date === dateText) ?? {};
    ensureSpace(context, 50);
    context.page.drawRectangle({ x: MARGIN, y: context.y - 20, width: CONTENT_WIDTH, height: 20, color: rgb(0.98, 0.98, 0.985) });
    drawText(context, `${day}요일  ${dateText}`, MARGIN + 6, context.y - 14, 9.5, INK);
    drawText(context, `출근 ${clean(time.start_time)}   퇴근 ${clean(time.end_time)}   휴가 ${clean(time.leave_type)}`, MARGIN + 250, context.y - 14, 8, MUTED);
    context.y -= 20;
    tableRow(context, ["업무 내용", "진행률"], [CONTENT_WIDTH - 82, 82], { header: true });
    const tasks = daily.filter((item) => item.날짜 === dateText && (clean(item.업무내용, "") || clean(item.진행률, "")));
    if (tasks.length) tasks.forEach((item) => tableRow(context, [clean(item.업무내용), clean(item.진행률)], [CONTENT_WIDTH - 82, 82]));
    else tableRow(context, ["기록 없음", "-"], [CONTENT_WIDTH - 82, 82]);
    context.y -= 7;
  });

  sectionTitle(context, "03", "특근 및 초과 근무");
  const specialWidths = [72, 38, 55, 64, CONTENT_WIDTH - 301, 72];
  tableRow(context, ["날짜", "요일", "시작", "소요 시간", "업무 내용", "진행률"], specialWidths, { header: true });
  const special = data.special?.filter((item) => Object.values(item).some((value) => clean(value, ""))) ?? [];
  if (special.length) {
    special.forEach((item) => tableRow(context, [clean(item.날짜), clean(item.요일), clean(item["시작 시각"]), clean(item["소요 시간"]), clean(item["업무 내용"]), clean(item.진행률)], specialWidths));
  } else {
    tableRow(context, ["-", "-", "-", "-", "기록 없음", "-"], specialWidths);
  }

  document.setTitle(`${record.week} 업무일지`);
  document.setAuthor(employeeName);
  document.setSubject("결재된 주간 업무일지");
  document.setCreator("업무일지 웹");
  const pages = document.getPages();
  pages.forEach((page, index) => {
    const label = `${index + 1} / ${pages.length}`;
    page.drawText(label, {
      x: (A4[0] - font.widthOfTextAtSize(label, 7)) / 2,
      y: 15,
      size: 7,
      font,
      color: MUTED,
    });
  });
  return document.save();
}
