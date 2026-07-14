import {
  cancelCloudPasswordRecovery,
  friendlyCloudError,
  getCloudSession,
  updateCloudPassword,
} from '../utils/cloud.js';

export function render(container) {
  const hasRecoverySession = Boolean(getCloudSession());

  container.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card card">
        <div class="auth-icon" aria-hidden="true">🔑</div>
        <h1 class="auth-title">重设云端密码</h1>
        <p class="auth-subtitle">${hasRecoverySession
          ? '设置新的云端登录密码，不会修改主密码或加密数据'
          : '恢复链接无效或已过期，请返回登录页重新发送邮件'}</p>

        ${hasRecoverySession ? `
          <form id="cloudPasswordResetForm" class="auth-form" autocomplete="off">
            <div class="form-group">
              <label class="form-label" for="newCloudPassword">新云端密码</label>
              <input class="form-input" id="newCloudPassword" type="password" minlength="6" required autocomplete="new-password" placeholder="至少 6 位" />
            </div>
            <div class="form-group">
              <label class="form-label" for="confirmCloudPassword">确认新密码</label>
              <input class="form-input" id="confirmCloudPassword" type="password" minlength="6" required autocomplete="new-password" placeholder="再次输入新密码" />
            </div>
            <div id="cloudPasswordResetError" class="alert alert-danger" style="display:none;"></div>
            <button type="submit" class="btn btn-primary auth-primary-btn">保存新密码</button>
          </form>
        ` : `
          <button type="button" class="btn btn-primary auth-primary-btn" id="returnCloudLoginBtn">返回云端登录</button>
        `}
      </div>
      <p class="auth-footer">主密码是云端密文的解密密钥，无法通过邮箱重置</p>
    </div>
  `;

  if (!hasRecoverySession) {
    container.querySelector('#returnCloudLoginBtn').addEventListener('click', () => {
      cancelCloudPasswordRecovery();
      window.navigateTo('cloud-login');
    });
    return;
  }

  bindResetForm(container);
}

function bindResetForm(container) {
  const form = container.querySelector('#cloudPasswordResetForm');
  const errorEl = container.querySelector('#cloudPasswordResetError');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const newPassword = container.querySelector('#newCloudPassword').value;
    const confirmPassword = container.querySelector('#confirmCloudPassword').value;
    errorEl.style.display = 'none';

    if (newPassword.length < 6) {
      showError(errorEl, '云端密码长度至少为 6 位。');
      return;
    }
    if (newPassword !== confirmPassword) {
      showError(errorEl, '两次输入的密码不一致。');
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = '保存中...';
    try {
      await updateCloudPassword(newPassword);
      sessionStorage.removeItem('acctmgrOfflineMode');
      window.navigateTo('lock-screen');
    } catch (error) {
      showError(errorEl, friendlyCloudError(error));
      button.disabled = false;
      button.textContent = '保存新密码';
    }
  });

  setTimeout(() => container.querySelector('#newCloudPassword')?.focus(), 100);
}

function showError(element, message) {
  element.textContent = message;
  element.style.display = 'block';
}
