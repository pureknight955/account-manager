/**
 * crypto.js — AES-256-GCM encryption / decryption via Web Crypto API
 *
 * Encrypted payload layout (binary, then base64-encoded):
 *   [ 16-byte salt ][ 12-byte IV ][ ciphertext… ]
 */

// ---------------------------------------------------------------------------
// Helpers: ArrayBuffer ↔ Base64
// ---------------------------------------------------------------------------

/**
 * Convert an ArrayBuffer (or TypedArray) to a Base64 string.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {string}
 */
export function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert a Base64 string back to an ArrayBuffer.
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
export function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

const LEGACY_PBKDF2_ITERATIONS = 100_000;
const PBKDF2_ITERATIONS = 310_000;
const ENCRYPTION_PREFIX = 'ENC_V2:';
const PASSWORD_VERIFIER_VERSION = 2;
const SALT_LENGTH = 16; // bytes
const IV_LENGTH = 12;   // bytes — recommended for AES-GCM

/**
 * Derive an AES-256-GCM CryptoKey from a master password and salt using
 * PBKDF2 (100 000 iterations, SHA-256).
 *
 * @param {string} masterPassword
 * @param {Uint8Array} salt - 16-byte salt
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(masterPassword, salt, iterations = PBKDF2_ITERATIONS) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// Encrypt / Decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * A random 16-byte salt and 12-byte IV are generated per call and prepended
 * to the ciphertext. The whole blob is returned as a Base64 string.
 *
 * @param {string} plaintext
 * @param {string} masterPassword
 * @returns {Promise<string>} Base64-encoded salt + IV + ciphertext
 */
export async function encrypt(plaintext, masterPassword) {
  if (!crypto.subtle) {
    throw new Error('Web Crypto API is required to encrypt secure data.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv   = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key  = await deriveKey(masterPassword, salt);

  const encoder = new TextEncoder();
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );

  // Concatenate: salt ‖ iv ‖ ciphertext
  const cipherBytes = new Uint8Array(cipherBuffer);
  const payload = new Uint8Array(SALT_LENGTH + IV_LENGTH + cipherBytes.byteLength);
  payload.set(salt, 0);
  payload.set(iv, SALT_LENGTH);
  payload.set(cipherBytes, SALT_LENGTH + IV_LENGTH);

  return `${ENCRYPTION_PREFIX}${arrayBufferToBase64(payload)}`;
}

/**
 * Decrypt a Base64-encoded payload produced by {@link encrypt}.
 *
 * @param {string} encryptedBase64
 * @param {string} masterPassword
 * @returns {Promise<string>} The original plaintext
 * @throws {Error} If the password is wrong or the data is tampered with
 */
export async function decrypt(encryptedBase64, masterPassword) {
  if (!crypto.subtle) {
    throw new Error('Web Crypto API is required to decrypt secure data.');
  }

  // Keep reading legacy local data, but never create insecure payloads again.
  if (encryptedBase64.startsWith('INSECURE_BASE64:')) {
    return decodeURIComponent(atob(encryptedBase64.substring(16)));
  }

  const isV2 = encryptedBase64.startsWith(ENCRYPTION_PREFIX);
  const encodedPayload = isV2
    ? encryptedBase64.substring(ENCRYPTION_PREFIX.length)
    : encryptedBase64;
  const payload = new Uint8Array(base64ToArrayBuffer(encodedPayload));
  if (payload.byteLength <= SALT_LENGTH + IV_LENGTH) {
    throw new Error('Encrypted payload is invalid.');
  }

  const salt       = payload.slice(0, SALT_LENGTH);
  const iv         = payload.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = payload.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(
    masterPassword,
    salt,
    isV2 ? PBKDF2_ITERATIONS : LEGACY_PBKDF2_ITERATIONS,
  );

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plainBuffer);
}

// ---------------------------------------------------------------------------
// Password hashing (SHA-256, hex)
// ---------------------------------------------------------------------------

/**
 * Hash a password with SHA-256 and return the result as a hex string.
 *
 * @param {string} password
 * @returns {Promise<string>} Hex-encoded SHA-256 digest
 */
export async function hashPassword(password) {
  if (!crypto.subtle) {
    return btoa(encodeURIComponent(password));
  }

  const encoder = new TextEncoder();
  const digest  = await crypto.subtle.digest('SHA-256', encoder.encode(password));
  const bytes   = new Uint8Array(digest);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a salted, deliberately slow verifier for the lock-screen password.
 * The verifier proves that the password is correct without storing it.
 *
 * @param {string} password
 * @returns {Promise<{version:number, algorithm:string, iterations:number, salt:string, hash:string}>}
 */
export async function createPasswordVerifier(password) {
  if (!crypto.subtle) {
    throw new Error('Web Crypto API is required to protect the master password.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  return {
    version: PASSWORD_VERIFIER_VERSION,
    algorithm: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: arrayBufferToBase64(salt),
    hash: arrayBufferToBase64(bits),
  };
}

/**
 * Verify a password against a previously computed SHA-256 hex hash.
 *
 * @param {string} password
 * @param {string} hash - Expected hex hash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, verifier) {
  if (verifier && typeof verifier === 'object' && verifier.version === PASSWORD_VERIFIER_VERSION) {
    if (!crypto.subtle) return false;
    const salt = new Uint8Array(base64ToArrayBuffer(verifier.salt));
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: Number(verifier.iterations) || PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    );
    return constantTimeEqual(arrayBufferToBase64(bits), verifier.hash || '');
  }

  // Legacy unsalted SHA-256 verifier. A successful login migrates it to v2.
  const computed = await hashPassword(password);
  return constantTimeEqual(computed, String(verifier || ''));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i++) {
    result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return result === 0;
}
