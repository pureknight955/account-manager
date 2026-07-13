// 锁屏页面 - 主密码入口
import { getSettings, saveSettings } from '../utils/storage.js';
import { createPasswordVerifier, verifyPassword } from '../utils/crypto.js';
import {
  friendlyCloudError,
  getCloudSession,
  hasRemoteVault,
  isCloudConfigured,
  remoteNeedsRestore,
  unlockAndSync,
} from '../utils/cloud.js';

/**
 * Render the lock screen page.
 * First-time users set a master password; returning users enter theirs to unlock.
 * @param {HTMLElement} container
 */
export function render(container) {
  const settings = getSettings();
  const cloudSession = getCloudSession();
  const canReturnToCloudLogin = isCloudConfigured() && !cloudSession;
  const localIsFirstTime = !settings.masterKeyVerifier && !settings.masterKeyHash;
  const isFirstTime = localIsFirstTime && !hasRemoteVault();
  const restoringCloud = localIsFirstTime && hasRemoteVault();

  container.innerHTML = `
    <div class="lock-screen auth-screen">
      <div class="lock-card auth-card card">
        <div class="lock-logo">🔐</div>
        <h1 class="lock-title">账号管理器</h1>
        <p class="lock-subtitle">${isFirstTime
          ? '首次使用，请设置主密码'
          : restoringCloud
            ? '请输入原主密码，下载并解密云端数据'
            : '请输入主密码解锁'}</p>

        <form id="lockForm" class="lock-form" autocomplete="off">
          ${isFirstTime ? renderSetupForm() : renderLoginForm()}
          <div id="lockError" class="alert alert-danger" style="display:none;"></div>
          ${canReturnToCloudLogin
            ? '<button type="button" class="auth-text-btn" id="returnCloudLoginBtn">返回云端登录</button>'
            : ''}
        </form>
      </div>
      <p class="lock-footer">${cloudSession
        ? '云端只保存完整密文，主密码不会上传'
        : '账号密码加密保存在当前浏览器中'}</p>
    </div>
  `;

  bindEvents(container, isFirstTime, settings);
}

/** Render form for first-time password setup */
function renderSetupForm() {
  return `
    <div class="form-group">
      <label class="form-label" for="newPassword">设置主密码</label>
      <input
        class="form-input"
        type="password"
        id="newPassword"
        placeholder="输入主密码（至少8位）"
        minlength="8"
        required
        autocomplete="new-password"
      />
    </div>
    <div class="form-group">
      <label class="form-label" for="confirmPassword">确认密码</label>
      <input
        class="form-input"
        type="password"
        id="confirmPassword"
        placeholder="再次输入密码"
        minlength="8"
        required
        autocomplete="new-password"
      />
    </div>
    <button type="submit" class="btn btn-primary lock-btn">确认设置</button>
  `;
}

/** Render form for returning user login */
function renderLoginForm() {
  return `
    <div class="form-group">
      <label class="form-label" for="masterPassword">主密码</label>
      <input
        class="form-input"
        type="password"
        id="masterPassword"
        placeholder="输入主密码"
        required
        autocomplete="current-password"
      />
    </div>
    <button type="submit" class="btn btn-primary lock-btn">解锁</button>
  `;
}

/**
 * Bind form submit events
 * @param {HTMLElement} container
 * @param {boolean} isFirstTime
 * @param {object} settings
 */
function bindEvents(container, isFirstTime, settings) {
  const form = container.querySelector('#lockForm');
  const errorEl = container.querySelector('#lockError');
  const returnCloudLoginButton = container.querySelector('#returnCloudLoginBtn');

  if (returnCloudLoginButton) {
    returnCloudLoginButton.addEventListener('click', () => {
      sessionStorage.removeItem('acctmgrOfflineMode');
      window.navigateTo('cloud-login');
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError(errorEl);

    try {
      if (isFirstTime) {
        await handleSetup(container, errorEl);
      } else {
        await handleLogin(container, errorEl, settings);
      }
    } catch (err) {
      showError(errorEl, '操作失败，请重试');
      console.error('Lock screen error:', err);
    }
  });

  // Focus the first password input
  const firstInput = form.querySelector('input[type="password"]');
  if (firstInput) {
    setTimeout(() => firstInput.focus(), 100);
  }
}

/**
 * Handle first-time password setup
 */
async function handleSetup(container, errorEl) {
  const newPwd = container.querySelector('#newPassword').value;
  const confirmPwd = container.querySelector('#confirmPassword').value;

  if (newPwd.length < 8) {
    showError(errorEl, '密码长度至少为8位');
    shakeCard(container);
    return;
  }

  if (newPwd !== confirmPwd) {
    showError(errorEl, '两次输入的密码不一致');
    shakeCard(container);
    return;
  }

  const verifier = await createPasswordVerifier(newPwd);
  const settings = getSettings();
  settings.masterKeyVerifier = verifier;
  settings.masterKeyHash = '';
  saveSettings(settings);

  sessionStorage.setItem('masterPassword', newPwd);
  try {
    await unlockAndSync(newPwd);
  } catch (error) {
    console.warn('Initial cloud sync failed:', error);
  }
  window.navigateTo('dashboard');
}

/**
 * Handle returning user login
 */
async function handleLogin(container, errorEl, settings) {
  const pwd = container.querySelector('#masterPassword').value;

  if (!pwd) {
    showError(errorEl, '请输入密码');
    shakeCard(container);
    return;
  }

  const mustRestoreCloud = hasRemoteVault() && remoteNeedsRestore();
  let activeSettings = settings;

  if (mustRestoreCloud) {
    try {
      await unlockAndSync(pwd);
      activeSettings = getSettings();
    } catch (error) {
      showError(errorEl, friendlyCloudError(error));
      shakeCard(container);
      return;
    }
  }

  const verifier = activeSettings.masterKeyVerifier || activeSettings.masterKeyHash;
  const valid = await verifyPassword(pwd, verifier);

  if (valid) {
    if (!activeSettings.masterKeyVerifier) {
      activeSettings.masterKeyVerifier = await createPasswordVerifier(pwd);
      activeSettings.masterKeyHash = '';
      saveSettings(activeSettings);
    }
    sessionStorage.setItem('masterPassword', pwd);
    if (!mustRestoreCloud) {
      try {
        await unlockAndSync(pwd);
      } catch (error) {
        console.warn('Cloud sync after unlock failed:', error);
      }
    }
    window.navigateTo('dashboard');
  } else {
    showError(errorEl, '密码错误，请重试');
    shakeCard(container);
    container.querySelector('#masterPassword').value = '';
    container.querySelector('#masterPassword').focus();
  }
}

/** Show error message */
function showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

/** Hide error message */
function hideError(el) {
  el.style.display = 'none';
  el.textContent = '';
}

/** Trigger shake animation on the lock card */
function shakeCard(container) {
  const card = container.querySelector('.lock-card');
  card.classList.remove('shake');
  // Force reflow to restart animation
  void card.offsetWidth;
  card.classList.add('shake');
  card.addEventListener('animationend', () => {
    card.classList.remove('shake');
  }, { once: true });
}
