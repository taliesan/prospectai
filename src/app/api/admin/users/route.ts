import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      approved: true,
      isAdmin: true,
      createdAt: true,
      _count: { select: { profiles: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return Response.json({ users });
}
