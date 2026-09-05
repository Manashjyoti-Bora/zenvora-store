import { PrismaClient } from '@prisma/client';
const url = process.argv[2];
const p = new PrismaClient({ datasources: { db: { url } } });
try {
  await p.$queryRaw`SELECT 1`;
  console.log('OK: reachable');
  const tables = await p.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`
  );
  console.log('public tables:', tables[0].n);
} catch (e) {
  console.log('FAIL:', e.message.split('\n')[0]);
} finally {
  await p.$disconnect();
}
