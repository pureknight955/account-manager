// 首页仪表盘
import { getAccounts, getTeamMembers, getAllTeamMembers, getBillingRecords, getIncomeRecords, getSettings } from '../utils/storage.js';
import {
  formatDate, daysUntil, formatCurrency, getCurrentMonth,
  getMemberPaymentStatus, getNextMonthlyBillingInfo,
} from '../utils/helpers.js';
import { isPaidSubscription, hasTeamManagement, hasMonthlyRenewal, ACCOUNT_TYPES } from '../config.js';
import { buildLedgerTransactions, summarizeByAccountType } from '../utils/ledger.js';

/**
 * Render the dashboard page.
 * @param {HTMLElement} container
 */
export function render(container) {
  const accounts = getAccounts();
  const allMembers = getAllTeamMembers();
  const billingRecords = getBillingRecords();
  const incomeRecords = getIncomeRecords();
  const settings = getSettings();
  const exchangeRate = settings.exchangeRate || 7.25;

  container.innerHTML = `
    <div class="page-header">
      <h1>首页</h1>
      <p class="greeting">${getGreeting()}</p>
    </div>
    <div class="dashboard-sections">
      ${renderSeatVacancies(accounts, allMembers)}
      ${renderMemberPaymentReminders(accounts, allMembers)}
      ${renderRenewalReminders(accounts)}
      ${renderAccountOverview(accounts)}
      ${renderMonthlyFinance(accounts, allMembers, billingRecords, incomeRecords, exchangeRate)}
    </div>
  `;

  bindDashboardEvents(container);
}

/** Time-based greeting */
function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了，注意休息 🌙';
  if (h < 12) return '早上好 ☀️';
  if (h < 14) return '中午好 🌤️';
  if (h < 18) return '下午好 ☁️';
  return '晚上好 🌙';
}

// ─── Section 1: Seat Vacancies ──────────────────────────────────────────────

function renderSeatVacancies(accounts, allMembers) {
  const businessAccounts = accounts.filter(
    (a) => a.type === 'gpt' && a.subscriptionType === 'business'
  );

  if (businessAccounts.length === 0) {
    return `
      <section class="card dashboard-section">
        <div class="card-header section-title" style="font-size: 1.15rem; font-weight: 700; color: #3b82f6; display: flex; justify-content: flex-start; align-items: center; gap: 0.4rem; border-bottom: 1px solid rgba(59, 130, 246, 0.15); padding-bottom: 0.75rem;">
          <span style="font-size: 1.3rem;">🪑</span> <span>席位空缺</span>
        </div>
        <div class="card-body">
          <div class="empty-state">暂无 GPT Business 账号</div>
        </div>
      </section>
    `;
  }

  const reminderDays = getSettings().reminderDays || 7;
  let vacancyRows = '';
  let upcomingRows = '';

  for (const acct of businessAccounts) {
    const members = getTeamMembers(acct.id).filter((m) => m.memberStatus === 'active');
    const limit = acct.teamLimit || 0;
    const vacancy = limit - members.length;

    if (vacancy > 0) {
      vacancyRows += `
        <div class="vacancy-card clickable-row" data-id="${acct.id}">
          <div class="vacancy-info">
            <div class="vacancy-account">${escHtml(acct.nickname || acct.email)}</div>
            <div class="vacancy-detail">总容量: ${limit}人</div>
          </div>
          <div class="vacancy-seats">
            <span class="seats-available">${vacancy} 空位</span>
          </div>
        </div>
      `;
    }

    // Members who might cause vacancies
    for (const m of members) {
      const status = getMemberPaymentStatus(m.inviteDate, m.paymentRecords, reminderDays);
      
      if (m.willRenew === false) {
        if (status.daysUntilNext >= 0 && status.daysUntilNext <= reminderDays) {
          upcomingRows += `
            <div class="vacancy-card clickable-row" data-id="${acct.id}">
              <div class="vacancy-info">
                <div class="vacancy-account">${escHtml(acct.nickname)} › ${escHtml(m.name)}</div>
                <div class="vacancy-detail" style="color: var(--color-info)">明确不续租，即将空出</div>
              </div>
              <div class="vacancy-seats">
                <span class="seats-available" style="color: var(--color-warning)">${status.daysUntilNext}天后空出</span>
              </div>
            </div>
          `;
        }
      } else if (!status.isPaid && status.daysUntilNext <= reminderDays) {
        const isDanger = status.urgency === 'danger';
        const reason = status.daysUntilNext < 0 ? '逾期未缴费，可能空出' : (isDanger ? '紧急未缴费，可能空出' : '待续费，可能空出');
        const color = isDanger ? 'var(--color-danger)' : 'var(--color-warning)';
        upcomingRows += `
          <div class="vacancy-card clickable-row" data-id="${acct.id}">
            <div class="vacancy-info">
              <div class="vacancy-account">${escHtml(acct.nickname)} › ${escHtml(m.name)}</div>
              <div class="vacancy-detail" style="color: ${color}">${reason}</div>
            </div>
            <div class="vacancy-seats">
              <span class="seats-available" style="color: ${color}">${status.daysUntilNext < 0 ? '已过期' : '剩' + status.daysUntilNext + '天'}</span>
            </div>
          </div>
        `;
      }
    }
  }

  const hasContent = vacancyRows || upcomingRows;

  if (!hasContent) {
    return `
      <section class="card dashboard-section" style="padding-bottom: var(--space-4);">
        <div class="card-header section-title" style="font-size: 1.15rem; font-weight: 700; color: #3b82f6; display: flex; justify-content: flex-start; align-items: center; gap: 0.4rem; border-bottom: none; padding-bottom: 0;">
          <span style="font-size: 1.3rem;">🪑</span> <span>席位空缺</span>
          <span style="margin-left:auto; font-size:var(--text-sm); font-weight:normal; color:var(--color-text-tertiary);">近期无空缺</span>
        </div>
      </section>
    `;
  }

  return `
    <section class="card dashboard-section">
      <div class="card-header section-title" style="font-size: 1.15rem; font-weight: 700; color: #3b82f6; display: flex; justify-content: flex-start; align-items: center; gap: 0.4rem; border-bottom: 1px solid rgba(59, 130, 246, 0.15); padding-bottom: 0.75rem;">
        <span style="font-size: 1.3rem;">🪑</span> <span>席位空缺</span>
      </div>
      <div class="card-body">
        ${vacancyRows ? `<div class="subsection-label">当前空位</div><div class="reminder-list" style="margin-bottom:1rem">${vacancyRows}</div>` : ''}
        ${upcomingRows ? `<div class="subsection-label">${reminderDays}日内可能空出</div><div class="reminder-list">${upcomingRows}</div>` : ''}
      </div>
    </section>
  `;
}

// ─── Section 2: Renewal Reminders ───────────────────────────────────────────

function renderRenewalReminders(accounts) {
  const reminderDays = getSettings().reminderDays || 7;
  const upcoming = accounts
    .map((a) => {
      const billingInfo = getAccountRenewalInfo(a);
      return { ...a, billingInfo };
    })
    .filter((a) => {
      if (!a.billingInfo.renewalDate || !isPaidSubscription(a.subscriptionType)) return false;
      const days = daysUntil(a.billingInfo.renewalDate);
      return days >= 0 && days <= reminderDays;
    })
    .sort((a, b) => daysUntil(a.billingInfo.renewalDate) - daysUntil(b.billingInfo.renewalDate));

  const typeMap = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t.value, t]));

  let rows = '';
  for (const acct of upcoming) {
    const days = daysUntil(acct.billingInfo.renewalDate);
    const typeInfo = typeMap[acct.type] || {};
    rows += `
      <div class="reminder-item clickable-row ${days <= 2 ? 'reminder-urgent' : 'reminder-upcoming'}" data-id="${acct.id}">
        <span class="reminder-icon" style="font-size:1.5rem">${typeInfo.icon || '📦'}</span>
        <div class="reminder-content">
          <div class="reminder-title">${escHtml(acct.nickname || acct.email)}</div>
          <div class="reminder-subtitle">${acct.subscriptionType}${acct.billingInfo.period ? ` · 第${acct.billingInfo.period}期月账单` : ''}</div>
        </div>
        <span class="days-badge ${days <= 2 ? 'days-danger' : 'days-warning'}">${days}天</span>
      </div>
    `;
  }

  if (!rows) {
    return `
      <section class="card dashboard-section" style="padding-bottom: var(--space-4);">
        <div class="card-header section-title" style="font-size: 1.15rem; font-weight: 700; color: #f59e0b; display: flex; justify-content: flex-start; align-items: center; gap: 0.4rem; border-bottom: none; padding-bottom: 0;">
          <span style="font-size: 1.3rem;">⚠️</span> <span>续费提醒</span>
          <span style="margin-left:auto; font-size:var(--text-sm); font-weight:normal; color:var(--color-text-tertiary);">近期无需续费</span>
        </div>
      </section>
    `;
  }

  return `
    <section class="card dashboard-section">
      <div class="card-header section-title" style="font-size: 1.15rem; font-weight: 700; color: #f59e0b; display: flex; justify-content: flex-start; align-items: center; gap: 0.4rem; border-bottom: none; padding-bottom: 0.75rem;">
        <span style="font-size: 1.3rem;">⚠️</span> <span>续费提醒</span>
      </div>
      <div class="card-body">
        <div class="reminder-list">${rows}</div>
      </div>
    </section>
  `;
}

// ─── Section 3: Member Payment Reminders ────────────────────────────────────

function renderMemberPaymentReminders(accounts, allMembers) {
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const reminderDays = getSettings().reminderDays || 7;
  
  const upcoming = allMembers
    .map(m => {
      const status = getMemberPaymentStatus(m.inviteDate, m.paymentRecords, reminderDays);
      return { ...m, status };
    })
    .filter((m) => {
      if (m.memberStatus !== 'active' || m.willRenew === false) return false;
      if (m.status.isPaid) return false;
      return m.status.urgency === 'danger' || m.status.urgency === 'warning';
    })
    .sort((a, b) => a.status.daysUntilNext - b.status.daysUntilNext);

  let rows = '';
  for (const m of upcoming) {
    const acct = accountMap[m.accountId];
    const acctName = acct ? (acct.nickname || acct.email) : '未知账号';
    const isDanger = m.status.urgency === 'danger';
    
    rows += `
      <div class="reminder-item clickable-row ${isDanger ? 'reminder-urgent' : 'reminder-upcoming'}" data-id="${m.accountId}" data-action="account-detail">
        <span class="reminder-icon" style="font-size:1.5rem">👤</span>
        <div class="reminder-content">
          <div class="reminder-title">${escHtml(m.name)}</div>
          <div class="reminder-subtitle">${escHtml(acctName)} · ¥${formatCurrency(m.chargeAmountCny)}</div>
          ${isDanger ? `<div style="font-size:0.75rem; color:var(--color-danger); margin-top:2px;">建议清退</div>` : ''}
        </div>
        <span class="badge badge-danger" style="margin-right: 0.5rem">待收第${m.status.targetPeriod}期</span>
        <span class="days-badge ${isDanger ? 'days-danger' : 'days-warning'}">${m.status.daysUntilNext < 0 ? '已过期' : m.status.daysUntilNext + '天'}</span>
      </div>
    `;
  }

  if (!rows) {
    return `
      <section class="card dashboard-section" style="padding-bottom: var(--space-4);">
        <div class="card-header section-title" style="font-size: 1.15rem; font-weight: 700; color: #10b981; display: flex; justify-content: flex-start; align-items: center; gap: 0.4rem; border-bottom: none; padding-bottom: 0;">
          <span style="font-size: 1.3rem;">💰</span> <span>成员缴费提醒</span>
          <span style="margin-left:auto; font-size:var(--text-sm); font-weight:normal; color:var(--color-text-tertiary);">近期无待收款</span>
        </div>
      </section>
    `;
  }

  return `
    <section class="card dashboard-section">
      <div class="card-header section-title" style="font-size: 1.15rem; font-weight: 700; color: #10b981; display: flex; justify-content: flex-start; align-items: center; gap: 0.4rem; border-bottom: 1px solid rgba(16, 185, 129, 0.15); padding-bottom: 0.75rem;">
        <span style="font-size: 1.3rem;">💰</span> <span>成员缴费提醒</span>
      </div>
      <div class="card-body">
        <div class="reminder-list">${rows}</div>
      </div>
    </section>
  `;
}

// ─── Section 4: Account Overview ────────────────────────────────────────────

function renderAccountOverview(accounts) {
  const stats = {};
  for (const t of ACCOUNT_TYPES) {
    const ofType = accounts.filter((a) => a.type === t.value);
    stats[t.value] = {
      total: ofType.length,
      active: ofType.filter((a) => a.status === 'active').length,
      banned: ofType.filter((a) => a.status === 'banned').length,
    };
  }

  let cards = '';
  for (const t of ACCOUNT_TYPES) {
    const s = stats[t.value];
    cards += `
      <div class="stat-card">
        <div class="stat-icon">${t.icon}</div>
        <div class="stat-number">${s.total}</div>
        <div class="stat-label">${t.label}</div>
        <div class="stat-detail">
          <span class="badge badge-success">${s.active} 正常</span>
          ${s.banned > 0 ? `<span class="badge badge-danger">${s.banned} 封禁</span>` : ''}
        </div>
      </div>
    `;
  }

  return `
    <section class="card dashboard-section">
      <div class="card-header section-title" style="font-size: 1.15rem; font-weight: 700; color: #8b5cf6; display: flex; justify-content: flex-start; align-items: center; gap: 0.4rem; border-bottom: 1px solid rgba(139, 92, 246, 0.15); padding-bottom: 0.75rem;">
        <span style="font-size: 1.3rem;">📊</span> <span>账号概览</span>
      </div>
      <div class="card-body">
        <div class="stats-grid">${cards}</div>
      </div>
    </section>
  `;
}

// ─── Section 5: Monthly Finance ─────────────────────────────────────────────

function renderMonthlyFinance(accounts, allMembers, billingRecords, incomeRecords, exchangeRate) {
  const currentMonthStr = getCurrentMonth();
  const transactions = buildLedgerTransactions({
    accounts,
    members: allMembers,
    billingRecords,
    incomeRecords,
    exchangeRate,
  });
  const stats = summarizeByAccountType(transactions, currentMonthStr);

  const renderTypeBlock = (type, icon, label, incomeLabel = '收入') => {
    const item = stats[type];
    const balance = item.income - item.expense;
    return `
      <div class="finance-block">
        <div class="finance-block-title">${icon} ${label}</div>
        <div class="finance-line">
          <span>支出</span>
          <span class="text-danger">-¥${formatCurrency(item.expense)}</span>
        </div>
        <div class="finance-line">
          <span>${incomeLabel}</span>
          <span class="text-success">+¥${formatCurrency(item.income)}</span>
        </div>
        <div class="finance-line finance-balance">
          <span>结余</span>
          <span class="${balance >= 0 ? 'text-success' : 'text-danger'}">${balance >= 0 ? '+' : ''}¥${formatCurrency(balance)}</span>
        </div>
      </div>
    `;
  };

  return `
    <section class="card dashboard-section">
      <div class="card-header section-title" style="font-size: 1.15rem; font-weight: 700; color: #ec4899; display: flex; justify-content: flex-start; align-items: center; gap: 0.4rem; border-bottom: 1px solid rgba(236, 72, 153, 0.15); padding-bottom: 0.75rem;">
        <span style="font-size: 1.3rem;">💹</span> <span>本月收支</span>
      </div>
      <div class="card-body">
        <div class="finance-summary">
          ${renderTypeBlock('gpt', '🤖', 'GPT', '收入（成员/售出）')}
          ${renderTypeBlock('claude', '🧠', 'Claude', '收入（退款）')}
          ${renderTypeBlock('gemini', '✨', 'Gemini', '收入')}
        </div>
        <div class="exchange-rate-info">
          当前汇率: 1 USD = ¥${exchangeRate} · ${getCurrentMonth()}
        </div>
      </div>
    </section>
  `;
}

// ─── Event Binding ──────────────────────────────────────────────────────────

function bindDashboardEvents(container) {
  container.querySelectorAll('.clickable-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      const action = row.dataset.action;
      
      if (action === 'accounts') {
        window.navigateTo('accounts');
      } else if (id) {
        window.navigateTo('account-detail', { id });
      }
    });
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getAccountRenewalInfo(account) {
  if (hasMonthlyRenewal(account.type) && account.subscriptionStartDate) {
    return getNextMonthlyBillingInfo(account.subscriptionStartDate);
  }
  return {
    renewalDate: account.renewalDate || '',
    period: 0,
  };
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
