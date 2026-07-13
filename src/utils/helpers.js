/**
 * helpers.js — Pure utility functions (dates, currency, masking, UI helpers)
 */

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

/**
 * Format a date value as 'YYYY-MM-DD'.
 * Returns '--' for null / undefined / empty / invalid input.
 *
 * @param {string|Date|number|null} dateString
 * @returns {string}
 */
export function formatDate(dateString) {
  if (!dateString) return '--';
  const d = parseDateOnly(dateString);
  return d ? formatDateOnly(d) : '--';
}

/**
 * Format a date value as 'YYYY-MM-DD HH:mm'.
 *
 * @param {string|Date|number|null} dateString
 * @returns {string}
 */
export function formatDateTime(dateString) {
  if (!dateString) return '--';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '--';
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  const hh   = String(d.getHours()).padStart(2, '0');
  const min  = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Calculate the number of full days from today until the given date.
 *
 * - Positive → date is in the future
 * - Negative → date is in the past
 * - 0        → today
 *
 * @param {string} dateString - A date parseable by `new Date()`
 * @returns {number} Integer days (NaN if input is invalid)
 */
export function daysUntil(dateString) {
  const other = parseDateOnly(dateString);
  const today = parseDateOnly(new Date());
  if (!other || !today) return NaN;

  const diffMs = other - today;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Return a human-readable Chinese label describing how far away a date is.
 *
 * Examples: '还剩3天', '今天到期', '已过期2天'
 *
 * @param {string} dateString
 * @returns {string}
 */
export function getRelativeDateLabel(dateString) {
  const days = daysUntil(dateString);
  if (isNaN(days)) return '--';
  if (days > 0) return `还剩${days}天`;
  if (days === 0) return '今天到期';
  return `已过期${Math.abs(days)}天`;
}

/**
 * Get the current month as 'YYYY-MM'.
 * @returns {string}
 */
export function getCurrentMonth() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * Check whether a date falls within the current calendar month.
 *
 * @param {string} dateString
 * @returns {boolean}
 */
export function isInCurrentMonth(dateString) {
  const d = parseDateOnly(dateString);
  if (!d) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/**
 * Return a local calendar date without converting through UTC.
 * This avoids an off-by-one day near midnight in positive UTC time zones.
 *
 * @param {Date|string|number} [value=new Date()]
 * @returns {string}
 */
export function getLocalDateString(value = new Date()) {
  return formatDateOnly(parseDateOnly(value));
}

// ---------------------------------------------------------------------------
// Currency helpers
// ---------------------------------------------------------------------------

/**
 * Format a numeric amount as a currency string.
 *
 * @param {number} amount
 * @param {'CNY'|'USD'} [currency='CNY']
 * @returns {string} e.g. '¥1,234.00' or '$20.00'
 */
export function formatCurrency(amount, currency = 'CNY') {
  const num = Number(amount);
  if (isNaN(num)) return '--';

  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatted;
}

/**
 * Convert a USD amount to CNY.
 *
 * @param {number} usdAmount
 * @param {number} rate - Exchange rate (CNY per 1 USD)
 * @returns {number}
 */
export function convertUsdToCny(usdAmount, rate) {
  return Number((usdAmount * rate).toFixed(2));
}

// ---------------------------------------------------------------------------
// Member billing cycle helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the current billing period number for a member based on invite date.
 * Period 1 starts on the invite date itself.
 *
 * Example: inviteDate = 2025-05-13, today = 2025-07-03
 *   → Period 1: May 13, Period 2: Jun 13, Period 3: Jul 13
 *   → Current period = 3 (the next upcoming or current cycle)
 *
 * @param {string} inviteDate - The member's invite date (YYYY-MM-DD)
 * @returns {number} The current period number (1-based), or 0 if invalid
 */
export function getCurrentPeriod(inviteDate, referenceDate = new Date()) {
  const inviteDay = parseDateOnly(inviteDate);
  const today = parseDateOnly(referenceDate);
  if (!inviteDay || !today) return 0;

  if (today < inviteDay) return 1; // Haven't even reached invite date yet

  const months = (today.getFullYear() - inviteDay.getFullYear()) * 12
    + (today.getMonth() - inviteDay.getMonth());
  let period = Math.max(1, months + 1);

  // Compare against the actual clamped due date (e.g. Jan 31 -> Feb 28).
  while (period > 1 && addMonthsClamped(inviteDay, period - 1) > today) {
    period -= 1;
  }
  while (addMonthsClamped(inviteDay, period) <= today) {
    period += 1;
  }

  return period;
}

/**
 * Calculate the next charge date for a member based on invite date.
 * Returns the next future date that falls on the same day-of-month as the invite date.
 *
 * @param {string} inviteDate - The member's invite date (YYYY-MM-DD)
 * @returns {string} Next charge date as 'YYYY-MM-DD', or '' if invalid
 */
export function getNextChargeDate(inviteDate, referenceDate = new Date()) {
  const invite = parseDateOnly(inviteDate);
  const today = parseDateOnly(referenceDate);
  if (!invite || !today) return '';

  let period = getCurrentPeriod(inviteDate, referenceDate);
  let dueDate = addMonthsClamped(invite, Math.max(0, period - 1));
  if (dueDate <= today) {
    period += 1;
    dueDate = addMonthsClamped(invite, period - 1);
  }
  return formatDateOnly(dueDate);
}

/**
 * Get the exact due date for a specific billing period of a member.
 *
 * @param {string} inviteDate 
 * @param {number} period 
 * @returns {string} 'YYYY-MM-DD'
 */
export function getDueDateForPeriod(inviteDate, period) {
  const n = Number(period);
  if (!inviteDate || !Number.isInteger(n) || n < 1) return '';
  return formatDateOnly(addMonthsClamped(inviteDate, n - 1));
}

function parseDateOnly(dateString) {
  if (!dateString) return null;
  if (dateString instanceof Date) {
    if (isNaN(dateString.getTime())) return null;
    return new Date(dateString.getFullYear(), dateString.getMonth(), dateString.getDate());
  }

  const match = String(dateString).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  const parsed = new Date(dateString);
  if (isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatDateOnly(date) {
  if (!date || isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addMonthsClamped(startDate, monthsToAdd) {
  const start = parseDateOnly(startDate);
  if (!start) return null;

  const targetYear = start.getFullYear();
  const targetMonth = start.getMonth() + monthsToAdd;
  const day = start.getDate();
  const firstOfTargetMonth = new Date(targetYear, targetMonth, 1);
  const lastDay = new Date(
    firstOfTargetMonth.getFullYear(),
    firstOfTargetMonth.getMonth() + 1,
    0
  ).getDate();

  return new Date(
    firstOfTargetMonth.getFullYear(),
    firstOfTargetMonth.getMonth(),
    Math.min(day, lastDay)
  );
}

/**
 * Get the due date for a monthly subscription billing period.
 * Period 1 is the original subscription start date.
 *
 * @param {string} startDate
 * @param {number} period
 * @returns {string}
 */
export function getMonthlyBillingDate(startDate, period) {
  const n = Number(period);
  if (!startDate || !Number.isFinite(n) || n < 1) return '';
  return formatDateOnly(addMonthsClamped(startDate, n - 1));
}

/**
 * Calculate the next due monthly billing date and its period number.
 *
 * @param {string} startDate
 * @param {Date|string} [referenceDate=new Date()]
 * @returns {{renewalDate: string, period: number}}
 */
export function getNextMonthlyBillingInfo(startDate, referenceDate = new Date()) {
  const start = parseDateOnly(startDate);
  const reference = parseDateOnly(referenceDate);
  if (!start || !reference) return { renewalDate: '', period: 0 };

  if (reference <= start) {
    return { renewalDate: formatDateOnly(start), period: 1 };
  }

  const roughMonths = (reference.getFullYear() - start.getFullYear()) * 12
    + (reference.getMonth() - start.getMonth());
  let period = Math.max(1, roughMonths + 1);
  let dueDate = addMonthsClamped(start, period - 1);

  if (dueDate < reference) {
    period += 1;
    dueDate = addMonthsClamped(start, period - 1);
  }

  return {
    renewalDate: formatDateOnly(dueDate),
    period,
  };
}

/**
 * Calculate the target payment period.
 * If the next charge date is within `reminderDays` from today, 
 * the target period is the upcoming period (current + 1).
 * Otherwise, the target period is the current period.
 */
export function getTargetPaymentPeriod(inviteDate, reminderDays = 7, referenceDate = new Date()) {
  const current = getCurrentPeriod(inviteDate, referenceDate);
  const nextDueDate = getDueDateForPeriod(inviteDate, current + 1);
  const reference = parseDateOnly(referenceDate);
  const nextDue = parseDateOnly(nextDueDate);
  const days = reference && nextDue
    ? Math.round((nextDue - reference) / (1000 * 60 * 60 * 24))
    : NaN;
  
  if (days >= 0 && days <= reminderDays) {
    return current + 1;
  }
  return current;
}

export function isPaymentRecordPaid(record) {
  if (record === true) return true;
  if (!record || typeof record !== 'object') return false;
  return record.paid !== false;
}

export function getPaymentRecordAmount(record, fallbackAmount = 0) {
  if (!record || record === true || typeof record !== 'object') {
    return Number(fallbackAmount) || 0;
  }
  const amount = Number(record.amountCny);
  return Number.isFinite(amount) ? amount : (Number(fallbackAmount) || 0);
}

export function getPaymentRecordDate(record, fallbackDate = '') {
  if (!record || record === true || typeof record !== 'object') {
    return fallbackDate || '';
  }
  return record.paidDate || fallbackDate || '';
}

/**
 * Returns a comprehensive payment status for a member.
 * Strictly relies on paymentRecords for the target period.
 * 
 * @returns {Object} { isPaid, targetPeriod, dueDate, daysUntilNext, urgency, paymentRecord }
 */
export function getMemberPaymentStatus(inviteDate, paymentRecords = {}, reminderDays = 7, referenceDate = new Date()) {
  const latestTargetPeriod = getTargetPaymentPeriod(inviteDate, reminderDays, referenceDate);
  let targetPeriod = latestTargetPeriod;

  // Never hide an older unpaid period behind a newer cycle.
  for (let period = 1; period <= latestTargetPeriod; period++) {
    if (!isPaymentRecordPaid(paymentRecords[period])) {
      targetPeriod = period;
      break;
    }
  }
  const paymentRecord = paymentRecords[targetPeriod];
  const isPaid = isPaymentRecordPaid(paymentRecord);
  
  const dueDate = getDueDateForPeriod(inviteDate, targetPeriod);
  const due = parseDateOnly(dueDate);
  const reference = parseDateOnly(referenceDate);
  const days = due && reference
    ? Math.round((due - reference) / (1000 * 60 * 60 * 24))
    : NaN;
  
  let urgency = 'normal';
  if (!isPaid) {
    if (days <= 2) {
      urgency = 'danger';
    } else if (days <= reminderDays) {
      urgency = 'warning';
    }
  }
  
  return { isPaid, targetPeriod, dueDate, daysUntilNext: days, urgency, paymentRecord };
}

// ---------------------------------------------------------------------------
// Text masking
// ---------------------------------------------------------------------------

/**
 * Mask an email address for display.
 *
 * 'testuser@gmail.com' → 'te***@gmail.com'
 *
 * @param {string} email
 * @returns {string}
 */
export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '--';
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return email; // not a real email

  const local  = email.slice(0, atIndex);
  const domain = email.slice(atIndex);

  if (local.length <= 2) {
    return `${local[0]}***${domain}`;
  }
  return `${local.slice(0, 2)}***${domain}`;
}

/**
 * Mask a text string, revealing only the last N characters.
 *
 * 'abcd1234' with visibleChars=4 → '****1234'
 *
 * @param {string} text
 * @param {number} [visibleChars=4]
 * @returns {string}
 */
export function maskText(text, visibleChars = 4) {
  if (!text || typeof text !== 'string') return '--';
  if (text.length <= visibleChars) return text;
  const masked = '*'.repeat(text.length - visibleChars);
  return masked + text.slice(-visibleChars);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Map an account type to a CSS custom-property name for its colour.
 *
 * @param {string} type - 'gpt' | 'claude' | 'gemini'
 * @returns {string} CSS variable name, e.g. '--color-gpt'
 */
export function getAccountTypeColor(type) {
  const map = {
    gpt:    '--color-gpt',
    claude: '--color-claude',
    gemini: '--color-gemini',
  };
  return map[type] || '--color-default';
}

/**
 * Map a status string to a CSS badge class name.
 *
 * @param {string} status - 'active' | 'expiring' | 'expired' | 'cancelled'
 * @returns {string} Class name, e.g. 'badge-active'
 */
export function getStatusColor(status) {
  const map = {
    active:    'badge-active',
    expiring:  'badge-expiring',
    expired:   'badge-expired',
    cancelled: 'badge-cancelled',
  };
  return map[status] || 'badge-default';
}

// ---------------------------------------------------------------------------
// General utilities
// ---------------------------------------------------------------------------

/**
 * Debounce a function: delays invocation until `delay` ms have elapsed since
 * the last call.
 *
 * @param {Function} fn
 * @param {number} delay - Milliseconds
 * @returns {Function} Debounced wrapper (has a `.cancel()` method)
 */
export function debounce(fn, delay) {
  let timer = null;

  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  return debounced;
}
