import PDFDocument from "pdfkit";

declare const PDF_FONT_BASE64: string;

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
  document: PDFKit.PDFDocument;
  y: number;
};

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 34;
const FOOTER_HEIGHT = 20;
const CONTENT_WIDTH = A4[0] - MARGIN * 2;
const FONT_NAME = "NanumGothic";
const LINE = "#c2c9d1";
const INK = "#1f2630";
const MUTED = "#5c6673";
const PALE = "#f2f5f7";
const ACCENT = "#146451";
const DISPLAY_ONLY_TEXT = new Set([
  "업무 내용을 입력하세요",
  "특근 업무 내용",
  "이번 주 공유할 내용이나 특이사항을 입력하세요",
]);

function fontBytes() {
  const encoded = typeof PDF_FONT_BASE64 === "string" ? PDF_FONT_BASE64 : "";
  if (!encoded) throw new Error("PDF 글꼴 번들이 비어 있습니다.");
  return Buffer.from(encoded, "base64");
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
  return text && !DISPLAY_ONLY_TEXT.has(text) ? text : fallback;
}

function isDefaultSpecialTask(item: SpecialTask) {
  return clean(item["소요 시간"], "") === "60분"
    && ![item.날짜, item.요일, item["시작 시각"], item["업무 내용"], item.진행률].some((value) => clean(value, ""));
}

function selectFont(document: PDFKit.PDFDocument, size: number, color = INK) {
  document.font(FONT_NAME).fontSize(size).fillColor(color);
}

function wrapText(text: string, document: PDFKit.PDFDocument, size: number, maxWidth: number) {
  selectFont(document, size);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const character of paragraph) {
      const candidate = line + character;
      if (line && document.widthOfString(candidate) > maxWidth) {
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
  context.document.addPage({ size: A4, margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } });
  context.document.font(FONT_NAME);
  context.y = MARGIN;
}

function ensureSpace(context: PdfContext, height: number) {
  if (context.y + height > A4[1] - MARGIN - FOOTER_HEIGHT) newPage(context);
}

function drawText(context: PdfContext, value: string, x: number, y: number, size = 9, color = INK) {
  selectFont(context.document, size, color);
  context.document.text(value, x, y, { lineBreak: false });
}

function sectionTitle(context: PdfContext, number: string, title: string) {
  ensureSpace(context, 30);
  context.document.save().rect(MARGIN, context.y, CONTENT_WIDTH, 22).fill(PALE).restore();
  drawText(context, number, MARGIN + 7, context.y + 6, 8, ACCENT);
  drawText(context, title, MARGIN + 31, context.y + 5, 11, INK);
  context.y += 29;
}

function tableRow(context: PdfContext, cells: string[], widths: number[], options?: { header?: boolean; minHeight?: number }) {
  const size = options?.header ? 8 : 8.5;
  const padding = 5;
  const wrapped = cells.map((cell, index) => wrapText(clean(cell), context.document, size, widths[index] - padding * 2));
  const lineHeight = size + 3;
  const height = Math.max(options?.minHeight ?? 22, ...wrapped.map((lines) => lines.length * lineHeight + padding * 2));
  ensureSpace(context, height);
  let x = MARGIN;
  for (let index = 0; index < cells.length; index += 1) {
    context.document
      .save()
      .lineWidth(0.6)
      .rect(x, context.y, widths[index], height)
      .fillAndStroke(options?.header ? PALE : "#ffffff", LINE)
      .restore();
    wrapped[index].forEach((line, lineIndex) => {
      drawText(context, line, x + padding, context.y + padding + lineIndex * lineHeight, size, options?.header ? MUTED : INK);
    });
    x += widths[index];
  }
  context.y += height;
}

function drawApproval(context: PdfContext, status: string) {
  const x = A4[0] - MARGIN - 154;
  const y = context.y;
  const widths = [34, 60, 60];
  const labels = ["결재", "부센터장", "센터장"];
  let cursor = x;
  labels.forEach((label, index) => {
    context.document
      .save()
      .lineWidth(0.7)
      .rect(cursor, y, widths[index], 34)
      .fillAndStroke(index === 0 ? PALE : "#ffffff", LINE)
      .restore();
    drawText(context, label, cursor + 5, y + 5, index === 0 ? 8 : 7.5, MUTED);
    const signed = index === 1
      ? ["부센터장만 서명", "서명 완료"].includes(status)
      : index === 2 && ["센터장만 서명", "서명 완료"].includes(status);
    if (signed) drawText(context, "서명", cursor + 18, y + 19, 9, ACCENT);
    cursor += widths[index];
  });
}

function addPageNumbers(document: PDFKit.PDFDocument) {
  const range = document.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    document.switchToPage(range.start + index);
    selectFont(document, 7, MUTED);
    document.text(`${index + 1} / ${range.count}`, MARGIN, A4[1] - MARGIN - 12, {
      align: "center",
      lineBreak: false,
      width: CONTENT_WIDTH,
    });
  }
}

export async function createWorkLogPdf(
  record: WorkLogRecord,
  employeeName: string,
  employeeEmail: string,
  fontData: Buffer | Uint8Array = fontBytes(),
) {
  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    compress: true,
    font: "",
    info: {
      Title: `${record.week} 업무일지`,
      Author: employeeName,
      Subject: "결재된 주간 업무일지",
      Creator: "업무일지 웹",
    },
    margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
    size: A4,
  });
  const chunks: Buffer[] = [];
  const completed = new Promise<Uint8Array>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    document.on("error", reject);
  });

  // PDFKit/Fontkit creates a subset and adds only glyphs used by this document.
  document.registerFont(FONT_NAME, fontData);
  document.font(FONT_NAME);
  const context: PdfContext = { document, y: MARGIN };
  newPage(context);
  const monday = mondayOfWeek(record.week);
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  const data = record.data ?? {};

  drawText(context, "주간 업무일지", MARGIN, context.y, 18, INK);
  drawText(context, `${record.week}  ·  ${isoDate(monday)} - ${isoDate(friday)}`, MARGIN, context.y + 20, 9, MUTED);
  drawText(context, `작성자  ${employeeName} (${employeeEmail})`, MARGIN, context.y + 36, 8.5, MUTED);
  drawApproval(context, record.status);
  context.y += 52;

  sectionTitle(context, "01", "금주 목표 및 주간 메모");
  tableRow(context, ["목표 내용", "진행률"], [CONTENT_WIDTH - 82, 82], { header: true });
  const goals = data.weekly_goals?.filter((item) => clean(item.업무내용, "") || clean(item.진행률, "")) ?? [];
  if (goals.length) goals.forEach((item) => tableRow(context, [clean(item.업무내용), clean(item.진행률)], [CONTENT_WIDTH - 82, 82]));
  else tableRow(context, ["기록 없음", "-"], [CONTENT_WIDTH - 82, 82]);
  context.y += 7;
  tableRow(context, ["주간 메모", clean(data.weekly_comment, "기록 없음")], [82, CONTENT_WIDTH - 82], { minHeight: 32 });
  context.y += 10;

  sectionTitle(context, "02", "요일별 업무 내역");
  const attendance = data.attendance ?? [];
  const daily = data.daily ?? [];
  ["월", "화", "수", "목", "금"].forEach((day, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    const dateText = isoDate(date);
    const time = attendance.find((item) => item.date === dateText) ?? {};
    ensureSpace(context, 50);
    context.document.save().rect(MARGIN, context.y, CONTENT_WIDTH, 20).fill("#fafafa").restore();
    drawText(context, `${day}요일  ${dateText}`, MARGIN + 6, context.y + 5, 9.5, INK);
    drawText(context, `출근 ${clean(time.start_time)}   퇴근 ${clean(time.end_time)}   휴가 ${clean(time.leave_type)}`, MARGIN + 250, context.y + 5, 8, MUTED);
    context.y += 20;
    tableRow(context, ["업무 내용", "진행률"], [CONTENT_WIDTH - 82, 82], { header: true });
    const tasks = daily.filter((item) => item.날짜 === dateText && (clean(item.업무내용, "") || clean(item.진행률, "")));
    if (tasks.length) tasks.forEach((item) => tableRow(context, [clean(item.업무내용), clean(item.진행률)], [CONTENT_WIDTH - 82, 82]));
    else tableRow(context, ["기록 없음", "-"], [CONTENT_WIDTH - 82, 82]);
    context.y += 7;
  });

  ensureSpace(context, 73);
  sectionTitle(context, "03", "특근 및 초과 근무");
  const specialWidths = [72, 38, 55, 64, CONTENT_WIDTH - 301, 72];
  tableRow(context, ["날짜", "요일", "시작", "소요 시간", "업무 내용", "진행률"], specialWidths, { header: true });
  const special = data.special?.filter((item) => !isDefaultSpecialTask(item) && Object.values(item).some((value) => clean(value, ""))) ?? [];
  if (special.length) {
    special.forEach((item) => tableRow(context, [clean(item.날짜), clean(item.요일), clean(item["시작 시각"]), clean(item["소요 시간"]), clean(item["업무 내용"]), clean(item.진행률)], specialWidths));
  } else {
    tableRow(context, ["-", "-", "-", "-", "기록 없음", "-"], specialWidths);
  }

  addPageNumbers(document);
  document.end();
  return completed;
}
