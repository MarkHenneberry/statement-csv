import "server-only";
import { PrismaClient } from "@prisma/client";

// Shared Prisma client. Reused across hot-reloads in dev so we don't exhaust the
// database's connection pool. Constructing the client does NOT open a connection —
// Prisma connects lazily on the first query — so importing this module is safe at
// build time and never hits the database during a static build.
//
// SERVER-ONLY: this module must never be imported into client components.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
