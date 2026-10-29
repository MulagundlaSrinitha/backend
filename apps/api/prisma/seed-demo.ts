import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Demo@123', 10);

  const user = await prisma.user.upsert({
    where: { email: 'demo@next360.com' },
    update: {},
    create: {
      email: 'demo@next360.com',
      name: 'Demo Customer',
      phone: '+919999999999',
      password: passwordHash,
      role: 'CUSTOMER',
      isKycVerified: true,
    },
  });

  console.log('✅ Demo user created:', user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
