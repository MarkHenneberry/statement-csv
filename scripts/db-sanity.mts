// Database sanity check (Supabase Postgres).
//
//   node --experimental-strip-types scripts/db-sanity.mts
//   DB_SANITY_WRITE=true node --experimental-strip-types scripts/db-sanity.mts
//
// Connects ONLY when DATABASE_URL is set; otherwise it skips cleanly. It verifies
// Prisma can query, prints safe operational counts, and (only when DB_SANITY_WRITE
// is "true") upserts a single safe dev test user + billing account. It never touches
// parser/upload data, never requires private statement files, and never prints
// secrets (no connection strings or passwords are logged).

import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  console.log("No DATABASE_URL set — skipping DB sanity check (this is fine).");
  console.log(
    "Set DATABASE_URL (and DIRECT_URL) from Supabase to run it. See src/lib/billing/README.md.",
  );
  process.exit(0);
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // 1. Can Prisma reach and query the database? (no app/parser data involved)
  await prisma.$queryRaw`SELECT 1`;
  console.log("ok    database reachable (SELECT 1)");

  // 2. Safe operational counts only — never any statement content.
  const counts = {
    users: await prisma.user.count(),
    billingAccounts: await prisma.billingAccount.count(),
    conversions: await prisma.conversion.count(),
    ledgerEntries: await prisma.pageCreditLedger.count(),
  };
  console.log("ok    table counts:", JSON.stringify(counts));

  // 3. Optional, explicit dev-only write: upsert a single safe placeholder row.
  if (process.env.DB_SANITY_WRITE === "true") {
    const email = "dev-sanity@example.com";
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: "DB Sanity (dev)" },
    });
    await prisma.billingAccount.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        planKey: "free",
        status: "free",
        monthlyPageAllowance: 0,
        pagesUsedThisPeriod: 0,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    console.log("ok    upserted safe dev test user + billing account (DB_SANITY_WRITE=true)");
  } else {
    console.log("info  read-only check (set DB_SANITY_WRITE=true to upsert a safe dev row)");
  }

  console.log("\nDB sanity check passed.");
}

main()
  .catch((err) => {
    // Safe label only — never echo connection details.
    console.error("DB sanity check failed:", err instanceof Error ? err.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
