import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLedgerTransactions,
  groupTransactionsByMonth,
  summarizeByAccountType,
  summarizeTransactions,
} from '../src/utils/ledger.js';

test('ledger combines expenses and every supported income source once', () => {
  const accounts = [{
    id: 'a1',
    type: 'gpt',
    nickname: '测试账号',
    refundStatus: 'received',
    refundAmount: 10,
    refundDate: '2026-07-20',
  }];
  const members = [{
    id: 'm1',
    accountId: 'a1',
    name: '成员',
    inviteDate: '2026-07-01',
    chargeAmountCny: 100,
    paymentRecords: { 1: { paid: true, paidDate: '2026-07-02', amountCny: 100 } },
  }];
  const billingRecords = [{
    id: 'b1', accountId: 'a1', billingDate: '2026-07-01', amount: 20,
    period: 1, paymentSource: 'gift_card',
  }];
  const incomeRecords = [{
    id: 'i1', accountId: 'a1', incomeDate: '2026-07-03', amountCny: 50,
    source: 'plus_sale',
  }];

  const transactions = buildLedgerTransactions({
    accounts,
    members,
    billingRecords,
    incomeRecords,
    exchangeRate: 7,
  });
  const summary = summarizeTransactions(transactions);

  assert.equal(transactions.length, 4);
  assert.deepEqual(summary, {
    income: 220,
    expense: 140,
    balance: 80,
    count: 4,
  });
  assert.equal(groupTransactionsByMonth(transactions)[0].month, '2026-07');
  assert.equal(summarizeByAccountType(transactions, '2026-07').gpt.balance, 80);
});
