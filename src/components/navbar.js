/**
 * navbar.js - Bottom navigation bar component
 *
 * Fixed bottom nav with four tabs: 首页, 账号, 财务, 设置.
 * Active tab is highlighted. onNavigate callback fires on tap.
 */

const tabs = [
  { id: 'dashboard', icon: '🏠', label: '首页' },
  { id: 'accounts', icon: '📋', label: '账号' },
  { id: 'wallet', icon: '💳', label: '卡包' },
  { id: 'finance',  icon: '💹', label: '财务' },
  { id: 'settings', icon: '⚙️', label: '设置' },
];

/** @type {HTMLElement|null} */
let navbarEl = null;

/**
 * Create the bottom navigation bar.
 * @param {(tabId: string) => void} onNavigate - Called with the tab id when user taps a tab.
 * @returns {HTMLElement} The navbar DOM element.
 */
export function createNavbar(onNavigate) {
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';

  tabs.forEach((tab) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'bottom-nav-item';
    item.dataset.tab = tab.id;

    const icon = document.createElement('span');
    icon.className = 'bottom-nav-icon';
    icon.textContent = tab.icon;

    const label = document.createElement('span');
    label.className = 'bottom-nav-label';
    label.textContent = tab.label;

    item.appendChild(icon);
    item.appendChild(label);

    item.addEventListener('click', () => {
      setActiveTab(tab.id);
      if (typeof onNavigate === 'function') {
        onNavigate(tab.id);
      }
    });

    nav.appendChild(item);
  });

  // Default: first tab active
  navbarEl = nav;
  setActiveTab(tabs[0].id);

  return nav;
}

/**
 * Update the visual active state of the navbar.
 * @param {string} tabId - The tab id to make active.
 */
export function setActiveTab(tabId) {
  if (!navbarEl) return;

  const items = navbarEl.querySelectorAll('.bottom-nav-item');
  items.forEach((item) => {
    if (item.dataset.tab === tabId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}
