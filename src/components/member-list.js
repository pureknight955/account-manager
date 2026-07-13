/**
 * member-list.js - Team member list component
 *
 * Used in GPT Business account detail. Shows team members with
 * name, invite date, charge amount, next charge date, paid status.
 * Supports add / edit (via modal) / delete actions.
 * Filters: active members by default, toggle to show exited.
 */

import { formatDate, formatCurrency, getLocalDateString } from '../utils/helpers.js';
import { MEMBER_STATUS_OPTIONS, PAYMENT_STATUS } from '../config.js';
import {
  createTextField,
  createDateField,
  createNumberField,
  createSelectField,
  createTextareaField,
} from './form-fields.js';
import { openModal, closeModal } from './modal.js';

/**
 * Create the member list component.
 * @param {Array} members - Array of member objects.
 * @param {string} accountId - Parent account ID.
 * @param {Object} callbacks
 * @param {(member: Object) => void} callbacks.onSave - Save a member (create or update).
 * @param {(memberId: string) => void} callbacks.onDelete - Delete a member.
 * @param {(accountId: string) => void} callbacks.onAdd - Add new member intent.
 * @returns {HTMLElement}
 */
export function createMemberList(members, accountId, callbacks = {}) {
  let showExited = false;

  const container = document.createElement('div');
  container.className = 'member-list-section';

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'member-list-header';

  const title = document.createElement('h3');
  title.className = 'member-list-title';
  title.textContent = '团队成员';

  const headerActions = document.createElement('div');
  headerActions.className = 'member-list-actions';

  // Toggle filter
  const filterBtn = document.createElement('button');
  filterBtn.type = 'button';
  filterBtn.className = 'btn btn-sm btn-ghost';
  filterBtn.textContent = '显示已退出';
  filterBtn.addEventListener('click', () => {
    showExited = !showExited;
    filterBtn.textContent = showExited ? '隐藏已退出' : '显示已退出';
    filterBtn.classList.toggle('btn-active', showExited);
    renderList();
  });

  // Add button
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-sm btn-primary';
  addBtn.textContent = '+ 添加成员';
  addBtn.addEventListener('click', () => {
    if (typeof callbacks.onAdd === 'function') {
      callbacks.onAdd(accountId);
    } else {
      openMemberEditModal(null);
    }
  });

  headerActions.appendChild(filterBtn);
  headerActions.appendChild(addBtn);
  header.appendChild(title);
  header.appendChild(headerActions);

  // --- List body ---
  const listBody = document.createElement('div');
  listBody.className = 'member-list-body';

  container.appendChild(header);
  container.appendChild(listBody);

  // --- Render function ---
  function renderList() {
    listBody.innerHTML = '';

    const filtered = showExited
      ? members
      : members.filter((m) => m.memberStatus !== 'exited');

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'member-list-empty';
      empty.textContent = showExited ? '暂无成员记录' : '暂无活跃成员';
      listBody.appendChild(empty);
      return;
    }

    filtered.forEach((member) => {
      listBody.appendChild(createMemberItem(member));
    });
  }

  // --- Create a single member item ---
  function createMemberItem(member) {
    const item = document.createElement('div');
    item.className = 'member-item';
    if (member.memberStatus === 'exited') {
      item.classList.add('member-exited');
    }

    // Top row: name + status badges
    const topRow = document.createElement('div');
    topRow.className = 'member-item-top';

    const name = document.createElement('span');
    name.className = 'member-item-name';
    name.textContent = member.name || '未命名';

    const badges = document.createElement('div');
    badges.className = 'member-item-badges';

    // Paid status
    const paidBadge = document.createElement('span');
    paidBadge.className = `badge ${member.isPaid ? 'badge-success' : 'badge-warning'}`;
    paidBadge.textContent = member.isPaid ? '已缴' : '未缴';
    badges.appendChild(paidBadge);

    // Member status
    const statusLabel = MEMBER_STATUS_OPTIONS.find((s) => s.value === member.memberStatus);
    const statusBadge = document.createElement('span');
    statusBadge.className = `badge ${member.memberStatus === 'active' ? 'badge-success' : 'badge-muted'}`;
    statusBadge.textContent = statusLabel ? statusLabel.label : member.memberStatus;
    badges.appendChild(statusBadge);

    topRow.appendChild(name);
    topRow.appendChild(badges);

    // Detail row
    const detailRow = document.createElement('div');
    detailRow.className = 'member-item-details';

    const inviteDate = document.createElement('span');
    inviteDate.textContent = `加入: ${formatDate(member.inviteDate)}`;

    const charge = document.createElement('span');
    charge.textContent = `收费: ${formatCurrency(member.chargeAmountCny)}`;

    const nextCharge = document.createElement('span');
    nextCharge.textContent = `下次: ${formatDate(member.nextChargeDate)}`;

    detailRow.appendChild(inviteDate);
    detailRow.appendChild(charge);
    detailRow.appendChild(nextCharge);

    // Action row
    const actionRow = document.createElement('div');
    actionRow.className = 'member-item-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-sm btn-ghost';
    editBtn.textContent = '✏️ 编辑';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMemberEditModal(member);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-sm btn-ghost btn-danger-text';
    deleteBtn.textContent = '🗑️ 删除';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`确定要删除成员「${member.name}」吗？`)) {
        if (typeof callbacks.onDelete === 'function') {
          callbacks.onDelete(member.id);
        }
      }
    });

    actionRow.appendChild(editBtn);
    actionRow.appendChild(deleteBtn);

    item.appendChild(topRow);
    item.appendChild(detailRow);
    item.appendChild(actionRow);

    return item;
  }

  // --- Edit modal ---
  function openMemberEditModal(member) {
    const isNew = !member;
    const draft = isNew
      ? {
          accountId,
          name: '',
          inviteDate: getLocalDateString(),
          chargeAmountCny: 0,
          nextChargeDate: '',
          isPaid: false,
          memberStatus: 'active',
          notes: '',
        }
      : { ...member };

    const form = document.createElement('div');
    form.className = 'member-edit-form';

    form.appendChild(
      createTextField('成员名称', draft.name, (v) => { draft.name = v; }, { required: true, placeholder: '请输入成员名称' })
    );

    form.appendChild(
      createDateField('加入日期', draft.inviteDate, (v) => { draft.inviteDate = v; })
    );

    form.appendChild(
      createNumberField('收费金额', draft.chargeAmountCny, (v) => { draft.chargeAmountCny = parseFloat(v) || 0; }, { prefix: '¥', min: 0, step: '0.01' })
    );

    form.appendChild(
      createDateField('下次收费日期', draft.nextChargeDate, (v) => { draft.nextChargeDate = v; })
    );

    form.appendChild(
      createSelectField('缴费状态', PAYMENT_STATUS.map((p) => ({ value: String(p.value), label: p.label })), String(draft.isPaid), (v) => { draft.isPaid = v === 'true'; })
    );

    form.appendChild(
      createSelectField('成员状态', MEMBER_STATUS_OPTIONS, draft.memberStatus, (v) => { draft.memberStatus = v; })
    );

    form.appendChild(
      createTextareaField('备注', draft.notes, (v) => { draft.notes = v; }, { placeholder: '可选备注...' })
    );

    openModal(isNew ? '添加成员' : '编辑成员', form, {
      showFooter: true,
      footerButtons: [
        {
          label: '取消',
          className: 'btn btn-ghost',
          onClick: () => closeModal(),
        },
        {
          label: isNew ? '添加' : '保存',
          className: 'btn btn-primary',
          onClick: () => {
            if (!draft.name.trim()) {
              // Basic validation
              return;
            }
            if (typeof callbacks.onSave === 'function') {
              callbacks.onSave(draft);
            }
            closeModal();
          },
        },
      ],
    });
  }

  // Initial render
  renderList();

  // Expose a re-render method for external updates
  container.refresh = (newMembers) => {
    members = newMembers;
    renderList();
  };

  return container;
}
