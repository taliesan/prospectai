import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { runOrgExtraction } from '@/lib/stages/stage-0-org-extraction';

// GET /api/project-context/[id] — get a single project context
export async function GET(
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

  return Response.json({ context });
}

// PUT /api/project-context/[id] — update a project context
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.projectContext.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json();
  const { name, rawDescription, issueAreas, defaultAsk } = body;

  const context = await prisma.projectContext.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(rawDescription !== undefined && { rawDescription }),
      ...(issueAreas !== undefined && { issueAreas }),
      ...(defaultAsk !== undefined && { defaultAsk }),
    },
    include: { materials: true },
  });

  // Re-run Stage 0 if any org-relevant fields changed
  const orgFieldsChanged =
    rawDescription !== undefined || issueAreas !== undefined || defaultAsk !== undefined;

  console.log(`[Stage 0] ProjectContext PUT detected for id=${id}, name="${context.name}"`);
  console.log(`[Stage 0] orgFieldsChanged=${orgFieldsChanged}, has processedBrief=${!!context.processedBrief} (${context.processedBrief?.length || 0} chars)`);

  if (orgFieldsChanged && context.processedBrief) {
    const materialTexts = context.materials
      .map(m => m.extractedText)
      .filter((t): t is string => Boolean(t));

    console.log(`[Stage 0] Calling runOrgExtraction...`);
    runOrgExtraction({
      name: context.name,
      processedBrief: context.processedBrief,
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
        console.log(`[Stage 0] strategicFrame updated for ${context.name} (${strategicFrame.length} chars)`);
      })
      .catch((err) => {
        console.error(`[Stage 0] ERROR in PUT trigger: ${err instanceof Error ? err.message : err}`);
        console.error(`[Stage 0] Stack: ${err instanceof Error ? err.stack : 'N/A'}`);
      });
  } else {
    console.log(`[Stage 0] Skipping re-extraction (orgFieldsChanged=${orgFieldsChanged}, processedBrief=${!!context.processedBrief})`);
  }

  return Response.json({ context });
}

// DELETE /api/project-context/[id] — delete a project context
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.projectContext.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  await prisma.projectContext.delete({ where: { id } });

  return Response.json({ success: true });
}
