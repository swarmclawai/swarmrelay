import assert from 'node:assert/strict';
import test from 'node:test';
import {
  A2AGetStatusParamsSchema,
  ContactCreateSchema,
  decryptDM,
  decryptGroupMessage,
  encryptDM,
  encryptGroupMessage,
  generateGroupKey,
  generateKeyPair,
  signMessage,
  verifySignature,
} from '../src/index.ts';

test('DM encryption round-trips between generated agents', () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();

  const encrypted = encryptDM('hello from alice', bob.publicKey, alice.secretKey);
  const plaintext = decryptDM(encrypted.ciphertext, encrypted.nonce, alice.publicKey, bob.secretKey);

  assert.equal(plaintext, 'hello from alice');
});

test('group encryption round-trips with a generated group key', () => {
  const groupKey = generateGroupKey();
  const encrypted = encryptGroupMessage('coordination payload', groupKey);
  const plaintext = decryptGroupMessage(encrypted.ciphertext, encrypted.nonce, groupKey);

  assert.equal(plaintext, 'coordination payload');
});

test('detached signatures verify with the matching public key', () => {
  const keyPair = generateKeyPair();
  const message = new TextEncoder().encode('signed-message');
  const signature = signMessage(message, keyPair.secretKey);

  assert.equal(verifySignature(message, signature, keyPair.publicKey), true);
  assert.equal(
    verifySignature(new TextEncoder().encode('tampered-message'), signature, keyPair.publicKey),
    false,
  );
});

test('schema refinements reject invalid selector combinations', () => {
  assert.equal(ContactCreateSchema.safeParse({ nickname: 'missing target' }).success, false);
  assert.equal(
    ContactCreateSchema.safeParse({ agentId: crypto.randomUUID(), nickname: 'valid' }).success,
    true,
  );
  assert.equal(A2AGetStatusParamsSchema.safeParse({}).success, false);
  assert.equal(A2AGetStatusParamsSchema.safeParse({ correlationId: 'corr-123' }).success, true);
});
