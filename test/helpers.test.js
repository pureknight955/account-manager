import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDueDateForPeriod,
  getMemberPaymentStatus,
  getMonthlyBillingDate,
  getNextChargeDate,
  getNextMonthlyBillingInfo,
} from '../src/utils/helpers.js';

test('month-end cycles keep the original anchor day', () => {
  assert.equal(getDueDateForPeriod('2026-01-31', 1), '2026-01-31');
  assert.equal(getDueDateForPeriod('2026-01-31', 2), '2026-02-28');
  assert.equal(getDueDateForPeriod('2026-01-31', 3), '2026-03-31');
  assert.equal(getDueDateForPeriod('2026-01-31', 4), '2026-04-30');
  assert.equal(getMonthlyBillingDate('2024-01-31', 2), '2024-02-29');
});

test('next charge date advances after a clamped month-end due date', () => {
  assert.equal(getNextChargeDate('2026-01-31', '2026-02-28'), '2026-03-31');
  assert.deepEqual(
    getNextMonthlyBillingInfo('2026-01-31', '2026-03-01'),
    { renewalDate: '2026-03-31', period: 3 },
  );
});

test('member status surfaces the oldest unpaid period', () => {
  const status = getMemberPaymentStatus(
    '2026-01-31',
    { 1: { paid: true, paidDate: '2026-01-31', amountCny: 100 } },
    7,
    '2026-04-25',
  );

  assert.equal(status.targetPeriod, 2);
  assert.equal(status.dueDate, '2026-02-28');
  assert.equal(status.isPaid, false);
  assert.equal(status.urgency, 'danger');
});
