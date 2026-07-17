import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryStorage {
  #data = new Map();

  get length() { return this.#data.size; }
  clear() { this.#data.clear(); }
  getItem(key) { return this.#data.has(key) ? this.#data.get(key) : null; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  removeItem(key) { this.#data.delete(key); }
  setItem(key, value) { this.#data.set(key, String(value)); }
}

globalThis.localStorage = new MemoryStorage();

const storage = await import('../src/utils/storage.js');
const {
  createPasswordVerifier,
  decrypt,
  encrypt,
  verifyPassword,
} = await import('../src/utils/crypto.js');

test.beforeEach(() => localStorage.clear());

test('card balance is always derived from opening balance, top-ups and card bills', () => {
  const account = storage.saveAccount({
    type: 'gpt', nickname: 'A', subscriptionType: 'plus', status: 'active',
    subscriptionStartDate: '2026-07-01', subscriptionCostUsd: 20,
  });
  const card = storage.saveCard({ brand: 'bitget', lastFour: '1234', balance: 100 });
  storage.saveTopUpRecord({ cardId: card.id, amount: 50, topUpDate: '2026-07-01' });
  const bill = storage.saveBillingRecord({
    accountId: account.id,
    billingDate: '2026-07-02',
    amount: 20,
    period: 1,
    paymentSource: 'card',
    cardId: card.id,
  });

  assert.equal(storage.getCardById(card.id).balance, 130);
  storage.editBillingRecord(bill.id, '', 25, 'gift_card', '2026-07-03');
  assert.equal(storage.getCardById(card.id).balance, 150);
  storage.editBillingRecord(bill.id, card.id, 25, 'card', '2026-07-03');
  assert.equal(storage.getCardById(card.id).balance, 125);
});

test('cancel at period end keeps the paid period and suppresses the next bill', () => {
  const account = storage.saveAccount({
    type: 'gpt', nickname: '取消续费', subscriptionType: 'plus', status: 'active',
    subscriptionStartDate: '2026-01-15', subscriptionCostUsd: 20,
  });

  assert.equal(storage.autoGenerateBillingRecords('2026-02-20'), 2);
  const canceled = storage.scheduleSubscriptionCancellation(account.id, '2026-02-20');
  assert.equal(canceled.subscriptionStatus, 'cancel_at_period_end');
  assert.equal(canceled.subscriptionEndDate, '2026-03-15');
  assert.equal(storage.isAccountSubscriptionActive(canceled, '2026-03-15'), true);

  assert.equal(storage.autoGenerateBillingRecords('2026-03-15'), 0);
  assert.equal(storage.getBillingRecordsByAccount(account.id).length, 2);
  storage.autoGenerateBillingRecords('2026-03-16');

  const expired = storage.getAccountById(account.id);
  assert.equal(expired.subscriptionType, 'free');
  assert.equal(expired.currentSubscriptionCycleId, '');
  assert.equal(expired.subscriptionCycles[0].status, 'ended');
  assert.equal(expired.subscriptionCycles[0].endDate, '2026-03-15');
  assert.equal(storage.isAccountSubscriptionActive(expired, '2026-03-16'), false);
});

test('scheduled cancellation can be restored before expiry', () => {
  const account = storage.saveAccount({
    type: 'claude', nickname: '恢复续费', subscriptionType: 'pro', status: 'active',
    subscriptionStartDate: '2026-01-15', subscriptionCostUsd: 20,
  });
  storage.autoGenerateBillingRecords('2026-02-20');
  storage.scheduleSubscriptionCancellation(account.id, '2026-02-20');

  const restored = storage.restoreSubscriptionRenewal(account.id, '2026-03-01');
  assert.equal(restored.subscriptionStatus, 'active');
  assert.equal(restored.subscriptionEndDate, '');
  assert.equal(storage.autoGenerateBillingRecords('2026-03-15'), 1);
  assert.equal(storage.getBillingRecordsByAccount(account.id).length, 3);
});

test('a later subscription creates a new cycle, enforces a one-day gap, and backfills bills', () => {
  const account = storage.saveAccount({
    type: 'gpt', nickname: '重新订阅', subscriptionType: 'plus', status: 'active',
    subscriptionStartDate: '2026-01-15', subscriptionCostUsd: 20,
  });
  storage.autoGenerateBillingRecords('2026-02-20');
  storage.scheduleSubscriptionCancellation(account.id, '2026-02-20');
  storage.autoGenerateBillingRecords('2026-03-16');

  const resubscribe = storage.getAccountById(account.id);
  resubscribe.subscriptionType = 'business';
  resubscribe.subscriptionStartDate = '2026-03-15';
  resubscribe.subscriptionCostUsd = 30;
  assert.throws(() => storage.saveAccount(resubscribe), /不能早于 2026-03-16/);

  resubscribe.subscriptionStartDate = '2026-03-16';
  storage.saveAccount(resubscribe);
  assert.equal(storage.autoGenerateBillingRecords('2026-05-20'), 3);

  const bills = storage.getBillingRecordsByAccount(account.id)
    .sort((left, right) => left.billingDate.localeCompare(right.billingDate));
  assert.deepEqual(bills.map((bill) => bill.billingDate), [
    '2026-01-15', '2026-02-15', '2026-03-16', '2026-04-16', '2026-05-16',
  ]);
  assert.equal(new Set(bills.map((bill) => bill.subscriptionCycleId)).size, 2);
  assert.deepEqual(bills.slice(2).map((bill) => bill.period), [1, 2, 3]);

  const edited = storage.getAccountById(account.id);
  edited.subscriptionCostUsd = 35;
  storage.saveAccount(edited);
  storage.autoGenerateBillingRecords('2026-05-20');
  assert.deepEqual(
    storage.getBillingRecordsByAccount(account.id).map((bill) => bill.amount),
    [20, 20, 30, 30, 30],
  );
});

test('banning ends billing immediately while preserving subscription and member history', () => {
  const account = storage.saveAccount({
    type: 'gpt', nickname: '封禁账号', subscriptionType: 'business', status: 'active',
    subscriptionStartDate: '2026-07-01', subscriptionCostUsd: 30, teamLimit: 5,
  });
  storage.saveTeamMember({
    accountId: account.id, name: '保留成员', inviteDate: '2026-07-01', memberStatus: 'active',
  });
  storage.autoGenerateBillingRecords('2026-07-01');

  const banned = storage.getAccountById(account.id);
  banned.status = 'banned';
  banned.banDate = '2026-07-10';
  storage.saveAccount(banned);
  assert.equal(storage.autoGenerateBillingRecords('2026-08-01'), 0);

  const stored = storage.getAccountById(account.id);
  assert.equal(stored.subscriptionType, 'free');
  assert.equal(stored.subscriptionCycles[0].endedReason, 'banned');
  assert.equal(stored.subscriptionCycles[0].endDate, '2026-07-10');
  assert.equal(storage.isAccountSubscriptionActive(stored, '2026-07-10'), false);
  assert.equal(storage.getTeamMembers(account.id).length, 1);
  assert.equal(storage.getBillingRecordsByAccount(account.id).length, 1);
});

test('legacy flat subscriptions and bills migrate into one preserved cycle', () => {
  localStorage.setItem('acctmgr_accounts', JSON.stringify([{
    id: 'legacy-account',
    type: 'gpt',
    nickname: '旧数据',
    subscriptionType: 'plus',
    subscriptionStartDate: '2026-01-10',
    subscriptionCostUsd: 20,
    status: 'active',
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
  }]));
  localStorage.setItem('acctmgr_billing_records', JSON.stringify([{
    id: 'legacy-bill',
    accountId: 'legacy-account',
    billingDate: '2026-01-10',
    amount: 18,
    period: 1,
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
  }]));

  assert.equal(storage.autoGenerateBillingRecords('2026-02-10'), 1);
  const migrated = storage.getAccountById('legacy-account');
  const bills = storage.getBillingRecordsByAccount('legacy-account')
    .sort((left, right) => left.period - right.period);

  assert.equal(migrated.subscriptionCycles.length, 1);
  assert.equal(migrated.currentSubscriptionCycleId, migrated.subscriptionCycles[0].id);
  assert.deepEqual(bills.map((bill) => bill.amount), [18, 20]);
  assert.ok(bills.every((bill) => bill.subscriptionCycleId === migrated.subscriptionCycles[0].id));
  assert.ok(bills.every((bill) => bill.planTypeSnapshot === 'plus'));
});

test('auto billing handles month ends and does not recreate a voided cycle', () => {
  const account = storage.saveAccount({
    type: 'gpt',
    nickname: '月末账号',
    subscriptionType: 'plus',
    status: 'active',
    subscriptionStartDate: '2026-01-31',
    subscriptionCostUsd: 20,
    paymentCardId: '',
  });

  assert.equal(storage.autoGenerateBillingRecords('2026-03-31'), 3);
  const records = storage.getBillingRecordsByAccount(account.id)
    .sort((left, right) => left.period - right.period);
  assert.deepEqual(records.map((record) => record.billingDate), [
    '2026-01-31', '2026-02-28', '2026-03-31',
  ]);
  const accountUpdatedAt = storage.getAccountById(account.id).updatedAt;
  const billUpdatedAt = records.map((record) => record.updatedAt);
  storage.autoGenerateBillingRecords('2026-03-31');
  assert.equal(storage.getAccountById(account.id).updatedAt, accountUpdatedAt);
  assert.deepEqual(
    storage.getBillingRecordsByAccount(account.id)
      .sort((left, right) => left.period - right.period)
      .map((record) => record.updatedAt),
    billUpdatedAt,
  );

  storage.editBillingRecord(records[0].id, '', 25, 'gift_card', '2026-02-01');
  storage.autoGenerateBillingRecords('2026-03-31');
  const edited = storage.getBillingRecordById(records[0].id);
  assert.equal(edited.amount, 25);
  assert.equal(edited.billingDate, '2026-02-01');

  storage.deleteBillingRecord(records[1].id);
  assert.equal(storage.autoGenerateBillingRecords('2026-03-31'), 0);
  assert.deepEqual(
    storage.getBillingRecordsByAccount(account.id).map((record) => record.period).sort(),
    [1, 3],
  );
});

test('master-password rotation re-encrypts existing secrets before switching', async () => {
  const oldPassword = 'old-password-123';
  const newPassword = 'new-password-456';
  const encryptedPassword = await encrypt('account-secret', oldPassword);
  storage.saveAccount({
    type: 'gpt',
    nickname: '加密账号',
    subscriptionType: 'free',
    status: 'active',
    encryptedPassword,
  });

  await storage.rotateAccountSecrets(decrypt, encrypt, oldPassword, newPassword);
  const rotated = storage.getAccounts()[0];
  assert.equal(await decrypt(rotated.encryptedPassword, newPassword), 'account-secret');
  await assert.rejects(() => decrypt(rotated.encryptedPassword, oldPassword));
});

test('master-password verifier is salted and rejects a wrong password', async () => {
  const verifier = await createPasswordVerifier('correct-password');
  assert.equal(await verifyPassword('correct-password', verifier), true);
  assert.equal(await verifyPassword('wrong-password', verifier), false);
  assert.ok(verifier.salt);
  assert.ok(verifier.iterations >= 300_000);
});
