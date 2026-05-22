import "dotenv/config";
import { prisma } from "./_lib/prisma.js";
const NON_VC = ['exa-discovery','techstars','gener8tor','500global','thehub','hn_hiring','yc','gregslist','startups_gallery'];
(async () => {
  const vcEligible = await prisma.company.count({
    where: { isVerified: true, stage: null, NOT: { tags: { hasSome: ['cc-stage-tried','exa-stage-tried'] } }, source: { notIn: NON_VC } }
  });
  const totalEligible = await prisma.company.count({
    where: { isVerified: true, stage: null, NOT: { tags: { hasSome: ['cc-stage-tried','exa-stage-tried'] } } }
  });
  console.log('VC-only eligible:', vcEligible);
  console.log('All eligible:', totalEligible);
  await prisma.$disconnect();
})();
