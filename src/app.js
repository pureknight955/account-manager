// 路由与页面切换管理
import { render as renderLockScreen } from './pages/lock-screen.js';
import { render as renderCloudLogin } from './pages/cloud-login.js';
import { render as renderDashboard } from './pages/dashboard.js';
import { render as renderAccounts } from './pages/accounts.js';
import { render as renderAccountDetail } from './pages/account-detail.js';
import { render as renderFinance } from './pages/finance.js';
import { render as renderWallet } from './pages/wallet.js';
import { render as renderSettings } from './pages/settings.js';
import { createNavbar, setActiveTab } from './components/navbar.js';
import { getSettings, autoGenerateBillingRecords } from './utils/storage.js';
import {
  getCloudSession,
  initializeCloud,
  isCloudConfigured,
} from './utils/cloud.js';

// 页面注册表
const pages = {
  'cloud-login': { render: renderCloudLogin, showNav: false },
  'lock-screen': { render: renderLockScreen, showNav: false },
  'dashboard': { render: renderDashboard, showNav: true, tab: 'dashboard' },
  'accounts': { render: renderAccounts, showNav: true, tab: 'accounts' },
  'account-detail': { render: renderAccountDetail, showNav: false },
  'wallet': { render: renderWallet, showNav: true, tab: 'wallet' },
  'finance': { render: renderFinance, showNav: true, tab: 'finance' },
  'settings': { render: renderSettings, showNav: true, tab: 'settings' },
};

let currentPage = null;
let navbar = null;
let appContainer = null;
let pageContainer = null;
let autoLockTimer = null;
let activityListenersBound = false;

/**
 * 初始化应用
 */
export async function initApp() {
  appContainer = document.getElementById('app');
  
  // 创建页面容器
  pageContainer = document.createElement('div');
  pageContainer.className = 'page-container';
  appContainer.appendChild(pageContainer);

  // 创建底部导航栏
  navbar = createNavbar((tabId) => {
    navigateTo(tabId);
  });
  appContainer.appendChild(navbar);

  // 初始化主题
  applyTheme();

  // 暴露全局导航函数
  window.navigateTo = navigateTo;
  window.lockApp = lockApp;
  bindAutoLockEvents();

  try {
    await initializeCloud();
  } catch (error) {
    console.error('Cloud initialization failed:', error);
  }

  // 检查是否已解锁
  const masterPassword = sessionStorage.getItem('masterPassword');
  const cloudRequired = isCloudConfigured()
    && !getCloudSession()
    && sessionStorage.getItem('acctmgrOfflineMode') !== '1';
  if (cloudRequired) {
    navigateTo('cloud-login');
  } else if (masterPassword) {
    navigateTo('dashboard');
  } else {
    navigateTo('lock-screen');
  }
}

/**
 * 导航到指定页面
 */
export function navigateTo(pageName, params = {}) {
  const page = pages[pageName];
  if (!page) {
    console.error(`Page not found: ${pageName}`);
    return;
  }

  const isPublicPage = pageName === 'lock-screen' || pageName === 'cloud-login';
  const cloudRequired = isCloudConfigured()
    && !getCloudSession()
    && sessionStorage.getItem('acctmgrOfflineMode') !== '1';

  if (!isPublicPage && cloudRequired) {
    navigateTo('cloud-login');
    return;
  }

  // 需要密码保护的页面检查
  if (!isPublicPage && !sessionStorage.getItem('masterPassword')) {
    navigateTo('lock-screen');
    return;
  }

  if (!isPublicPage) {
    // Idempotent refresh: missing cycles are created once, manual edits remain intact.
    autoGenerateBillingRecords();
    resetAutoLockTimer();
  }

  // 页面切换动画
  pageContainer.classList.add('page-exit');
  
  // 短暂延迟后切换内容
  setTimeout(() => {
    // 清空页面容器
    pageContainer.innerHTML = '';
    pageContainer.classList.remove('page-exit');
    pageContainer.classList.add('page-enter');

    // 渲染新页面
    currentPage = pageName;
    page.render(pageContainer, params);

    // 控制导航栏显示
    if (page.showNav) {
      navbar.classList.remove('hidden');
      pageContainer.classList.remove('no-nav');
      if (page.tab) {
        setActiveTab(page.tab);
      }
    } else {
      navbar.classList.add('hidden');
      pageContainer.classList.add('no-nav');
    }

    // 滚动到顶部
    window.scrollTo(0, 0);

    // 移除进入动画类
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pageContainer.classList.remove('page-enter');
      });
    });
  }, 150);
}

/**
 * 应用主题设置
 */
export function applyTheme(theme) {
  if (!theme) {
    const settings = getSettings();
    theme = settings.theme || 'auto';
  }

  const html = document.documentElement;

  if (theme === 'auto') {
    html.removeAttribute('data-theme');
    // 让 CSS 的 prefers-color-scheme 媒体查询接管
  } else {
    html.setAttribute('data-theme', theme);
  }
}

/**
 * 获取当前页面名称
 */
export function getCurrentPage() {
  return currentPage;
}

export function lockApp() {
  sessionStorage.removeItem('masterPassword');
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = null;
  if (currentPage !== 'lock-screen') navigateTo('lock-screen');
}

function bindAutoLockEvents() {
  if (activityListenersBound) return;
  activityListenersBound = true;

  ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
    document.addEventListener(eventName, resetAutoLockTimer, { passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resetAutoLockTimer();
  });
  document.addEventListener('acctmgr:auto-lock-updated', resetAutoLockTimer);
}

function resetAutoLockTimer() {
  if (!sessionStorage.getItem('masterPassword')) return;
  if (autoLockTimer) clearTimeout(autoLockTimer);

  const minutes = Number(getSettings().autoLockMinutes);
  const safeMinutes = Number.isFinite(minutes) && minutes >= 1 ? minutes : 30;
  autoLockTimer = setTimeout(lockApp, safeMinutes * 60 * 1000);
}
