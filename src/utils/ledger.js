import { ACCOUNT_TYPES, BILLING_PAYMENT_SOURCES } from '../config.js';
import {
  convertUsdToCny,
  getDueDateForPeriod,
  getPaymentRecordAmount,
  getPaymentRecordDate,
  isPaymentRecordPaid,
} from './helpers.js';

/**
 * Build the canonical finance ledger used by both Dashboard and Finance.
 * Card balances are intentionally separate: a business expense exists even
 * when it was paid by gift card or a third party.
 */
export function buildLedgerTransactions({
  accounts = [],
  members = [],
  billingRecords = [],
  incomeRecords = [],
  exchangeRate = 7.25,
} = {}) {
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const transactions = [];

  billingRecords.forEach((record) => {
    const account = accountMap.get(record.accountId);
    const date = normalizeLedgerDate(record.billingDate || record.createdAt);
    const amountUsd = normalizeAmount(record.amount);
    if (!date || amountUsd === null) return;

    const accountType = account?.type || 'other';
    const typeInfo = ACCOUNT_TYPES.find((type) => type.value === accountType);
    transactions.push({
      id: `expense-${record.id}`,
      sourceId: record.id,
      source: 'subscription_billing',
      kind: 'expense',
      date,
      month: date.slice(0, 7),
      accountId: record.accountId,
      accountType,
      title: getAccountName(account),
      subtitle: `${typeInfo?.label || accountType} · 第 ${record.period || '-'} 期账单 · ${getBillingSourceLabel(record.paymentSource)}`,
      amountCny: convertUsdToCny(amountUsd, exchangeRate),
      amountUsd,
      icon: typeInfo?.icon || '💳',
    });
  });

  members.forEach((member) => {
    const account = accountMap.get(member.accountId);
    Object.entries(member.paymentRecords || {}).forEach(([period, paymentRecord]) => {
      if (!isPaymentRecordPaid(paymentRecord)) return;
      const periodNumber = Number(period);
      if (!Number.isInteger(periodNumber) || periodNumber < 1) return;

      const dueDate = getDueDateForPeriod(member.inviteDate, periodNumber);
      const date = normalizeLedgerDate(getPaymentRecordDate(paymentRecord, dueDate));
      const amountCny = normalizeAmount(
        getPaymentRecordAmount(paymentRecord, member.chargeAmountCny)
      );
      if (!date || amountCny === null) return;

      transactions.push({
        id: `member-income-${member.id}-${periodNumber}`,
        sourceId: member.id,
        source: 'member_payment',
        kind: 'income',
        date,
        month: date.slice(0, 7),
        accountId: member.accountId,
        accountType: account?.type || 'gpt',
        title: member.name || '未命名成员',
        subtitle: `${getAccountName(account)} · 第 ${periodNumber} 期成员缴费`,
        amountCny,
        amountUsd: null,
        icon: '👤',
      });
    });
  });

  incomeRecords.forEach((record) => {
    const account = accountMap.get(record.accountId);
    const date = normalizeLedgerDate(record.incomeDate || record.createdAt);
    const amountCny = normalizeAmount(record.amountCny);
    if (!date || amountCny === null) return;

    const notes = record.notes ? ` · ${record.notes}` : '';
    transactions.push({
      id: `direct-income-${record.id}`,
      sourceId: record.id,
      source: record.source || 'plus_sale',
      kind: 'income',
      date,
      month: date.slice(0, 7),
      accountId: record.accountId,
      accountType: account?.type || 'gpt',
      title: getAccountName(account),
      subtitle: `Plus 售出收入${notes}`,
      amountCny,
      amountUsd: null,
      icon: '💰',
    });
  });

  accounts.forEach((account) => {
    if (account.refundStatus !== 'received') return;
    const amountUsd = normalizeAmount(account.refundAmount);
    const date = normalizeLedgerDate(account.refundDate || account.updatedAt || account.createdAt);
    if (!date || amountUsd === null || amountUsd <= 0) return;

    const typeInfo = ACCOUNT_TYPES.find((type) => type.value === account.type);
    transactions.push({
      id: `refund-${account.id}`,
      sourceId: account.id,
      source: 'refund',
      kind: 'income',
      date,
      month: date.slice(0, 7),
      accountId: account.id,
      accountType: account.type,
      title: getAccountName(account),
      subtitle: `${typeInfo?.label || account.type} · 退款到账`,
      amountCny: convertUsdToCny(amountUsd, exchangeRate),
      amountUsd,
      icon: '↩',
    });
  });

  return transactions.sort((left, right) => {
    const dateCompare = right.date.localeCompare(left.date);
    if (dateCompare !== 0) return dateCompare;
    return left.id.localeCompare(right.id);
  });
}

export function summarizeTransactions(transactions = []) {
  const income = transactions
    .filter((transaction) => transaction.kind === 'income')
    .reduce((sum, transaction) => sum + transaction.amountCny, 0);
  const expense = transactions
    .filter((transaction) => transaction.kind === 'expense')
    .reduce((sum, transaction) => sum + transaction.amountCny, 0);

  return {
    income: roundMoney(income),
    expense: roundMoney(expense),
    balance: roundMoney(income - expense),
    count: transactions.length,
  };
}

export function groupTransactionsByMonth(transactions = []) {
  const monthMap = new Map();
  transactions.forEach((transaction) => {
    if (!monthMap.has(transaction.month)) monthMap.set(transaction.month, []);
    monthMap.get(transaction.month).push(transaction);
  });

  return [...monthMap.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([month, monthTransactions]) => ({
      month,
      transactions: monthTransactions,
      ...summarizeTransactions(monthTransactions),
    }));
}

export function summarizeByAccountType(transactions = [], month = '') {
  const filtered = month
    ? transactions.filter((transaction) => transaction.month === month)
    : transactions;
  const result = {};
  ACCOUNT_TYPES.forEach((type) => {
    result[type.value] = summarizeTransactions(
      filtered.filter((transaction) => transaction.accountType === type.value)
    );
  });
  return result;
}

export function normalizeLedgerDate(value) {
  if (!value) return '';
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return roundMoney(amount);
}

function roundMoney(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function getAccountName(account) {
  return account ? (account.nickname || account.email || '未命名账号') : '未知账号';
}

function getBillingSourceLabel(source) {
  return BILLING_PAYMENT_SOURCES.find((item) => item.value === source)?.label || '未指定来源';
}
