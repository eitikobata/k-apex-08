const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const { authenticator } = require('otplib');

const prisma = new PrismaClient();

async function main() {
  const callsign = process.env.SEED_ADMIN_CALLSIGN || 'K.ADMIN';
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@kobata-matrix.corp';
  const password = process.env.SEED_ADMIN_PASSWORD || 'change-me-immediately-12';

  const existing = await prisma.operator.findUnique({ where: { callsign } });
  if (existing) {
    console.log(`Operator ${callsign} already exists — skipping seed.`);
    return;
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const totpSecret = authenticator.generateSecret();

  await prisma.operator.create({
    data: { callsign, email, passwordHash, role: 'ADMIN', totpSecret },
  });

  const keyUri = authenticator.keyuri(email, 'Kobata Matrix Corporation', totpSecret);

  console.log('=== First ADMIN operator seeded ===');
  console.log(`callsign: ${callsign}`);
  console.log(`password: ${password}`);
  console.log(`TOTP secret (manual entry): ${totpSecret}`);
  console.log(`TOTP key URI: ${keyUri}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
  