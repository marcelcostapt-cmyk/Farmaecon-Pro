import { PrismaPg } from '@prisma/adapter-pg';
export function getDatabaseUrl() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return process.env.DATABASE_URL;
}
export function createPrismaAdapter() { return new PrismaPg(getDatabaseUrl()); }
