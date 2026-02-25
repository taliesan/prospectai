import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET /api/project-context — list user's project contexts
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contexts = await prisma.projectContext.findMany({
    where: { userId: session.user.id },
    include: { materials: { select: { id: true, type: true, filename: true, url: true, charCount: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  return Response.json({ contexts });
}

// POST /api/project-context — create a new project context
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { name, rawDescription, issueAreas, defaultAsk } = body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'Name is required' }, { status: 400 });
  }

  const context = await prisma.projectContext.create({
    data: {
      userId: session.user.id,
      name: name.trim(),
      rawDescription: rawDescription || null,
      processedBrief: rawDescription || '', // placeholder until /process is called
      issueAreas: issueAreas || null,
      defaultAsk: defaultAsk || null,
    },
  });

  return Response.json({ context }, { status: 201 });
}
