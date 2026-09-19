import { PrismaClient } from "@prisma/client";

// Singleton PrismaClient that survives Next.js dev-mode hot reload
// without exhausting DB connections.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
