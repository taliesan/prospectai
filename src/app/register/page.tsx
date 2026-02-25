'use client';

import { useState } from 'react';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Registration failed');
      } else {
        setSuccess(true);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-brand-black flex flex-col items-center justify-center px-4">
        <div
          className="absolute top-0 right-0 w-[600px] h-[600px] opacity-20"
          style={{ background: 'radial-gradient(circle at 70% 30%, #7B2D8E, transparent 60%)' }}
        />
        <h1 className="font-serif text-[56px] leading-[1.05] text-white mb-6 relative z-10">
          Prospect<span className="font-serif italic" style={{ color: '#D894E8' }}>AI</span>
        </h1>
        <div className="w-full max-w-sm relative z-10 text-center">
          <div className="rounded-lg p-6 border border-white/15" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <svg className="w-12 h-12 mx-auto mb-4 text-brand-green" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <h2 className="text-lg font-semibold text-white mb-2">Account Created</h2>
            <p className="text-sm text-white/50 mb-4">
              You&apos;ll be able to log in once an admin approves your account.
            </p>
            <a
              href="/login"
              className="inline-block text-sm text-purple-400 hover:text-purple-300 transition-colors"
            >
              Back to Login
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-black flex flex-col items-center justify-center px-4">
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
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          placeholder="Full name"
          autoFocus
          className="w-full text-[15px] text-white border border-white/15 rounded-lg px-4 py-3.5
                     focus:border-purple-400 focus:outline-none placeholder-white/30 transition-all"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        />
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(''); }}
          placeholder="Email"
          className="w-full text-[15px] text-white border border-white/15 rounded-lg px-4 py-3.5
                     focus:border-purple-400 focus:outline-none placeholder-white/30 transition-all"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          placeholder="Password (8+ characters)"
          className="w-full text-[15px] text-white border border-white/15 rounded-lg px-4 py-3.5
                     focus:border-purple-400 focus:outline-none placeholder-white/30 transition-all"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        />
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
          placeholder="Confirm password"
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
          {isLoading ? 'Creating account...' : 'Create Account'}
        </button>
        <p className="text-center text-sm text-white/40">
          Already have an account?{' '}
          <a href="/login" className="text-purple-400 hover:text-purple-300 transition-colors">
            Sign in
          </a>
        </p>
      </form>
    </div>
  );
}
