/* eslint-disable @typescript-eslint/no-explicit-any */
// scripts/backfill-strategic-frames.ts
//
// One-shot backfill: runs Stage 0 org extraction on every ProjectContext
// that has a processedBrief but no strategicFrame.
//
// Usage:  npx tsx scripts/backfill-strategic-frames.ts
//         npx tsx scripts/backfill-strategic-frames.ts --dry-run

// @ts-ignore — tsx resolves these at runtime via tsconfig paths
import { prisma } from '@/lib/db';
// @ts-ignore
import { runOrgExtraction } from '@/lib/stages/stage-0-org-extraction';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const contexts = await prisma.projectContext.findMany({
    where: {
      strategicFrame: null,
      processedBrief: { not: '' },
    },
    include: { materials: true },
  });

  console.log(`Found ${contexts.length} ProjectContexts to backfill${dryRun ? ' (dry run)' : ''}`);

  let success = 0;
  let failed = 0;

  for (const ctx of contexts) {
    console.log(`\n[${ctx.id}] ${ctx.name}`);

    if (dryRun) {
      console.log('  -> Would run Stage 0 extraction');
      success++;
      continue;
    }

    try {
      const materialTexts = (ctx as any).materials
        .map((m: any) => m.extractedText)
        .filter((t: any): t is string => Boolean(t));

      const strategicFrame = await runOrgExtraction({
        name: ctx.name,
        processedBrief: ctx.processedBrief,
        issueAreas: ctx.issueAreas || undefined,
        defaultAsk: ctx.defaultAsk || undefined,
        materials: materialTexts.length > 0 ? materialTexts : undefined,
      });

      await prisma.projectContext.update({
        where: { id: ctx.id },
        data: { strategicFrame },
      });

      console.log(`  -> Saved (${strategicFrame.length} chars)`);
      success++;
    } catch (err) {
      console.error(`  -> FAILED:`, err);
      failed++;
    }
  }

  console.log(`\nDone. ${success} succeeded, ${failed} failed.`);
}

main()
  .catch((err: any) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
