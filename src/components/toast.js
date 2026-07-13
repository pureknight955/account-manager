/**
 * toast.js - Toast notification component
 *
 * Shows brief messages at the top of the screen.
 * Auto-dismisses after 3 seconds. Multiple toasts stack.
 */

const ICONS = {
  success: '✅',
  error:   '❌',
  warning: '⚠️',
  info:    'ℹ️',
};

const DURATION_MS = 3000;
const FADE_MS = 300;

/** @type {HTMLElement|null} */
let container = null;

/**
 * Ensure the toast container exists in the DOM.
 * @returns {HTMLElement}
 */
function getContainer() {
  if (container && document.body.contains(container)) return container;

  container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

/**
 * Show a toast notification.
 * @param {string} message - Message text to display.
 * @param {'success'|'error'|'warning'|'info'} [type='info'] - Toast type.
 */
export function showToast(message, type = 'info') {
  const wrapper = getContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = ICONS[type] || ICONS.info;

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => dismissToast(toast));

  toast.appendChild(icon);
  toast.appendChild(text);
  toast.appendChild(closeBtn);

  wrapper.appendChild(toast);

  // Trigger reflow then add visible class for slide-down animation
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  // Auto-dismiss
  setTimeout(() => dismissToast(toast), DURATION_MS);
}

/**
 * Dismiss a toast element with fade-out animation.
 * @param {HTMLElement} toast
 */
function dismissToast(toast) {
  if (!toast || !toast.parentNode) return;

  toast.classList.remove('toast-visible');
  toast.classList.add('toast-hiding');

  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, FADE_MS);
}
