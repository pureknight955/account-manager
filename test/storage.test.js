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
