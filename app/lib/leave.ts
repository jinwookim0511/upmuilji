export type LeaveResult = {
  category: "before_join" | "under_1y" | "over_1y";
  label: string;
  days: number;
  monthsCompleted: number;
};

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/**
 * 연차 계산용 인정 근무 개월 수.
 *
 * 입사일이 15일 이내(15일 포함)이면 다음 달 1일에 입사 월을 첫 1개월로
 * 인정합니다. 16일 이후 입사자는 첫 온전한 달이 지난 뒤부터 셉니다.
 */
export function completedLeaveMonths(hireDate: Date, asOf: Date): number {
  const hire = startOfDay(hireDate);
  const reference = startOfDay(asOf);
  if (reference < hire) {
    return -Math.max(1, Math.ceil((hire.getTime() - reference.getTime()) / 86_400_000));
  }

  const calendarMonthDifference =
    (reference.getFullYear() - hire.getFullYear()) * 12
    + reference.getMonth()
    - hire.getMonth();
  const initialMonthCounts = hire.getDate() <= 15;

  return Math.max(0, calendarMonthDifference - (initialMonthCounts ? 0 : 1));
}

/**
 * 근로기준법 제60조를 기준으로 한 발생 연차.
 * 1년 미만은 인정 근무 월마다 1일(최대 11일)입니다. 입사 연도 10월 1일까지
 * 입사한 경우 다음 해 1월 1일, 10월 2일 이후 입사한 경우 다다음 해 1월 1일에
 * 만 1년으로 간주합니다. 이후 최대 연차는 매년 1월 1일에만 갱신하며,
 * 만 3년부터 2년마다 1일을 더해 최대 25일입니다.
 */
export function accruedAnnualLeave(hireDate: Date, asOf: Date = new Date()): LeaveResult {
  const hire = startOfDay(hireDate);
  const reference = startOfDay(asOf);
  const monthsCompleted = completedLeaveMonths(hire, reference);

  if (reference < hire) {
    return { category: "before_join", label: "입사 예정", days: 0, monthsCompleted };
  }

  const hiredByAnnualCutoff = hire.getMonth() < 9 || (hire.getMonth() === 9 && hire.getDate() <= 1);
  const firstAnnualGrantYear = hire.getFullYear() + (hiredByAnnualCutoff ? 1 : 2);
  const firstAnnualGrantDate = new Date(firstAnnualGrantYear, 0, 1);

  if (reference < firstAnnualGrantDate) {
    return {
      category: "under_1y",
      label: "1년 미만",
      days: Math.min(11, monthsCompleted),
      monthsCompleted,
    };
  }

  const serviceYears = reference.getFullYear() - firstAnnualGrantYear + 1;
  const extraDays = serviceYears >= 3 ? Math.floor((serviceYears - 1) / 2) : 0;
  const days = Math.min(25, 15 + extraDays);
  return {
    category: "over_1y",
    label: `만 ${serviceYears}년+`,
    days,
    monthsCompleted,
  };
}

export function parseLocalDate(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function leaveDaysForType(leaveType: string) {
  return ({ 연차: 1, 반차: 0.5, 반반차: 0.25 } as Record<string, number>)[leaveType] ?? 0;
}
