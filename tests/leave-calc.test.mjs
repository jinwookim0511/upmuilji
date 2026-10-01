import assert from "node:assert/strict";
import test from "node:test";

import { accruedAnnualLeave, completedLeaveMonths, leaveDaysForType } from "../app/lib/leave.ts";

test("counts the entry month when the hire date is on or before the 15th", () => {
  assert.equal(completedLeaveMonths(new Date(2026, 1, 15), new Date(2026, 2, 1)), 1);
  assert.equal(completedLeaveMonths(new Date(2026, 1, 16), new Date(2026, 2, 1)), 0);
  assert.equal(completedLeaveMonths(new Date(2026, 1, 16), new Date(2026, 3, 1)), 1);
});

test("grants the first annual entitlement on January 1 for hires through October 1", () => {
  assert.equal(accruedAnnualLeave(new Date(2025, 9, 1), new Date(2025, 11, 31)).days, 2);
  assert.deepEqual(accruedAnnualLeave(new Date(2025, 9, 1), new Date(2026, 0, 1)), {
    category: "over_1y",
    label: "만 1년+",
    days: 15,
    monthsCompleted: 3,
  });
});

test("keeps hires after October 1 on the under-one-year rule until the following January 1", () => {
  assert.deepEqual(accruedAnnualLeave(new Date(2025, 9, 2), new Date(2026, 0, 1)), {
    category: "under_1y",
    label: "1년 미만",
    days: 3,
    monthsCompleted: 3,
  });
  assert.equal(accruedAnnualLeave(new Date(2025, 9, 2), new Date(2026, 11, 31)).days, 11);
  assert.equal(accruedAnnualLeave(new Date(2025, 9, 2), new Date(2027, 0, 1)).days, 15);
});

test("updates service leave only on January 1 and caps the result at 25 days", () => {
  assert.equal(accruedAnnualLeave(new Date(2023, 9, 1), new Date(2025, 11, 31)).days, 15);
  assert.equal(accruedAnnualLeave(new Date(2023, 9, 1), new Date(2026, 0, 1)).days, 16);
  assert.equal(accruedAnnualLeave(new Date(2005, 9, 1), new Date(2026, 0, 1)).days, 25);
});

test("converts only annual leave types into deducted days", () => {
  assert.equal(leaveDaysForType("연차"), 1);
  assert.equal(leaveDaysForType("반차"), 0.5);
  assert.equal(leaveDaysForType("반반차"), 0.25);
  assert.equal(leaveDaysForType("공휴일"), 0);
  assert.equal(leaveDaysForType("병가"), 0);
});
