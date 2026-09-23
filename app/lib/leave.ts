export type LeaveResult = {
  category: "before_join" | "under_1y" | "over_1y";
  label: string;
  days: number;
  monthsCompleted: number;
};

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function anniversaryAfterYears(hireDate: Date, years: number) {
  const targetYear = hireDate.getFullYear() + years;
  const lastDay = new Date(targetYear, hireDate.getMonth() + 1, 0).getDate();
  return new Date(targetYear, hireDate.getMonth(), Math.min(hireDate.getDate(), lastDay));
}

/**
 * 연차 계산용 인정 근무 개월 수.
 *
 * 입사 월은 입사일부터 말일까지(입사일 포함) 15일 이상이면 다음 달 1일에
 * 첫 1개월로 인정합니다. 15일 미만이면 첫 온전한 달이 지난 뒤부터 셉니다.
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
  const lastDayOfHireMonth = new Date(hire.getFullYear(), hire.getMonth() + 1, 0).getDate();
  const initialMonthCounts = lastDayOfHireMonth - hire.getDate() + 1 >= 15;

  return Math.max(0, calendarMonthDifference - (initialMonthCounts ? 0 : 1));
}

/**
 * 근로기준법 제60조를 기준으로 한 발생 연차.
 * 1년 미만은 인정 근무 월마다 1일(최대 11일), 만 1년 이후에는 회계연도
 * 기준 15일에서 3년차부터 2년마다 1일을 더하며 최대 25일입니다.
 */
export function accruedAnnualLeave(hireDate: Date, asOf: Date = new Date()): LeaveResult {
  const hire = startOfDay(hireDate);
  const reference = startOfDay(asOf);
  const monthsCompleted = completedLeaveMonths(hire, reference);

  if (reference < hire) {
    return { category: "before_join", label: "입사 예정", days: 0, monthsCompleted };
  }

  if (reference < anniversaryAfterYears(hire, 1)) {
    return {
      category: "under_1y",
      label: "1년 미만",
      days: Math.min(11, monthsCompleted),
      monthsCompleted,
    };
  }

  let serviceYears = reference.getFullYear() - hire.getFullYear();
  if (reference < anniversaryAfterYears(hire, serviceYears)) serviceYears -= 1;
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
