import "dotenv/config";
import { prisma } from "./_lib/prisma.js";

// Delete companies with YC batch year before 2021 (e.g. W20, S19, W18, ...)
const result = await prisma.company.deleteMany({
  where: {
    batch: { not: null },
    OR: [
      { batch: { endsWith: "00" } },
      { batch: { endsWith: "01" } },
      { batch: { endsWith: "02" } },
      { batch: { endsWith: "03" } },
      { batch: { endsWith: "04" } },
      { batch: { endsWith: "05" } },
      { batch: { endsWith: "06" } },
      { batch: { endsWith: "07" } },
      { batch: { endsWith: "08" } },
      { batch: { endsWith: "09" } },
      { batch: { endsWith: "10" } },
      { batch: { endsWith: "11" } },
      { batch: { endsWith: "12" } },
      { batch: { endsWith: "13" } },
      { batch: { endsWith: "14" } },
      { batch: { endsWith: "15" } },
      { batch: { endsWith: "16" } },
      { batch: { endsWith: "17" } },
      { batch: { endsWith: "18" } },
      { batch: { endsWith: "19" } },
      { batch: { endsWith: "20" } },
    ],
  },
});

console.log(`Deleted ${result.count} companies with batch year before 2021.`);
await prisma.$disconnect();
