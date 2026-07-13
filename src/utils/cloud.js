import { createClient } from '@supabase/supabase-js';
import { decrypt, encrypt } from './crypto.js';
import { exportAllData, getSettings, importAllData } from './storage.js';
import { CloudConflictError, resolveSyncAction } from './cloud-vault.js';

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const LOCAL_REVISION_KEY = 'acctmgr_cloud_revision';
const DIRTY_KEY = 'acctmgr_cloud_dirty';
const LAST_SYNC_KEY = 'acctmgr_cloud_last_sync';
const SYNC_DELAY_MS = 1200;

let client = null;
let session = null;
let remoteVault = null;
let initialized = false;
let listenersBound = false;
let syncTimer = null;
let syncInFlight = null;
let lastError = '';

export function isCloudConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export async function initializeCloud() {
  if (initialized || !isCloudConfigured()) return getCloudStatus();

  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  session = data.session;
  initialized = true;
  bindListeners();

  if (session) {
    try {
      await refreshRemoteVault();
      lastError = '';
    } catch (error) {
      lastError = friendlyCloudError(error);
    }
  }

  client.auth.onAuthStateChange((_event, nextSession) => {
    session = nextSession;
    if (!session) remoteVault = null;
    dispatchStatus();
  });

  return getCloudStatus();
}

export function getCloudSession() {
  return session;
}

export function getCloudStatus() {
  return {
    configured: isCloudConfigured(),
    signedIn: Boolean(session),
    email: session?.user?.email || '',
    remoteRevision: remoteVault?.revision ?? null,
    localRevision: getLocalRevision(),
    dirty: isDirty(),
    lastSyncedAt: getLocalValue(LAST_SYNC_KEY),
    lastError,
  };
}

export function hasRemoteVault() {
  return Boolean(remoteVault);
}

export function remoteNeedsRestore() {
  if (!remoteVault) return false;
  const action = getCurrentAction();
  return action === 'download' || action === 'conflict';
}

export async function signInCloud(email, password) {
  ensureClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  session = data.session;
  await refreshRemoteVault();
  lastError = '';
  dispatchStatus();
  return data;
}

export async function signUpCloud(email, password) {
  ensureClient();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  session = data.session;
  if (session) await refreshRemoteVault();
  dispatchStatus();
  return data;
}

export async function signOutCloud() {
  ensureClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  session = null;
  remoteVault = null;
  clearSyncMetadata();
  dispatchStatus();
}

export function resetLocalCloudState() {
  clearSyncMetadata();
  dispatchStatus();
}

export async function refreshRemoteVault() {
  ensureSignedIn();
  const { data, error } = await client
    .from('user_vaults')
    .select('user_id,ciphertext,revision,schema_version,updated_at')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) throw error;
  remoteVault = data || null;
  dispatchStatus();
  return remoteVault;
}

export async function unlockAndSync(masterPassword) {
  if (!session) return { action: 'offline' };
  await refreshRemoteVault();
  const action = getCurrentAction();

  if (action === 'conflict') {
    throw new CloudConflictError();
  }
  if (action === 'download') {
    return restoreRemoteVault(masterPassword);
  }
  if (action === 'create' || action === 'upload') {
    return syncNow(masterPassword);
  }
  return { action: 'none', revision: getLocalRevision() };
}

export async function restoreRemoteVault(masterPassword) {
  ensureSignedIn();
  if (!remoteVault) await refreshRemoteVault();
  if (!remoteVault) return { action: 'none' };

  const plaintext = await decrypt(remoteVault.ciphertext, masterPassword);
  const backup = JSON.parse(plaintext);
  const imported = importAllData(backup, { notify: false });
  if (!imported) throw new Error('云端数据格式无效。');

  setLocalRevision(remoteVault.revision);
  setDirty(false);
  setLocalValue(LAST_SYNC_KEY, new Date().toISOString());
  lastError = '';
  dispatchStatus();
  return { action: 'download', revision: remoteVault.revision };
}

export async function syncNow(masterPassword = sessionStorage.getItem('masterPassword')) {
  if (!session) throw new Error('请先登录云端账号。');
  if (!masterPassword) throw new Error('请先输入主密码解锁。');
  if (syncInFlight) return syncInFlight;

  syncInFlight = performSync(masterPassword).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function performSync(masterPassword) {
  await refreshRemoteVault();
  const action = getCurrentAction();
  if (action === 'download' || action === 'conflict') {
    throw new CloudConflictError();
  }
  if (action === 'none' && remoteVault) {
    return { action: 'none', revision: remoteVault.revision };
  }

  const ciphertext = await encrypt(JSON.stringify(exportAllData()), masterPassword);
  let saved;

  if (!remoteVault) {
    const { data, error } = await client
      .from('user_vaults')
      .insert({
        user_id: session.user.id,
        ciphertext,
        revision: 1,
        schema_version: 1,
      })
      .select('user_id,ciphertext,revision,schema_version,updated_at')
      .single();
    if (error) throw error;
    saved = data;
  } else {
    const expectedRevision = getLocalRevision();
    const nextRevision = expectedRevision + 1;
    const { data, error } = await client
      .from('user_vaults')
      .update({
        ciphertext,
        revision: nextRevision,
        schema_version: 1,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', session.user.id)
      .eq('revision', expectedRevision)
      .select('user_id,ciphertext,revision,schema_version,updated_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new CloudConflictError('云端版本已变化，请重新载入后再修改。');
    saved = data;
  }

  remoteVault = saved;
  setLocalRevision(saved.revision);
  setDirty(false);
  setLocalValue(LAST_SYNC_KEY, new Date().toISOString());
  lastError = '';
  dispatchStatus();
  return { action: remoteVault.revision === 1 ? 'create' : 'upload', revision: saved.revision };
}

function getCurrentAction() {
  return resolveSyncAction({
    remoteRevision: remoteVault?.revision ?? null,
    localRevision: getLocalRevision(),
    dirty: isDirty(),
    hasLocalData: hasMeaningfulLocalData(),
  });
}

function hasMeaningfulLocalData() {
  const data = exportAllData();
  return Boolean(
    data.accounts.length
    || data.teamMembers.length
    || data.cards.length
    || data.topUpRecords.length
    || data.billingRecords.length
    || data.incomeRecords.length
    || getSettings().masterKeyVerifier
    || getSettings().masterKeyHash
  );
}

function bindListeners() {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;

  window.addEventListener('acctmgr:data-changed', () => {
    if (!session) return;
    setDirty(true);
    scheduleSync();
  });
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    const masterPassword = sessionStorage.getItem('masterPassword');
    if (!masterPassword || !session) return;
    try {
      await syncNow(masterPassword);
    } catch (error) {
      lastError = friendlyCloudError(error);
      dispatchStatus();
    }
  }, SYNC_DELAY_MS);
}

function getLocalRevision() {
  return Math.max(0, Number(getLocalValue(LOCAL_REVISION_KEY)) || 0);
}

function setLocalRevision(revision) {
  setLocalValue(LOCAL_REVISION_KEY, String(Math.max(0, Number(revision) || 0)));
}

function isDirty() {
  return getLocalValue(DIRTY_KEY) === '1';
}

function setDirty(value) {
  setLocalValue(DIRTY_KEY, value ? '1' : '0');
}

function clearSyncMetadata() {
  removeLocalValue(LOCAL_REVISION_KEY);
  removeLocalValue(DIRTY_KEY);
  removeLocalValue(LAST_SYNC_KEY);
  lastError = '';
}

function getLocalValue(key) {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
}

function setLocalValue(key, value) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
}

function removeLocalValue(key) {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
}

function ensureClient() {
  if (!client) throw new Error('云端服务尚未初始化。');
}

function ensureSignedIn() {
  ensureClient();
  if (!session) throw new Error('请先登录云端账号。');
}

function dispatchStatus() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('acctmgr:cloud-status', { detail: getCloudStatus() }));
  }
}

export function friendlyCloudError(error) {
  if (error instanceof CloudConflictError) return error.message;
  const message = String(error?.message || error || '云端操作失败');
  if (/Invalid login credentials/i.test(message)) return '邮箱或云端密码错误。';
  if (/Email not confirmed/i.test(message)) return '请先完成邮箱验证。';
  if (/User already registered/i.test(message)) return '该邮箱已经注册，请直接登录。';
  if (/Failed to fetch|NetworkError/i.test(message)) return '无法连接云端，请检查网络。';
  if (/decrypt|operation-specific reason/i.test(message)) return '主密码错误，无法解密云端数据。';
  return message;
}
