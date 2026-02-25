import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sanitizeForClaude } from '@/lib/sanitize';

// POST /api/project-context/[id]/materials — add files or URLs
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const context = await prisma.projectContext.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!context) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const contentType = request.headers.get('content-type') || '';

  // Handle JSON body (URLs)
  if (contentType.includes('application/json')) {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return Response.json({ error: 'URL is required' }, { status: 400 });
    }

    // Fetch URL content
    let extractedText = '';
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ProspectAI/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const raw = await res.text();
        extractedText = sanitizeForClaude(raw).slice(0, 100_000);
      }
    } catch (err) {
      console.warn(`[Materials] Failed to fetch URL ${url}:`, err);
    }

    const material = await prisma.projectMaterial.create({
      data: {
        projectContextId: id,
        type: 'url',
        url,
        extractedText: extractedText || null,
        charCount: extractedText.length || null,
      },
    });

    return Response.json({ material }, { status: 201 });
  }

  // Handle multipart form data (file uploads)
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return Response.json({ error: 'File is required' }, { status: 400 });
    }

    let extractedText = '';

    if (file.type === 'application/pdf') {
      // PDF text extraction using unpdf (same as LinkedIn PDF handling)
      try {
        const arrayBuffer = await file.arrayBuffer();
        const { extractText } = await import('unpdf');
        const { text } = await extractText(new Uint8Array(arrayBuffer), { mergePages: true });
        extractedText = text;
      } catch (err) {
        console.warn(`[Materials] Failed to extract PDF text from ${file.name}:`, err);
      }
    } else {
      // Plain text, Word docs as text
      try {
        extractedText = await file.text();
      } catch (err) {
        console.warn(`[Materials] Failed to read file ${file.name}:`, err);
      }
    }

    const material = await prisma.projectMaterial.create({
      data: {
        projectContextId: id,
        type: 'file',
        filename: file.name,
        extractedText: extractedText || null,
        charCount: extractedText.length || null,
      },
    });

    return Response.json({ material }, { status: 201 });
  }

  return Response.json({ error: 'Unsupported content type' }, { status: 400 });
}
