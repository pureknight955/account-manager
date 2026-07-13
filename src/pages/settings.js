// 设置页面
import {
  getSettings,
  saveSettings,
  exportAllData,
  importAllData,
  rotateAccountSecrets,
  clearAllData,
} from '../utils/storage.js';
import {
  createPasswordVerifier,
  decrypt,
  encrypt,
  verifyPassword,
} from '../utils/crypto.js';
import { getLocalDateString } from '../utils/helpers.js';
import {
  friendlyCloudError,
  getCloudStatus,
  resetLocalCloudState,
  signOutCloud,
  syncNow,
} from '../utils/cloud.js';

/**
 * Render the settings page.
 * @param {HTMLElement} container
 */
export function render(container) {
  const settings = getSettings();

  container.innerHTML = `
    <div class="page-header">
      <h1>⚙️ 设置</h1>
    </div>

    <div class="settings-sections">
      ${renderPasswordSection(settings)}
      ${renderCloudSection()}
      ${renderExchangeRateSection(settings)}
      ${renderReminderSection(settings)}
      ${renderThemeSection(settings)}
      ${renderDataSection()}
      ${renderAboutSection()}
    </div>

    <!-- Password change modal -->
    <div class="modal-overlay" id="pwdModal" style="display:none;">
      <div class="modal card">
        <div class="card-header">
          修改主密码
          <button class="btn btn-outline btn-sm" id="closePwdModal">✕</button>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">当前密码</label>
            <input class="form-input" type="password" id="currentPwd" autocomplete="current-password" />
          </div>
          <div class="form-group">
            <label class="form-label">新密码</label>
            <input class="form-input" type="password" id="newPwd" minlength="8" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label class="form-label">确认新密码</label>
            <input class="form-input" type="password" id="confirmNewPwd" minlength="8" autocomplete="new-password" />
          </div>
          <div id="pwdError" class="alert alert-danger" style="display:none;"></div>
          <button class="btn btn-primary" id="savePwdBtn">保存</button>
        </div>
      </div>
    </div>
  `;

  bindSettingsEvents(container, settings);
}

// ─── Sections ───────────────────────────────────────────────────────────────

function renderPasswordSection(settings) {
  const autoLockMinutes = Number(settings.autoLockMinutes) || 30;
  return `
    <section class="card settings-section">
      <div class="card-header section-title">🔑 主密码</div>
      <div class="card-body">
        <div class="settings-row clickable-row" id="changePwdRow">
          <span>修改主密码</span>
          <span class="settings-arrow">›</span>
        </div>
        <div class="form-group settings-inline" style="margin-top: 1rem;">
          <label style="width: 140px; font-weight: 500;">无操作自动锁定</label>
          <select class="form-select" id="autoLockMinutesInput" style="width: 120px;">
            ${[5, 15, 30, 60, 120].map((minutes) => `
              <option value="${minutes}" ${autoLockMinutes === minutes ? 'selected' : ''}>${minutes} 分钟</option>
            `).join('')}
          </select>
          <button class="btn btn-outline" id="saveAutoLockBtn">保存</button>
          <button class="btn btn-outline" id="lockNowBtn">立即锁定</button>
        </div>
      </div>
    </section>
  `;
}

function renderCloudSection() {
  const status = getCloudStatus();
  if (!status.configured) return '';
  const stateLabel = !status.signedIn
    ? '未登录'
    : status.lastError
      ? '同步异常'
      : status.dirty
        ? '等待同步'
        : '已同步';
  const stateClass = status.lastError ? 'cloud-state-error' : status.dirty ? 'cloud-state-pending' : 'cloud-state-ok';
  const lastSync = status.lastSyncedAt
    ? new Date(status.lastSyncedAt).toLocaleString('zh-CN', { hour12: false })
    : '尚未同步';

  return `
    <section class="card settings-section" id="cloudSettingsSection">
      <div class="card-header section-title">☁️ 云端同步</div>
      <div class="card-body">
        <div class="settings-row">
          <div>
            <div class="cloud-account">${escapeHtml(status.email || '未登录')}</div>
            <div class="settings-note cloud-sync-detail">${escapeHtml(lastSync)} · 本地版本 ${status.localRevision || 0}</div>
          </div>
          <span class="cloud-state ${stateClass}">${stateLabel}</span>
        </div>
        ${status.lastError ? `<div class="alert alert-danger cloud-sync-error">${escapeHtml(status.lastError)}</div>` : ''}
        <div class="settings-actions" style="margin-top: var(--space-3);">
          <button class="btn btn-primary" id="syncNowBtn" ${status.signedIn ? '' : 'disabled'}>立即同步</button>
          <button class="btn btn-outline" id="cloudLogoutBtn" ${status.signedIn ? '' : 'disabled'}>退出云端账号</button>
        </div>
        <div class="settings-note">所有账号、卡片和财务数据会先由主密码完整加密，再上传到云端。</div>
      </div>
    </section>
  `;
}

function renderExchangeRateSection(settings) {
  const rate = settings.exchangeRate || 7.25;
  return `
    <section class="card settings-section">
      <div class="card-header section-title">💱 汇率设置</div>
      <div class="card-body">
        <div class="settings-info">当前汇率: <strong>1 USD = ¥${rate}</strong></div>
        <div class="form-group settings-inline">
          <input
            class="form-input"
            type="number"
            id="exchangeRateInput"
            step="0.01"
            min="0"
            value="${rate}"
            placeholder="输入汇率"
          />
          <button class="btn btn-primary" id="saveRateBtn">保存汇率</button>
        </div>
        <div class="settings-note">在线汇率功能将在联网版本启用</div>
      </div>
    </section>
  `;
}

function renderReminderSection(settings) {
  const days = settings.reminderDays || 7;
  return `
    <section class="card settings-section">
      <div class="card-header section-title">📅 提醒设置</div>
      <div class="card-body">
        <div class="form-group settings-inline">
          <label style="width: 140px; font-weight: 500;">提前提醒天数</label>
          <input
            class="form-input"
            type="number"
            id="reminderDaysInput"
            min="3"
            max="10"
            value="${days}"
            style="width: 80px;"
          />
          <button class="btn btn-primary" id="saveReminderBtn">保存</button>
        </div>
        <div class="settings-note">空缺和缴费将在此天数内出现在首页提醒（支持 3-10 天）</div>
      </div>
    </section>
  `;
}

function renderThemeSection(settings) {
  const current = settings.theme || 'auto';
  const themes = [
    { value: 'auto', label: '自动', icon: '🌗' },
    { value: 'light', label: '亮色', icon: '☀️' },
    { value: 'dark', label: '暗色', icon: '🌙' },
  ];

  return `
    <section class="card settings-section">
      <div class="card-header section-title">🎨 主题</div>
      <div class="card-body">
        <div class="theme-options">
          ${themes.map(
            (t) => `
            <button
              class="btn ${current === t.value ? 'btn-primary' : 'btn-outline'} theme-btn"
              data-theme="${t.value}"
            >${t.icon} ${t.label}</button>`
          ).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderDataSection() {
  return `
    <section class="card settings-section">
      <div class="card-header section-title">📦 数据管理</div>
      <div class="card-body">
        <div class="settings-actions">
          <button class="btn btn-primary" id="exportBtn">📤 导出备份</button>
          <button class="btn btn-outline" id="importBtn">📥 导入备份</button>
          <input type="file" id="importFileInput" accept=".json" style="display:none;" />
          <button class="btn btn-danger" id="clearDataBtn">🗑️ 清除所有数据</button>
        </div>
        <div class="settings-note">备份文件包含账号和财务明细，请按敏感文件保管。导入旧备份时会自动兼容历史数据结构并重算卡包余额。</div>
      </div>
    </section>
  `;
}

function renderAboutSection() {
  const cloudEnabled = getCloudStatus().configured;
  return `
    <section class="card settings-section">
      <div class="card-header section-title">ℹ️ 关于</div>
      <div class="card-body">
        <div class="about-info">
          <div class="about-row"><strong>账号管理器</strong> v1.0.0</div>
          <div class="about-row">${cloudEnabled ? '云端保存完整加密数据，本地浏览器保留工作缓存' : '数据存储在本地浏览器中'}</div>
          <div class="about-row">云端数据使用 AES-256-GCM 加密，主密码不会上传；解锁后的本机浏览器仍需妥善保护</div>
        </div>
      </div>
    </section>
  `;
}

// ─── Event Binding ──────────────────────────────────────────────────────────

function bindSettingsEvents(container, settings) {
  const syncNowButton = container.querySelector('#syncNowBtn');
  if (syncNowButton) {
    syncNowButton.addEventListener('click', async () => {
      syncNowButton.disabled = true;
      syncNowButton.textContent = '同步中...';
      try {
        const result = await syncNow();
        showToast(`云端同步完成 · 版本 ${result.revision || getCloudStatus().localRevision}`);
        window.navigateTo('settings');
      } catch (error) {
        showToast(friendlyCloudError(error));
        syncNowButton.disabled = false;
        syncNowButton.textContent = '立即同步';
      }
    });
  }

  const cloudLogoutButton = container.querySelector('#cloudLogoutBtn');
  if (cloudLogoutButton) {
    cloudLogoutButton.addEventListener('click', async () => {
      if (!confirm('退出后将清除这台浏览器的本地工作数据，云端加密数据会保留。确定退出吗？')) return;
      cloudLogoutButton.disabled = true;
      try {
        if (getCloudStatus().dirty) await syncNow();
        await signOutCloud();
        clearAllData({ notify: false });
        sessionStorage.clear();
        window.navigateTo('cloud-login');
      } catch (error) {
        showToast(friendlyCloudError(error));
        cloudLogoutButton.disabled = false;
      }
    });
  }

  // ── Change password ──
  container.querySelector('#changePwdRow').addEventListener('click', () => {
    container.querySelector('#pwdModal').style.display = 'flex';
    container.querySelector('#currentPwd').focus();
  });

  container.querySelector('#closePwdModal').addEventListener('click', () => {
    container.querySelector('#pwdModal').style.display = 'none';
    clearPwdForm(container);
  });

  container.querySelector('#savePwdBtn').addEventListener('click', async () => {
    await handlePasswordChange(container);
  });

  container.querySelector('#saveAutoLockBtn').addEventListener('click', () => {
    const minutes = Number(container.querySelector('#autoLockMinutesInput').value);
    const s = getSettings();
    s.autoLockMinutes = minutes;
    saveSettings(s);
    document.dispatchEvent(new Event('acctmgr:auto-lock-updated'));
    showToast('自动锁定时间已保存');
  });

  container.querySelector('#lockNowBtn').addEventListener('click', () => {
    if (window.lockApp) window.lockApp();
  });

  // ── Exchange rate ──
  container.querySelector('#saveRateBtn').addEventListener('click', () => {
    const input = container.querySelector('#exchangeRateInput');
    const newRate = parseFloat(input.value);
    if (isNaN(newRate) || newRate <= 0) {
      showToast('请输入有效的汇率');
      return;
    }
    const s = getSettings();
    s.exchangeRate = newRate;
    s.exchangeRateUpdatedAt = new Date().toISOString();
    saveSettings(s);
    showToast('汇率已更新 ✓');
    // Update display
    const info = container.querySelector('.settings-info');
    if (info) info.innerHTML = `当前汇率: <strong>1 USD = ¥${newRate}</strong>`;
  });

  // ── Reminder Days ──
  const saveReminderBtn = container.querySelector('#saveReminderBtn');
  if (saveReminderBtn) {
    saveReminderBtn.addEventListener('click', () => {
      const input = container.querySelector('#reminderDaysInput');
      const val = parseInt(input.value, 10);
      if (isNaN(val) || val < 3 || val > 10) {
        showToast('请输入 3-10 之间的天数');
        return;
      }
      const s = getSettings();
      s.reminderDays = val;
      saveSettings(s);
      showToast('提醒设置已保存 ✓');
    });
  }

  // ── Theme ──
  container.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      const s = getSettings();
      s.theme = theme;
      saveSettings(s);

      // Apply theme immediately; auto delegates to the system preference.
      if (theme === 'auto') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', theme);
      }

      // Update button states
      container.querySelectorAll('.theme-btn').forEach((b) => {
        b.classList.toggle('btn-primary', b.dataset.theme === theme);
        b.classList.toggle('btn-outline', b.dataset.theme !== theme);
      });

      showToast(`主题已切换: ${btn.textContent.trim()}`);
    });
  });

  // ── Export ──
  container.querySelector('#exportBtn').addEventListener('click', () => {
    try {
      const data = exportAllData();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const dateStr = getLocalDateString();
      const a = document.createElement('a');
      a.href = url;
      a.download = `account-manager-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('备份已导出 ✓');
    } catch (err) {
      console.error('Export failed:', err);
      showToast('导出失败');
    }
  });

  // ── Import ──
  const fileInput = container.querySelector('#importFileInput');
  container.querySelector('#importBtn').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        const ok = importAllData(data);
        if (!ok) {
          showToast('导入失败：数据结构无效');
          return;
        }
        showToast('数据已导入 ✓ 正在刷新…');
        sessionStorage.removeItem('masterPassword');
        setTimeout(() => window.navigateTo('lock-screen'), 1000);
      } catch (err) {
        console.error('Import failed:', err);
        showToast('导入失败：文件格式无效');
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be imported again
    fileInput.value = '';
  });

  // ── Clear all data ──
  container.querySelector('#clearDataBtn').addEventListener('click', () => {
    const cloudConfigured = getCloudStatus().configured;
    const warning = cloudConfigured
      ? '⚠️ 确定要清除这台浏览器的本地数据吗？\n\n云端加密数据不会删除，重新登录后可恢复到本机。\n\n仍建议先导出备份。'
      : '⚠️ 确定要清除所有数据吗？\n\n此操作将删除所有账号、成员和设置数据，且不可恢复。\n\n建议先导出备份。';
    const confirmed = confirm(
      warning
    );
    if (!confirmed) return;

    const doubleConfirm = confirm(cloudConfigured
      ? '再次确认：清除这台浏览器的本地数据？'
      : '再次确认：真的要清除所有数据吗？');
    if (!doubleConfirm) return;

    clearAllData({ notify: false });
    resetLocalCloudState();

    sessionStorage.clear();
    showToast(cloudConfigured ? '本地数据已清除，云端数据仍保留' : '所有数据已清除');
    setTimeout(() => window.navigateTo('lock-screen'), 500);
  });
}

// ─── Password Change Handler ────────────────────────────────────────────────

async function handlePasswordChange(container) {
  const errorEl = container.querySelector('#pwdError');
  const currentPwd = container.querySelector('#currentPwd').value;
  const newPwd = container.querySelector('#newPwd').value;
  const confirmPwd = container.querySelector('#confirmNewPwd').value;

  errorEl.style.display = 'none';

  if (!currentPwd || !newPwd || !confirmPwd) {
    showPwdError(errorEl, '请填写所有字段');
    return;
  }

  if (newPwd.length < 8) {
    showPwdError(errorEl, '新密码长度至少为8位');
    return;
  }

  if (newPwd !== confirmPwd) {
    showPwdError(errorEl, '两次输入的新密码不一致');
    return;
  }

  const settings = getSettings();
  const valid = await verifyPassword(
    currentPwd,
    settings.masterKeyVerifier || settings.masterKeyHash,
  );
  if (!valid) {
    showPwdError(errorEl, '当前密码错误');
    return;
  }

  const saveButton = container.querySelector('#savePwdBtn');
  saveButton.disabled = true;
  saveButton.textContent = '正在重新加密...';

  try {
    const newVerifier = await createPasswordVerifier(newPwd);
    await rotateAccountSecrets(decrypt, encrypt, currentPwd, newPwd);
    settings.masterKeyVerifier = newVerifier;
    settings.masterKeyHash = '';
    saveSettings(settings);
  } catch (error) {
    console.error('Password rotation failed:', error);
    showPwdError(errorEl, '主密码修改失败：存在无法解密的数据，原密码和数据均未变更');
    saveButton.disabled = false;
    saveButton.textContent = '保存';
    return;
  }

  // Update session
  sessionStorage.setItem('masterPassword', newPwd);

  try {
    await syncNow(newPwd);
  } catch (error) {
    console.warn('Cloud sync after password change failed:', error);
  }

  container.querySelector('#pwdModal').style.display = 'none';
  clearPwdForm(container);
  saveButton.disabled = false;
  saveButton.textContent = '保存';
  showToast('主密码已修改 ✓');
}

function showPwdError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

function clearPwdForm(container) {
  container.querySelector('#currentPwd').value = '';
  container.querySelector('#newPwd').value = '';
  container.querySelector('#confirmNewPwd').value = '';
  container.querySelector('#pwdError').style.display = 'none';
}

// ─── Toast ──────────────────────────────────────────────────────────────────

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

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}
