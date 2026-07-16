// 账号详情页 - 查看 / 编辑 / 新建
import {
  getAccountById, saveAccount, deleteAccount,
  getTeamMembers, saveTeamMember, deleteTeamMember, generateId,
  getCards, saveCard, getBillingRecordsByAccount, getSettings,
  getBillingRecordById, deleteBillingRecord, editBillingRecord,
  getIncomeRecordsByAccount, saveIncomeRecord, deleteIncomeRecord
} from '../utils/storage.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import {
  formatDate, formatCurrency, getTargetPaymentPeriod, getMemberPaymentStatus, getNextMonthlyBillingInfo,
  getDueDateForPeriod, isPaymentRecordPaid, getPaymentRecordAmount, getPaymentRecordDate,
  getLocalDateString,
} from '../utils/helpers.js';
import {
  SUBSCRIPTION_TYPES, STATUS_OPTIONS, REFUND_STATUS_OPTIONS, BILLING_PAYMENT_SOURCES,
  MEMBER_STATUS_OPTIONS, ACCOUNT_TYPES,
  isPaidSubscription, hasTeamManagement, hasRefundFields,
  hasRegistrationDate, hasLoginDevice, hasDirectSaleIncome, hasMonthlyRenewal,
} from '../config.js';

/**
 * Render account detail page.
 * @param {HTMLElement} container
 * @param {object} params - { id } for existing, { type, isNew: true } for new
 */
export async function render(container, params = {}) {
  const isNew = !!params.isNew;
  let account = isNew
    ? createEmptyAccount(params.type || 'gpt')
    : getAccountById(params.id);

  if (!account && !isNew) {
    container.innerHTML = `
      <div class="page-header">
        <button class="btn btn-outline back-btn" id="backBtn">← 返回</button>
        <h1>账号未找到</h1>
      </div>
      <div class="empty-state">该账号不存在或已被删除</div>
    `;
    container.querySelector('#backBtn').addEventListener('click', () =>
      window.navigateTo('accounts')
    );
    return;
  }

  const state = { editing: isNew, account: { ...account }, revealed: {} };

  await renderPage(container, state, isNew);
}

// ─── Empty Account Factory ──────────────────────────────────────────────────

function createEmptyAccount(type) {
  return {
    id: generateId(),
    type,
    nickname: '',
    email: '',
    encryptedPassword: '',
    subscriptionType: 'free',
    status: 'active',
    banDate: '',
    subscriptionStartDate: '',
    renewalDate: '',
    subscriptionCostUsd: 0,
    billingDate: '',
    teamLimit: 0,
    encryptedPaymentMethod: '',
    loginDevice: '',
    registrationDate: '',
    refundStatus: 'none',
    refundAmount: 0,
    refundDate: '',
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Page Rendering ─────────────────────────────────────────────────────────

function renderPageHtml(state, isNew, title, typeInfo, bodyHtml) {
  return `
    <div class="page-header detail-header" style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--color-border-light); margin-bottom: 1.5rem;">
      <button class="btn btn-outline btn-sm" id="backBtn" style="white-space: nowrap; flex-shrink: 0; padding: 0.35rem 0.75rem; border-radius: var(--radius-md);">
        <span style="margin-right: 2px;">‹</span> 返回
      </button>
      <h1 style="margin: 0; flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 0.6rem; font-size: 1.35rem; font-weight: 700;">
        <span>${typeInfo.icon || ''}</span>
        <span class="truncate" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${title}</span>
      </h1>
      ${
        !isNew
          ? `<button class="btn ${state.editing ? 'btn-ghost' : 'btn-outline'} btn-sm" id="editToggleBtn" style="flex-shrink: 0; white-space: nowrap; padding: 0.35rem 0.75rem; border-radius: var(--radius-md);">${
              state.editing ? '✕ 取消' : '✏️ 编辑'
            }</button>`
          : '<div style="width: 74px; flex-shrink: 0;"></div>'
      }
    </div>

    <div class="detail-body">
      ${bodyHtml}
    </div>

    ${
      state.editing
        ? `
      <div class="detail-actions" style="margin-top: 1.5rem; text-align: center;">
        <button class="btn btn-primary" id="saveBtn">💾 保存</button>
        ${!isNew ? `<button class="btn btn-danger" id="deleteBtn" style="margin-left: 0.5rem;">🗑️ 删除账号</button>` : ''}
      </div>`
        : ''
    }

    ${
      !state.editing && hasTeamManagement(state.account.type, state.account.subscriptionType)
        ? renderTeamSection(state.account)
        : ''
    }
    ${
      !state.editing && hasDirectSaleIncome(state.account.type, state.account.subscriptionType)
        ? renderDirectIncomeSection(state.account)
        : ''
    }
  `;
}

async function renderPage(container, state, isNew) {
  const { account, editing } = state;
  const typeInfo = ACCOUNT_TYPES.find((t) => t.value === account.type) || {};
  const title = isNew
    ? `新建 ${typeInfo.label || ''} 账号`
    : escHtml(account.nickname || account.email || '账号详情');

  const bodyHtml = editing ? await renderEditForm(state) : await renderViewMode(state);
  container.innerHTML = renderPageHtml(state, isNew, title, typeInfo, bodyHtml);

  bindDetailEvents(container, state, isNew);
}

// ─── View Mode ──────────────────────────────────────────────────────────────

async function renderViewMode(state) {
  const a = state.account;
  const masterPwd = sessionStorage.getItem('masterPassword');
  const paid = isPaidSubscription(a.subscriptionType);

  let basicHtml = '';
  basicHtml += viewRow('账号类型', getTypeLabel(a.type));
  basicHtml += viewRow('昵称', a.nickname || '-');
  basicHtml += viewRow('邮箱', a.email || '-');
  basicHtml += await viewRowSensitive('密码', a.encryptedPassword, 'password', state, masterPwd);
  if (hasLoginDevice(a.type)) {
    basicHtml += viewRow('登录设备', a.loginDevice || '-');
  }

  let subHtml = '';
  subHtml += viewRow('订阅类型', getSubLabel(a.type, a.subscriptionType));
  subHtml += viewRow(
    '状态',
    a.status === 'banned'
      ? '<span class="badge badge-danger">封禁</span>'
      : '<span class="badge badge-success">正常</span>',
    true
  );
  if (a.status === 'banned') {
    subHtml += viewRow('封禁日期', formatDate(a.banDate) || '-');
  }
  if (paid && a.status !== 'banned') {
    if (hasMonthlyRenewal(a.type)) {
      const billingInfo = getAccountRenewalInfo(a);
      subHtml += viewRow('开通时间', formatDate(a.subscriptionStartDate) || '-');
      subHtml += viewRow(
        '续费日期',
        `${formatDate(billingInfo.renewalDate)}${billingInfo.period ? ` <span class="badge badge-info">第 ${billingInfo.period} 期月账单</span>` : ''}`,
        true
      );
    } else {
      subHtml += viewRow('续费日期', formatDate(a.renewalDate) || '-');
    }
    subHtml += viewRow('订阅费用', a.subscriptionCostUsd ? `$${formatCurrency(a.subscriptionCostUsd)}` : '-');
    if (!hasMonthlyRenewal(a.type)) {
      subHtml += viewRow('账单日期', formatDate(a.billingDate) || '-');
    }
    
    // Display card info if linked
    if (a.paymentCardId) {
      const cards = getCards();
      const c = cards.find(card => card.id === a.paymentCardId);
      if (c) {
        subHtml += viewRow('支付卡片', `${c.brand.toUpperCase()} •••• ${c.lastFour}`);
      } else {
        subHtml += viewRow('支付卡片', '-');
      }
    } else {
      subHtml += await viewRowSensitive('支付方式 (旧)', a.encryptedPaymentMethod, 'payment', state, masterPwd);
    }
    
    subHtml += `
      <div class="settings-row clickable-row" style="padding: 1rem 1.5rem; text-align: center; border-bottom: 1px solid var(--color-border-light);" id="viewBillingHistoryBtn">
        <span style="color: var(--color-primary); font-weight: 500;">查看历史账单 ›</span>
      </div>
    `;
  }
  if (hasTeamManagement(a.type, a.subscriptionType)) {
    subHtml += viewRow('团队上限', a.teamLimit || '0');
  }

  let otherHtml = '';
  if (hasRegistrationDate(a.type)) {
    otherHtml += viewRow('注册时间', formatDate(a.registrationDate) || '-');
  }
  if (hasRefundFields(a.type)) {
    const refundLabel = REFUND_STATUS_OPTIONS.find((o) => o.value === a.refundStatus)?.label || '未申请';
    otherHtml += viewRow('退款状态', refundLabel);
    if (a.refundStatus && a.refundStatus !== 'none') {
      otherHtml += viewRow('退款金额', a.refundAmount ? `$${formatCurrency(a.refundAmount)}` : '-');
      otherHtml += viewRow('退款日期', formatDate(a.refundDate) || '-');
    }
  }
  otherHtml += viewRow('备注', a.notes || '-');
  otherHtml += viewRow('创建时间', formatDate(a.createdAt) || '-');
  otherHtml += viewRow('更新时间', formatDate(a.updatedAt) || '-');

  return `
    <div class="settings-sections">
      <section class="card settings-section">
        <div class="card-header section-title">ℹ️ 基本信息</div>
        <div class="card-body" style="padding: 0;">${basicHtml}</div>
      </section>
      <section class="card settings-section">
        <div class="card-header section-title">💳 订阅与财务</div>
        <div class="card-body" style="padding: 0;">${subHtml}</div>
      </section>
      <section class="card settings-section">
        <div class="card-header section-title">📝 其他信息</div>
        <div class="card-body" style="padding: 0;">${otherHtml}</div>
      </section>
    </div>
  `;
}

function viewRow(label, value, isHtml = false) {
  return `
    <div class="settings-row" style="display: flex; align-items: center; padding: 1rem 1.5rem; border-bottom: 1px solid var(--color-border-light);">
      <span class="detail-label" style="color: var(--color-text-secondary); width: 120px; flex-shrink: 0;">${label}</span>
      <span class="detail-value" style="font-weight: 500; flex: 1; text-align: right;">${isHtml ? value : escHtml(String(value))}</span>
    </div>
  `;
}

async function viewRowSensitive(label, encryptedVal, key, state, masterPwd) {
  const isRevealed = state.revealed[key];
  let displayVal = '••••••••';

  if (isRevealed && encryptedVal && masterPwd) {
    try {
      displayVal = (await decrypt(encryptedVal, masterPwd)) || '(空)';
    } catch {
      displayVal = '(解密失败)';
    }
  }

  if (!encryptedVal) displayVal = '-';

  return `
    <div class="settings-row" style="display: flex; align-items: center; padding: 1rem 1.5rem; border-bottom: 1px solid var(--color-border-light);">
      <span class="detail-label" style="color: var(--color-text-secondary); width: 120px; flex-shrink: 0;">${label}</span>
      <span class="detail-value" style="font-weight: 500; flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem;">
        <span class="sensitive-text ${!isRevealed ? 'mono' : ''}">${escHtml(displayVal)}</span>
        ${encryptedVal ? `<button class="btn btn-outline btn-sm reveal-btn" data-key="${key}" style="padding: 2px 8px; font-size: 0.75rem;">${isRevealed ? '隐藏' : '查看'}</button>` : ''}
      </span>
    </div>
  `;
}

// ─── Edit Form ──────────────────────────────────────────────────────────────

async function renderEditForm(state) {
  const a = state.account;
  const masterPwd = sessionStorage.getItem('masterPassword');
  const paid = isPaidSubscription(a.subscriptionType);

  // Decrypt sensitive fields for editing
  let passwordVal = '';
  let paymentVal = '';
  if (masterPwd) {
    try { passwordVal = a.encryptedPassword ? await decrypt(a.encryptedPassword, masterPwd) : ''; } catch { passwordVal = ''; }
    try { paymentVal = a.encryptedPaymentMethod ? await decrypt(a.encryptedPaymentMethod, masterPwd) : ''; } catch { paymentVal = ''; }
  }
  
  passwordVal = passwordVal || '';
  paymentVal = paymentVal || '';

  const subOptions = SUBSCRIPTION_TYPES[a.type] || [];
  const billingInfo = getAccountRenewalInfo(a);
  const renewalDateValue = hasMonthlyRenewal(a.type)
    ? (billingInfo.renewalDate || a.renewalDate || '')
    : (a.renewalDate || '');

  let html = '';

  html += formGroup('昵称', `<input class="form-input" id="f_nickname" value="${escAttr(a.nickname)}" placeholder="给账号起个名字" />`);
  html += formGroup('邮箱', `<input class="form-input" id="f_email" type="email" value="${escAttr(a.email)}" placeholder="登录邮箱" />`);
  html += formGroup('密码', `<input class="form-input" id="f_password" type="text" value="${escAttr(passwordVal)}" placeholder="登录密码" />`);

  html += formGroup('订阅类型', `
    <select class="form-select" id="f_subscriptionType">
      ${subOptions.map((o) => `<option value="${o.value}" ${a.subscriptionType === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
    </select>
  `);

  html += formGroup('状态', `
    <select class="form-select" id="f_status">
      ${STATUS_OPTIONS.map((o) => `<option value="${o.value}" ${a.status === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
    </select>
  `);

  // Conditional: ban date
  html += `<div id="banDateGroup" style="${a.status !== 'banned' ? 'display:none' : ''}">
    ${formGroup('封禁日期', `<input class="form-input" id="f_banDate" type="date" value="${a.banDate || ''}" />`)}
  </div>`;

  const cards = getCards();
  const cardOptions = cards.map(c => `<option value="${c.id}" ${a.paymentCardId === c.id ? 'selected' : ''}>${c.brand.toUpperCase()} •••• ${c.lastFour}</option>`).join('');

  // Conditional: paid subscription fields
  html += `<div id="paidFields" style="${(!paid || a.status === 'banned') ? 'display:none' : ''}">
    ${hasMonthlyRenewal(a.type)
      ? `
        ${formGroup('开通时间', `<input class="form-input" id="f_subscriptionStartDate" type="date" value="${a.subscriptionStartDate || ''}" />`)}
        ${formGroup('续费日期（自动）', `
          <input
            class="form-input"
            id="f_renewalDate"
            type="date"
            value="${renewalDateValue}"
            disabled
            style="background: var(--color-bg-hover); color: var(--color-text-tertiary); cursor: not-allowed;"
          />
          <div id="billingPeriodHint" style="margin-top: 0.4rem; font-size: 0.82rem; color: var(--color-text-tertiary);">
            ${getBillingPeriodHint(billingInfo)}
          </div>
        `)}
      `
      : formGroup('续费日期', `<input class="form-input" id="f_renewalDate" type="date" value="${renewalDateValue}" />`)
    }
    ${formGroup('订阅费用 (USD)', `<input class="form-input" id="f_subscriptionCostUsd" type="number" step="0.01" min="0" value="${a.subscriptionCostUsd || 0}" />`)}
    <div id="billingDateGroup" style="${hasMonthlyRenewal(a.type) ? 'display:none' : ''}">
      ${formGroup('账单日期', `<input class="form-input" id="f_billingDate" type="date" value="${a.billingDate || ''}" />`)}
    </div>
    ${formGroup('支付卡片', `
      <select class="form-select" id="f_paymentCardId">
        <option value="">-- 请选择卡片 --</option>
        ${cardOptions}
      </select>
    `)}
    ${a.encryptedPaymentMethod ? formGroup('旧版支付方式 (只读)', `
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <input class="form-input" id="f_oldPaymentMethod" type="text" value="${escAttr(paymentVal)}" readonly style="opacity: 0.7; flex: 1;" />
        <button class="btn btn-outline btn-sm" id="migrateCardBtn">自动读取并添加到卡包</button>
      </div>
    `) : ''}
  </div>`;

  // Conditional: team limit (GPT Business)
  html += `<div id="teamLimitGroup" style="${!hasTeamManagement(a.type, a.subscriptionType) ? 'display:none' : ''}">
    ${formGroup('团队上限', `<input class="form-input" id="f_teamLimit" type="number" min="0" value="${a.teamLimit || 0}" />`)}
  </div>`;

  // Conditional: login device (GPT only)
  if (hasLoginDevice(a.type)) {
    html += formGroup('登录设备', `<input class="form-input" id="f_loginDevice" value="${escAttr(a.loginDevice)}" placeholder="登录设备" />`);
  }

  // Conditional: registration date (Claude, Gemini)
  if (hasRegistrationDate(a.type)) {
    html += formGroup('注册时间', `<input class="form-input" id="f_registrationDate" type="date" value="${a.registrationDate || ''}" />`);
  }

  // Conditional: refund fields (Claude only)
  if (hasRefundFields(a.type)) {
    html += formGroup('退款状态', `
      <select class="form-select" id="f_refundStatus">
        ${REFUND_STATUS_OPTIONS.map((o) => `<option value="${o.value}" ${a.refundStatus === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>
    `);
    html += `<div id="refundAmountGroup" style="${!a.refundStatus || a.refundStatus === 'none' ? 'display:none' : ''}">
      ${formGroup('退款金额 (USD)', `<input class="form-input" id="f_refundAmount" type="number" step="0.01" min="0" value="${a.refundAmount || 0}" />`)}
      ${formGroup('退款日期', `<input class="form-input" id="f_refundDate" type="date" value="${a.refundDate || ''}" />`)}
    </div>`;
  }

  html += formGroup('备注', `<textarea class="form-input" id="f_notes" rows="3" placeholder="备注信息">${escHtml(a.notes || '')}</textarea>`);

  return `<div class="detail-form">${html}</div>`;
}

function formGroup(label, inputHtml) {
  return `
    <div class="form-group">
      <label class="form-label">${label}</label>
      ${inputHtml}
    </div>
  `;
}

// ─── Team Section (View Mode) ───────────────────────────────────────────────

function renderTeamSection(account) {
  const members = getTeamMembers(account.id);
  const activeMembers = members.filter((m) => m.memberStatus === 'active');
  const exitedMembers = members.filter((m) => m.memberStatus === 'exited');
  const reminderDays = getSettings().reminderDays || 7;

  let memberRows = '';
  for (const m of activeMembers) {
    memberRows += memberRow(m, reminderDays);
  }
  for (const m of exitedMembers) {
    memberRows += memberRow(m, reminderDays);
  }

  return `
    <section class="card team-section">
      <div class="card-header section-title">
        👥 团队成员
        <span class="badge badge-info">${activeMembers.length} / ${account.teamLimit || 0}</span>
        <button class="btn btn-outline btn-sm" id="addMemberBtn">+ 添加</button>
      </div>
      <div class="card-body">
        ${memberRows || '<div class="empty-state">暂无成员</div>'}
      </div>
    </section>

    <!-- Member modal -->
    <div class="modal-overlay" id="memberModal">
      <div class="modal card member-edit-modal">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 0;">
          <span id="memberModalTitle" style="font-weight: bold;">添加成员</span>
          <button class="btn btn-ghost btn-sm" style="padding: 4px 8px; font-size: 1.2rem; line-height: 1;" id="closeMemberModal">✕</button>
        </div>
        <div class="card-body member-edit-modal-body" id="memberModalBody"></div>
        <div class="member-edit-modal-footer">
          <button class="btn btn-primary" id="saveMemberBtn">保存</button>
        </div>
      </div>
    </div>
  `;
}

function memberRow(m, reminderDays = 7) {
  const statusBadge =
    m.memberStatus === 'exited'
      ? '<span class="badge badge-danger">已退出</span>'
      : '<span class="badge badge-success">活跃</span>';
      
  const statusObj = getMemberPaymentStatus(m.inviteDate, m.paymentRecords, reminderDays);
  const isPaid = statusObj.isPaid;
  const targetPeriod = statusObj.targetPeriod;
  const dueDate = statusObj.dueDate;
  const urgency = statusObj.urgency;
  const paidDate = getPaymentRecordDate(statusObj.paymentRecord, dueDate);
  const paidAmount = getPaymentRecordAmount(statusObj.paymentRecord, m.chargeAmountCny);
  
  let paidBadge = '';
  if (m.willRenew === false) {
    paidBadge = '<span class="badge badge-info">不续租</span>';
  } else if (isPaid) {
    paidBadge = '<span class="badge badge-success">已缴费</span>';
  } else if (urgency === 'danger') {
    paidBadge = '<span class="badge badge-danger">欠费告警</span>';
  } else if (urgency === 'warning') {
    paidBadge = '<span class="badge badge-warning">即将到期</span>';
  } else {
    paidBadge = '<span class="badge badge-warning">未缴费</span>';
  }

  return `
    <div class="member-row" data-member-id="${m.id}" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid var(--color-border-light);">
      <div class="member-info" style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 4px;">${escHtml(m.name)} ${statusBadge}</div>
        <div style="font-size: 0.85rem; color: var(--color-text-tertiary);">
          ¥${formatCurrency(m.chargeAmountCny)}/月 · 第 ${targetPeriod} 期 (${paidBadge})<br/>
          ${m.willRenew === false ? `<span style="color: var(--color-info);">本期结束退出 (${dueDate || '-'})</span>` : (!isPaid ? `<span style="color: ${urgency === 'danger' ? 'var(--color-danger)' : 'var(--color-warning)'};">应缴日期: ${dueDate || '-'}</span>` : `已收: ¥${formatCurrency(paidAmount)} · ${paidDate || '-'}`)}
        </div>
      </div>
      <div class="member-actions" style="display: flex; flex-direction: column; gap: 0.25rem;">
        ${m.willRenew !== false && !isPaid && m.memberStatus === 'active' ? `<button class="btn btn-primary btn-sm confirm-pay-btn" data-member-id="${m.id}" data-target-period="${targetPeriod}" style="font-size: 0.7rem; padding: 2px 6px;">确认收款</button>` : ''}
        <div style="display: flex; gap: 0.25rem; justify-content: flex-end;">
          <button class="btn btn-outline btn-sm edit-member-btn" data-member-id="${m.id}" style="font-size: 0.7rem; padding: 2px 6px;">编辑</button>
          <button class="btn btn-danger btn-sm del-member-btn" data-member-id="${m.id}" style="font-size: 0.7rem; padding: 2px 6px;">删除</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Direct Income Section (GPT Plus View Mode) ────────────────────────────

function renderDirectIncomeSection(account) {
  const records = getIncomeRecordsByAccount(account.id)
    .sort((a, b) => String(b.incomeDate || b.createdAt || '').localeCompare(String(a.incomeDate || a.createdAt || '')));
  const total = records.reduce((sum, r) => sum + (Number(r.amountCny) || 0), 0);

  return `
    <section class="card direct-income-section">
      <div class="card-header section-title">
        💰 售出收入
        <span class="badge badge-success">¥${formatCurrency(total)}</span>
        <button class="btn btn-outline btn-sm" id="addIncomeBtn">+ 添加</button>
      </div>
      <div class="card-body">
        <div style="font-size: 0.85rem; color: var(--color-text-tertiary); margin-bottom: 0.75rem;">
          Plus 收入按人民币记录，不进入卡包余额；订阅支出仍由账单记录管理。
        </div>
        ${records.length ? records.map(incomeRow).join('') : '<div class="empty-state">暂无售出收入</div>'}
      </div>
    </section>

    <div class="modal-overlay" id="incomeModal">
      <div class="modal card" style="width: 90%; max-width: 520px; margin: 0 auto;">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 0;">
          <span id="incomeModalTitle" style="font-weight: bold;">添加售出收入</span>
          <button class="btn btn-ghost btn-sm" style="padding: 4px 8px; font-size: 1.2rem; line-height: 1;" id="closeIncomeModal">✕</button>
        </div>
        <div class="card-body" id="incomeModalBody" style="max-height: 70vh; overflow-y: auto;"></div>
      </div>
    </div>
  `;
}

function incomeRow(record) {
  const amount = Number(record.amountCny) || 0;
  const note = record.notes ? escHtml(record.notes) : 'Plus 售出收入';

  return `
    <div class="income-row" data-income-id="${escAttr(record.id)}" style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.75rem 0; border-bottom: 1px solid var(--color-border-light);">
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: 600; margin-bottom: 4px;">${note}</div>
        <div style="font-size: 0.85rem; color: var(--color-text-tertiary);">${formatDate(record.incomeDate) || '-'}</div>
      </div>
      <div style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0;">
        <span class="text-success" style="font-weight: 700;">+¥${formatCurrency(amount)}</span>
        <button class="btn btn-outline btn-sm edit-income-btn" data-income-id="${escAttr(record.id)}" style="font-size: 0.7rem; padding: 2px 6px;">编辑</button>
        <button class="btn btn-danger btn-sm del-income-btn" data-income-id="${escAttr(record.id)}" style="font-size: 0.7rem; padding: 2px 6px;">删除</button>
      </div>
    </div>
  `;
}

// ─── Event Binding ──────────────────────────────────────────────────────────

function bindDetailEvents(container, state, isNew) {
  // Back button
  container.querySelector('#backBtn').addEventListener('click', () => {
    window.navigateTo('accounts');
  });

  // Edit toggle
  const editBtn = container.querySelector('#editToggleBtn');
  if (editBtn) {
    editBtn.addEventListener('click', async () => {
      if (state.editing) {
        // Cancel → re-read from storage
        state.account = getAccountById(state.account.id) || state.account;
        state.editing = false;
      } else {
        state.editing = true;
      }
      await renderPage(container, state, false);
    });
  }

  // Reveal buttons (view mode)
  container.querySelectorAll('.reveal-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      state.revealed[key] = !state.revealed[key];
      await renderPage(container, state, isNew);
    });
  });

  // Dynamic conditional field toggles (edit mode)
  if (state.editing) {
    bindEditFormDynamics(container, state);
  }

  // Save button
  const saveBtn = container.querySelector('#saveBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => await handleSave(container, state, isNew));
  }

  // Delete button
  const deleteBtn = container.querySelector('#deleteBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => handleDelete(state.account));
  }

  // Team member events
  bindTeamEvents(container, state);

  // Direct income events
  bindIncomeEvents(container, state);

  // View Billing History Modal Event
  const viewBillingBtn = container.querySelector('#viewBillingHistoryBtn');
  if (viewBillingBtn) {
    viewBillingBtn.addEventListener('click', () => {
      showBillingHistory(container, state.account);
    });
  }
}

// ─── Billing History View ───────────────────────────────────────────────────

function showBillingHistory(container, account) {
  const bills = getBillingRecordsByAccount(account.id).sort((a, b) => b.period - a.period);
  const cards = getCards();
  
  let html = '';
  if (bills.length === 0) {
    html = '<div class="empty-state">暂无账单记录</div>';
  } else {
    html = bills.map(b => {
      const c = cards.find(card => card.id === b.cardId);
      const sourceLabel = getBillingSourceLabel(b.paymentSource);
      const cardStr = c ? `${c.brand.toUpperCase()} •••• ${c.lastFour}` : sourceLabel;
      return `
        <div class="settings-row clickable-row billing-history-item" data-id="${b.id}" style="padding: 1rem; border-bottom: 1px solid var(--color-border-light); flex-direction: column; align-items: flex-start; gap: 0.5rem; cursor: pointer;">
          <div style="width: 100%; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: bold; color: var(--color-primary);">第 ${b.period} 期账单 ›</span>
            <span style="color: var(--color-danger); font-weight: bold;">-$${formatCurrency(b.amount)}</span>
          </div>
          <div style="font-size: 0.85rem; color: var(--color-text-tertiary); display: flex; justify-content: space-between; width: 100%;">
            <span>扣款日期: ${b.billingDate}</span>
            <span>支付卡片: ${cardStr}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Create or update modal
  let modal = document.getElementById('billingHistoryModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'billingHistoryModal';
    modal.style.zIndex = '1000';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal card" style="width: 90%; max-width: 500px; max-height: 80vh; display: flex; flex-direction: column;">
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
        <span>历史账单</span>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('billingHistoryModal').classList.remove('modal-open')">✕</button>
      </div>
      <div class="card-body" style="flex: 1; overflow-y: auto; padding: 0;">
        <div style="padding: 0.8rem 1rem; font-size: 0.85rem; color: var(--color-text-tertiary); background: var(--color-bg-light); border-bottom: 1px solid var(--color-border-light);">
          💡 点击任意账单可直接修改金额、更换卡片或删除账单。
        </div>
        ${html}
        <div style="padding: 1rem; text-align: center;">
          <button class="btn btn-outline btn-sm" onclick="window.navigateTo('wallet')">前往卡包管理</button>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('modal-open');

  // Bind edit billing modal on click
  modal.querySelectorAll('.billing-history-item').forEach(item => {
    item.addEventListener('click', () => {
      const billId = item.dataset.id;
      openEditAccountBillModal(container, billId, account);
    });
  });
}

/**
 * Open inline Edit Billing Modal inside Account Detail
 */
function openEditAccountBillModal(container, billId, account) {
  const b = getBillingRecordById(billId);
  if (!b) return;

  const cards = getCards();
  const cardOptions = cards.map(c => `<option value="${c.id}" ${b.cardId === c.id ? 'selected' : ''}>${c.brand.toUpperCase()} •••• ${c.lastFour} ($${formatCurrency(c.balance)})</option>`).join('');
  const sourceOptions = BILLING_PAYMENT_SOURCES.map(s => `<option value="${s.value}" ${(b.paymentSource || 'unknown') === s.value ? 'selected' : ''}>${s.label}</option>`).join('');

  let modal = document.getElementById('editAccountBillModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'editAccountBillModal';
    modal.style.zIndex = '1010';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal card" style="width: 90%; max-width: 400px; display: flex; flex-direction: column;">
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
        <span>编辑账单 (第 ${b.period} 期)</span>
        <button class="btn btn-ghost btn-sm" id="closeEditAccountBillBtn">✕</button>
      </div>
      <div class="card-body" style="padding: var(--space-4);">
        <div class="alert alert-warning" style="margin-bottom: 1rem; font-size: 0.85rem;">
          修改账单会自动进行退款和重新扣款。差额会同步到对应的卡片余额中。
        </div>
        <div class="form-group">
          <label class="form-label">支付来源</label>
          <select class="form-select" id="eb_paymentSource">
            ${sourceOptions}
          </select>
        </div>
        <div class="form-group" id="eb_cardGroup">
          <label class="form-label">支付卡片</label>
          <select class="form-select" id="eb_cardId">
            <option value="">-- 请选择卡片 --</option>
            ${cardOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">扣款日期</label>
          <input class="form-input" id="eb_billingDate" type="date" value="${b.billingDate || ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">实际扣费金额 (USD)</label>
          <input class="form-input" id="eb_amount" type="number" step="0.01" min="0" value="${b.amount || 0}" />
        </div>
        <div style="display: flex; gap: 0.5rem; margin-top: 1.5rem;">
          <button class="btn btn-danger" style="flex: 1;" id="deleteAccountBillBtn">删除账单</button>
          <button class="btn btn-primary" style="flex: 2;" id="saveAccountBillBtn">确认修改</button>
        </div>
      </div>
    </div>
  `;

  modal.classList.add('modal-open');

  const sourceSelect = modal.querySelector('#eb_paymentSource');
  const cardGroup = modal.querySelector('#eb_cardGroup');
  const syncCardGroup = () => {
    if (cardGroup) cardGroup.style.display = sourceSelect.value === 'card' ? '' : 'none';
  };
  sourceSelect.addEventListener('change', syncCardGroup);
  syncCardGroup();

  // Close event
  modal.querySelector('#closeEditAccountBillBtn').addEventListener('click', () => {
    modal.classList.remove('modal-open');
  });

  // Save event
  modal.querySelector('#saveAccountBillBtn').addEventListener('click', () => {
    const paymentSource = modal.querySelector('#eb_paymentSource').value;
    const newCardId = paymentSource === 'card' ? modal.querySelector('#eb_cardId').value : '';
    const newAmount = Number(modal.querySelector('#eb_amount').value);
    const billingDate = modal.querySelector('#eb_billingDate').value;

    if (!billingDate || !Number.isFinite(newAmount) || newAmount < 0) {
      showToast('请填写有效的扣款日期和金额');
      return;
    }
    if (paymentSource === 'card' && !newCardId) {
      showToast('请选择实际扣款卡片');
      return;
    }

    editBillingRecord(b.id, newCardId, newAmount, paymentSource, billingDate);
    showToast('账单修改成功，卡片余额已同步');
    modal.classList.remove('modal-open');
    
    // Refresh history
    showBillingHistory(container, account);
  });

  // Delete event
  modal.querySelector('#deleteAccountBillBtn').addEventListener('click', () => {
    if (confirm('确定要删除这笔账单记录吗？')) {
      deleteBillingRecord(b.id);
      showToast('账单已删除，卡片余额已重算');
      modal.classList.remove('modal-open');
      
      // Refresh history
      showBillingHistory(container, account);
    }
  });
}

/**
 * Bind dynamic show/hide of conditional fields in edit mode
 */
function bindEditFormDynamics(container, state) {
  const statusSelect = container.querySelector('#f_status');
  const subSelect = container.querySelector('#f_subscriptionType');

  const updatePaidFields = () => {
    const paid = isPaidSubscription(subSelect ? subSelect.value : state.account.subscriptionType);
    const isBanned = statusSelect ? statusSelect.value === 'banned' : state.account.status === 'banned';
    const paidFields = container.querySelector('#paidFields');
    if (paidFields) paidFields.style.display = (paid && !isBanned) ? '' : 'none';
  };

  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      const banGroup = container.querySelector('#banDateGroup');
      if (banGroup) banGroup.style.display = statusSelect.value === 'banned' ? '' : 'none';
      updatePaidFields();
    });
  }

  if (subSelect) {
    subSelect.addEventListener('change', () => {
      updatePaidFields();
      const teamGroup = container.querySelector('#teamLimitGroup');
      if (teamGroup) {
        teamGroup.style.display = hasTeamManagement(state.account.type, subSelect.value) ? '' : 'none';
      }
    });
  }

  const startDateInput = container.querySelector('#f_subscriptionStartDate');
  const renewalInput = container.querySelector('#f_renewalDate');
  const periodHint = container.querySelector('#billingPeriodHint');
  const syncAutoRenewal = () => {
    if (!startDateInput || !renewalInput) return;
    const info = getNextMonthlyBillingInfo(startDateInput.value);
    renewalInput.value = info.renewalDate || '';
    if (periodHint) {
      periodHint.textContent = getBillingPeriodHint(info);
    }
  };
  if (startDateInput) {
    syncAutoRenewal();
    startDateInput.addEventListener('change', syncAutoRenewal);
    startDateInput.addEventListener('input', syncAutoRenewal);
  }

  // Refund status → refund amount toggle
  const refundSelect = container.querySelector('#f_refundStatus');
  if (refundSelect) {
    refundSelect.addEventListener('change', () => {
      const amtGroup = container.querySelector('#refundAmountGroup');
      if (amtGroup) amtGroup.style.display = refundSelect.value !== 'none' ? '' : 'none';
    });
  }

  // Migrate old payment method to Card
  const migrateBtn = container.querySelector('#migrateCardBtn');
  if (migrateBtn) {
    migrateBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const val = container.querySelector('#f_oldPaymentMethod').value;
      if (!val) return;
      
      let brand = 'other';
      const lowerVal = val.toLowerCase();
      if (lowerVal.includes('bitget')) brand = 'bitget';
      else if (lowerVal.includes('bybit')) brand = 'bybit';
      else if (lowerVal.includes('roogoo')) brand = 'roogoo';
      else if (lowerVal.includes('ur')) brand = 'ur';
      else if (lowerVal.includes('savo')) brand = 'savo';
      else if (lowerVal.includes('krak')) brand = 'krak';
      
      const match = val.match(/\d{4}/);
      const lastFour = match ? match[0] : '';
      
      if (!lastFour) {
        showToast('无法识别卡片尾号，添加失败');
        return;
      }
      
      const cards = getCards();
      const existingCard = cards.find(c => c.brand === brand && c.lastFour === lastFour);
      const select = container.querySelector('#f_paymentCardId');
      
      if (existingCard) {
        select.value = existingCard.id;
        showToast('卡包已有该卡片，已自动选中');
      } else {
        const newCard = {
          id: generateId(),
          brand,
          lastFour,
          remark: val,
          balance: 0
        };
        
        saveCard(newCard);
        
        // Add to select and select it
        const brandOptions = [
          {value: 'bybit', label: 'Bybit Card'},
          {value: 'bitget', label: 'Bitget Card'},
          {value: 'roogoo', label: 'Roogoo'},
          {value: 'ur', label: 'UR Card'},
          {value: 'savo', label: 'Savo'},
          {value: 'krak', label: 'Kraken'},
          {value: 'other', label: '其他 (Other)'}
        ];
        const brandLabel = brandOptions.find(b => b.value === brand)?.label || brand;
        const option = document.createElement('option');
        option.value = newCard.id;
        option.textContent = `${brandLabel} •••• ${lastFour}`;
        select.appendChild(option);
        select.value = newCard.id;
        
        showToast('已成功提取并添加到卡包，已为您自动选中！');
      }
    });
  }
}

/**
 * Collect form values and save the account
 */
async function handleSave(container, state, isNew) {
  const masterPwd = sessionStorage.getItem('masterPassword');
  const a = state.account;

  // Collect common fields
  a.nickname = getVal(container, '#f_nickname');
  a.email = getVal(container, '#f_email');
  a.subscriptionType = getVal(container, '#f_subscriptionType') || a.subscriptionType;
  a.status = getVal(container, '#f_status') || a.status;
  a.banDate = getVal(container, '#f_banDate');
  if (hasMonthlyRenewal(a.type)) {
    a.subscriptionStartDate = getVal(container, '#f_subscriptionStartDate');
  }
  a.renewalDate = getVal(container, '#f_renewalDate');
  a.subscriptionCostUsd = parseFloat(getVal(container, '#f_subscriptionCostUsd')) || 0;
  a.billingDate = getVal(container, '#f_billingDate');
  a.teamLimit = parseInt(getVal(container, '#f_teamLimit'), 10) || 0;
  a.notes = getVal(container, '#f_notes');

  if (!a.nickname && !a.email) {
    showToast('账号昵称和邮箱至少填写一项');
    return;
  }

  if (isPaidSubscription(a.subscriptionType) && a.status !== 'banned') {
    if (hasMonthlyRenewal(a.type) && !a.subscriptionStartDate) {
      showToast('付费订阅必须填写开通时间');
      return;
    }
    if (!Number.isFinite(a.subscriptionCostUsd) || a.subscriptionCostUsd <= 0) {
      showToast('付费订阅费用必须大于 0');
      return;
    }
  }

  if (hasTeamManagement(a.type, a.subscriptionType)) {
    const activeMemberCount = getTeamMembers(a.id).filter((member) => member.memberStatus === 'active').length;
    if (a.teamLimit < activeMemberCount) {
      showToast(`团队上限不能小于当前活跃成员数 ${activeMemberCount}`);
      return;
    }
  }

  // Encrypt sensitive fields
  const rawPwd = getVal(container, '#f_password');
  if (rawPwd && masterPwd) {
    a.encryptedPassword = await encrypt(rawPwd, masterPwd);
  } else if (!rawPwd) {
    // If cleared, remove encrypted value (only for new accounts)
    if (isNew) a.encryptedPassword = '';
  }

  const rawPayment = getVal(container, '#f_paymentCardId');
  a.paymentCardId = rawPayment || '';

  // Type-specific fields
  if (hasLoginDevice(a.type)) {
    a.loginDevice = getVal(container, '#f_loginDevice');
  }
  if (hasRegistrationDate(a.type)) {
    a.registrationDate = getVal(container, '#f_registrationDate');
  }
  if (hasRefundFields(a.type)) {
    a.refundStatus = getVal(container, '#f_refundStatus') || 'none';
    a.refundAmount = parseFloat(getVal(container, '#f_refundAmount')) || 0;
    a.refundDate = getVal(container, '#f_refundDate');
    if (a.refundStatus === 'received' && (a.refundAmount <= 0 || !a.refundDate)) {
      showToast('退款到账时必须填写退款金额和到账日期');
      return;
    }
  }

  // Adjust monthly billing date and handle banned/unpaid clearing
  if (!isPaidSubscription(a.subscriptionType)) {
    a.renewalDate = '';
    a.billingDate = '';
    a.subscriptionCostUsd = 0;
  } else if (hasMonthlyRenewal(a.type) && a.subscriptionStartDate) {
    const info = getNextMonthlyBillingInfo(a.subscriptionStartDate);
    a.renewalDate = info.renewalDate || a.renewalDate;
    a.billingDate = a.renewalDate;
  }

  a.updatedAt = new Date().toISOString();
  if (isNew) a.createdAt = new Date().toISOString();

  saveAccount(a);
  showToast('保存成功 ✓');

  // Switch to view mode
  state.account = a;
  state.editing = false;
  await renderPage(container, state, false);
}

/**
 * Delete account with confirmation
 */
function handleDelete(account) {
  const confirmed = confirm(`确定要删除账号「${account.nickname || account.email || ''}」吗？\n此操作不可恢复。`);
  if (confirmed) {
    deleteAccount(account.id);
    showToast('账号已删除');
    window.navigateTo('accounts');
  }
}

// ─── Direct Income Events ──────────────────────────────────────────────────

function bindIncomeEvents(container, state) {
  const addIncomeBtn = container.querySelector('#addIncomeBtn');
  if (addIncomeBtn) {
    addIncomeBtn.addEventListener('click', () => {
      openIncomeModal(container, state, null);
    });
  }

  container.querySelectorAll('.edit-income-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const incomeId = btn.dataset.incomeId;
      const records = getIncomeRecordsByAccount(state.account.id);
      const record = records.find((r) => r.id === incomeId);
      if (record) openIncomeModal(container, state, record);
    });
  });

  container.querySelectorAll('.del-income-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const incomeId = btn.dataset.incomeId;
      if (confirm('确定删除这笔售出收入？')) {
        deleteIncomeRecord(incomeId);
        showToast('售出收入已删除');
        renderPage(container, state, false);
      }
    });
  });
}

function openIncomeModal(container, state, existingRecord) {
  const modal = container.querySelector('#incomeModal');
  const title = container.querySelector('#incomeModalTitle');
  const body = container.querySelector('#incomeModalBody');
  if (!modal || !body) return;

  const isEdit = !!existingRecord;
  const record = existingRecord
    ? { ...existingRecord }
    : {
        accountId: state.account.id,
        source: 'plus_sale',
        incomeDate: getLocalDateString(),
        amountCny: 0,
        notes: '',
      };

  if (title) title.textContent = isEdit ? '编辑售出收入' : '添加售出收入';

  body.innerHTML = `
    ${formGroup('收入日期', `<input class="form-input" id="i_incomeDate" type="date" value="${record.incomeDate || ''}" />`)}
    ${formGroup('卖出收入 (CNY)', `<input class="form-input" id="i_amountCny" type="number" step="0.01" min="0" value="${record.amountCny || 0}" placeholder="银行卡实际收到的人民币金额" />`)}
    ${formGroup('备注', `<textarea class="form-input" id="i_notes" rows="2" placeholder="例如：卖给某客户、某订单">${escHtml(record.notes || '')}</textarea>`)}
    <button class="btn btn-primary" style="width: 100%; margin-top: 1rem;" id="saveIncomeBtn">保存</button>
  `;

  modal.classList.add('modal-open');

  const closeBtn = container.querySelector('#closeIncomeModal');
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.classList.remove('modal-open');
    };
  }

  const saveBtn = container.querySelector('#saveIncomeBtn');
  if (saveBtn) {
    saveBtn.onclick = () => {
      const amount = parseFloat(getVal(container, '#i_amountCny')) || 0;
      if (amount <= 0) {
        showToast('收入金额必须大于 0');
        return;
      }

      saveIncomeRecord({
        ...record,
        incomeDate: getVal(container, '#i_incomeDate') || getLocalDateString(),
        amountCny: amount,
        notes: getVal(container, '#i_notes'),
      });

      modal.classList.remove('modal-open');
      showToast(isEdit ? '售出收入已更新' : '售出收入已添加');
      renderPage(container, state, false);
    };
  }
}

// ─── Team Member Events ─────────────────────────────────────────────────────

function bindTeamEvents(container, state) {
  const addMemberBtn = container.querySelector('#addMemberBtn');
  if (addMemberBtn) {
    addMemberBtn.addEventListener('click', () => {
      openMemberModal(container, state, null);
    });
  }

  container.querySelectorAll('.edit-member-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const memberId = btn.dataset.memberId;
      const members = getTeamMembers(state.account.id);
      const member = members.find((m) => m.id === memberId);
      if (member) openMemberModal(container, state, member);
    });
  });

  container.querySelectorAll('.confirm-pay-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const memberId = btn.dataset.memberId;
      const tPeriod = parseInt(btn.dataset.targetPeriod, 10);
      const members = getTeamMembers(state.account.id);
      const member = members.find((m) => m.id === memberId);
      if (member) {
        if (!member.paymentRecords) member.paymentRecords = {};
        member.paymentRecords[tPeriod] = {
          paid: true,
          paidDate: getLocalDateString(),
          amountCny: Number(member.chargeAmountCny) || 0,
          updatedAt: new Date().toISOString(),
        };
        
        saveTeamMember(member);
        showToast(`第 ${tPeriod} 期收款确认成功`);
        renderPage(container, state, false);
      }
    });
  });

  container.querySelectorAll('.del-member-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const memberId = btn.dataset.memberId;
      if (confirm('确定删除该成员？')) {
        deleteTeamMember(memberId);
        showToast('成员已删除');
        renderPage(container, state, false);
      }
    });
  });
}

function openMemberModal(container, state, existingMember) {
  const modal = container.querySelector('#memberModal');
  const title = container.querySelector('#memberModalTitle');
  const body = container.querySelector('#memberModalBody');
  if (!modal || !body) return;

  const isEdit = !!existingMember;
  const m = existingMember || {
    id: generateId(),
    accountId: state.account.id,
    name: '',
    email: '',
    inviteDate: getLocalDateString(),
    chargeAmountCny: 0,
    paidUpToPeriod: 0,
    memberStatus: 'active',
    notes: '',
  };

  title.textContent = isEdit ? '编辑成员' : '添加成员';

    const reminderDays = getSettings().reminderDays || 7;
    const targetPeriod = getTargetPaymentPeriod(m.inviteDate, reminderDays);
    let historyHtml = '';
    const paymentRecords = m.paymentRecords || {};

    if (isEdit && m.inviteDate) {
      historyHtml = '<div style="margin-top: 1.5rem; border-top: 1px solid var(--color-border-light); padding-top: 1rem;">';
      historyHtml += '<div style="font-weight: bold; margin-bottom: 0.8rem;">历史账单 (当前催收期：第 ' + targetPeriod + ' 期)</div>';
      historyHtml += '<div style="max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem;">';
      
      for (let i = targetPeriod; i >= 1; i--) {
        const periodRecord = paymentRecords[i];
        const isPaid = isPaymentRecordPaid(periodRecord);
        const paidDate = getPaymentRecordDate(periodRecord, getDueDateForPeriod(m.inviteDate, i));
        const paidAmount = getPaymentRecordAmount(periodRecord, m.chargeAmountCny);
        historyHtml += `
          <div style="display: grid; grid-template-columns: minmax(120px, 1fr); gap: 0.75rem; align-items: center; padding: 0.75rem; background: var(--color-bg-tertiary); border-radius: var(--radius-md);">
            <div style="min-width: 0;">
              <div style="font-weight: 500; font-size: 0.95rem;">第 ${i} 期</div>
              <div style="font-size: 0.8rem; color: var(--color-text-tertiary);">默认 ¥${m.chargeAmountCny || 0}</div>
            </div>
            <div style="display: grid; grid-template-columns: minmax(96px, 1fr) minmax(116px, 1fr) minmax(92px, 0.8fr); gap: 0.4rem; align-items: center;">
              <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.85rem; user-select: none;">
                <input type="checkbox" class="member-payment-cb" data-period="${i}" ${isPaid ? 'checked' : ''} style="width: 16px; height: 16px;" />
                ${isPaid ? '<span class="badge badge-success">已缴费</span>' : '<span class="badge badge-warning">未缴费</span>'}
              </label>
              <input class="form-input member-payment-date" data-period="${i}" type="date" value="${isPaid ? paidDate : ''}" style="height: 32px; font-size: 0.8rem; padding: 0.2rem 0.4rem;" />
              <input class="form-input member-payment-amount" data-period="${i}" type="number" step="0.01" min="0" value="${isPaid ? paidAmount : (m.chargeAmountCny || 0)}" style="height: 32px; font-size: 0.8rem; padding: 0.2rem 0.4rem;" />
            </div>
          </div>
        `;
      }
      historyHtml += '</div></div>';
    }

  body.innerHTML = `
    ${formGroup('姓名', `<input class="form-input" id="m_name" value="${escAttr(m.name)}" placeholder="成员姓名" />`)}
    ${formGroup('邮箱', `<input class="form-input" id="m_email" type="email" value="${escAttr(m.email)}" placeholder="成员邮箱 (选填)" />`)}
    ${formGroup('邀请日期 / 加入日期', `<input class="form-input" id="m_inviteDate" type="date" value="${m.inviteDate || ''}" />`)}
    ${formGroup('收费金额 (CNY/月)', `<input class="form-input" id="m_chargeAmountCny" type="number" step="0.01" min="0" value="${m.chargeAmountCny || 0}" />`)}
    ${formGroup('下期是否续租', `
      <select class="form-select" id="m_willRenew">
        <option value="true" ${m.willRenew !== false ? 'selected' : ''}>续租 (默认)</option>
        <option value="false" ${m.willRenew === false ? 'selected' : ''}>不续租 (到期空出)</option>
      </select>
    `)}
    ${formGroup('成员状态', `
      <select class="form-select" id="m_memberStatus">
        ${MEMBER_STATUS_OPTIONS.map((o) => `<option value="${o.value}" ${m.memberStatus === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>
    `)}
    ${formGroup('备注', `<textarea class="form-input" id="m_notes" rows="2">${escHtml(m.notes || '')}</textarea>`)}
    ${historyHtml}
  `;

  modal.classList.add('modal-open');

  // Close modal
  container.querySelector('#closeMemberModal').addEventListener('click', () => {
    modal.classList.remove('modal-open');
  });

  // Save member
  container.querySelector('#saveMemberBtn').addEventListener('click', () => {
    m.name = getVal(container, '#m_name');
    m.email = getVal(container, '#m_email');
    m.inviteDate = getVal(container, '#m_inviteDate');
    const chargeAmount = Number(getVal(container, '#m_chargeAmountCny'));
    m.chargeAmountCny = Number.isFinite(chargeAmount) ? chargeAmount : 0;
    m.willRenew = getVal(container, '#m_willRenew') === 'true';
    m.memberStatus = getVal(container, '#m_memberStatus') || 'active';
    m.notes = getVal(container, '#m_notes');

    if (!m.name || !m.inviteDate) {
      showToast('成员姓名和加入日期不能为空');
      return;
    }
    if (!Number.isFinite(chargeAmount) || chargeAmount < 0) {
      showToast('成员月租金额不能小于 0');
      return;
    }
    if (!isEdit && m.memberStatus === 'active') {
      const activeCount = getTeamMembers(state.account.id)
        .filter((member) => member.memberStatus === 'active').length;
      if (state.account.teamLimit > 0 && activeCount >= state.account.teamLimit) {
        showToast('当前团队席位已满，请先调整团队上限或退出成员');
        return;
      }
    }
    
    if (!m.paymentRecords) m.paymentRecords = {};
    container.querySelectorAll('.member-payment-cb').forEach(cb => {
      const p = parseInt(cb.dataset.period, 10);
      if (!cb.checked) {
        delete m.paymentRecords[p];
        return;
      }
      const dateInput = container.querySelector(`.member-payment-date[data-period="${p}"]`);
      const amountInput = container.querySelector(`.member-payment-amount[data-period="${p}"]`);
      const existingRecord = m.paymentRecords[p] && typeof m.paymentRecords[p] === 'object' ? m.paymentRecords[p] : {};
      const paidAmount = Number(amountInput?.value);
      m.paymentRecords[p] = {
        ...existingRecord,
        paid: true,
        paidDate: dateInput?.value || getDueDateForPeriod(m.inviteDate, p),
        amountCny: Number.isFinite(paidAmount) ? paidAmount : m.chargeAmountCny,
        updatedAt: new Date().toISOString(),
      };
    });

    saveTeamMember(m);
    modal.classList.remove('modal-open');
    showToast('成员已保存 ✓');
    renderPage(container, state, false);
  });
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function getVal(container, selector) {
  const el = container.querySelector(selector);
  return el ? el.value.trim() : '';
}

function getTypeLabel(type) {
  return ACCOUNT_TYPES.find((t) => t.value === type)?.label || type;
}

function getSubLabel(type, sub) {
  const options = SUBSCRIPTION_TYPES[type] || [];
  return options.find((o) => o.value === sub)?.label || sub || 'Free';
}

function getBillingSourceLabel(source) {
  return BILLING_PAYMENT_SOURCES.find((s) => s.value === source)?.label || '未指定来源';
}

function getAccountRenewalInfo(account) {
  if (hasMonthlyRenewal(account.type) && account.subscriptionStartDate) {
    return getNextMonthlyBillingInfo(account.subscriptionStartDate);
  }

  return {
    renewalDate: account.renewalDate || '',
    period: 0,
  };
}

function getBillingPeriodHint(info) {
  if (!info || !info.period || !info.renewalDate) {
    return '填写开通时间后自动计算续费日期和账单期数';
  }
  return `第 ${info.period} 期月账单`;
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function escAttr(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showToast(message) {
  // Use global toast if available, otherwise simple alert-style toast
  if (window.showToast) {
    window.showToast(message);
    return;
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}
