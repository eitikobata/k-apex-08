// One-off data migration — encrypts any Operator.totpSecret still stored
// in plaintext (from before this fix landed). Safe to re-run: rows
// already in the encrypted format are skipped via isAlreadyEncrypted().
//
// Usage (from the backend container/host, with DATABASE_URL and
// TOTP_ENCRYPTION_KEY set in the environment):
//   node prisma/migrate-encrypt-totp-secrets.js
//
// This does NOT touch operators with no totpSecret at all (never
// enrolled — nothing to encrypt).
const { PrismaClient } = require('@prisma/client');
const { encryptTotpSecret, isAlreadyEncrypted } = require('./totp-crypto.util');

const prisma = new PrismaClient();

async function main() {
  const operators = await prisma.operator.findMany({
    where: { totpSecret: { not: null } },
    select: { id: true, callsign: true, totpSecret: true },
  });

  if (operators.length === 0) {
    console.log('No operators with a totpSecret — nothing to do.');
    return;
  }

  let encrypted = 0;
  let alreadyDone = 0;

  for (const op of operators) {
    if (isAlreadyEncrypted(op.totpSecret)) {
      alreadyDone += 1;
      continue;
    }
    const newValue = encryptTotpSecret(op.totpSecret);
    // eslint-disable-next-line no-await-in-loop
    await prisma.operator.update({ where: { id: op.id }, data: { totpSecret: newValue } });
    console.log(`Encrypted totpSecret for ${op.callsign} (${op.id})`);
    encrypted += 1;
  }

  console.log(`\nDone. Encrypted: ${encrypted}. Already encrypted (skipped): ${alreadyDone}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
