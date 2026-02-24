'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(
          result.error === 'Your account is pending approval.'
            ? result.error
            : 'Invalid email or password'
        );
      } else {
        router.push('/');
        router.refresh();
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dtw-black flex flex-col items-center justify-center px-4">
      <div
        className="absolute top-0 right-0 w-[600px] h-[600px] opacity-20"
        style={{ background: 'radial-gradient(circle at 70% 30%, #7B2D8E, transparent 60%)' }}
      />
      <div
        className="absolute bottom-0 left-0 w-[500px] h-[500px] opacity-15"
        style={{ background: 'radial-gradient(circle at 30% 70%, #2D6A4F, transparent 60%)' }}
      />

      <h1 className="font-serif text-[56px] leading-[1.05] text-white mb-10 relative z-10">
        Prospect<span className="font-serif italic" style={{ color: '#D894E8' }}>AI</span>
      </h1>

      <form onSubmit={handleSubmit} className="w-full max-w-xs relative z-10 space-y-4">
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(''); }}
          placeholder="Email"
          autoFocus
          className="w-full text-[15px] text-white border border-white/15 rounded-lg px-4 py-3.5
                     focus:border-purple-400 focus:outline-none placeholder-white/30 transition-all"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          placeholder="Password"
          className="w-full text-[15px] text-white border border-white/15 rounded-lg px-4 py-3.5
                     focus:border-purple-400 focus:outline-none placeholder-white/30 transition-all"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        />
        {error && (
          <p className="text-sm" style={{ color: '#E07A5F' }}>{error}</p>
        )}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-lg text-[15px] font-semibold text-white py-3.5 transition-all duration-300
                     hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: '#6B21A8' }}
          onMouseEnter={(e) => { if (!isLoading) { e.currentTarget.style.background = '#581C87'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(107,33,168,0.3)'; } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#6B21A8'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
        </button>
        <p className="text-center text-sm text-white/40">
          Don&apos;t have an account?{' '}
          <a href="/register" className="text-purple-400 hover:text-purple-300 transition-colors">
            Register
          </a>
        </p>
      </form>
    </div>
  );
}
