/**
 * modal.js - Full-screen modal / bottom drawer component
 *
 * Slides up from bottom on mobile. Only one modal open at a time.
 * Click overlay or X button to close.
 */

/** @type {HTMLElement|null} */
let currentModal = null;

/** @type {Function|null} */
let currentOnClose = null;

/**
 * Open a modal with the given title and content.
 * @param {string} title - Modal header title.
 * @param {HTMLElement} contentElement - DOM element to place inside the body.
 * @param {Object} [options]
 * @param {Function} [options.onClose] - Called when modal is closed.
 * @param {boolean} [options.showFooter] - Whether to render a footer area.
 * @param {Array<{label: string, className?: string, onClick: Function}>} [options.footerButtons] - Footer buttons.
 * @returns {HTMLElement} The modal element.
 */
export function openModal(title, contentElement, options = {}) {
  // Close any existing modal first
  if (currentModal) {
    removeModalImmediate();
  }

  currentOnClose = options.onClose || null;

  // Overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  // Container
  const container = document.createElement('div');
  container.className = 'modal-container';

  // Header
  const header = document.createElement('div');
  header.className = 'modal-header';

  const titleEl = document.createElement('h2');
  titleEl.className = 'modal-title';
  titleEl.textContent = title;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close-btn';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.addEventListener('click', closeModal);

  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement('div');
  body.className = 'modal-body';
  if (contentElement) {
    body.appendChild(contentElement);
  }

  // Assemble container
  container.appendChild(header);
  container.appendChild(body);

  // Optional footer
  if (options.showFooter && Array.isArray(options.footerButtons) && options.footerButtons.length > 0) {
    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    options.footerButtons.forEach((btnDef) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = btnDef.className || 'btn';
      btn.textContent = btnDef.label;
      btn.addEventListener('click', () => {
        if (typeof btnDef.onClick === 'function') {
          btnDef.onClick();
        }
      });
      footer.appendChild(btn);
    });

    container.appendChild(footer);
  }

  overlay.appendChild(container);

  // Click overlay background to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });

  // Escape key to close
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // Prevent body scroll while modal is open
  document.body.classList.add('modal-open');
  document.body.appendChild(overlay);

  currentModal = overlay;

  // Trigger slide-up animation
  requestAnimationFrame(() => {
    overlay.classList.add('modal-visible');
  });

  return overlay;
}

/**
 * Close the current modal with slide-down animation.
 */
export function closeModal() {
  if (!currentModal) return;

  const modal = currentModal;
  const onClose = currentOnClose;

  modal.classList.remove('modal-visible');
  modal.classList.add('modal-hiding');

  setTimeout(() => {
    if (modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
    document.body.classList.remove('modal-open');

    if (typeof onClose === 'function') {
      onClose();
    }
  }, 300);

  currentModal = null;
  currentOnClose = null;
}

/**
 * Remove current modal immediately without animation.
 */
function removeModalImmediate() {
  if (!currentModal) return;
  if (currentModal.parentNode) {
    currentModal.parentNode.removeChild(currentModal);
  }
  document.body.classList.remove('modal-open');
  currentModal = null;
  currentOnClose = null;
}
