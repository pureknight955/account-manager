// 账号列表页
import { getAccounts, reorderAccount } from '../utils/storage.js';
import { ACCOUNT_TYPES } from '../config.js';
import { createAccountCard } from '../components/account-card.js';

/**
 * Render the accounts list page.
 * @param {HTMLElement} container
 * @param {object} [params]
 */
export function render(container, params = {}) {
  const initialTab = params.tab || 'gpt';

  container.innerHTML = `
    <div class="page-header" style="display: flex; justify-content: space-between; align-items: center;">
      <h1 style="margin: 0;">账号管理</h1>
      <button class="btn btn-ghost btn-icon" id="layoutToggleBtn" title="切换布局" style="padding: 0.5rem; border-radius: 50%; display: flex; align-items: center; justify-content: center;"></button>
    </div>

    <!-- Sub-tab bar -->
    <div class="tab-bar" id="accountTabs">
      ${ACCOUNT_TYPES.map(
        (t) => `
        <button
          class="tab-item ${t.value === initialTab ? 'tab-active' : ''}"
          data-tab="${t.value}"
        >${t.icon} ${t.label}</button>`
      ).join('')}
    </div>

    <!-- Search + Filter -->
    <div class="accounts-toolbar">
      <div class="search-bar">
        <input
          type="text"
          class="form-input"
          id="accountSearch"
          placeholder="搜索昵称或邮箱…"
        />
      </div>
      <div class="filter-chips" id="filterChips">
        <button class="chip chip-active" data-filter="all">全部</button>
        <button class="chip" data-filter="active">正常</button>
        <button class="chip" data-filter="banned">封禁</button>
      </div>
    </div>

    <!-- Account list -->
    <div id="accountList" class="account-list"></div>

    <!-- FAB -->
    <button class="fab" id="fabAdd" title="添加账号">+</button>
  `;

  // State
  const state = {
    currentTab: initialTab,
    searchQuery: '',
    statusFilter: 'all',
  };

  renderAccountList(container, state);
  bindAccountEvents(container, state);
}

/**
 * Render the filtered account list into #accountList
 */
function renderAccountList(container, state) {
  const listEl = container.querySelector('#accountList');
  const allAccounts = getAccounts();

  // Filter by type
  let filtered = allAccounts.filter((a) => a.type === state.currentTab);

  // Filter by status
  if (state.statusFilter !== 'all') {
    filtered = filtered.filter((a) => a.status === state.statusFilter);
  }

  // Filter by search
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (a) =>
        (a.nickname && a.nickname.toLowerCase().includes(q)) ||
        (a.email && a.email.toLowerCase().includes(q))
    );
  }

  if (filtered.length === 0) {
    const typeLabel =
      ACCOUNT_TYPES.find((t) => t.value === state.currentTab)?.label || '';
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p>暂无${typeLabel}账号</p>
        <button class="btn btn-primary btn-sm" id="emptyAddBtn">添加账号</button>
      </div>
    `;
    const emptyBtn = listEl.querySelector('#emptyAddBtn');
    if (emptyBtn) {
      emptyBtn.addEventListener('click', () => {
        window.navigateTo('account-detail', { type: state.currentTab, isNew: true });
      });
    }
    return;
  }

  listEl.innerHTML = '';
  filtered.forEach((acct, idx) => {
    const card = createAccountCard(acct, (a) => {
      window.navigateTo('account-detail', { id: a.id });
    });
    
    // Add Context Menu for Reordering
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      
      // Remove any existing menus
      document.querySelectorAll('.acct-context-menu').forEach(m => m.remove());
      
      const menu = document.createElement('div');
      menu.className = 'card acct-context-menu';
      menu.style.position = 'fixed';
      menu.style.left = `${e.clientX}px`;
      menu.style.top = `${e.clientY}px`;
      menu.style.zIndex = '9999';
      menu.style.padding = '0.5rem';
      menu.style.display = 'flex';
      menu.style.flexDirection = 'column';
      menu.style.gap = '0.25rem';
      menu.style.minWidth = '120px';
      
      if (idx > 0) {
        const upBtn = document.createElement('button');
        upBtn.className = 'btn btn-ghost btn-sm';
        upBtn.textContent = '⬆️ 上移 (Move Up)';
        upBtn.onclick = (ev) => {
          ev.stopPropagation();
          reorderAccount(acct.id, -1, state.currentTab);
          menu.remove();
          renderAccountList(container, state);
        };
        menu.appendChild(upBtn);
      }
      
      if (idx < filtered.length - 1) {
        const downBtn = document.createElement('button');
        downBtn.className = 'btn btn-ghost btn-sm';
        downBtn.textContent = '⬇️ 下移 (Move Down)';
        downBtn.onclick = (ev) => {
          ev.stopPropagation();
          reorderAccount(acct.id, 1, state.currentTab);
          menu.remove();
          renderAccountList(container, state);
        };
        menu.appendChild(downBtn);
      }
      
      if (menu.children.length > 0) {
        document.body.appendChild(menu);
        
        // Close menu when clicking outside
        setTimeout(() => {
          const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
            document.removeEventListener('contextmenu', closeMenu);
          };
          document.addEventListener('click', closeMenu);
          document.addEventListener('contextmenu', closeMenu);
        }, 10);
      }
    });

    listEl.appendChild(card);
  });
}



/**
 * Bind tab, search, filter, and FAB events
 */
function bindAccountEvents(container, state) {
  // Layout Toggle
  const layoutToggleBtn = container.querySelector('#layoutToggleBtn');
  const accountList = container.querySelector('#accountList');

  function applyLayout() {
    const layout = localStorage.getItem('acctmgr_layout') || 'list';
    if (layout === 'grid') {
      accountList.classList.add('layout-grid');
      layoutToggleBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"></line>
          <line x1="8" y1="12" x2="21" y2="12"></line>
          <line x1="8" y1="18" x2="21" y2="18"></line>
          <line x1="3" y1="6" x2="3.01" y2="6"></line>
          <line x1="3" y1="12" x2="3.01" y2="12"></line>
          <line x1="3" y1="18" x2="3.01" y2="18"></line>
        </svg>
      `;
      layoutToggleBtn.title = '切换为单列展示';
    } else {
      accountList.classList.remove('layout-grid');
      layoutToggleBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
      `;
      layoutToggleBtn.title = '切换为双列展示';
    }
  }

  // Initial layout apply
  applyLayout();

  layoutToggleBtn.addEventListener('click', () => {
    const current = localStorage.getItem('acctmgr_layout') || 'list';
    localStorage.setItem('acctmgr_layout', current === 'list' ? 'grid' : 'list');
    applyLayout();
  });

  // Tab switching
  container.querySelectorAll('#accountTabs .tab-item').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('#accountTabs .tab-item').forEach((t) =>
        t.classList.remove('tab-active')
      );
      tab.classList.add('tab-active');
      state.currentTab = tab.dataset.tab;
      renderAccountList(container, state);
    });
  });

  // Search
  const searchInput = container.querySelector('#accountSearch');
  let debounceTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.searchQuery = searchInput.value.trim();
      renderAccountList(container, state);
    }, 200);
  });

  // Filter chips
  container.querySelectorAll('#filterChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('#filterChips .chip').forEach((c) =>
        c.classList.remove('chip-active')
      );
      chip.classList.add('chip-active');
      state.statusFilter = chip.dataset.filter;
      renderAccountList(container, state);
    });
  });

  // FAB
  container.querySelector('#fabAdd').addEventListener('click', () => {
    window.navigateTo('account-detail', { type: state.currentTab, isNew: true });
  });
}

/** Escape HTML */
function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
