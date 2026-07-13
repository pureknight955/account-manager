// 财务概览页 - 月度收支账本
import { getAccounts, getAllTeamMembers, getBillingRecords, getIncomeRecords, getSettings } from '../utils/storage.js';
import { formatCurrency, formatDate, getCurrentMonth } from '../utils/helpers.js';
import {
  buildLedgerTransactions,
  groupTransactionsByMonth,
  summarizeTransactions,
} from '../utils/ledger.js';

/**
 * Render the finance ledger page.
 * @param {HTMLElement} container
 */
export function render(container) {
  const accounts = getAccounts();
  const members = getAllTeamMembers();
  const billingRecords = getBillingRecords();
  const incomeRecords = getIncomeRecords();
  const settings = getSettings();
  const rate = settings.exchangeRate || 7.25;

  const transactions = buildLedgerTransactions({
    accounts,
    members,
    billingRecords,
    incomeRecords,
    exchangeRate: rate,
  });
  const groupedMonths = groupTransactionsByMonth(transactions);
  const currentMonth = getCurrentMonth();
  const currentStats = groupedMonths.find((m) => m.month === currentMonth) || summarizeMonth(currentMonth, []);
  const allStats = summarizeTransactions(transactions);

  container.innerHTML = `
    <div class="page-header finance-page-header">
      <h1>💹 财务概览</h1>
      <div class="finance-rate-pill">1 USD = ¥${formatCurrency(rate)}</div>
    </div>

    <section class="finance-overview-band">
      <div class="finance-overview-main">
        <span class="finance-overview-label">本月结余</span>
        <strong class="${currentStats.balance >= 0 ? 'text-success' : 'text-danger'}">
          ${formatSignedCny(currentStats.balance)}
        </strong>
      </div>
      <div class="finance-overview-metrics">
        <div>
          <span>本月收入</span>
          <strong class="text-success">+¥${formatCurrency(currentStats.income)}</strong>
        </div>
        <div>
          <span>本月支出</span>
          <strong class="text-danger">-¥${formatCurrency(currentStats.expense)}</strong>
        </div>
        <div>
          <span>全部流水</span>
          <strong>${allStats.count} 笔</strong>
        </div>
      </div>
    </section>

    <div class="finance-month-ledger">
      ${groupedMonths.length ? groupedMonths.map(renderMonthSection).join('') : renderEmptyState()}
    </div>
  `;

  bindFinanceEvents(container);
}

function summarizeMonth(month, transactions) {
  const stats = summarizeTransactions(transactions);
  return {
    month,
    transactions,
    ...stats,
  };
}

function renderMonthSection(monthData) {
  return `
    <section class="card finance-month-card">
      <div class="finance-month-header">
        <div>
          <h2>${formatMonthLabel(monthData.month)}</h2>
          <span>${monthData.count} 笔流水</span>
        </div>
        <div class="finance-month-balance ${monthData.balance >= 0 ? 'text-success' : 'text-danger'}">
          ${formatSignedCny(monthData.balance)}
        </div>
      </div>

      <div class="finance-month-summary">
        <span class="summary-income">收入 +¥${formatCurrency(monthData.income)}</span>
        <span class="summary-expense">支出 -¥${formatCurrency(monthData.expense)}</span>
      </div>

      <div class="finance-transaction-list">
        ${monthData.transactions.map(renderTransactionRow).join('')}
      </div>
    </section>
  `;
}

function renderTransactionRow(tx) {
  const isIncome = tx.kind === 'income';
  const amountClass = isIncome ? 'text-success' : 'text-danger';
  const amountPrefix = isIncome ? '+' : '-';
  const secondaryAmount = tx.amountUsd !== null
    ? `<span class="finance-transaction-usd">$${formatCurrency(tx.amountUsd)}</span>`
    : '';

  return `
    <button class="finance-transaction-row" data-account-id="${escAttr(tx.accountId || '')}" ${tx.accountId ? '' : 'disabled'}>
      <span class="finance-transaction-icon ${isIncome ? 'income' : 'expense'}">${tx.icon}</span>
      <span class="finance-transaction-main">
        <strong>${escHtml(tx.title)}</strong>
        <small>${formatDate(tx.date)} · ${escHtml(tx.subtitle)}</small>
      </span>
      <span class="finance-transaction-amounts">
        <strong class="${amountClass}">${amountPrefix}¥${formatCurrency(tx.amountCny)}</strong>
        ${secondaryAmount}
      </span>
      <span class="settings-arrow">›</span>
    </button>
  `;
}

function renderEmptyState() {
  return `
    <section class="card finance-empty-card">
      <div class="empty-state">
        <div class="empty-state-icon">📒</div>
        <p>暂无收支记录</p>
      </div>
    </section>
  `;
}

function bindFinanceEvents(container) {
  container.querySelectorAll('.finance-transaction-row[data-account-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const accountId = row.dataset.accountId;
      if (accountId) {
        window.navigateTo('account-detail', { id: accountId });
      }
    });
  });
}

function formatMonthLabel(month) {
  if (!month || !month.includes('-')) return '未知月份';
  const [year, mm] = month.split('-');
  const current = getCurrentMonth();
  const label = `${year}年${Number(mm)}月`;
  return month === current ? `${label} · 本月` : label;
}

function formatSignedCny(value) {
  const n = Number(value) || 0;
  return `${n >= 0 ? '+' : '-'}¥${formatCurrency(Math.abs(n))}`;
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function escAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
