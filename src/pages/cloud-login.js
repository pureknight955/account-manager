import { getSettings } from '../utils/storage.js';
import {
  friendlyCloudError,
  getCloudSession,
  isCloudConfigured,
  requestCloudPasswordReset,
  signInCloud,
  signUpCloud,
} from '../utils/cloud.js';

export function render(container) {
  const settings = getSettings();
  const hasLocalData = Boolean(settings.masterKeyVerifier || settings.masterKeyHash);

  if (getCloudSession()) {
    window.navigateTo('lock-screen');
    return;
  }

  container.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card card">
        <div class="auth-icon" aria-hidden="true">☁️</div>
        <h1 class="auth-title">账号管理器</h1>
        <p class="auth-subtitle">登录后在不同设备同步同一份加密数据</p>

        <form id="cloudLoginForm" class="auth-form" autocomplete="on">
          <div class="form-group">
            <label class="form-label" for="cloudEmail">邮箱</label>
            <input class="form-input" id="cloudEmail" type="email" required autocomplete="email" placeholder="输入云端登录邮箱" />
          </div>
          <div class="form-group">
            <label class="form-label" for="cloudPassword">云端密码</label>
            <input class="form-input" id="cloudPassword" type="password" minlength="6" required autocomplete="current-password" placeholder="至少 6 位" />
          </div>
          <div class="form-group" id="registrationCodeGroup" hidden>
            <label class="form-label" for="registrationCode">注册暗号</label>
            <input class="form-input" id="registrationCode" type="password" inputmode="numeric" autocomplete="off" placeholder="输入注册暗号" />
          </div>
          <div id="cloudLoginError" class="alert alert-danger" style="display:none;"></div>
          <div id="cloudLoginInfo" class="alert alert-info" style="display:none;"></div>
          <button type="submit" class="btn btn-primary auth-primary-btn" id="cloudSignInBtn">登录云端</button>
          <button type="button" class="btn btn-outline auth-secondary-btn" id="cloudSignUpBtn" aria-expanded="false">创建云端账号</button>
          <button type="button" class="auth-text-btn" id="forgotCloudPasswordBtn">忘记云端密码</button>
          ${hasLocalData ? '<button type="button" class="auth-text-btn" id="offlineModeBtn">暂时离线使用本机数据</button>' : ''}
        </form>
      </div>
      <p class="auth-footer">云端只保存由主密码加密后的数据，主密码不会上传</p>
    </div>
  `;

  bindEvents(container);
}

function bindEvents(container) {
  const form = container.querySelector('#cloudLoginForm');
  const signUpButton = container.querySelector('#cloudSignUpBtn');
  const registrationCodeGroup = container.querySelector('#registrationCodeGroup');
  const forgotPasswordButton = container.querySelector('#forgotCloudPasswordBtn');
  const offlineButton = container.querySelector('#offlineModeBtn');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleAuth(container, 'signin');
  });

  signUpButton.addEventListener('click', async () => {
    if (registrationCodeGroup.hidden) {
      registrationCodeGroup.hidden = false;
      signUpButton.setAttribute('aria-expanded', 'true');
      signUpButton.textContent = '使用暗号创建账号';
      container.querySelector('#registrationCode')?.focus();
      return;
    }
    await handleAuth(container, 'signup');
  });

  forgotPasswordButton.addEventListener('click', async () => {
    await handlePasswordResetRequest(container);
  });

  if (offlineButton) {
    offlineButton.addEventListener('click', () => {
      sessionStorage.setItem('acctmgrOfflineMode', '1');
      window.navigateTo('lock-screen');
    });
  }

  setTimeout(() => container.querySelector('#cloudEmail')?.focus(), 100);
}

async function handleAuth(container, mode) {
  const email = container.querySelector('#cloudEmail').value.trim();
  const password = container.querySelector('#cloudPassword').value;
  const registrationCode = container.querySelector('#registrationCode').value.trim();
  const errorEl = container.querySelector('#cloudLoginError');
  const infoEl = container.querySelector('#cloudLoginInfo');
  const buttons = container.querySelectorAll('button');

  hideMessage(errorEl);
  hideMessage(infoEl);

  if (!isCloudConfigured()) {
    showMessage(errorEl, '云端连接参数尚未配置。');
    return;
  }
  if (!email || password.length < 6) {
    showMessage(errorEl, '请输入有效邮箱和至少 6 位的云端密码。');
    return;
  }
  if (mode === 'signup' && !registrationCode) {
    showMessage(errorEl, '请输入注册暗号。');
    return;
  }

  buttons.forEach((button) => { button.disabled = true; });
  try {
    const result = mode === 'signup'
      ? await signUpCloud(email, password, registrationCode)
      : await signInCloud(email, password);

    if (result.session) {
      sessionStorage.removeItem('acctmgrOfflineMode');
      window.navigateTo('lock-screen');
      return;
    }

    showMessage(infoEl, '注册成功。请打开验证邮件完成确认，然后返回这里登录。');
  } catch (error) {
    showMessage(errorEl, friendlyCloudError(error));
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function handlePasswordResetRequest(container) {
  const email = container.querySelector('#cloudEmail').value.trim();
  const errorEl = container.querySelector('#cloudLoginError');
  const infoEl = container.querySelector('#cloudLoginInfo');
  const buttons = container.querySelectorAll('button');

  hideMessage(errorEl);
  hideMessage(infoEl);
  if (!email) {
    showMessage(errorEl, '请先输入需要找回密码的云端邮箱。');
    container.querySelector('#cloudEmail')?.focus();
    return;
  }

  buttons.forEach((button) => { button.disabled = true; });
  try {
    await requestCloudPasswordReset(email);
    showMessage(infoEl, '恢复邮件已发送。请打开邮件中的链接设置新的云端密码。');
  } catch (error) {
    showMessage(errorEl, friendlyCloudError(error));
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function showMessage(element, message) {
  element.textContent = message;
  element.style.display = 'block';
}

function hideMessage(element) {
  element.textContent = '';
  element.style.display = 'none';
}
