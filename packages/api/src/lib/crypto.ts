import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
const { encodeBase64, decodeBase64 } = util;
import { CHALLENGE_TTL_SECONDS } from '@swarmrelay/shared';

export function generateChallenge(): { challenge: string; expiresAt: Date } {
  const challenge = encodeBase64(randomBytes(32));
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
  return { challenge, expiresAt };
}

export function verifyEd25519Signature(publicKeyBase64: string, message: Uint8Array, signatureBase64: string): boolean {
  const publicKey = decodeBase64(publicKeyBase64);
  const signature = decodeBase64(signatureBase64);
  return nacl.sign.detached.verify(message, signature, publicKey);
}

export function generateKeyPair(): { publicKey: string; secretKey: string } {
  const kp = nacl.sign.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

// Encrypt private key for storage (AES-256-GCM)
export function encryptPrivateKey(secretKeyBase64: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secretKeyBase64, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

// Decrypt private key from storage (AES-256-GCM)
export function decryptPrivateKey(encryptedData: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, ciphertextHex] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

function getEncryptionKey(): Buffer {
  const hex = process.env.AGENT_KEY_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('AGENT_KEY_ENCRYPTION_KEY must be a 32-byte hex string (64 characters)');
  }
  return Buffer.from(hex, 'hex');
}
