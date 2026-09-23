import assert from "node:assert/strict";
import test from "node:test";

import { accruedAnnualLeave, completedLeaveMonths, leaveDaysForType } from "../app/lib/leave.ts";

test("counts the entry month only when at least 15 calendar days remain", () => {
  assert.equal(completedLeaveMonths(new Date(2026, 0, 17), new Date(2026, 1, 1)), 1);
  assert.equal(completedLeaveMonths(new Date(2026, 0, 18), new Date(2026, 1, 1)), 0);
  assert.equal(completedLeaveMonths(new Date(2026, 0, 18), new Date(2026, 2, 1)), 1);
});

test("moves to annual entitlement only on the first anniversary", () => {
  assert.equal(accruedAnnualLeave(new Date(2025, 8, 23), new Date(2026, 8, 22)).days, 11);
  assert.deepEqual(accruedAnnualLeave(new Date(2025, 8, 23), new Date(2026, 8, 23)), {
    category: "over_1y",
    label: "만 1년+",
    days: 15,
    monthsCompleted: 11,
  });
});

test("adds biennial service leave and caps the result at 25 days", () => {
  assert.equal(accruedAnnualLeave(new Date(2023, 8, 23), new Date(2026, 8, 23)).days, 16);
  assert.equal(accruedAnnualLeave(new Date(2005, 8, 23), new Date(2026, 8, 23)).days, 25);
});

test("converts only annual leave types into deducted days", () => {
  assert.equal(leaveDaysForType("연차"), 1);
  assert.equal(leaveDaysForType("반차"), 0.5);
  assert.equal(leaveDaysForType("반반차"), 0.25);
  assert.equal(leaveDaysForType("공휴일"), 0);
  assert.equal(leaveDaysForType("병가"), 0);
});
