import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const profile = await prisma.profile.findUnique({
    where: { id: params.id },
  });

  if (!profile || (profile.userId !== session.user.id && !session.user.isAdmin)) {
    return Response.json({ error: 'Profile not found' }, { status: 404 });
  }

  return Response.json({ profile });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const profile = await prisma.profile.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true },
  });

  if (!profile || (profile.userId !== session.user.id && !session.user.isAdmin)) {
    return Response.json({ error: 'Profile not found' }, { status: 404 });
  }

  await prisma.profile.delete({ where: { id: params.id } });

  return Response.json({ deleted: true });
}
