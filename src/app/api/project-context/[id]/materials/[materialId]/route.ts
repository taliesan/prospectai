import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

// DELETE /api/project-context/[id]/materials/[materialId]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; materialId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, materialId } = await params;

  // Verify ownership
  const context = await prisma.projectContext.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!context) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const material = await prisma.projectMaterial.findFirst({
    where: { id: materialId, projectContextId: id },
  });

  if (!material) {
    return Response.json({ error: 'Material not found' }, { status: 404 });
  }

  await prisma.projectMaterial.delete({ where: { id: materialId } });

  return Response.json({ success: true });
}
