import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { email, name, password } = await request.json();

    // Validate inputs
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return Response.json({ error: 'Valid email is required' }, { status: 400 });
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return Response.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Check uniqueness
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return Response.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    // Create user
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        name: name.trim(),
        passwordHash,
        approved: false,
      },
    });

    return Response.json({
      message: "Account created. You'll be able to log in once an admin approves your account.",
    });
  } catch (error) {
    console.error('[Register] Error:', error);
    return Response.json({ error: 'Registration failed' }, { status: 500 });
  }
}
