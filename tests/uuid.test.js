import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createUuid } from '../src/platform/uuid.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function replaceCrypto(t, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
  t.after(() => original ? Object.defineProperty(globalThis, 'crypto', original) : delete globalThis.crypto);
}

test('native UUID generation preserves the Crypto receiver', t => {
  const crypto = { randomUUID() { assert.equal(this, crypto); return 'native-id'; } };
  replaceCrypto(t, crypto);
  assert.equal(createUuid(), 'native-id');
});

test('HTTP-compatible getRandomValues generates distinct v4 identifiers without randomUUID', t => {
  let calls = 0;
  const crypto = { getRandomValues(bytes) { assert.equal(this, crypto); calls++; return webcrypto.getRandomValues(bytes); } };
  replaceCrypto(t, crypto);
  const ids = Array.from({ length: 1000 }, createUuid);
  assert.equal(calls, 1000);
  assert(ids.every(id => uuid.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

for (const crypto of [{}, undefined]) {
  test(`identifiers still work with ${crypto ? 'no crypto methods' : 'no crypto object'}`, t => {
    replaceCrypto(t, crypto);
    const ids = Array.from({ length: 100 }, createUuid);
    assert(ids.every(id => uuid.test(id)));
    assert.equal(new Set(ids).size, ids.length);
  });
}
