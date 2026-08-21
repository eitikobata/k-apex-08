// Plain CommonJS, no NestJS DI — used by prisma/seed.js and
// prisma/migrate-encrypt-totp-secrets.js, both of which run outside the
// Nest app context (same reasoning as seed.js already being plain JS, not
// ts-node: these don't ship in the production container, they're run
// once via `node prisma/whatever.js`). Mirrors TotpService's
// encryptSecret/decryptSecret exactly — same algorithm, same stored
// format — so anything encrypted here is readable by the running app and
// vice versa. If TotpService's format ever changes, update both places.
const crypto = require('crypto');

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const GCM_IV_BYTES = 12;

function getEncryptionKey() {
  const keyB64 = process.env.TOTP_ENCRYPTION_KEY;
  if (!keyB64) {
    throw new Error('TOTP_ENCRYPTION_KEY is not set — generate one with: openssl rand -base64 32');
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error(`TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256 (got ${key.length})`);
  }
  return key;
}

function encryptTotpSecret(plaintextSecret) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextSecret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** True if `value` is already in the encrypted iv:authTag:ciphertext
 * format (exactly 2 colons) rather than a raw Base32 TOTP secret (otplib
 * never produces a colon) — lets the migration script skip rows that
 * were already encrypted, safely re-runnable. */
function isAlreadyEncrypted(value) {
  return typeof value === 'string' && value.split(':').length === 3;
}

module.exports = { encryptTotpSecret, isAlreadyEncrypted };
