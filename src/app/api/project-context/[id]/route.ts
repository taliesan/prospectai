import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

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
  });

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
