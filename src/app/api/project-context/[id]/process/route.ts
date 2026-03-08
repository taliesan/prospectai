import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';
import { runOrgExtraction } from '@/lib/stages/stage-0-org-extraction';

const PROCESSING_THRESHOLD = 8_000;

const DISTILL_PROMPT = `You are processing organizational context for a donor profiling system. The user has provided materials about their organization or project. Your job is to distill this into a structured brief that a profile writer can use to understand:

1. What this organization/project does (mission, theory of change)
2. What they're building or fighting for (concrete programs, campaigns)
3. What makes them distinctive (positioning, approach, differentiators)
4. Who they serve or represent
5. Their current strategic priorities
6. Any specific language, framing, or values they use

Produce a structured brief of 2,000-4,000 characters. Be specific and concrete — the profile writer needs to understand what this org actually does, not just its mission statement. Preserve distinctive language and framing from the source materials.

Do NOT invent or embellish. Only include what's in the provided materials.`;

// POST /api/project-context/[id]/process — run Sonnet distillation
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const context = await prisma.projectContext.findFirst({
    where: { id, userId: session.user.id },
    include: { materials: true },
  });

  if (!context) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // Concatenate all raw material
  const parts: string[] = [];
  if (context.rawDescription) {
    parts.push(`## Organization Description\n${context.rawDescription}`);
  }
  for (const m of context.materials) {
    if (m.extractedText) {
      const label = m.type === 'url' ? `## Content from ${m.url}` : `## Content from ${m.filename}`;
      parts.push(`${label}\n${m.extractedText}`);
    }
  }

  const rawContent = parts.join('\n\n---\n\n');
  const totalChars = rawContent.length;

  let processedBrief: string;

  if (totalChars <= PROCESSING_THRESHOLD) {
    // Short enough — use directly
    processedBrief = rawContent || context.rawDescription || '';
    console.log(`[Process] Under threshold (${totalChars} chars), using raw content directly`);
  } else {
    // Run Sonnet distillation
    console.log(`[Process] Over threshold (${totalChars} chars), running Sonnet distillation`);
    try {
      const anthropic = new Anthropic();
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2000,
        system: DISTILL_PROMPT,
        messages: [{
          role: 'user',
          content: `Here are all the materials provided about this organization/project:\n\n${rawContent.slice(0, 50_000)}`,
        }],
      });
      processedBrief = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n');
      console.log(`[Process] Sonnet produced ${processedBrief.length} char brief`);
    } catch (err) {
      console.error('[Process] Sonnet distillation failed:', err);
      // Fallback: truncate raw content
      processedBrief = rawContent.slice(0, 4000);
    }
  }

  // Save processed brief
  const updated = await prisma.projectContext.update({
    where: { id },
    data: { processedBrief },
  });

  // Run Stage 0 org extraction async — don't block the response
  console.log(`[Stage 0] ProjectContext POST /process detected for id=${id}, name="${context.name}"`);
  console.log(`[Stage 0] Has processedBrief: true (${processedBrief.length} chars)`);

  const materialTexts = context.materials
    .map(m => m.extractedText)
    .filter((t): t is string => Boolean(t));

  console.log(`[Stage 0] Calling runOrgExtraction...`);
  runOrgExtraction({
    name: context.name,
    processedBrief,
    issueAreas: context.issueAreas || undefined,
    defaultAsk: context.defaultAsk || undefined,
    materials: materialTexts.length > 0 ? materialTexts : undefined,
  })
    .then(async (strategicFrame) => {
      console.log(`[Stage 0] Writing strategicFrame to ProjectContext id=${id}...`);
      await prisma.projectContext.update({
        where: { id },
        data: { strategicFrame },
      });
      console.log(`[Stage 0] strategicFrame saved for ${context.name} (${strategicFrame.length} chars)`);
    })
    .catch((err) => {
      console.error(`[Stage 0] ERROR in /process trigger: ${err instanceof Error ? err.message : err}`);
      console.error(`[Stage 0] Stack: ${err instanceof Error ? err.stack : 'N/A'}`);
    });

  return Response.json({ context: updated });
}
