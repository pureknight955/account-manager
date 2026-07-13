import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSyncAction } from '../src/utils/cloud-vault.js';

test('creates the first remote vault from existing local data', () => {
  assert.equal(resolveSyncAction({
    remoteRevision: null,
    localRevision: 0,
    dirty: false,
    hasLocalData: true,
  }), 'create');
});

test('downloads a remote vault onto an empty device', () => {
  assert.equal(resolveSyncAction({
    remoteRevision: 3,
    localRevision: 0,
    dirty: false,
    hasLocalData: false,
  }), 'download');
});

test('uploads dirty data only when revisions match', () => {
  assert.equal(resolveSyncAction({
    remoteRevision: 4,
    localRevision: 4,
    dirty: true,
    hasLocalData: true,
  }), 'upload');
});

test('downloads a newer remote revision when local data is clean', () => {
  assert.equal(resolveSyncAction({
    remoteRevision: 5,
    localRevision: 4,
    dirty: false,
    hasLocalData: true,
  }), 'download');
});

test('refuses to overwrite when both local and remote changed', () => {
  assert.equal(resolveSyncAction({
    remoteRevision: 5,
    localRevision: 4,
    dirty: true,
    hasLocalData: true,
  }), 'conflict');
});

test('does nothing when both sides are already aligned', () => {
  assert.equal(resolveSyncAction({
    remoteRevision: 5,
    localRevision: 5,
    dirty: false,
    hasLocalData: true,
  }), 'none');
});

