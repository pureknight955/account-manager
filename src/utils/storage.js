/**
 * storage.js — localStorage persistence layer
 *
 * All keys are prefixed with 'acctmgr_' to avoid collisions.
 * Data is stored as JSON.
 */

import {
  addCalendarDays,
  compareDateOnly,
  getLocalDateString,
  getMonthlyBillingDate,
  getNextMonthlyBillingInfo,
} from './helpers.js';
import { SUBSCRIPTION_STATUS } from '../config.js';

const PREFIX = 'acctmgr_';
const CARD_BALANCE_MODEL_VERSION = 2;

const KEYS = {
  accounts:       `${PREFIX}accounts`,
  teamMembers:    `${PREFIX}team_members`,
  settings:       `${PREFIX}settings`,
  cards:          `${PREFIX}cards`,
  topUpRecords:   `${PREFIX}top_up_records`,
  billingRecords: `${PREFIX}billing_records`,
  incomeRecords:  `${PREFIX}income_records`,
};

let dataNotificationsSuppressed = 0;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read a JSON value from localStorage, returning `fallback` on failure.
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Write a JSON-serialisable value to localStorage.
 * @param {string} key
 * @param {*} value
 */
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  notifyDataChanged(key);
}

function notifyDataChanged(key) {
  if (dataNotificationsSuppressed > 0 || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('acctmgr:data-changed', { detail: { key } }));
}

function withoutDataNotifications(callback) {
  dataNotificationsSuppressed += 1;
  try {
    return callback();
  } finally {
    dataNotificationsSuppressed -= 1;
  }
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a UUID v4 string.
 * @returns {string}
 */
export function generateId() {
  // crypto.randomUUID() is available in all modern browsers
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback (RFC 4122 v4)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * Get all accounts, optionally filtered by type.
 * @param {string} [type] - 'gpt' | 'claude' | 'gemini' | undefined
 * @returns {Array<Object>}
 */
export function getAccounts(type) {
  const accounts = read(KEYS.accounts, []);
  if (!type) return accounts;
  return accounts.filter((a) => a.type === type);
}

/**
 * Get a single account by its id.
 * @param {string} id
 * @returns {Object|null}
 */
export function getAccountById(id) {
  const accounts = read(KEYS.accounts, []);
  return accounts.find((a) => a.id === id) || null;
}

export function getSubscriptionCycles(account) {
  return Array.isArray(account?.subscriptionCycles)
    ? account.subscriptionCycles.map((cycle) => ({ ...cycle }))
    : [];
}

export function getCurrentSubscriptionCycle(account) {
  const cycles = getSubscriptionCycles(account);
  if (!cycles.length) return null;
  if (account?.currentSubscriptionCycleId) {
    const current = cycles.find((cycle) => cycle.id === account.currentSubscriptionCycleId);
    if (current) return current;
  }
  return cycles.find((cycle) => (
    cycle.status === SUBSCRIPTION_STATUS.ACTIVE
    || cycle.status === SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END
  )) || null;
}

export function getLatestSubscriptionEndDate(account) {
  return getSubscriptionCycles(account)
    .map((cycle) => cycle.endDate || '')
    .filter(Boolean)
    .sort()
    .at(-1) || '';
}

export function getEarliestNewSubscriptionDate(account) {
  const latestEndDate = getLatestSubscriptionEndDate(account);
  return latestEndDate ? addCalendarDays(latestEndDate, 1) : '';
}

export function getSubscriptionLifecycleStatus(account) {
  const current = getCurrentSubscriptionCycle(account);
  if (current) return current.status;
  return getSubscriptionCycles(account).length ? SUBSCRIPTION_STATUS.ENDED : 'none';
}

export function isAccountSubscriptionActive(account, referenceDate = new Date()) {
  if (!account || account.status === 'banned') return false;
  const cycle = getCurrentSubscriptionCycle(account);
  if (!cycle) return false;
  if (cycle.status === SUBSCRIPTION_STATUS.ACTIVE) return true;
  if (cycle.status !== SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END || !cycle.endDate) return false;
  return compareDateOnly(getLocalDateString(referenceDate), cycle.endDate) <= 0;
}

function buildSubscriptionCycle(account, now) {
  return {
    id: generateId(),
    planType: account.subscriptionType,
    startDate: account.subscriptionStartDate || '',
    billingAnchorDate: account.subscriptionStartDate || '',
    costUsd: Number(account.subscriptionCostUsd) || 0,
    paymentCardId: account.paymentCardId || '',
    status: SUBSCRIPTION_STATUS.ACTIVE,
    endDate: '',
    cancellationRequestedAt: '',
    endedReason: '',
    createdAt: now,
    updatedAt: now,
  };
}

function copySubscriptionCycles(account) {
  return getSubscriptionCycles(account);
}

function findMutableCurrentCycle(account) {
  if (!Array.isArray(account.subscriptionCycles)) return null;
  if (account.currentSubscriptionCycleId) {
    const current = account.subscriptionCycles.find((cycle) => cycle.id === account.currentSubscriptionCycleId);
    if (current) return current;
  }
  return account.subscriptionCycles.find((cycle) => (
    cycle.status === SUBSCRIPTION_STATUS.ACTIVE
    || cycle.status === SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END
  )) || null;
}

function clearCurrentPaidSubscription(account) {
  account.currentSubscriptionCycleId = '';
  account.subscriptionType = 'free';
  account.subscriptionStatus = SUBSCRIPTION_STATUS.ENDED;
  account.subscriptionStartDate = '';
  account.renewalDate = '';
  account.billingDate = '';
  account.subscriptionCostUsd = 0;
}

function finishCurrentCycle(account, endDate, reason, now) {
  const current = findMutableCurrentCycle(account);
  if (current) {
    current.status = SUBSCRIPTION_STATUS.ENDED;
    current.endDate = endDate || current.endDate || getLocalDateString(now);
    current.endedReason = reason || current.endedReason || 'ended';
    current.updatedAt = now;
  }
  clearCurrentPaidSubscription(account);
}

/**
 * Save (create or update) an account.
 *
 * - If the account has no `id`, a new UUID is generated and `createdAt` is set.
 * - `updatedAt` is always refreshed.
 *
 * @param {Object} account
 * @returns {Object} The saved account (with id and timestamps)
 */
export function saveAccount(account) {
  const accounts = read(KEYS.accounts, []);
  const now = new Date().toISOString();
  const existingIndex = account.id ? accounts.findIndex((item) => item.id === account.id) : -1;
  const previous = existingIndex >= 0 ? accounts[existingIndex] : null;
  const next = {
    ...(previous || {}),
    ...account,
    subscriptionCycles: Array.isArray(account.subscriptionCycles)
      ? copySubscriptionCycles(account)
      : copySubscriptionCycles(previous),
  };

  if (!next.id) {
    // Create
    next.id = generateId();
    next.createdAt = now;
  }

  // Import legacy paid accounts into their first independent subscription cycle.
  if (!next.subscriptionCycles.length && previous && isPaidSubscriptionValue(previous.subscriptionType)) {
    const legacy = buildSubscriptionCycle(previous, previous.createdAt || now);
    legacy.id = previous.currentSubscriptionCycleId || legacy.id;
    legacy.status = previous.subscriptionStatus || SUBSCRIPTION_STATUS.ACTIVE;
    legacy.endDate = previous.subscriptionEndDate || '';
    legacy.cancellationRequestedAt = previous.cancellationRequestedAt || '';
    next.subscriptionCycles.push(legacy);
    next.currentSubscriptionCycleId = legacy.status === SUBSCRIPTION_STATUS.ENDED ? '' : legacy.id;
  }

  let current = findMutableCurrentCycle(next);
  const isPaid = isPaidSubscriptionValue(next.subscriptionType);

  if (next.status === 'banned') {
    next.banDate = next.banDate || getLocalDateString();
    finishCurrentCycle(next, next.banDate, 'banned', now);
    current = null;
  } else if (current) {
    if (!isPaid) {
      throw new Error('当前订阅尚未结束，请使用“取消续费”功能。');
    }
    if (next.subscriptionType !== current.planType) {
      throw new Error('当前订阅尚未结束，暂不支持直接切换套餐。');
    }
    const existingBills = read(KEYS.billingRecords, []).filter((record) => (
      record.subscriptionCycleId === current.id && record.status !== 'voided'
    ));
    if (existingBills.length && next.subscriptionStartDate !== current.startDate) {
      throw new Error('已有账单的订阅不能修改首次扣费日期。');
    }
    current.startDate = next.subscriptionStartDate || current.startDate;
    current.billingAnchorDate = current.startDate;
    current.costUsd = Number(next.subscriptionCostUsd) || 0;
    current.paymentCardId = next.paymentCardId || '';
    current.updatedAt = now;
    next.subscriptionStatus = current.status;
    next.subscriptionEndDate = current.endDate || '';
    next.cancellationRequestedAt = current.cancellationRequestedAt || '';
  } else if (isPaid) {
    if (!next.subscriptionStartDate) {
      throw new Error('付费订阅必须填写实际首次扣费日期。');
    }
    if (compareDateOnly(next.subscriptionStartDate, getLocalDateString()) > 0) {
      throw new Error('实际首次扣费日期不能晚于今天。');
    }
    const earliestDate = getEarliestNewSubscriptionDate(next);
    if (earliestDate && compareDateOnly(next.subscriptionStartDate, earliestDate) < 0) {
      throw new Error(`新订阅日期不能早于 ${earliestDate}。`);
    }
    const cycle = buildSubscriptionCycle(next, now);
    next.subscriptionCycles.push(cycle);
    next.currentSubscriptionCycleId = cycle.id;
    next.subscriptionStatus = SUBSCRIPTION_STATUS.ACTIVE;
    next.subscriptionEndDate = '';
    next.cancellationRequestedAt = '';
  } else {
    next.currentSubscriptionCycleId = '';
    next.subscriptionStatus = next.subscriptionCycles.length ? SUBSCRIPTION_STATUS.ENDED : 'none';
  }

  next.lastUserEditedAt = now;
  next.updatedAt = now;

  const idx = accounts.findIndex((a) => a.id === next.id);
  if (idx >= 0) {
    accounts[idx] = next;
  } else {
    accounts.push(next);
  }

  write(KEYS.accounts, accounts);
  Object.assign(account, next);
  return next;
}

/**
 * Keep the current paid period usable, but stop before its next bill.
 * The inclusive end date is the next cycle date after the latest valid bill.
 */
export function scheduleSubscriptionCancellation(accountId, referenceDate = new Date()) {
  autoGenerateBillingRecords(referenceDate);
  const account = getAccountById(accountId);
  if (!account || account.status === 'banned') {
    throw new Error('只有正常使用中的付费账号可以取消续费。');
  }

  account.subscriptionCycles = copySubscriptionCycles(account);
  const current = findMutableCurrentCycle(account);
  if (!current || current.status === SUBSCRIPTION_STATUS.ENDED) {
    throw new Error('当前没有可以取消的付费订阅。');
  }

  const today = getLocalDateString(referenceDate);
  const validBills = getBillingRecordsByAccountIncludingVoided(accountId)
    .filter((record) => record.status !== 'voided')
    .filter((record) => record.subscriptionCycleId === current.id)
    .filter((record) => !record.billingDate || record.billingDate <= today)
    .sort((left, right) => {
      const periodDiff = Number(left.period || 0) - Number(right.period || 0);
      return periodDiff || String(left.billingDate || '').localeCompare(String(right.billingDate || ''));
    });
  const lastBill = validBills.at(-1);
  let endDate = '';
  if (lastBill?.period) {
    endDate = getMonthlyBillingDate(current.billingAnchorDate || current.startDate, Number(lastBill.period) + 1);
  }
  if (!endDate) {
    endDate = getNextMonthlyBillingInfo(current.billingAnchorDate || current.startDate, referenceDate).renewalDate;
  }
  if (!endDate) throw new Error('无法确定订阅到期日，请先检查首次扣费日期。');

  const now = new Date().toISOString();
  current.status = SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END;
  current.endDate = endDate;
  current.cancellationRequestedAt = now;
  current.endedReason = '';
  current.updatedAt = now;
  account.subscriptionStatus = current.status;
  account.subscriptionEndDate = endDate;
  account.cancellationRequestedAt = now;
  account.renewalDate = endDate;
  account.billingDate = endDate;
  account.lastUserEditedAt = now;
  account.updatedAt = now;
  persistAccount(account);
  return account;
}

export function restoreSubscriptionRenewal(accountId, referenceDate = new Date()) {
  const account = getAccountById(accountId);
  if (!account || account.status === 'banned') {
    throw new Error('封禁账号不能恢复续费。');
  }
  account.subscriptionCycles = copySubscriptionCycles(account);
  const current = findMutableCurrentCycle(account);
  if (!current || current.status !== SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END) {
    throw new Error('当前订阅没有处于到期取消状态。');
  }
  const today = getLocalDateString(referenceDate);
  if (!current.endDate || compareDateOnly(today, current.endDate) > 0) {
    throw new Error('当前订阅已经到期，请重新创建付费订阅。');
  }

  const now = new Date().toISOString();
  current.status = SUBSCRIPTION_STATUS.ACTIVE;
  current.endDate = '';
  current.cancellationRequestedAt = '';
  current.endedReason = '';
  current.updatedAt = now;
  const nextInfo = getNextMonthlyBillingInfo(current.billingAnchorDate || current.startDate, referenceDate);
  account.subscriptionStatus = current.status;
  account.subscriptionEndDate = '';
  account.cancellationRequestedAt = '';
  account.renewalDate = nextInfo.renewalDate;
  account.billingDate = nextInfo.renewalDate;
  account.lastUserEditedAt = now;
  account.updatedAt = now;
  persistAccount(account);
  return account;
}

/**
 * Delete an account **and all its team members, billing records, and income records**.
 * @param {string} id
 * @returns {boolean} `true` if the account existed
 */
export function deleteAccount(id) {
  const accounts = read(KEYS.accounts, []);
  const filtered = accounts.filter((a) => a.id !== id);
  const existed = filtered.length < accounts.length;

  if (existed) {
    write(KEYS.accounts, filtered);
    // Cascade-delete team members belonging to this account
    const members = read(KEYS.teamMembers, []);
    write(KEYS.teamMembers, members.filter((m) => m.accountId !== id));
    // Cascade-delete billing records belonging to this account
    const bills = read(KEYS.billingRecords, []);
    write(KEYS.billingRecords, bills.filter((b) => b.accountId !== id));
    // Cascade-delete direct income records belonging to this account
    const incomes = read(KEYS.incomeRecords, []);
    write(KEYS.incomeRecords, incomes.filter((r) => r.accountId !== id));
    reconcileAllCardBalances();
  }

  return existed;
}

/**
 * Reorder an account within its type group.
 * @param {string} id - Account ID
 * @param {number} direction - -1 for up, 1 for down
 * @param {string} type - The account type (e.g., 'gpt')
 * @returns {boolean} true if successful
 */
export function reorderAccount(id, direction, type) {
  const accounts = read(KEYS.accounts, []);
  
  const filtered = accounts.filter(a => a.type === type);
  const idx = filtered.findIndex(a => a.id === id);
  
  if (idx < 0) return false;
  if (direction === -1 && idx === 0) return false;
  if (direction === 1 && idx === filtered.length - 1) return false;

  const targetIdx = idx + direction;
  const temp = filtered[idx];
  filtered[idx] = filtered[targetIdx];
  filtered[targetIdx] = temp;

  const originalIndices = accounts
    .map((a, i) => a.type === type ? i : -1)
    .filter(i => i !== -1);
    
  for (let i = 0; i < originalIndices.length; i++) {
    accounts[originalIndices[i]] = filtered[i];
  }

  write(KEYS.accounts, accounts);
  return true;
}

// ---------------------------------------------------------------------------
// Team members
// ---------------------------------------------------------------------------

/**
 * Internal helper to migrate a member's legacy paidUpToPeriod to paymentRecords
 * and ensure willRenew has a default value.
 */
function migrateMemberData(m) {
  if (!m) return m;
  if (m.willRenew === undefined) {
    m.willRenew = true;
  }
  const normalizePaidRecord = (record) => {
    if (record === true) {
      return {
        paid: true,
        paidDate: '',
        amountCny: Number(m.chargeAmountCny) || 0,
      };
    }
    if (record && typeof record === 'object') {
      const normalizedRecord = {
        paid: record.paid !== false,
        paidDate: record.paidDate || '',
        amountCny: Number(record.amountCny ?? m.chargeAmountCny) || 0,
      };
      if (record.notes) normalizedRecord.notes = record.notes;
      if (record.createdAt) normalizedRecord.createdAt = record.createdAt;
      if (record.updatedAt) normalizedRecord.updatedAt = record.updatedAt;
      return normalizedRecord;
    }
    return null;
  };

  if (!m.paymentRecords && m.paidUpToPeriod) {
    m.paymentRecords = {};
    for (let i = 1; i <= m.paidUpToPeriod; i++) {
      m.paymentRecords[i] = normalizePaidRecord(true);
    }
  } else if (!m.paymentRecords) {
    m.paymentRecords = {};
  } else {
    const normalized = {};
    Object.entries(m.paymentRecords).forEach(([period, record]) => {
      const paidRecord = normalizePaidRecord(record);
      if (paidRecord) normalized[period] = paidRecord;
    });
    m.paymentRecords = normalized;
  }
  return m;
}

/**
 * Get team members for a specific account.
 * @param {string} accountId
 * @returns {Array<Object>}
 */
export function getTeamMembers(accountId) {
  const members = read(KEYS.teamMembers, []);
  return members.filter((m) => m.accountId === accountId).map(migrateMemberData);
}

/**
 * Get a single team member by id.
 * @param {string} id
 * @returns {Object|null}
 */
export function getTeamMemberById(id) {
  const members = read(KEYS.teamMembers, []);
  return migrateMemberData(members.find((m) => m.id === id)) || null;
}

/**
 * Get every team member across all accounts.
 * @returns {Array<Object>}
 */
export function getAllTeamMembers() {
  const members = read(KEYS.teamMembers, []);
  return members.map(migrateMemberData);
}

/**
 * Save (create or update) a team member.
 *
 * @param {Object} member - Must include `accountId`.
 * @returns {Object} The saved member
 */
export function saveTeamMember(member) {
  if (!member?.accountId || !getAccountById(member.accountId)) {
    throw new Error('成员必须关联一个有效账号。');
  }
  const members = read(KEYS.teamMembers, []);
  const now = new Date().toISOString();
  const normalizedMember = migrateMemberData({ ...member });
  normalizedMember.chargeAmountCny = normalizeMoney(normalizedMember.chargeAmountCny);

  if (!normalizedMember.id) {
    normalizedMember.id = generateId();
    normalizedMember.createdAt = now;
  }
  normalizedMember.updatedAt = now;

  const idx = members.findIndex((m) => m.id === normalizedMember.id);
  if (idx >= 0) {
    members[idx] = { ...members[idx], ...normalizedMember };
  } else {
    members.push(normalizedMember);
  }

  write(KEYS.teamMembers, members);
  return normalizedMember;
}

/**
 * Delete a team member.
 * @param {string} id
 * @returns {boolean} `true` if the member existed
 */
export function deleteTeamMember(id) {
  const members = read(KEYS.teamMembers, []);
  const filtered = members.filter((m) => m.id !== id);
  const existed = filtered.length < members.length;

  if (existed) {
    write(KEYS.teamMembers, filtered);
  }

  return existed;
}

// ---------------------------------------------------------------------------
// Cards (Payment Cards / 卡包)
// ---------------------------------------------------------------------------

/**
 * Get all cards.
 * @returns {Array<Object>}
 */
export function getCards() {
  return reconcileAllCardBalances();
}

/**
 * Get a single card by id.
 * @param {string} id
 * @returns {Object|null}
 */
export function getCardById(id) {
  const cards = reconcileAllCardBalances();
  return cards.find((c) => c.id === id) || null;
}

/**
 * Save (create or update) a card.
 * @param {Object} card
 * @returns {Object}
 */
export function saveCard(card) {
  const cards = read(KEYS.cards, []);
  const now = new Date().toISOString();
  card.lastFour = String(card.lastFour || '').replace(/\D/g, '').slice(-4);
  card.remark = String(card.remark || '').trim();

  if (!card.id) {
    card.id = generateId();
    card.createdAt = now;
    card.openingBalance = Number(card.openingBalance ?? card.balance ?? 0) || 0;
    card.balance = card.openingBalance;
    card.balanceModelVersion = CARD_BALANCE_MODEL_VERSION;
  }
  card.updatedAt = now;

  const idx = cards.findIndex((c) => c.id === card.id);
  if (idx >= 0) {
    const existing = cards[idx];
    cards[idx] = {
      ...existing,
      ...card,
      openingBalance: Number(existing.openingBalance ?? 0) || 0,
      balanceModelVersion: existing.balanceModelVersion || CARD_BALANCE_MODEL_VERSION,
    };
  } else {
    cards.push(card);
  }

  write(KEYS.cards, cards);
  return reconcileAllCardBalances().find((c) => c.id === card.id) || card;
}

/**
 * Delete a card and its top-up records.
 * Also clears paymentCardId on accounts that reference this card.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteCard(id) {
  const cards = read(KEYS.cards, []);
  const filtered = cards.filter((c) => c.id !== id);
  const existed = filtered.length < cards.length;

  if (existed) {
    write(KEYS.cards, filtered);
    // Cascade-delete top-up records
    const records = read(KEYS.topUpRecords, []);
    write(KEYS.topUpRecords, records.filter((r) => r.cardId !== id));
    // Clear paymentCardId on accounts
    const accounts = read(KEYS.accounts, []);
    let changed = false;
    for (const a of accounts) {
      if (a.paymentCardId === id) {
        a.paymentCardId = '';
        changed = true;
      }
    }
    if (changed) write(KEYS.accounts, accounts);

    // Historical expenses remain, but no longer affect a deleted card balance.
    const bills = read(KEYS.billingRecords, []);
    const normalizedBills = bills.map((bill) => {
      if (bill.cardId !== id) return bill;
      return {
        ...bill,
        cardId: '',
        paymentSource: 'unknown',
        updatedAt: new Date().toISOString(),
      };
    });
    write(KEYS.billingRecords, normalizedBills);
    reconcileAllCardBalances();
  }

  return existed;
}

/**
 * Update a card's balance by a delta amount.
 * @param {string} cardId
 * @param {number} delta - Positive to add, negative to subtract
 * @returns {Object|null} Updated card or null
 */
export function updateCardBalance(cardId, delta) {
  const cards = read(KEYS.cards, []);
  const card = cards.find((c) => c.id === cardId);
  if (!card) return null;

  card.openingBalance = (Number(card.openingBalance ?? card.balance) || 0) + (Number(delta) || 0);
  card.updatedAt = new Date().toISOString();
  write(KEYS.cards, cards);
  return reconcileAllCardBalances().find((c) => c.id === cardId) || null;
}

function roundMoney(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function normalizeMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return roundMoney(amount);
}

function sumTopUpsForCard(topUps, cardId) {
  return topUps
    .filter((r) => r.cardId === cardId)
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

function sumBillingsForCard(billings, cardId) {
  return billings
    .filter((r) => r.status !== 'voided' && r.cardId === cardId && getBillingPaymentSource(r) === 'card')
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

function getBillingPaymentSource(record) {
  if (!record) return 'unknown';
  if (record.paymentSource) return record.paymentSource;
  return record.cardId ? 'card' : 'unknown';
}

function normalizeBillingRecord(record, activeCardIds = null) {
  const normalized = { ...record };
  const source = getBillingPaymentSource(normalized);
  const validSources = new Set(['card', 'gift_card', 'third_party', 'unknown']);
  normalized.paymentSource = validSources.has(source) ? source : 'unknown';

  if (normalized.paymentSource === 'card') {
    if (!normalized.cardId || normalized.cardId === 'unspecified' || normalized.cardId === 'undefined' || normalized.cardId === 'null') {
      normalized.cardId = '';
      normalized.paymentSource = 'unknown';
    } else if (activeCardIds && !activeCardIds.has(normalized.cardId)) {
      normalized.cardId = '';
      normalized.paymentSource = 'unknown';
    }
  } else {
    normalized.cardId = '';
  }

  return normalized;
}

function normalizeBillingRecords(records, activeCardIds = null) {
  return records.map((r) => normalizeBillingRecord(r, activeCardIds));
}

function getLegacyOpeningBalance(card, topUps, billings) {
  if (
    card.balanceModelVersion === CARD_BALANCE_MODEL_VERSION &&
    card.openingBalance !== undefined
  ) {
    return Number(card.openingBalance) || 0;
  }

  const hasRecords = topUps.some((r) => r.cardId === card.id) ||
    billings.some((r) => r.cardId === card.id);
  return hasRecords ? 0 : (Number(card.balance) || 0);
}

export function reconcileAllCardBalances() {
  const cards = read(KEYS.cards, []);
  const topUps = read(KEYS.topUpRecords, []);
  const activeCardIds = new Set(cards.map((c) => c.id));
  const billings = normalizeBillingRecords(read(KEYS.billingRecords, []), activeCardIds);
  let changed = false;

  const reconciled = cards.map((card) => {
    const openingBalance = getLegacyOpeningBalance(card, topUps, billings);
    const balance = roundMoney(
      openingBalance
        + sumTopUpsForCard(topUps, card.id)
        - sumBillingsForCard(billings, card.id)
    );

    if (
      card.openingBalance !== openingBalance ||
      card.balance !== balance ||
      card.balanceModelVersion !== CARD_BALANCE_MODEL_VERSION
    ) {
      changed = true;
      return {
        ...card,
        openingBalance,
        balance,
        balanceModelVersion: CARD_BALANCE_MODEL_VERSION,
        updatedAt: new Date().toISOString(),
      };
    }
    return card;
  });

  if (changed) {
    write(KEYS.cards, reconciled);
  }
  return reconciled;
}

// ---------------------------------------------------------------------------
// Top-Up Records (充值记录)
// ---------------------------------------------------------------------------

/**
 * Get top-up records for a specific card.
 * @param {string} cardId
 * @returns {Array<Object>}
 */
export function getTopUpRecords(cardId) {
  const records = read(KEYS.topUpRecords, []);
  return records.filter((r) => r.cardId === cardId);
}

/**
 * Get all top-up records.
 * @returns {Array<Object>}
 */
export function getAllTopUpRecords() {
  return read(KEYS.topUpRecords, []);
}

/**
 * Save a top-up record, then recompute card balances from records.
 * @param {Object} record - Must include cardId and amount
 * @returns {Object}
 */
export function saveTopUpRecord(record) {
  const amount = Number(record?.amount);
  if (!record?.cardId || !read(KEYS.cards, []).some((card) => card.id === record.cardId)) {
    throw new Error('充值记录必须关联一张有效卡片。');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('充值金额必须大于 0。');
  }
  const records = read(KEYS.topUpRecords, []);
  const now = new Date().toISOString();
  record.amount = roundMoney(amount);
  record.topUpDate = record.topUpDate || getLocalDateString();

  if (!record.id) {
    record.id = generateId();
    record.createdAt = now;
  }
  record.updatedAt = now;

  const idx = records.findIndex((r) => r.id === record.id);
  if (idx >= 0) {
    const oldRecord = records[idx];
    records[idx] = { ...oldRecord, ...record };
  } else {
    records.push(record);
  }

  write(KEYS.topUpRecords, records);
  reconcileAllCardBalances();
  return record;
}

/**
 * Delete a top-up record and recompute card balances.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteTopUpRecord(id) {
  const records = read(KEYS.topUpRecords, []);
  const filtered = records.filter((r) => r.id !== id);
  const existed = filtered.length < records.length;
  if (existed) {
    write(KEYS.topUpRecords, filtered);
    reconcileAllCardBalances();
  }
  return existed;
}

// ---------------------------------------------------------------------------
// Billing Records (账单记录)
// ---------------------------------------------------------------------------

/**
 * Get all billing records.
 * @returns {Array<Object>}
 */
export function getBillingRecords() {
  const cards = read(KEYS.cards, []);
  const activeCardIds = new Set(cards.map((c) => c.id));
  return normalizeBillingRecords(read(KEYS.billingRecords, []), activeCardIds)
    .filter((record) => record.status !== 'voided');
}

function getBillingRecordsByAccountIncludingVoided(accountId) {
  const cards = read(KEYS.cards, []);
  const activeCardIds = new Set(cards.map((c) => c.id));
  return normalizeBillingRecords(read(KEYS.billingRecords, []), activeCardIds)
    .filter((record) => record.accountId === accountId);
}

/**
 * Get billing records for a specific account.
 * @param {string} accountId
 * @returns {Array<Object>}
 */
export function getBillingRecordsByAccount(accountId) {
  const records = getBillingRecords();
  return records.filter((r) => r.accountId === accountId);
}

/**
 * Get billing records associated with a specific card.
 * @param {string} cardId
 * @returns {Array<Object>}
 */
export function getBillingRecordsByCard(cardId) {
  const records = getBillingRecords();
  return records.filter((r) => r.cardId === cardId && r.paymentSource === 'card');
}

/**
 * Get a single billing record by id.
 * @param {string} id
 * @returns {Object|null}
 */
export function getBillingRecordById(id) {
  const records = getBillingRecords();
  return records.find((r) => r.id === id) || null;
}

/**
 * Save a billing record, then recompute card balances from records.
 * @param {Object} record
 * @returns {Object}
 */
export function saveBillingRecord(record) {
  const amount = Number(record?.amount);
  const account = record?.accountId ? getAccountById(record.accountId) : null;
  if (!record?.accountId || !account) {
    throw new Error('账单必须关联一个有效账号。');
  }
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('账单金额不能小于 0。');
  }
  const records = read(KEYS.billingRecords, []);
  const now = new Date().toISOString();
  const activeCardIds = new Set(read(KEYS.cards, []).map((c) => c.id));

  if (!record.id) {
    record.id = generateId();
    record.createdAt = now;
  }
  record.updatedAt = now;
  record.amount = roundMoney(amount);
  record.billingDate = record.billingDate || getLocalDateString();
  const currentCycle = getCurrentSubscriptionCycle(account);
  if (!record.subscriptionCycleId && currentCycle) {
    record.subscriptionCycleId = currentCycle.id;
  }
  if (!record.planTypeSnapshot) {
    const cycle = getSubscriptionCycles(account)
      .find((item) => item.id === record.subscriptionCycleId);
    record.planTypeSnapshot = cycle?.planType || account.subscriptionType || '';
  }
  if (record.period !== undefined) {
    record.period = Math.max(1, Math.trunc(Number(record.period) || 1));
  }
  const normalizedRecord = normalizeBillingRecord(record, activeCardIds);

  const idx = records.findIndex((r) => r.id === normalizedRecord.id);
  if (idx >= 0) {
    records[idx] = { ...records[idx], ...normalizedRecord };
  } else {
    records.push(normalizedRecord);
  }

  write(KEYS.billingRecords, records);
  reconcileAllCardBalances();
  return normalizedRecord;
}

/**
 * Delete a billing record by ID.
 * @param {string} id
 * @returns {boolean} true if the record existed
 */
export function deleteBillingRecord(id) {
  const records = read(KEYS.billingRecords, []);
  const index = records.findIndex((record) => record.id === id);
  const existed = index >= 0;
  if (existed) {
    const record = records[index];
    if (record.isAutoGenerated && record.accountId && record.period) {
      records[index] = {
        ...record,
        status: 'voided',
        voidedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else {
      records.splice(index, 1);
    }
    write(KEYS.billingRecords, records);
    reconcileAllCardBalances();
  }
  return existed;
}

/**
 * Get all billing records that do not have a card assigned.
 * @returns {Array<Object>}
 */
export function getUnspecifiedBillingRecords() {
  const records = getBillingRecords();
  return records.filter((r) => r.paymentSource !== 'card' || !r.cardId);
}

/**
 * Edit a billing record, then recompute card balances from records.
 *
 * @param {string} recordId
 * @param {string} newCardId
 * @param {number} newAmount
 * @param {string} [paymentSource]
 * @param {string} [billingDate]
 * @returns {Object|null} Updated record or null
 */
export function editBillingRecord(recordId, newCardId, newAmount, paymentSource = 'card', billingDate = '') {
  const record = getBillingRecordById(recordId);
  if (!record) return null;

  record.paymentSource = paymentSource || (newCardId ? 'card' : 'unknown');
  record.cardId = record.paymentSource === 'card' ? newCardId : '';
  record.amount = newAmount;
  if (billingDate) record.billingDate = billingDate;
  record.isManualEdited = true;
  record.updatedAt = new Date().toISOString();
  saveBillingRecord(record);

  return record;
}

// ---------------------------------------------------------------------------
// Income Records (收入记录)
// ---------------------------------------------------------------------------

/**
 * Get all direct income records.
 * @returns {Array<Object>}
 */
export function getIncomeRecords() {
  return read(KEYS.incomeRecords, []);
}

/**
 * Get direct income records for a specific account.
 * @param {string} accountId
 * @returns {Array<Object>}
 */
export function getIncomeRecordsByAccount(accountId) {
  const records = read(KEYS.incomeRecords, []);
  return records.filter((r) => r.accountId === accountId);
}

/**
 * Get a single income record by id.
 * @param {string} id
 * @returns {Object|null}
 */
export function getIncomeRecordById(id) {
  const records = read(KEYS.incomeRecords, []);
  return records.find((r) => r.id === id) || null;
}

/**
 * Save a direct income record.
 * Plus sale income is recorded in CNY and does not affect card balances.
 *
 * @param {Object} record
 * @returns {Object}
 */
export function saveIncomeRecord(record) {
  const amount = Number(record?.amountCny);
  if (!record?.accountId || !getAccountById(record.accountId)) {
    throw new Error('收入记录必须关联一个有效账号。');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('收入金额必须大于 0。');
  }
  const records = read(KEYS.incomeRecords, []);
  const now = new Date().toISOString();

  if (!record.id) {
    record.id = generateId();
    record.createdAt = now;
  }
  record.updatedAt = now;

  const normalized = {
    ...record,
    source: record.source || 'plus_sale',
    amountCny: roundMoney(amount),
  };

  const idx = records.findIndex((r) => r.id === normalized.id);
  if (idx >= 0) {
    records[idx] = { ...records[idx], ...normalized };
  } else {
    records.push(normalized);
  }

  write(KEYS.incomeRecords, records);
  return normalized;
}

/**
 * Delete a direct income record by ID.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteIncomeRecord(id) {
  const records = read(KEYS.incomeRecords, []);
  const filtered = records.filter((r) => r.id !== id);
  const existed = filtered.length < records.length;
  if (existed) {
    write(KEYS.incomeRecords, filtered);
  }
  return existed;
}

/**
 * Auto-generate billing records for accounts whose billing date has passed.
 * For each missed billing cycle, creates a record and assigns it to the default card.
 * Accounts with a subscription start date use monthly period calculation.
 *
 * Should be called on page load (e.g., from dashboard or app init).
 *
 * @returns {number} Number of records generated
 */
export function autoGenerateBillingRecords(referenceDate = new Date()) {
  const accounts = read(KEYS.accounts, []);
  const rawBillingRecords = read(KEYS.billingRecords, []);
  const todayStr = getLocalDateString(referenceDate);
  const now = new Date().toISOString();
  let generated = 0;
  let accountsChanged = false;
  let billsChanged = false;

  // One-time migration: legacy flat subscription fields become the first
  // independent cycle and legacy bills are attached to that cycle.
  for (const account of accounts) {
    const before = JSON.stringify({
      subscriptionType: account.subscriptionType,
      subscriptionStatus: account.subscriptionStatus,
      currentSubscriptionCycleId: account.currentSubscriptionCycleId,
      subscriptionCycles: account.subscriptionCycles,
    });
    account.subscriptionCycles = copySubscriptionCycles(account);
    let current = findMutableCurrentCycle(account);

    if (!current && !account.subscriptionCycles.length && isPaidSubscriptionValue(account.subscriptionType)) {
      const cycle = buildSubscriptionCycle(account, account.createdAt || now);
      if (account.status === 'banned') {
        cycle.status = SUBSCRIPTION_STATUS.ENDED;
        cycle.endDate = account.banDate || getLocalDateString(account.updatedAt || referenceDate);
        cycle.endedReason = 'banned';
        account.subscriptionCycles.push(cycle);
        clearCurrentPaidSubscription(account);
      } else {
        cycle.status = account.subscriptionStatus || SUBSCRIPTION_STATUS.ACTIVE;
        cycle.endDate = account.subscriptionEndDate || '';
        cycle.cancellationRequestedAt = account.cancellationRequestedAt || '';
        account.subscriptionCycles.push(cycle);
        account.currentSubscriptionCycleId = cycle.id;
        account.subscriptionStatus = cycle.status;
        current = cycle;
      }
    } else if (current) {
      account.currentSubscriptionCycleId = current.id;
      account.subscriptionStatus = current.status;
    }

    const cycles = account.subscriptionCycles;
    const accountBills = rawBillingRecords.filter((record) => record.accountId === account.id);
    for (const record of accountBills) {
      if (!record.subscriptionCycleId && cycles.length) {
        const matchingCycle = cycles.find((cycle) => (
          (!cycle.startDate || !record.billingDate || record.billingDate >= cycle.startDate)
          && (!cycle.endDate || !record.billingDate || record.billingDate <= cycle.endDate)
        )) || cycles[0];
        record.subscriptionCycleId = matchingCycle.id;
        record.planTypeSnapshot = record.planTypeSnapshot || matchingCycle.planType;
        billsChanged = true;
      }
    }

    if (current?.status === SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END
      && current.endDate
      && compareDateOnly(todayStr, current.endDate) > 0) {
      finishCurrentCycle(account, current.endDate, 'canceled', now);
      account.systemUpdatedAt = now;
      current = null;
    }

    const after = JSON.stringify({
      subscriptionType: account.subscriptionType,
      subscriptionStatus: account.subscriptionStatus,
      currentSubscriptionCycleId: account.currentSubscriptionCycleId,
      subscriptionCycles: account.subscriptionCycles,
    });
    if (before !== after) accountsChanged = true;
  }

  if (accountsChanged) write(KEYS.accounts, accounts);
  if (billsChanged) write(KEYS.billingRecords, rawBillingRecords);

  for (const account of accounts) {
    if (account.status === 'banned') continue;
    const cycle = findMutableCurrentCycle(account);
    if (!cycle || !cycle.startDate || !cycle.costUsd) continue;

    const existingRecords = getBillingRecordsByAccountIncludingVoided(account.id)
      .filter((record) => record.subscriptionCycleId === cycle.id);
    let period = 1;
    let targetDate = getMonthlyBillingDate(cycle.billingAnchorDate || cycle.startDate, period);
    const shouldGenerateDate = (date) => {
      if (!date || date > todayStr) return false;
      if (cycle.status === SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END) {
        return Boolean(cycle.endDate) && date < cycle.endDate;
      }
      return cycle.status === SUBSCRIPTION_STATUS.ACTIVE;
    };

    while (shouldGenerateDate(targetDate)) {
      const existing = existingRecords.find((record) => Number(record.period) === period);
      if (!existing) {
        const newRecord = {
          id: generateId(),
          accountId: account.id,
          subscriptionCycleId: cycle.id,
          planTypeSnapshot: cycle.planType,
          billingDate: targetDate,
          amount: cycle.costUsd,
          cardId: cycle.paymentCardId || '',
          paymentSource: cycle.paymentCardId ? 'card' : 'unknown',
          period,
          isAutoGenerated: true,
          createdAt: now,
          updatedAt: now,
        };
        saveBillingRecord(newRecord);
        existingRecords.push(newRecord);
        generated++;
      }
      period += 1;
      targetDate = getMonthlyBillingDate(cycle.billingAnchorDate || cycle.startDate, period);
    }

    const nextDate = cycle.status === SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END
      ? cycle.endDate
      : targetDate;
    if (account.renewalDate !== nextDate || account.billingDate !== nextDate) {
      account.renewalDate = nextDate || '';
      account.billingDate = nextDate || '';
      account.systemUpdatedAt = now;
      persistAccount(account);
    }
  }

  return generated;
}

function isPaidSubscriptionValue(subscriptionType) {
  return !!subscriptionType && subscriptionType !== 'free';
}


function persistAccount(account) {
  const allAccounts = read(KEYS.accounts, []);
  const idx = allAccounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) {
    allAccounts[idx] = { ...allAccounts[idx], ...account };
    write(KEYS.accounts, allAccounts);
  }
}

/**
 * Batch extract legacy encrypted payment methods and convert them to cards.
 */
export async function batchExtractLegacyPayments(decryptFn, masterPwd) {
  const accounts = read(KEYS.accounts, []);
  let extractedCount = 0;
  
  for (const account of accounts) {
    if (account.encryptedPaymentMethod && !account.paymentCardId) {
      try {
        const val = await decryptFn(account.encryptedPaymentMethod, masterPwd);
        if (!val) continue;
        
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
        if (!lastFour) continue;
        
        const cards = getCards();
        let existingCard = cards.find(c => c.brand === brand && c.lastFour === lastFour);
        
        if (!existingCard) {
          existingCard = {
            id: generateId(),
            brand,
            lastFour,
            remark: val,
            balance: 0
          };
          saveCard(existingCard);
        }
        
        account.paymentCardId = existingCard.id;
        // Optionally clear legacy method: account.encryptedPaymentMethod = '';
        account.updatedAt = new Date().toISOString();
        saveAccount(account);
        extractedCount++;
      } catch (e) {
        // Skip on error
      }
    }
  }
  return extractedCount;
}

/**
 * Re-encrypt all stored account secrets when the master password changes.
 * Nothing is written until every existing secret has decrypted successfully.
 */
export async function rotateAccountSecrets(decryptFn, encryptFn, oldPassword, newPassword) {
  const accounts = read(KEYS.accounts, []);
  const secretFields = ['encryptedPassword', 'encryptedPaymentMethod'];

  const rotatedAccounts = await Promise.all(accounts.map(async (account) => {
    const rotated = { ...account };
    for (const field of secretFields) {
      if (!account[field]) continue;
      const plaintext = await decryptFn(account[field], oldPassword);
      rotated[field] = await encryptFn(plaintext, newPassword);
    }
    rotated.updatedAt = new Date().toISOString();
    return rotated;
  }));

  write(KEYS.accounts, rotatedAccounts);
  return rotatedAccounts.length;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** @type {Object} Default settings shape */
const DEFAULT_SETTINGS = {
  exchangeRate: 7.25,
  useAutoExchangeRate: false,
  exchangeRateUpdatedAt: '',
  masterKeyHash: '',
  masterKeyVerifier: null,
  theme: 'auto', // 'light' | 'dark' | 'auto'
  reminderDays: 7, // 提前提醒天数
  autoLockMinutes: 30,
};

/**
 * Get the current settings, merged with defaults.
 * @returns {Object}
 */
export function getSettings() {
  const stored = read(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

/**
 * Save settings (merges with existing).
 * @param {Object} settings
 * @returns {Object} The full saved settings
 */
export function saveSettings(settings) {
  const current = getSettings();
  const merged = { ...current, ...settings };
  write(KEYS.settings, merged);
  return merged;
}

// ---------------------------------------------------------------------------
// Data consistency checks
// ---------------------------------------------------------------------------

export function runDataConsistencyCheck({ repair = false } = {}) {
  const issues = [];
  const fixed = [];
  const accounts = read(KEYS.accounts, []);
  const members = read(KEYS.teamMembers, []);
  const cards = read(KEYS.cards, []);
  const topUps = read(KEYS.topUpRecords, []);
  const billingRecords = read(KEYS.billingRecords, []);
  const incomeRecords = read(KEYS.incomeRecords, []);

  const accountIds = new Set(accounts.map((a) => a.id));
  const cardIds = new Set(cards.map((c) => c.id));

  const accountsWithInvalidCards = accounts.filter((a) => a.paymentCardId && !cardIds.has(a.paymentCardId));
  if (accountsWithInvalidCards.length > 0) {
    issues.push(`发现 ${accountsWithInvalidCards.length} 个账号绑定了不存在的默认卡片。`);
    if (repair) {
      write(KEYS.accounts, accounts.map((a) => {
        if (!a.paymentCardId || cardIds.has(a.paymentCardId)) return a;
        return {
          ...a,
          paymentCardId: '',
          updatedAt: new Date().toISOString(),
        };
      }));
      fixed.push(`已清理 ${accountsWithInvalidCards.length} 个无效默认卡片引用。`);
    }
  }

  const normalizedMembers = members.map((m) => migrateMemberData({ ...m }));
  if (JSON.stringify(normalizedMembers) !== JSON.stringify(members)) {
    issues.push('发现旧版成员缴费记录，需迁移为包含收款日期和金额的新格式。');
    if (repair) {
      write(KEYS.teamMembers, normalizedMembers);
      fixed.push('已迁移成员缴费记录格式。');
    }
  }

  const orphanMembers = normalizedMembers.filter((member) => !accountIds.has(member.accountId));
  if (orphanMembers.length > 0) {
    issues.push(`发现 ${orphanMembers.length} 个未关联账号的成员。`);
    if (repair) {
      write(KEYS.teamMembers, normalizedMembers.filter((member) => accountIds.has(member.accountId)));
      fixed.push(`已删除 ${orphanMembers.length} 个孤立成员。`);
    }
  }

  const normalizedBills = billingRecords.map((b) => normalizeBillingRecord(b, cardIds));
  if (JSON.stringify(normalizedBills) !== JSON.stringify(billingRecords)) {
    issues.push('发现账单支付来源缺失或卡片引用无效。');
    if (repair) {
      write(KEYS.billingRecords, normalizedBills);
      fixed.push('已修复账单支付来源和无效卡片引用。');
    }
  }

  const orphanBills = normalizedBills.filter((b) => !accountIds.has(b.accountId));
  if (orphanBills.length > 0) {
    issues.push(`发现 ${orphanBills.length} 笔孤立账单记录。`);
    if (repair) {
      write(KEYS.billingRecords, normalizedBills.filter((b) => accountIds.has(b.accountId)));
      fixed.push(`已删除 ${orphanBills.length} 笔孤立账单记录。`);
    }
  }

  const orphanIncomes = incomeRecords.filter((r) => !accountIds.has(r.accountId));
  if (orphanIncomes.length > 0) {
    issues.push(`发现 ${orphanIncomes.length} 笔孤立收入记录。`);
    if (repair) {
      write(KEYS.incomeRecords, incomeRecords.filter((r) => accountIds.has(r.accountId)));
      fixed.push(`已删除 ${orphanIncomes.length} 笔孤立收入记录。`);
    }
  }

  const orphanTopUps = topUps.filter((r) => !cardIds.has(r.cardId));
  if (orphanTopUps.length > 0) {
    issues.push(`发现 ${orphanTopUps.length} 笔孤立充值记录。`);
    if (repair) {
      write(KEYS.topUpRecords, topUps.filter((r) => cardIds.has(r.cardId)));
      fixed.push(`已删除 ${orphanTopUps.length} 笔孤立充值记录。`);
    }
  }

  const periodKeys = new Map();
  normalizedBills.forEach((b, index) => {
    if (!b.accountId || !b.period || b.status === 'voided') return;
    const key = `${b.accountId}::${b.subscriptionCycleId || 'legacy'}::${b.period}`;
    if (!periodKeys.has(key)) periodKeys.set(key, []);
    periodKeys.get(key).push(index);
  });
  const duplicateGroups = [...periodKeys.values()].filter((indices) => indices.length > 1);
  const duplicateCount = duplicateGroups.length;
  if (duplicateCount > 0) {
    issues.push(`发现 ${duplicateCount} 组重复账单期数。`);
    if (repair) {
      const dedupedBills = normalizedBills.map((bill) => ({ ...bill }));
      duplicateGroups.forEach((indices) => {
        const sorted = [...indices].sort((left, right) => {
          const manualDiff = Number(!!dedupedBills[right].isManualEdited) - Number(!!dedupedBills[left].isManualEdited);
          if (manualDiff !== 0) return manualDiff;
          return String(dedupedBills[right].updatedAt || '').localeCompare(String(dedupedBills[left].updatedAt || ''));
        });
        sorted.slice(1).forEach((index) => {
          dedupedBills[index].status = 'voided';
          dedupedBills[index].voidedAt = new Date().toISOString();
          dedupedBills[index].updatedAt = new Date().toISOString();
        });
      });
      write(KEYS.billingRecords, dedupedBills.filter((bill) => accountIds.has(bill.accountId)));
      fixed.push(`已保留每期一笔有效账单，其余 ${duplicateGroups.reduce((sum, indices) => sum + indices.length - 1, 0)} 笔标记为作废。`);
    }
  }

  const hasBalanceMismatch = cards.some((card) => {
    const openingBalance = getLegacyOpeningBalance(card, topUps, normalizedBills);
    const expectedBalance = roundMoney(
      openingBalance
        + sumTopUpsForCard(topUps, card.id)
        - sumBillingsForCard(normalizedBills, card.id)
    );
    return card.openingBalance !== openingBalance ||
      card.balance !== expectedBalance ||
      card.balanceModelVersion !== CARD_BALANCE_MODEL_VERSION;
  });
  if (hasBalanceMismatch) {
    issues.push('发现卡片余额与交易记录不一致。');
    if (repair) {
      reconcileAllCardBalances();
      fixed.push('已按初始余额 + 充值 - 卡片账单重算卡片余额。');
    }
  }

  if (repair) {
    // Re-read the repaired records so orphan/duplicate cleanup is reflected in balances.
    reconcileAllCardBalances();
  }

  return {
    ok: issues.length === 0,
    issues,
    fixed,
    repaired: repair,
  };
}

// ---------------------------------------------------------------------------
// Data export / import / clear
// ---------------------------------------------------------------------------

/**
 * Export all app data.
 * @returns {Object}
 */
export function exportAllData() {
  return {
    schemaVersion: 2,
    accounts:       read(KEYS.accounts, []),
    teamMembers:    read(KEYS.teamMembers, []),
    cards:          read(KEYS.cards, []),
    topUpRecords:   read(KEYS.topUpRecords, []),
    billingRecords: read(KEYS.billingRecords, []),
    incomeRecords:  read(KEYS.incomeRecords, []),
    settings:       getSettings(),
    exportedAt:     new Date().toISOString(),
  };
}

/**
 * Import data from a JSON string, replacing **all** existing data.
 *
 * @param {string} jsonString
 * @returns {boolean} `true` on success, `false` on parse/validation failure
 */
export function importAllData(jsonString, options = {}) {
  try {
    const data = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;

    if (!data || typeof data !== 'object') return false;

    // Validate expected arrays/objects
    if (data.accounts && !Array.isArray(data.accounts)) return false;
    if (data.teamMembers && !Array.isArray(data.teamMembers)) return false;
    if (data.cards && !Array.isArray(data.cards)) return false;
    if (data.topUpRecords && !Array.isArray(data.topUpRecords)) return false;
    if (data.billingRecords && !Array.isArray(data.billingRecords)) return false;
    if (data.incomeRecords && !Array.isArray(data.incomeRecords)) return false;

    withoutDataNotifications(() => {
      write(KEYS.accounts, data.accounts || []);
      write(KEYS.teamMembers, data.teamMembers || []);
      write(KEYS.cards, data.cards || []);
      write(KEYS.topUpRecords, data.topUpRecords || []);
      write(KEYS.billingRecords, data.billingRecords || []);
      write(KEYS.incomeRecords, data.incomeRecords || []);
      if (data.settings && typeof data.settings === 'object') {
        write(KEYS.settings, data.settings);
      }

      runDataConsistencyCheck({ repair: true });
    });
    if (options.notify !== false) notifyDataChanged('import');
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove all app data from localStorage (keys matching the prefix).
 */
export function clearAllData(options = {}) {
  Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
  if (options.notify !== false) notifyDataChanged('clear');
}
