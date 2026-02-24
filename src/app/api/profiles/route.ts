import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const profiles = await prisma.profile.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      donorName: true,
      status: true,
      sourceCount: true,
      confidenceScores: true,
      pipelineVersion: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return Response.json({ profiles });
}
