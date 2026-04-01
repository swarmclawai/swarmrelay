import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
const { decodeBase64, encodeBase64, decodeUTF8, encodeUTF8 } = util;

// --- Key Generation ---

export function generateKeyPair(): { publicKey: string; secretKey: string } {
  const kp = nacl.sign.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

// --- Ed25519 → X25519 Conversion ---

export function ed25519ToX25519Public(ed25519PublicKeyBase64: string): Uint8Array {
  const ed25519Pub = decodeBase64(ed25519PublicKeyBase64);
  // tweetnacl doesn't expose the conversion directly, so we use the
  // nacl.box.keyPair.fromSecretKey approach is only for secret keys.
  // For public key conversion we need the low-level implementation.
  // Use the standard formula: clear cofactor bits, multiply by basepoint.
  return ed25519PublicKeyToX25519(ed25519Pub);
}

export function ed25519ToX25519Secret(ed25519SecretKeyBase64: string): Uint8Array {
  const ed25519Secret = decodeBase64(ed25519SecretKeyBase64);
  // The X25519 secret key is derived from the first 32 bytes of the Ed25519 secret key
  // after hashing with SHA-512 (same derivation as libsodium crypto_sign_ed25519_sk_to_curve25519)
  return ed25519SecretKeyToX25519(ed25519Secret);
}

// --- DM Encryption (NaCl box) ---

export function encryptDM(
  plaintext: string,
  recipientEd25519PublicBase64: string,
  senderEd25519SecretBase64: string,
): { ciphertext: string; nonce: string } {
  const message = decodeUTF8(plaintext);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const recipientX25519 = ed25519ToX25519Public(recipientEd25519PublicBase64);
  const senderX25519 = ed25519ToX25519Secret(senderEd25519SecretBase64);
  const encrypted = nacl.box(message, nonce, recipientX25519, senderX25519);
  if (!encrypted) throw new Error('Encryption failed');
  return {
    ciphertext: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

export function decryptDM(
  ciphertextBase64: string,
  nonceBase64: string,
  senderEd25519PublicBase64: string,
  recipientEd25519SecretBase64: string,
): string {
  const ciphertext = decodeBase64(ciphertextBase64);
  const nonce = decodeBase64(nonceBase64);
  const senderX25519 = ed25519ToX25519Public(senderEd25519PublicBase64);
  const recipientX25519 = ed25519ToX25519Secret(recipientEd25519SecretBase64);
  const decrypted = nacl.box.open(ciphertext, nonce, senderX25519, recipientX25519);
  if (!decrypted) throw new Error('Decryption failed');
  return encodeUTF8(decrypted);
}

// --- Group Encryption (NaCl secretbox) ---

export function generateGroupKey(): string {
  return encodeBase64(nacl.randomBytes(nacl.secretbox.keyLength));
}

export function encryptGroupMessage(
  plaintext: string,
  groupKeyBase64: string,
): { ciphertext: string; nonce: string } {
  const message = decodeUTF8(plaintext);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const groupKey = decodeBase64(groupKeyBase64);
  const encrypted = nacl.secretbox(message, nonce, groupKey);
  if (!encrypted) throw new Error('Group encryption failed');
  return {
    ciphertext: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

export function decryptGroupMessage(
  ciphertextBase64: string,
  nonceBase64: string,
  groupKeyBase64: string,
): string {
  const ciphertext = decodeBase64(ciphertextBase64);
  const nonce = decodeBase64(nonceBase64);
  const groupKey = decodeBase64(groupKeyBase64);
  const decrypted = nacl.secretbox.open(ciphertext, nonce, groupKey);
  if (!decrypted) throw new Error('Group decryption failed');
  return encodeUTF8(decrypted);
}

// --- Group Key Distribution ---

export function encryptGroupKeyForMember(
  groupKeyBase64: string,
  memberEd25519PublicBase64: string,
  creatorEd25519SecretBase64: string,
): { encryptedKey: string; nonce: string } {
  const groupKey = decodeBase64(groupKeyBase64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const memberX25519 = ed25519ToX25519Public(memberEd25519PublicBase64);
  const creatorX25519 = ed25519ToX25519Secret(creatorEd25519SecretBase64);
  const encrypted = nacl.box(groupKey, nonce, memberX25519, creatorX25519);
  if (!encrypted) throw new Error('Group key encryption failed');
  return {
    encryptedKey: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

export function decryptGroupKeyFromCreator(
  encryptedKeyBase64: string,
  nonceBase64: string,
  creatorEd25519PublicBase64: string,
  memberEd25519SecretBase64: string,
): string {
  const encryptedKey = decodeBase64(encryptedKeyBase64);
  const nonce = decodeBase64(nonceBase64);
  const creatorX25519 = ed25519ToX25519Public(creatorEd25519PublicBase64);
  const memberX25519 = ed25519ToX25519Secret(memberEd25519SecretBase64);
  const decrypted = nacl.box.open(encryptedKey, nonce, creatorX25519, memberX25519);
  if (!decrypted) throw new Error('Group key decryption failed');
  return encodeBase64(decrypted);
}

// --- Message Signing ---

export function signMessage(messageBytes: Uint8Array, ed25519SecretBase64: string): string {
  const secretKey = decodeBase64(ed25519SecretBase64);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return encodeBase64(signature);
}

export function verifySignature(
  messageBytes: Uint8Array,
  signatureBase64: string,
  ed25519PublicBase64: string,
): boolean {
  const signature = decodeBase64(signatureBase64);
  const publicKey = decodeBase64(ed25519PublicBase64);
  return nacl.sign.detached.verify(messageBytes, signature, publicKey);
}

// --- Low-level Ed25519 → X25519 conversion ---
// Based on libsodium's crypto_sign_ed25519_pk_to_curve25519
// and crypto_sign_ed25519_sk_to_curve25519

function ed25519PublicKeyToX25519(edPk: Uint8Array): Uint8Array {
  // Ed25519 public key → X25519 public key
  // Uses the birational map from the Ed25519 curve to Curve25519
  // Formula: x25519_pk = (1 + ed_y) / (1 - ed_y) mod p
  // where ed_y is the y-coordinate extracted from the Ed25519 public key
  const p = BigInt('57896044618658097711785492504343953926634992332820282019728792003956564819949');

  // Extract y-coordinate from Ed25519 public key (last bit of last byte is sign of x)
  const edPkCopy = new Uint8Array(edPk);
  edPkCopy[31] &= 0x7f; // Clear the sign bit
  let y = BigInt(0);
  for (let i = 0; i < 32; i++) {
    y += BigInt(edPkCopy[i]) << BigInt(8 * i);
  }

  // u = (1 + y) / (1 - y) mod p
  const one = BigInt(1);
  const numerator = modP(y + one, p);
  const denominator = modP(one - y, p);
  const u = modP(numerator * modInverse(denominator, p), p);

  // Convert u to 32-byte little-endian array
  const result = new Uint8Array(32);
  let tmp = u;
  for (let i = 0; i < 32; i++) {
    result[i] = Number(tmp & BigInt(0xff));
    tmp >>= BigInt(8);
  }
  return result;
}

function ed25519SecretKeyToX25519(edSk: Uint8Array): Uint8Array {
  // Ed25519 secret key → X25519 secret key
  // Hash the first 32 bytes of the Ed25519 secret key with SHA-512
  // Then clamp the first 32 bytes of the hash
  const seed = edSk.slice(0, 32);
  const hash = sha512(seed);
  hash[0] &= 248;
  hash[31] &= 127;
  hash[31] |= 64;
  return hash.slice(0, 32);
}

function modP(a: bigint, p: bigint): bigint {
  return ((a % p) + p) % p;
}

function modInverse(a: bigint, p: bigint): bigint {
  // Fermat's little theorem: a^(p-2) mod p
  return modPow(modP(a, p), p - BigInt(2), p);
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = BigInt(1);
  base = modP(base, mod);
  while (exp > BigInt(0)) {
    if (exp & BigInt(1)) {
      result = modP(result * base, mod);
    }
    exp >>= BigInt(1);
    base = modP(base * base, mod);
  }
  return result;
}

function sha512(data: Uint8Array): Uint8Array {
  // tweetnacl includes SHA-512 via nacl.hash
  return nacl.hash(data);
}
