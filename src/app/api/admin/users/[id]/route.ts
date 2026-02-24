import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = params;
  const body = await request.json();

  // Only allow updating approved and isAdmin flags
  const data: { approved?: boolean; isAdmin?: boolean } = {};
  if (typeof body.approved === 'boolean') data.approved = body.approved;
  if (typeof body.isAdmin === 'boolean') data.isAdmin = body.isAdmin;

  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  // Prevent admin from revoking their own admin status
  if (id === session.user.id && data.isAdmin === false) {
    return Response.json({ error: 'Cannot revoke your own admin status' }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      approved: true,
      isAdmin: true,
    },
  });

  return Response.json({ user });
}
