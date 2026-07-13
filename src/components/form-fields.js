/**
 * form-fields.js - Reusable form field generators
 *
 * Each function returns a div.form-group containing a label and an input element.
 * Every onChange callback receives the new value as its argument.
 */

/**
 * Create a wrapper div.form-group with a label element.
 * @param {string} labelText
 * @param {string} [inputId]
 * @returns {{ group: HTMLElement, label: HTMLElement }}
 */
function createGroup(labelText, inputId) {
  const group = document.createElement('div');
  group.className = 'form-group';

  const label = document.createElement('label');
  label.className = 'form-label';
  label.textContent = labelText;
  if (inputId) {
    label.setAttribute('for', inputId);
  }

  group.appendChild(label);
  return { group, label };
}

/** Generate a simple unique id for inputs. */
let fieldCounter = 0;
function uid(prefix = 'field') {
  return `${prefix}-${++fieldCounter}`;
}

/**
 * Text input field.
 * @param {string} label
 * @param {string} value
 * @param {(val: string) => void} onChange
 * @param {Object} [options]
 * @param {string} [options.placeholder]
 * @param {boolean} [options.required]
 * @param {boolean} [options.readonly]
 * @returns {HTMLElement}
 */
export function createTextField(label, value, onChange, options = {}) {
  const id = uid('text');
  const { group } = createGroup(label, id);

  const input = document.createElement('input');
  input.type = 'text';
  input.id = id;
  input.className = 'form-input';
  input.value = value ?? '';

  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.required) input.required = true;
  if (options.readonly) input.readOnly = true;

  input.addEventListener('input', () => {
    if (typeof onChange === 'function') onChange(input.value);
  });

  group.appendChild(input);
  return group;
}

/**
 * Password input field with show/hide toggle button.
 * @param {string} label
 * @param {string} value
 * @param {(val: string) => void} onChange
 * @returns {HTMLElement}
 */
export function createPasswordField(label, value, onChange) {
  const id = uid('pwd');
  const { group } = createGroup(label, id);

  const wrapper = document.createElement('div');
  wrapper.className = 'form-input-wrapper';

  const input = document.createElement('input');
  input.type = 'password';
  input.id = id;
  input.className = 'form-input';
  input.value = value ?? '';

  input.addEventListener('input', () => {
    if (typeof onChange === 'function') onChange(input.value);
  });

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'form-toggle-btn';
  toggleBtn.textContent = '👁';
  toggleBtn.setAttribute('aria-label', '显示/隐藏密码');

  toggleBtn.addEventListener('click', () => {
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    toggleBtn.textContent = isHidden ? '👁‍🗨' : '👁';
  });

  wrapper.appendChild(input);
  wrapper.appendChild(toggleBtn);
  group.appendChild(wrapper);

  return group;
}

/**
 * Select dropdown field.
 * @param {string} label
 * @param {Array<{value: string, label: string}>} options - Dropdown options.
 * @param {string} value - Currently selected value.
 * @param {(val: string) => void} onChange
 * @returns {HTMLElement}
 */
export function createSelectField(label, options, value, onChange) {
  const id = uid('sel');
  const { group } = createGroup(label, id);

  const select = document.createElement('select');
  select.id = id;
  select.className = 'form-select';

  options.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === value) option.selected = true;
    select.appendChild(option);
  });

  select.addEventListener('change', () => {
    if (typeof onChange === 'function') onChange(select.value);
  });

  group.appendChild(select);
  return group;
}

/**
 * Date input field.
 * @param {string} label
 * @param {string} value - ISO date string (YYYY-MM-DD).
 * @param {(val: string) => void} onChange
 * @param {Object} [options]
 * @param {string} [options.min]
 * @param {string} [options.max]
 * @returns {HTMLElement}
 */
export function createDateField(label, value, onChange, options = {}) {
  const id = uid('date');
  const { group } = createGroup(label, id);

  const input = document.createElement('input');
  input.type = 'date';
  input.id = id;
  input.className = 'form-input';
  input.value = value ?? '';

  if (options.min) input.min = options.min;
  if (options.max) input.max = options.max;

  input.addEventListener('change', () => {
    if (typeof onChange === 'function') onChange(input.value);
  });

  group.appendChild(input);
  return group;
}

/**
 * Number input field with optional prefix (e.g. ¥) and suffix.
 * @param {string} label
 * @param {number|string} value
 * @param {(val: string) => void} onChange
 * @param {Object} [options]
 * @param {string} [options.prefix] - Text shown before input (e.g. '¥')
 * @param {string} [options.suffix] - Text shown after input
 * @param {number} [options.min]
 * @param {number|string} [options.step]
 * @returns {HTMLElement}
 */
export function createNumberField(label, value, onChange, options = {}) {
  const id = uid('num');
  const { group } = createGroup(label, id);

  const wrapper = document.createElement('div');
  wrapper.className = 'form-input-wrapper';

  if (options.prefix) {
    const prefix = document.createElement('span');
    prefix.className = 'form-input-prefix';
    prefix.textContent = options.prefix;
    wrapper.appendChild(prefix);
  }

  const input = document.createElement('input');
  input.type = 'number';
  input.id = id;
  input.className = 'form-input';
  input.value = value ?? '';

  if (options.min !== undefined) input.min = options.min;
  if (options.step !== undefined) input.step = options.step;

  input.addEventListener('input', () => {
    if (typeof onChange === 'function') onChange(input.value);
  });

  wrapper.appendChild(input);

  if (options.suffix) {
    const suffix = document.createElement('span');
    suffix.className = 'form-input-suffix';
    suffix.textContent = options.suffix;
    wrapper.appendChild(suffix);
  }

  group.appendChild(wrapper);
  return group;
}

/**
 * Textarea field.
 * @param {string} label
 * @param {string} value
 * @param {(val: string) => void} onChange
 * @param {Object} [options]
 * @param {string} [options.placeholder]
 * @param {number} [options.rows]
 * @returns {HTMLElement}
 */
export function createTextareaField(label, value, onChange, options = {}) {
  const id = uid('ta');
  const { group } = createGroup(label, id);

  const textarea = document.createElement('textarea');
  textarea.id = id;
  textarea.className = 'form-input form-textarea';
  textarea.value = value ?? '';
  textarea.rows = options.rows || 3;

  if (options.placeholder) textarea.placeholder = options.placeholder;

  textarea.addEventListener('input', () => {
    if (typeof onChange === 'function') onChange(textarea.value);
  });

  group.appendChild(textarea);
  return group;
}
