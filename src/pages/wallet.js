// 卡包 (Wallet) 页面
import { getCards, getCardById, saveCard, deleteCard, getTopUpRecords, saveTopUpRecord, getBillingRecordsByCard, editBillingRecord, getAccounts, autoGenerateBillingRecords, batchExtractLegacyPayments, deleteBillingRecord, getBillingRecordById, getUnspecifiedBillingRecords } from '../utils/storage.js';
import { CARD_BRANDS, TOP_UP_METHODS, BILLING_PAYMENT_SOURCES } from '../config.js';
import { formatDate, formatCurrency, getLocalDateString } from '../utils/helpers.js';
import { decrypt } from '../utils/crypto.js';

export function render(container) {
  const cards = getCards();
  const unspecifiedBills = getUnspecifiedBillingRecords();
  const displayCards = [...cards];
  displayCards.push({
    id: 'unspecified',
    brand: 'other',
    lastFour: '0000',
    remark: '非卡片 (礼品卡/他人代付/未绑定)',
    balance: 0,
    isVirtual: true
  });

  let cardsHtml = '';
  if (displayCards.length === 0) {
    cardsHtml = `
      <div class="wallet-empty">
        <div class="wallet-empty-icon">💳</div>
        <div class="wallet-empty-text">暂无卡片</div>
      </div>
    `;
  } else {
    cardsHtml = displayCards.map(c => {
      const brandInfo = CARD_BRANDS.find(b => b.value === c.brand) || { label: c.brand };
      const cardStyle = c.isVirtual
        ? { bg: 'linear-gradient(135deg, #374151 0%, #4b5563 50%, #1f2937 100%)', shadow: 'rgba(55, 65, 81, 0.3)' }
        : getCardStyle(c.id);
      
      return `
        <div class="wallet-card" data-brand="${c.brand}" data-id="${c.id}" style="background: ${cardStyle.bg}; box-shadow: 0 8px 24px ${cardStyle.shadow}, var(--shadow-md);">
          <div class="wallet-card-top">
            <div class="wallet-card-brand">${escHtml(c.isVirtual ? '非卡片' : brandInfo.label)}</div>
            <div class="wallet-card-chip" style="${c.isVirtual ? 'display: none;' : ''}"></div>
          </div>
          <div class="wallet-card-number">${c.isVirtual ? '礼品卡 / 他人代付 / 未指定来源' : '•••• •••• •••• ' + escHtml(c.lastFour || '****')}</div>
          <div class="wallet-card-bottom">
            <div class="wallet-card-remark">${escHtml(c.remark || '未命名卡片')}</div>
            <div class="wallet-card-balance" style="${c.isVirtual ? 'display: none;' : ''}">
              <div class="wallet-card-balance-label">余额 (USD)</div>
              <div class="wallet-card-balance-amount">$${formatCurrency(c.balance || 0)}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  const totalBalance = cards.reduce((sum, c) => sum + (c.balance || 0), 0);

  container.innerHTML = `
    <div class="page-header" style="display: flex; flex-direction: column; gap: 0.5rem; padding-right: var(--space-4); margin-bottom: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <h1>💳 卡包</h1>
        <button class="btn btn-primary btn-sm" id="addCardBtn">+ 添加卡片</button>
      </div>
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <button class="btn btn-outline btn-sm" id="refreshBillsBtn" style="font-size: 0.8rem;">🔄 刷新所有账单</button>
        <button class="btn btn-outline btn-sm" id="batchExtractBtn" style="font-size: 0.8rem;">⚡ 一键提取旧卡片</button>
      </div>
    </div>

    <div class="wallet-summary">
      <div class="wallet-summary-label">总余额 (USD)</div>
      <div class="wallet-summary-amount">$${formatCurrency(totalBalance)}</div>
    </div>

    <div class="wallet-card-list">
      ${cardsHtml}
    </div>

    <!-- Modals -->
    ${renderCardModal()}
    ${renderTopUpModal()}
    ${renderCardDetailModal()}
    ${renderEditBillingModal()}
  `;

  bindEvents(container);
}

// ─── Render Modals ─────────────────────────────────────────────────────────

function renderCardModal() {
  const brandOptions = CARD_BRANDS.map(b => `<option value="${b.value}">${b.label}</option>`).join('');
  return `
    <div class="modal-overlay" id="cardModal" style="z-index: 1010;">
      <div class="modal card">
        <div class="card-header">
          <span id="cardModalTitle">添加卡片</span>
          <button class="btn btn-ghost btn-sm" id="closeCardModal">✕</button>
        </div>
        <div class="card-body">
          <input type="hidden" id="c_id" />
          <div class="form-group">
            <label class="form-label">卡片品牌</label>
            <select class="form-select" id="c_brand">${brandOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">卡号尾号 (4位)</label>
            <input class="form-input" id="c_lastFour" type="text" maxlength="4" placeholder="例如: 1234" />
          </div>
          <div class="form-group">
            <label class="form-label">备注</label>
            <input class="form-input" id="c_remark" type="text" placeholder="例如: 专门扣GPT的卡" />
          </div>
          <div class="form-group" id="initialBalanceGroup">
            <label class="form-label">初始余额 (USD)</label>
            <input class="form-input" id="c_balance" type="number" step="0.01" min="0" value="0" />
          </div>
          <button class="btn btn-primary" style="width: 100%; margin-top: 1rem;" id="saveCardBtn">保存</button>
        </div>
      </div>
    </div>
  `;
}

function renderTopUpModal() {
  const methodOptions = TOP_UP_METHODS.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
  return `
    <div class="modal-overlay" id="topUpModal" style="z-index: 1010;">
      <div class="modal card">
        <div class="card-header">
          <span id="topUpModalTitle">充值</span>
          <button class="btn btn-ghost btn-sm" id="closeTopUpModal">✕</button>
        </div>
        <div class="card-body">
          <input type="hidden" id="t_id" />
          <input type="hidden" id="t_cardId" />
          <div class="form-group">
            <label class="form-label">充值金额 (USD)</label>
            <input class="form-input" id="t_amount" type="number" step="0.01" min="0.01" value="" />
          </div>
          <div class="form-group">
            <label class="form-label">充值日期</label>
            <input class="form-input" id="t_date" type="date" value="${getLocalDateString()}" />
          </div>
          <div class="form-group">
            <label class="form-label">充值方式</label>
            <select class="form-select" id="t_method">${methodOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">备注</label>
            <input class="form-input" id="t_notes" type="text" placeholder="选填" />
          </div>
          <button class="btn btn-primary" style="width: 100%; margin-top: 1rem;" id="saveTopUpBtn">确认充值</button>
        </div>
      </div>
    </div>
  `;
}

function renderCardDetailModal() {
  return `
    <div class="modal-overlay" id="cardDetailModal">
      <div class="modal card" style="width: 90%; max-width: 600px; height: 85vh; display: flex; flex-direction: column;">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 0.5rem; flex-shrink: 0;">
          <span style="font-weight: bold; font-size: 1.1rem;">卡片详情</span>
          <button class="btn btn-ghost btn-sm" id="closeCardDetailModal">✕</button>
        </div>
        <div class="card-body" style="flex: 1; overflow-y: auto; padding-top: 0.5rem;">
          <div id="cardDetailContent"></div>
        </div>
      </div>
    </div>
  `;
}

function renderEditBillingModal() {
  const cards = getCards();
  const cardOptions = cards.map(c => {
    const brandLabel = CARD_BRANDS.find(b => b.value === c.brand)?.label || c.brand;
    return `<option value="${c.id}">${brandLabel} •••• ${c.lastFour} ($${formatCurrency(c.balance)})</option>`;
  }).join('');
  const sourceOptions = BILLING_PAYMENT_SOURCES.map(s => `<option value="${s.value}">${s.label}</option>`).join('');

  return `
    <div class="modal-overlay" id="editBillingModal" style="z-index: 1010;">
      <div class="modal card">
        <div class="card-header">
          <span>编辑历史账单</span>
          <button class="btn btn-ghost btn-sm" id="closeEditBillingModal">✕</button>
        </div>
        <div class="card-body">
          <input type="hidden" id="b_id" />
          <div class="alert alert-warning" style="margin-bottom: 1rem; font-size: 0.85rem;">
            只有“卡片余额”来源会影响卡包余额；礼品卡、他人代付和未指定来源只记录为账单流水。
          </div>
          <div class="form-group">
            <label class="form-label">支付来源</label>
            <select class="form-select" id="b_paymentSource">${sourceOptions}</select>
          </div>
          <div class="form-group" id="b_cardGroup">
            <label class="form-label">支付卡片</label>
            <select class="form-select" id="b_cardId">
              <option value="">-- 请选择卡片 --</option>
              ${cardOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">扣款日期</label>
            <input class="form-input" id="b_billingDate" type="date" />
          </div>
          <div class="form-group">
            <label class="form-label">实际扣费金额 (USD)</label>
            <input class="form-input" id="b_amount" type="number" step="0.01" min="0" />
          </div>
          <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
            <button class="btn btn-danger" style="flex: 1;" id="deleteBillingBtn">删除账单</button>
            <button class="btn btn-primary" style="flex: 2;" id="saveBillingBtn">确认修改</button>
          </div>
        </div>
      </div>
    </div>
  `;
}


// ─── Event Binding ─────────────────────────────────────────────────────────

function bindEvents(container) {
  // Refresh Bills
  container.querySelector('#refreshBillsBtn').addEventListener('click', () => {
    const count = autoGenerateBillingRecords();
    if (count > 0) {
      showToast(`账单刷新完成，共补齐 ${count} 笔扣费记录！`);
      render(container);
    } else {
      showToast('账单已是最新，无新增记录。');
    }
  });

  // Batch Extract Old Cards
  container.querySelector('#batchExtractBtn').addEventListener('click', async () => {
    const masterPwd = sessionStorage.getItem('masterPassword');
    if (!masterPwd) {
      showToast('未检测到主密码，无法解密提取');
      return;
    }
    const btn = container.querySelector('#batchExtractBtn');
    btn.disabled = true;
    btn.textContent = '提取中...';
    
    const count = await batchExtractLegacyPayments(decrypt, masterPwd);
    if (count > 0) {
      showToast(`提取完成，成功转换 ${count} 张卡片！`);
      render(container);
    } else {
      showToast('无需提取，或无符合条件的旧记录。');
      btn.disabled = false;
      btn.textContent = '⚡ 一键提取旧卡片';
    }
  });

  // Add Card
  container.querySelector('#addCardBtn').addEventListener('click', () => {
    container.querySelector('#c_id').value = '';
    container.querySelector('#c_brand').value = 'bybit';
    container.querySelector('#c_lastFour').value = '';
    container.querySelector('#c_remark').value = '';
    container.querySelector('#c_balance').value = '0';
    container.querySelector('#initialBalanceGroup').style.display = 'block';
    container.querySelector('#cardModalTitle').textContent = '添加卡片';
    container.querySelector('#cardModal').classList.add('modal-open');
  });

  // Close Card Modal
  container.querySelector('#closeCardModal').addEventListener('click', () => {
    container.querySelector('#cardModal').classList.remove('modal-open');
  });

  // Save Card
  container.querySelector('#saveCardBtn').addEventListener('click', () => {
    const id = container.querySelector('#c_id').value;
    const lastFour = container.querySelector('#c_lastFour').value.trim();
    const initialBalance = Number(container.querySelector('#c_balance').value);
    if (!/^\d{4}$/.test(lastFour)) {
      showToast('卡号尾号必须是 4 位数字');
      return;
    }
    if (!id && (!Number.isFinite(initialBalance) || initialBalance < 0)) {
      showToast('请输入有效的初始余额');
      return;
    }
    const card = {
      id: id || undefined,
      brand: container.querySelector('#c_brand').value,
      lastFour,
      remark: container.querySelector('#c_remark').value.trim(),
    };
    if (!id) {
      card.balance = initialBalance;
    }
    
    saveCard(card);
    showToast('卡片保存成功');
    container.querySelector('#cardModal').classList.remove('modal-open');
    render(container);
  });

  // Open Card Detail
  container.querySelectorAll('.wallet-card').forEach(el => {
    el.addEventListener('click', () => {
      const cardId = el.dataset.id;
      showCardDetail(container, cardId);
    });
  });

  // Close Card Detail
  container.querySelector('#closeCardDetailModal').addEventListener('click', () => {
    container.querySelector('#cardDetailModal').classList.remove('modal-open');
    render(container); // Refresh main view to show updated balance
  });

  // Close Top Up Modal
  container.querySelector('#closeTopUpModal').addEventListener('click', () => {
    container.querySelector('#topUpModal').classList.remove('modal-open');
  });

  // Save Top Up
  container.querySelector('#saveTopUpBtn').addEventListener('click', () => {
    const amount = parseFloat(container.querySelector('#t_amount').value);
    if (!amount || amount <= 0) {
      showToast('请输入有效的充值金额');
      return;
    }
    const recordId = container.querySelector('#t_id').value;
    const topUpDate = container.querySelector('#t_date').value;
    if (!topUpDate) {
      showToast('请选择充值日期');
      return;
    }
    const record = {
      id: recordId || undefined,
      cardId: container.querySelector('#t_cardId').value,
      amount: amount,
      topUpDate,
      method: container.querySelector('#t_method').value,
      notes: container.querySelector('#t_notes').value.trim()
    };
    saveTopUpRecord(record);
    showToast(recordId ? '充值记录已修改，余额已同步' : '充值成功');
    container.querySelector('#topUpModal').classList.remove('modal-open');
    showCardDetail(container, record.cardId); // Refresh detail view
  });

  // Close Edit Billing
  container.querySelector('#closeEditBillingModal').addEventListener('click', () => {
    container.querySelector('#editBillingModal').classList.remove('modal-open');
  });

  const billingSourceSelect = container.querySelector('#b_paymentSource');
  const billingCardGroup = container.querySelector('#b_cardGroup');
  const syncBillingCardGroup = () => {
    if (billingCardGroup) {
      billingCardGroup.style.display = billingSourceSelect.value === 'card' ? '' : 'none';
    }
  };
  if (billingSourceSelect) {
    billingSourceSelect.addEventListener('change', syncBillingCardGroup);
  }

  // Save Edit Billing
  container.querySelector('#saveBillingBtn').addEventListener('click', () => {
    const recordId = container.querySelector('#b_id').value;
    const paymentSource = container.querySelector('#b_paymentSource').value;
    const newCardId = paymentSource === 'card' ? container.querySelector('#b_cardId').value : '';
    const newAmount = Number(container.querySelector('#b_amount').value);
    const billingDate = container.querySelector('#b_billingDate').value;

    if (!billingDate || !Number.isFinite(newAmount) || newAmount < 0) {
      showToast('请填写有效的扣款日期和金额');
      return;
    }
    if (paymentSource === 'card' && !newCardId) {
      showToast('请选择实际扣款卡片');
      return;
    }
    
    editBillingRecord(recordId, newCardId, newAmount, paymentSource, billingDate);
    showToast('账单修改成功，余额已重算');
    container.querySelector('#editBillingModal').classList.remove('modal-open');
    
    // Refresh card detail based on which card we were viewing
    const currentCardId = container.querySelector('#t_cardId').value;
    if (currentCardId) {
      showCardDetail(container, currentCardId);
    }
  });

  // Delete Billing Record
  container.querySelector('#deleteBillingBtn').addEventListener('click', () => {
    const recordId = container.querySelector('#b_id').value;
    const currentCardId = container.querySelector('#t_cardId').value;
    
    if (confirm('确定要删除这笔账单记录吗？')) {
      const b = getBillingRecordById(recordId);
      if (b) {
        deleteBillingRecord(recordId);
        showToast('账单已删除，卡片余额已重算');
        container.querySelector('#editBillingModal').classList.remove('modal-open');
        
        if (currentCardId) {
          showCardDetail(container, currentCardId);
        }
      }
    }
  });
}

function openTopUpModal(container, cardId, existingRecord = null) {
  const isEdit = !!existingRecord;
  container.querySelector('#t_id').value = existingRecord?.id || '';
  container.querySelector('#t_cardId').value = cardId;
  container.querySelector('#t_amount').value = existingRecord?.amount || '';
  container.querySelector('#t_date').value = existingRecord?.topUpDate || getLocalDateString();
  container.querySelector('#t_method').value = existingRecord?.method || TOP_UP_METHODS[0]?.value || 'other';
  container.querySelector('#t_notes').value = existingRecord?.notes || '';
  container.querySelector('#topUpModalTitle').textContent = isEdit ? '编辑充值记录' : '充值';
  container.querySelector('#saveTopUpBtn').textContent = isEdit ? '保存修改' : '确认充值';
  container.querySelector('#topUpModal').classList.add('modal-open');
}

function showCardDetail(container, cardId) {
  let card = null;
  let billings = [];
  
  if (cardId === 'unspecified') {
    card = {
      id: 'unspecified',
      brand: 'other',
      lastFour: '0000',
      remark: '非卡片 (礼品卡/他人代付/未指定来源)',
      balance: 0,
      isVirtual: true
    };
    billings = getUnspecifiedBillingRecords();
  } else {
    card = getCardById(cardId);
    if (!card) return;
    billings = getBillingRecordsByCard(cardId);
  }

  const topUps = cardId === 'unspecified' ? [] : getTopUpRecords(cardId);
  const billingsList = billings;
  
  // Combine and sort transactions
  const txs = [];
  topUps.forEach(t => {
    const methodInfo = TOP_UP_METHODS.find(m => m.value === t.method);
    txs.push({
      type: 'topup',
      date: t.topUpDate || t.createdAt.split('T')[0],
      amount: t.amount,
      title: '充值',
      subtitle: methodInfo ? methodInfo.label : t.method,
      raw: t
    });
  });
  
  const accounts = getAccounts();
  billingsList.forEach(b => {
    const acct = accounts.find(a => a.id === b.accountId);
    const acctName = acct ? (acct.nickname || acct.email || acct.type) : '未知账号';
    txs.push({
      type: 'billing',
      date: b.billingDate || b.createdAt.split('T')[0],
      amount: -b.amount,
      title: `订阅扣费 (${acctName})`,
      subtitle: `第 ${b.period} 期账单`,
      raw: b
    });
  });

  txs.sort((a, b) => b.date.localeCompare(a.date));

  const txsHtml = txs.length === 0 ? '<div class="empty-state">暂无交易记录</div>' : txs.map(tx => {
    const isTopUp = tx.type === 'topup';
    const clickHandler = isTopUp
      ? `onclick="window.editTopUp('${tx.raw.id}', '${cardId}')"`
      : `onclick="window.editBilling('${tx.raw.id}', '${cardId}')"`;
    return `
      <div class="wallet-history-item" ${clickHandler} style="cursor: pointer;">
        <div class="wallet-history-item-left">
          <div class="wallet-history-item-type">${escHtml(tx.title)}</div>
          <div class="wallet-history-item-date">${formatDate(tx.date)} &middot; ${escHtml(tx.subtitle)}</div>
        </div>
        <div class="wallet-history-item-amount ${isTopUp ? 'amount-positive' : 'amount-negative'}">
          ${isTopUp ? '+' : ''}$${formatCurrency(Math.abs(tx.amount))}
        </div>
        <div class="settings-arrow" style="margin-left: 10px;">›</div>
      </div>
    `;
  }).join('');

  const brandInfo = CARD_BRANDS.find(b => b.value === card.brand) || { label: card.brand };
  const cardStyle = getCardStyle(card.id);

  const html = `
    <!-- Mini Card Presentation -->
    <div class="wallet-detail-card" data-brand="${card.brand}" style="background: ${cardStyle.bg}; box-shadow: 0 8px 24px ${cardStyle.shadow}, var(--shadow-md);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <div style="font-weight: 800; text-transform: uppercase;">${escHtml(card.isVirtual ? '非卡片' : brandInfo.label)}</div>
        <div style="font-family: monospace; font-size: 1.1rem;">${card.isVirtual ? '非真实卡片' : '•••• ' + escHtml(card.lastFour)}</div>
      </div>
      <div style="${card.isVirtual ? 'display: none;' : ''}">
        <div style="font-size: 0.8rem; opacity: 0.8; text-transform: uppercase;">Balance</div>
        <div style="font-size: 1.8rem; font-weight: bold; font-family: monospace;">$${formatCurrency(card.balance || 0)}</div>
      </div>
      <div style="${!card.isVirtual ? 'display: none;' : ''}">
        <div style="font-size: 0.85rem; opacity: 0.9;">记录礼品卡、他人代付或未指定卡片的系统账单</div>
      </div>
    </div>

    <!-- Actions -->
    <div class="wallet-detail-actions" style="${card.isVirtual ? 'display: none;' : ''}">
      <button class="btn btn-primary" id="btnTopUp">充值</button>
      <button class="btn btn-outline" id="btnEditCard">编辑卡片</button>
      <button class="btn btn-danger" id="btnDelCard">删除</button>
    </div>

    <!-- Transaction History -->
    <div class="wallet-history-section">
      <div class="wallet-history-title">📄 交易明细</div>
      <div class="wallet-history-list">
        ${txsHtml}
      </div>
    </div>
  `;

  const contentEl = container.querySelector('#cardDetailContent');
  contentEl.innerHTML = html;

  // Global function for onclick edit billing
  window.editBilling = (billingId, cid) => {
    let b;
    if (cid === 'unspecified') {
      b = getBillingRecordById(billingId);
    } else {
      b = getBillingRecordsByCard(cid).find(r => r.id === billingId);
    }
    if (!b) return;
    
    // Store current card for refresh
    container.querySelector('#t_cardId').value = cid;
    
    const editModal = container.querySelector('#editBillingModal');
    container.querySelector('#b_id').value = b.id;
    container.querySelector('#b_paymentSource').value = b.paymentSource || (b.cardId ? 'card' : 'unknown');
    container.querySelector('#b_cardId').value = b.cardId || '';
    container.querySelector('#b_amount').value = b.amount;
    container.querySelector('#b_billingDate').value = b.billingDate || '';
    container.querySelector('#b_cardGroup').style.display = container.querySelector('#b_paymentSource').value === 'card' ? '' : 'none';
    editModal.classList.add('modal-open');
  };

  window.editTopUp = (topUpId, cid) => {
    if (cid === 'unspecified') return;
    const topUp = getTopUpRecords(cid).find(r => r.id === topUpId);
    if (!topUp) return;
    openTopUpModal(container, cid, topUp);
  };

  // Bind new action buttons (only if not virtual card)
  if (!card.isVirtual) {
    contentEl.querySelector('#btnTopUp').addEventListener('click', () => {
      openTopUpModal(container, card.id);
    });

    contentEl.querySelector('#btnEditCard').addEventListener('click', () => {
      container.querySelector('#c_id').value = card.id;
      container.querySelector('#c_brand').value = card.brand;
      container.querySelector('#c_lastFour').value = card.lastFour;
      container.querySelector('#c_remark').value = card.remark;
      container.querySelector('#initialBalanceGroup').style.display = 'none'; // hide balance on edit
      container.querySelector('#cardModalTitle').textContent = '编辑卡片';
      container.querySelector('#cardModal').classList.add('modal-open');
    });

    contentEl.querySelector('#btnDelCard').addEventListener('click', () => {
      if (confirm('确定要删除这张卡片吗？该操作不可恢复，并会清除其充值记录；历史账单将保留为未指定来源。')) {
        deleteCard(card.id);
        showToast('卡片已删除');
        container.querySelector('#cardDetailModal').classList.remove('modal-open');
        render(container);
      }
    });
  }

  container.querySelector('#cardDetailModal').classList.add('modal-open');
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function showToast(message) {
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

// ─── Predefined bright, vibrant card gradients ───
const CARD_GRADIENTS = [
  { bg: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #818cf8 100%)', shadow: 'rgba(79, 70, 229, 0.3)' }, // Indigo
  { bg: 'linear-gradient(135deg, #f97316 0%, #fb923c 50%, #fdba74 100%)', shadow: 'rgba(249, 115, 22, 0.3)' }, // Orange
  { bg: 'linear-gradient(135deg, #0d9488 0%, #14b8a6 50%, #2dd4bf 100%)', shadow: 'rgba(13, 148, 136, 0.3)' }, // Teal
  { bg: 'linear-gradient(135deg, #db2777 0%, #ec4899 50%, #f472b6 100%)', shadow: 'rgba(219, 39, 119, 0.3)' }, // Pink
  { bg: 'linear-gradient(135deg, #7c3aed 0%, #8b5cf6 50%, #a78bfa 100%)', shadow: 'rgba(124, 58, 237, 0.3)' }, // Purple
  { bg: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%)', shadow: 'rgba(37, 99, 235, 0.3)' }, // Blue
  { bg: 'linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)', shadow: 'rgba(5, 150, 105, 0.3)' }, // Emerald
  { bg: 'linear-gradient(135deg, #ea580c 0%, #f97316 50%, #fb923c 100%)', shadow: 'rgba(234, 88, 12, 0.3)' }, // Warm Orange
  { bg: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #a78bfa 100%)', shadow: 'rgba(79, 70, 229, 0.3)' }, // Violet
  { bg: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 50%, #22d3ee 100%)', shadow: 'rgba(8, 145, 178, 0.3)' }, // Cyan
  { bg: 'linear-gradient(135deg, #4b5563 0%, #6b7280 50%, #9ca3af 100%)', shadow: 'rgba(107, 114, 128, 0.3)' }, // Slate Gray
];

export function getCardStyle(cardId) {
  if (!cardId) return CARD_GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < cardId.length; i++) {
    hash = cardId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % CARD_GRADIENTS.length;
  return CARD_GRADIENTS[index];
}
