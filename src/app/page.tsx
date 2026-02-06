'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ProgressEvent {
  type: 'status' | 'complete' | 'error' | 'ping';
  message: string;
  stage?: 'research' | 'dossier' | 'profile' | 'critique' | 'revision';
  detail?: string;
}

export default function Home() {
  const [donorName, setDonorName] = useState('');
  const [fundraiserName, setFundraiserName] = useState('');
  const [seedUrls, setSeedUrls] = useState('');
  const mode = 'conversation';
  const [isLoading, setIsLoading] = useState(false);
  const [progressMessages, setProgressMessages] = useState<ProgressEvent[]>([]);
  const [currentStage, setCurrentStage] = useState<string>('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!donorName.trim() || !seedUrls.trim()) return;

    setIsLoading(true);
    setProgressMessages([]);
    setCurrentStage('Starting...');

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          donorName: donorName.trim(),
          fundraiserName: fundraiserName.trim(),
          seedUrls: seedUrls.split('\n').filter(u => u.trim()),
          mode
        })
      });

      if (!response.ok) {
        throw new Error('Generation failed');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (buffer.trim()) {
            console.log('[SSE] Processing remaining buffer after stream end:', buffer);
            if (buffer.startsWith('data: ')) {
              try {
                const event: ProgressEvent = JSON.parse(buffer.slice(6));
                if (event.type === 'complete' && event.detail) {
                  const result = JSON.parse(event.detail);
                  localStorage.setItem('lastProfile', JSON.stringify(result));
                  router.push(`/profile/${encodeURIComponent(donorName.trim())}`);
                  return;
                } else if (event.type === 'error') {
                  setProgressMessages(prev => [...prev, event]);
                  setIsLoading(false);
                  return;
                }
              } catch (parseErr) {
                console.error('Failed to parse final SSE event from buffer:', parseErr);
              }
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: ProgressEvent = JSON.parse(line.slice(6));

              if (event.type === 'ping') {
                continue;
              }

              if (event.type === 'status') {
                setProgressMessages(prev => [...prev, event]);
                if (event.stage) {
                  setCurrentStage(event.stage.charAt(0).toUpperCase() + event.stage.slice(1));
                }
              } else if (event.type === 'complete' && event.detail) {
                console.log('[SSE] Received complete event with profile data');
                const result = JSON.parse(event.detail);
                localStorage.setItem('lastProfile', JSON.stringify(result));
                router.push(`/profile/${encodeURIComponent(donorName.trim())}`);
                return;
              } else if (event.type === 'error') {
                setProgressMessages(prev => [...prev, event]);
                setIsLoading(false);
                return;
              }
            } catch (parseErr) {
              console.error('Failed to parse SSE event:', parseErr);
            }
          }
        }
      }

      console.error('[SSE] Stream ended without receiving complete event');
      setProgressMessages(prev => [...prev, {
        type: 'error',
        message: 'Error: Stream ended unexpectedly. Please try again.'
      }]);
      setIsLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setProgressMessages(prev => [...prev, {
        type: 'error',
        message: 'Error: Generation failed. Please try again.'
      }]);
      setIsLoading(false);
    }
  };

  // Loading state — full dark screen with progress
  if (isLoading) {
    const progressPercent = Math.min(progressMessages.length * 8, 95);
    return (
      <div className="min-h-screen bg-dtw-black">
        {/* Animated gradient bar */}
        <div
          className="h-1.5 w-full"
          style={{
            background: 'linear-gradient(90deg, #7B2D8E, #C77DFF, #2D6A4F, #40916C, #7B2D8E)',
            backgroundSize: '200% 100%',
            animation: 'gradientShift 3s ease infinite',
          }}
        />

        <div className="flex flex-col items-center justify-center min-h-[90vh] px-4">
          <h1 className="font-serif text-5xl text-white mb-4">{donorName}</h1>
          <p className="text-base text-white/50 mb-10">{currentStage || 'Starting...'}</p>

          {/* Progress bar */}
          <div className="w-full max-w-[400px] mb-3">
            <div className="h-1 rounded-full bg-white/10">
              <div
                className="h-1 rounded-full bg-dtw-green transition-all duration-700"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
          <p className="text-[13px] text-white/35 mb-12">
            {currentStage}
          </p>

          {/* Streaming preview card */}
          {progressMessages.length > 0 && (
            <div
              className="w-full max-w-lg rounded-2xl p-6 relative overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                backdropFilter: 'blur(10px)',
              }}
            >
              {/* Purple accent bar */}
              <div className="absolute top-0 left-6 right-6 h-1 rounded-b-sm" style={{ background: '#C77DFF' }} />

              <p className="text-[11px] font-semibold tracking-[3px] uppercase mb-4" style={{ color: '#D894E8' }}>
                {currentStage === 'Research' ? 'RESEARCHING' : currentStage === 'Profile' ? 'PERSUASION PROFILE' : 'GENERATING'}
              </p>

              <div className="space-y-1 text-sm max-h-48 overflow-y-auto">
                {progressMessages.slice(-8).map((msg, i) => (
                  <div
                    key={i}
                    className={`${
                      msg.type === 'error'
                        ? 'text-dtw-red'
                        : msg.message.startsWith('\u2713')
                          ? 'text-dtw-green-light'
                          : msg.message.startsWith('\u26A0')
                            ? 'text-dtw-gold'
                            : 'text-white/60'
                    }`}
                  >
                    {msg.message}
                  </div>
                ))}
                <span className="streaming-dot ml-1" />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Animated purple gradient bar */}
      <div
        className="h-1.5 w-full"
        style={{
          background: 'linear-gradient(90deg, #7B2D8E, #C77DFF, #2D6A4F, #40916C, #7B2D8E)',
          backgroundSize: '200% 100%',
          animation: 'gradientShift 3s ease infinite',
        }}
      />

      {/* Dark nav bar */}
      <nav className="bg-dtw-black px-6 py-4">
        <span className="text-[11px] font-semibold tracking-[3px] uppercase text-white/50">
          Democracy Takes Work
        </span>
      </nav>

      {/* Dark hero section */}
      <div className="relative bg-dtw-black overflow-hidden">
        {/* Decorative radial gradients */}
        <div
          className="absolute top-0 right-0 w-[600px] h-[600px] opacity-20"
          style={{ background: 'radial-gradient(circle at 70% 30%, #7B2D8E, transparent 60%)' }}
        />
        <div
          className="absolute bottom-0 left-0 w-[500px] h-[500px] opacity-15"
          style={{ background: 'radial-gradient(circle at 30% 70%, #2D6A4F, transparent 60%)' }}
        />

        <div className="relative z-10 text-center py-24 px-4">
          <h1 className="font-serif text-[80px] leading-[1.05] text-white mb-4">
            Prospect<span className="font-serif italic" style={{ color: '#D894E8' }}>AI</span>
          </h1>
          <p className="text-xl text-white/55 max-w-lg mx-auto">
            Behavioral intelligence for high-stakes donor meetings
          </p>
        </div>
      </div>

      {/* Diagonal clip-path transition */}
      <div
        className="h-24 bg-dtw-black"
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 20%, 0 100%)' }}
      />

      {/* Two-column form section */}
      <div className="bg-dtw-off-white py-16 px-4">
        <div className="max-w-5xl mx-auto flex flex-col lg:flex-row gap-12 items-start">
          {/* LEFT: Form card */}
          <div className="w-full lg:w-[480px] bg-white rounded-2xl relative overflow-hidden"
               style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
            {/* Purple accent bar */}
            <div className="absolute top-0 left-8 right-8 h-1 bg-dtw-purple rounded-b-sm" />

            <form onSubmit={handleSubmit} className="p-8 pt-10 space-y-6">
              <div>
                <label htmlFor="donorName" className="block text-xs font-semibold text-dtw-warm-gray uppercase tracking-[1px] mb-2">
                  Donor Name
                </label>
                <input
                  type="text"
                  id="donorName"
                  value={donorName}
                  onChange={(e) => setDonorName(e.target.value)}
                  placeholder="e.g., Craig Newmark"
                  className="w-full text-[15px] text-dtw-black bg-dtw-warm-white border border-dtw-light-gray border-b-2 rounded px-4 py-3.5
                             focus:border-dtw-green focus:border-b-dtw-green focus:bg-white focus:outline-none
                             placeholder-dtw-mid-gray transition-all"
                  style={{ boxShadow: 'none' }}
                  onFocus={(e) => e.target.style.boxShadow = '0 0 0 3px rgba(45,106,79,0.12)'}
                  onBlur={(e) => e.target.style.boxShadow = 'none'}
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="fundraiserName" className="block text-xs font-semibold text-dtw-warm-gray uppercase tracking-[1px] mb-2">
                  Fundraiser Name
                </label>
                <input
                  type="text"
                  id="fundraiserName"
                  value={fundraiserName}
                  onChange={(e) => setFundraiserName(e.target.value)}
                  placeholder="Your name (for the Meeting Guide)"
                  className="w-full text-[15px] text-dtw-black bg-dtw-warm-white border border-dtw-light-gray border-b-2 rounded px-4 py-3.5
                             focus:border-dtw-green focus:border-b-dtw-green focus:bg-white focus:outline-none
                             placeholder-dtw-mid-gray transition-all"
                  style={{ boxShadow: 'none' }}
                  onFocus={(e) => e.target.style.boxShadow = '0 0 0 3px rgba(45,106,79,0.12)'}
                  onBlur={(e) => e.target.style.boxShadow = 'none'}
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="seedUrls" className="block text-xs font-semibold text-dtw-warm-gray uppercase tracking-[1px] mb-2">
                  Seed URL <span className="text-dtw-red">*</span>
                </label>
                <textarea
                  id="seedUrls"
                  value={seedUrls}
                  onChange={(e) => setSeedUrls(e.target.value)}
                  placeholder="Add at least one URL about this donor (e.g., LinkedIn, company bio, interview)"
                  rows={3}
                  className="w-full text-[15px] text-dtw-black bg-dtw-warm-white border border-dtw-light-gray border-b-2 rounded px-4 py-3.5
                             focus:border-dtw-green focus:border-b-dtw-green focus:bg-white focus:outline-none
                             placeholder-dtw-mid-gray transition-all resize-none"
                  style={{ boxShadow: 'none' }}
                  onFocus={(e) => e.target.style.boxShadow = '0 0 0 3px rgba(45,106,79,0.12)'}
                  onBlur={(e) => e.target.style.boxShadow = 'none'}
                  disabled={isLoading}
                />
                <p className="mt-1.5 text-xs text-dtw-mid-gray">
                  Required — this anchors our research to the right person
                </p>
              </div>

              <div className="border-t border-dtw-light-gray pt-6">
                <button
                  type="submit"
                  disabled={isLoading || !donorName.trim() || !seedUrls.trim()}
                  className="w-full rounded-pill text-[15px] font-semibold text-white bg-dtw-black py-[18px] px-8 tracking-[0.3px]
                             hover:bg-dtw-green hover:-translate-y-0.5
                             disabled:bg-dtw-light-gray disabled:text-dtw-mid-gray disabled:cursor-not-allowed disabled:hover:translate-y-0
                             transition-all duration-200"
                  style={{ boxShadow: 'none' }}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.boxShadow = '0 4px 16px rgba(45,106,79,0.3)'; }}
                  onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
                >
                  Generate Profile
                </button>
              </div>
            </form>
          </div>

          {/* RIGHT: What you'll get */}
          <div className="flex-1 lg:pt-4">
            <p className="text-[11px] font-semibold tracking-[3px] uppercase text-dtw-mid-gray mb-8">
              What you&apos;ll get
            </p>

            <div className="space-y-8">
              {/* Persuasion Profile */}
              <div className="flex items-start gap-5">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                     style={{ background: '#F0DDF5' }}>
                  <svg className="w-5 h-5" style={{ color: '#7B2D8E' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-serif text-[22px] text-dtw-black mb-1">Persuasion Profile</h3>
                  <p className="text-sm text-dtw-mid-gray leading-relaxed">Behavioral analysis of how they think, decide, and what moves them</p>
                </div>
              </div>

              {/* Meeting Guide */}
              <div className="flex items-start gap-5">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                     style={{ background: '#D8F3DC' }}>
                  <svg className="w-5 h-5" style={{ color: '#2D6A4F' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-serif text-[22px] text-dtw-black mb-1">Meeting Guide</h3>
                  <p className="text-sm text-dtw-mid-gray leading-relaxed">Tactical prep for your conversation — what to say and when</p>
                </div>
              </div>

              {/* Sources */}
              <div className="flex items-start gap-5">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                     style={{ background: '#FAE0D8' }}>
                  <svg className="w-5 h-5" style={{ color: '#E07A5F' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-serif text-[22px] text-dtw-black mb-1">Sources</h3>
                  <p className="text-sm text-dtw-mid-gray leading-relaxed">All references, fully traceable and organized by domain</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Error display */}
      {!isLoading && progressMessages.some(m => m.type === 'error') && (
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="p-4 rounded-xl bg-red-50 text-dtw-red border border-red-100">
            {progressMessages.find(m => m.type === 'error')?.message}
          </div>
        </div>
      )}

      {/* Green CTA band */}
      <div className="bg-dtw-green py-20 px-4 text-center">
        <h2 className="font-serif text-4xl text-white mb-3">
          Not just facts. <span className="italic">Intelligence.</span>
        </h2>
        <p className="text-base text-white/70 max-w-md mx-auto">
          Every profile is built from behavioral patterns, not Wikipedia summaries.
        </p>
      </div>

      {/* Footer */}
      <footer className="bg-dtw-black py-6 text-center">
        <span className="text-[11px] font-semibold tracking-[3px] uppercase text-white/25">
          Democracy Takes Work &middot; ProspectAI &middot; 2026
        </span>
      </footer>
    </div>
  );
}
