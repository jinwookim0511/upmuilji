import assert from "node:assert/strict";
import test from "node:test";

import { accruedAnnualLeave, completedLeaveMonths, leaveDaysForType } from "../app/lib/leave.ts";

test("counts the entry month when the hire date is on or before the 15th", () => {
  assert.equal(completedLeaveMonths(new Date(2026, 1, 15), new Date(2026, 2, 1)), 1);
  assert.equal(completedLeaveMonths(new Date(2026, 1, 16), new Date(2026, 2, 1)), 0);
  assert.equal(completedLeaveMonths(new Date(2026, 1, 16), new Date(2026, 3, 1)), 1);
});

test("grants the first annual entitlement only when 12 months are complete on January 1", () => {
  assert.equal(accruedAnnualLeave(new Date(2025, 0, 15), new Date(2025, 11, 31)).days, 11);
  assert.deepEqual(accruedAnnualLeave(new Date(2025, 0, 15), new Date(2026, 0, 1)), {
    category: "over_1y",
    label: "만 1년+",
    days: 15,
    monthsCompleted: 12,
  });
});

test("keeps employees below 12 months on the under-one-year rule for the whole year", () => {
  assert.deepEqual(accruedAnnualLeave(new Date(2025, 0, 16), new Date(2026, 0, 1)), {
    category: "under_1y",
    label: "1년 미만",
    days: 11,
    monthsCompleted: 11,
  });
  assert.equal(accruedAnnualLeave(new Date(2025, 0, 16), new Date(2026, 11, 31)).days, 11);
  assert.equal(accruedAnnualLeave(new Date(2025, 0, 16), new Date(2027, 0, 1)).days, 15);
});

test("updates service leave only on January 1 and caps the result at 25 days", () => {
  assert.equal(accruedAnnualLeave(new Date(2023, 0, 15), new Date(2025, 11, 31)).days, 15);
  assert.equal(accruedAnnualLeave(new Date(2023, 0, 15), new Date(2026, 0, 1)).days, 16);
  assert.equal(accruedAnnualLeave(new Date(2005, 0, 15), new Date(2026, 0, 1)).days, 25);
});

test("converts only annual leave types into deducted days", () => {
  assert.equal(leaveDaysForType("연차"), 1);
  assert.equal(leaveDaysForType("반차"), 0.5);
  assert.equal(leaveDaysForType("반반차"), 0.25);
  assert.equal(leaveDaysForType("공휴일"), 0);
  assert.equal(leaveDaysForType("병가"), 0);
});
