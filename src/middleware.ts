import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: {
    signIn: '/login',
  },
});

export const config = {
  matcher: [
    // Protect all pages except login, register, and static assets
    '/((?!login|register|api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
};
