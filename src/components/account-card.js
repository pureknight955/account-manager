/**
 * account-card.js - Account list card component
 *
 * Displays account summary: nickname, masked email, subscription type,
 * status badge, and conditional info (team members / refund status).
 * Left border color indicates account type.
 */

import { getSubscriptionLifecycleStatus, getTeamMembers } from '../utils/storage.js';
import { formatCurrency, formatDate, maskEmail } from '../utils/helpers.js';
import {
  SUBSCRIPTION_TYPES,
  REFUND_STATUS_OPTIONS,
  ACCOUNT_TYPES,
  SUBSCRIPTION_STATUS,
  hasTeamManagement,
  hasRefundFields,
} from '../config.js';

/** Border colors per account type */
const TYPE_COLORS = {
  gpt:    '#4f46e5',
  claude: '#f97316',
  gemini: '#8b5cf6',
};

/**
 * Create an account card DOM element.
 * @param {Object} account - Account data object.
 * @param {(account: Object) => void} onClick - Called when user clicks the card.
 * @returns {HTMLElement}
 */
export function createAccountCard(account, onClick) {
  const card = document.createElement('div');
  card.className = 'card account-card';
  card.style.borderLeft = `4px solid ${TYPE_COLORS[account.type] || '#6b7280'}`;
  card.style.cursor = 'pointer';

  // --- Header row: icon + nickname + status badge ---
  const header = document.createElement('div');
  header.className = 'account-card-header';

  const typeConfig = ACCOUNT_TYPES.find((t) => t.value === account.type);
  const typeIcon = document.createElement('span');
  typeIcon.className = 'account-card-type-icon';
  typeIcon.textContent = typeConfig ? typeConfig.icon : '📦';

  const nickname = document.createElement('span');
  nickname.className = 'account-card-nickname';
  nickname.textContent = account.nickname || account.email || '未命名';

  const statusBadge = document.createElement('span');
  const isActive = account.status === 'active';
  statusBadge.className = `badge ${isActive ? 'badge-success' : 'badge-danger'}`;
  statusBadge.textContent = isActive ? '正常' : '封禁';

  header.appendChild(typeIcon);
  header.appendChild(nickname);
  header.appendChild(statusBadge);

  // --- Info row: email + subscription badge ---
  const info = document.createElement('div');
  info.className = 'account-card-info';

  const email = document.createElement('span');
  email.className = 'account-card-email';
  email.textContent = maskEmail(account.email || '');

  const subBadge = document.createElement('span');
  const lifecycleStatus = getSubscriptionLifecycleStatus(account);
  subBadge.className = `badge ${lifecycleStatus === SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END ? 'badge-warning' : 'badge-outline'}`;
  const subTypes = SUBSCRIPTION_TYPES[account.type] || [];
  const subMatch = subTypes.find((s) => s.value === account.subscriptionType);
  const subscriptionLabel = subMatch ? subMatch.label : (account.subscriptionType || 'Free');
  subBadge.textContent = lifecycleStatus === SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END
    ? `${subscriptionLabel} · 到期取消`
    : subscriptionLabel;

  info.appendChild(email);
  info.appendChild(subBadge);

  // --- Extra row: team members or refund ---
  let extra = null;

  if (hasTeamManagement(account.type, account.subscriptionType)) {
    const members = getTeamMembers(account.id);
    const activeMembers = members.filter((m) => m.memberStatus === 'active');
    const teamLimit = account.teamLimit || 0;

    extra = document.createElement('div');
    extra.className = 'account-card-extra';

    const teamText = document.createElement('span');
    teamText.className = 'account-card-team';
    teamText.textContent = `👥 ${activeMembers.length}/${teamLimit} 成员`;
    extra.appendChild(teamText);
  }

  if (hasRefundFields(account.type) && account.refundStatus && account.refundStatus !== 'none') {
    extra = extra || document.createElement('div');
    if (!extra.className) extra.className = 'account-card-extra';

    const refundLabel = REFUND_STATUS_OPTIONS.find((r) => r.value === account.refundStatus);
    const refundBadge = document.createElement('span');
    refundBadge.className = 'badge badge-warning';
    const refundParts = [`退款: ${refundLabel ? refundLabel.label : account.refundStatus}`];
    if (account.refundAmount) refundParts.push(`$${formatCurrency(account.refundAmount)}`);
    if (account.refundDate) refundParts.push(formatDate(account.refundDate));
    refundBadge.textContent = refundParts.join(' · ');
    extra.appendChild(refundBadge);
  }

  // --- Assemble ---
  card.appendChild(header);
  card.appendChild(info);
  if (extra) card.appendChild(extra);

  // Click handler
  card.addEventListener('click', () => {
    if (typeof onClick === 'function') onClick(account);
  });

  return card;
}
