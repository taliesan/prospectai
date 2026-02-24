'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

interface ProgressEvent {
  type: 'status' | 'complete' | 'error' | 'ping' | 'phase';
  message: string;
  phase?: 'research' | 'analysis' | 'writing';
  step?: number;
  totalSteps?: number;
  detail?: string;
}

export default function Home() {
  const { data: session } = useSession();
  const [donorName, setDonorName] = useState('');
  const [fundraiserName, setFundraiserName] = useState('');
  const [seedUrls, setSeedUrls] = useState('');
  const [linkedinPdf, setLinkedinPdf] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progressMessages, setProgressMessages] = useState<ProgressEvent[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string>('');
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(28);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activity, setActivity] = useState<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const router = useRouter();

  // Pre-fill form from query params (e.g. from Regenerate button)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const donor = params.get('donor');
    const seedUrl = params.get('seedUrl');
    if (donor) setDonorName(donor);
    if (seedUrl) setSeedUrls(seedUrl);
  }, []);

  // Polish item 5: URL validation state
  const hasValidUrl = /^https?:\/\/.+\..+/m.test(seedUrls);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!donorName.trim() || !seedUrls.trim()) return;

    setIsLoading(true);
    setProgressMessages([]);
    setCurrentPhase('');
    setCurrentStep(0);
    setTotalSteps(28);

    try {
      // Convert LinkedIn PDF to base64 if provided
      let linkedinPdfBase64: string | undefined;
      if (linkedinPdf) {
        console.log('[Form] LinkedIn PDF selected:', linkedinPdf.name, 'size:', linkedinPdf.size);
        const arrayBuffer = await linkedinPdf.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        linkedinPdfBase64 = btoa(binary);
        console.log('[Form] LinkedIn base64 length:', linkedinPdfBase64.length);
      } else {
        console.log('[Form] No LinkedIn PDF selected');
      }

      // Step 1: Submit job — returns immediately with jobId
      const submitResponse = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          donorName: donorName.trim(),
          fundraiserName: fundraiserName.trim(),
          seedUrls: [seedUrls.trim()].filter(Boolean),
          linkedinPdf: linkedinPdfBase64,
        })
      });

      if (!submitResponse.ok) {
        throw new Error('Generation failed');
      }

      const { jobId } = await submitResponse.json();
      console.log('[SSE] Job submitted:', jobId);
      setActiveJobId(jobId);

      // Shared handler for both SSE events and poll responses
      const handleJobData = (data: any) => {
        if (data.type === 'complete') {
          eventSourceRef.current?.close();
          eventSourceRef.current = null;
          setActiveJobId(null);
          // Navigate to the profile by database ID if available, fall back to name
          const profileId = data.result?.profileId;
          if (profileId) {
            router.push(`/profile/${profileId}`);
          } else {
            localStorage.setItem('lastProfile', JSON.stringify(data.result));
            router.push(`/profile/${encodeURIComponent(donorName.trim())}`);
          }
          return true;
        }
        if (data.type === 'error') {
          eventSourceRef.current?.close();
          eventSourceRef.current = null;
          setActiveJobId(null);
          setProgressMessages(prev => [...prev, {
            type: 'error' as const,
            message: `Error: ${data.message || 'Generation failed'}`
          }]);
          setIsLoading(false);
          return true;
        }
        if (data.type === 'cancelled') {
          eventSourceRef.current?.close();
          eventSourceRef.current = null;
          setActiveJobId(null);
          setProgressMessages(prev => [...prev, {
            type: 'status' as const,
            message: 'Research cancelled.'
          }]);
          setIsLoading(false);
          return true;
        }

        // Progress update
        if (data.phase) setCurrentPhase(data.phase);
        if (data.step) setCurrentStep(data.step);
        if (data.totalSteps) setTotalSteps(data.totalSteps);
        if (data.activity) setActivity(data.activity);
        if (data.message) {
          setProgressMessages(prev => {
            const lastMsg = prev[prev.length - 1]?.message;
            if (lastMsg !== data.message) {
              return [...prev, { type: 'status' as const, message: data.message }];
            }
            return prev;
          });
        }
        if (data.milestones?.length) {
          setProgressMessages(prev => {
            const existingMilestones = new Set(prev.filter(m => m.message.startsWith('\u2713')).map(m => m.message));
            const newMilestones = data.milestones.filter((m: string) => !existingMilestones.has(m));
            if (newMilestones.length > 0) {
              return [...prev, ...newMilestones.map((m: string) => ({ type: 'status' as const, message: m }))];
            }
            return prev;
          });
        }
        return false;
      };

      // Polling fallback — called when SSE drops
      const startPollingFallback = () => {
        console.warn('[Poll] SSE lost, falling back to polling every 4s');
        const POLL_INTERVAL = 4_000;
        const MAX_POLL_DURATION = 45 * 60 * 1000;
        const pollStart = Date.now();

        const loop = async () => {
          while (true) {
            if (Date.now() - pollStart > MAX_POLL_DURATION) {
              setProgressMessages(prev => [...prev, {
                type: 'error' as const,
                message: 'Error: Generation timed out. Please try again.'
              }]);
              setIsLoading(false);
              setActiveJobId(null);
              return;
            }
            try {
              const res = await fetch(`/api/generate/status/${jobId}`);
              if (!res.ok) throw new Error(`Status ${res.status}`);
              const status = await res.json();

              const mapped = status.status === 'complete'
                ? { type: 'complete', result: status.result }
                : status.status === 'failed'
                  ? { type: 'error', message: status.error }
                  : status.status === 'cancelled'
                    ? { type: 'cancelled' }
                    : {
                        type: 'progress',
                        phase: status.phase,
                        step: status.step,
                        totalSteps: status.totalSteps,
                        message: status.message,
                        milestones: status.milestones,
                        activity: status.activity,
                      };
              if (handleJobData(mapped)) return;
            } catch (err) {
              console.warn('[Poll] Error (will retry):', err);
            }
            await new Promise(r => setTimeout(r, POLL_INTERVAL));
          }
        };
        loop();
      };

      // Step 2: Open SSE stream for real-time progress
      const es = new EventSource(`/api/job-status/${jobId}`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          handleJobData(JSON.parse(event.data));
        } catch (e) {
          console.warn('[SSE] Parse error:', e);
        }
      };

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        startPollingFallback();
      };
    } catch (error) {
      console.error('Error:', error);
      setProgressMessages(prev => [...prev, {
        type: 'error' as const,
        message: 'Error: Generation failed. Please try again.'
      }]);
      setIsLoading(false);
    }
  };

  // Loading state — full dark screen with progress
  if (isLoading) {
    // Weighted progress: Research 0–40%, Analysis 40–80%, Writing 80–100%
    const progressPercent = Math.min((currentStep / totalSteps) * 100, 98);

    // Phase labels for the card header
    const phaseLabels: Record<string, string> = {
      'research': 'RESEARCHING',
      'analysis': 'ANALYZING BEHAVIOR',
      'writing': 'WRITING DOCUMENTS',
    };
    const phaseLabel = phaseLabels[currentPhase] || 'STARTING';

    return (
      <div className="min-h-screen bg-dtw-black">
        {/* Animated gradient bar */}
        <div
          className="h-[5px] w-full"
          style={{
            background: 'linear-gradient(90deg, #7B2D8E, #C77DFF, #2D6A4F, #40916C, #7B2D8E)',
            backgroundSize: '300% 100%',
            animation: 'gradientShift 8s ease-in-out infinite',
          }}
        />

        {/* Version badge — loading screen */}
        <div className="flex justify-end px-6 pt-4">
          <span className="text-[10px] font-semibold tracking-[2px] uppercase text-white/30 border border-white/15 rounded px-2 py-0.5">
            v3.57
          </span>
        </div>

        <div className="flex flex-col items-center justify-center min-h-[90vh] px-4">
          <h1 className="font-serif text-5xl text-white mb-8">{donorName}</h1>

          {/* Progress bar */}
          <div className="w-full max-w-[400px] mb-10">
            <div className="h-1 rounded-full bg-white/10">
              <div
                className="h-1 rounded-full bg-dtw-green transition-all duration-700"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Single status display — always visible */}
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
              {phaseLabel}
            </p>

            {/* Current status — single line, overwrites */}
            <div className="flex items-center gap-2 mb-3">
              <span className="streaming-dot flex-shrink-0" />
              <p className={`text-sm ${
                progressMessages[progressMessages.length - 1]?.type === 'error'
                  ? 'text-dtw-red'
                  : 'text-white'
              }`}>
                {progressMessages.length > 0
                  ? progressMessages[progressMessages.length - 1]?.message
                  : 'Starting...'}
              </p>
            </div>

            {/* Deep research activity — real-time OpenAI data */}
            {activity && currentPhase === 'research' && activity.openaiStatus && (
              <div className="border-t border-white/10 pt-3 mt-3">
                {/* Search/page counters */}
                {(activity.searches > 0 || activity.pageVisits > 0) && (
                  <div className="flex gap-4 text-xs text-white/50 mb-2">
                    {activity.searches > 0 && (
                      <span>{activity.searches} web searches</span>
                    )}
                    {activity.pageVisits > 0 && (
                      <span>{activity.pageVisits} pages analyzed</span>
                    )}
                    {activity.reasoningSteps > 0 && (
                      <span>{activity.reasoningSteps} reasoning steps</span>
                    )}
                  </div>
                )}

                {/* Recent search queries */}
                {activity.recentSearchQueries?.length > 0 && (
                  <div className="space-y-0.5 mb-2">
                    <p className="text-[10px] font-semibold tracking-[2px] uppercase text-white/30">Recent searches</p>
                    {activity.recentSearchQueries.slice(-3).map((q: string, i: number) => (
                      <p key={i} className="text-xs text-white/40 truncate">&ldquo;{q}&rdquo;</p>
                    ))}
                  </div>
                )}

                {/* Reasoning summary */}
                {activity.reasoningSummary?.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-semibold tracking-[2px] uppercase text-white/30">Model reasoning</p>
                    {activity.reasoningSummary.slice(-1).map((s: string, i: number) => (
                      <p key={i} className="text-xs text-white/40 italic">{s}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Completed milestones — newest on top */}
            {progressMessages.filter(msg => msg.message.startsWith('\u2713')).length > 0 && (
              <div className="border-t border-white/10 pt-3 space-y-1">
                {progressMessages
                  .filter(msg => msg.message.startsWith('\u2713'))
                  .reverse()
                  .slice(0, 6)
                  .map((msg, i) => (
                    <div key={i} className="text-xs text-dtw-green-light/70">
                      {msg.message}
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Cancel button — user-initiated only */}
          {activeJobId && (
            <button
              className="mt-6 text-xs text-white/30 hover:text-white/60 transition-colors duration-200 underline underline-offset-2"
              onClick={async () => {
                try {
                  eventSourceRef.current?.close();
                  eventSourceRef.current = null;
                  await fetch(`/api/generate/cancel/${activeJobId}`, { method: 'POST' });
                  setActiveJobId(null);
                  setActivity(null);
                  setProgressMessages(prev => [...prev, {
                    type: 'status' as const,
                    message: 'Research cancelled.'
                  }]);
                  setIsLoading(false);
                } catch (err) {
                  console.warn('[Cancel] Failed:', err);
                }
              }}
            >
              Cancel research
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Gradient bar */}
      <div
        className="h-[5px] w-full"
        style={{
          background: 'linear-gradient(90deg, #7B2D8E, #C77DFF, #2D6A4F, #40916C, #7B2D8E)',
          backgroundSize: '300% 100%',
          animation: 'gradientShift 8s ease-in-out infinite',
        }}
      />

      {/* Dark nav bar */}
      <nav className="bg-dtw-black px-6 py-4 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[3px] uppercase text-white/50">
          Democracy Takes Work
        </span>
        <div className="flex items-center gap-4">
          {session?.user?.name && (
            <span className="text-xs text-white/40">{session.user.name}</span>
          )}
          <a href="/profiles" className="text-xs text-white/40 hover:text-white/70 transition-colors">
            Profiles
          </a>
          {session?.user?.isAdmin && (
            <a href="/admin" className="text-xs text-purple-400/70 hover:text-purple-300 transition-colors">
              Admin
            </a>
          )}
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="text-xs text-white/30 hover:text-white/60 transition-colors"
          >
            Sign out
          </button>
          <span className="text-[10px] font-semibold tracking-[2px] uppercase text-white/30 border border-white/15 rounded px-2 py-0.5">
            v3.57
          </span>
        </div>
      </nav>

      {/* Dark hero section */}
      <div className="relative bg-dtw-black overflow-hidden">
        <div
          className="absolute top-0 right-0 w-[600px] h-[600px] opacity-20"
          style={{ background: 'radial-gradient(circle at 70% 30%, #7B2D8E, transparent 60%)' }}
        />
        <div
          className="absolute bottom-0 left-0 w-[500px] h-[500px] opacity-15"
          style={{ background: 'radial-gradient(circle at 30% 70%, #2D6A4F, transparent 60%)' }}
        />

        <div className="relative z-10 text-center py-14 pb-20 px-4">
          <h1 className="font-serif text-[80px] leading-[1.05] text-white mb-4">
            Prospect<span className="font-serif italic" style={{ color: '#D894E8' }}>AI</span>
          </h1>
          <p className="text-xl text-white/55 max-w-lg mx-auto">
            Behavioral intelligence for high-stakes donor meetings
          </p>
        </div>
      </div>

      <div
        className="h-24 bg-dtw-black"
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 60%, 0 100%)' }}
      />

      {/* Form section */}
      <div className="bg-dtw-off-white py-16 px-4">
        <div className="max-w-5xl mx-auto flex flex-col lg:flex-row gap-12 items-start animate-fade-in-up opacity-0"
             style={{ animationDelay: '0.2s' }}>
          {/* LEFT: Form card */}
          <div className="w-full lg:w-[480px] bg-white rounded-2xl relative overflow-hidden"
               style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)' }}>
            <div className="absolute top-0 left-8 right-8 h-1 bg-dtw-purple rounded-b-sm"
                 style={{ boxShadow: '0 2px 8px rgba(123,45,142,0.15)' }} />

            <form onSubmit={handleSubmit} className="p-8 pt-10 space-y-6">
              <h2 className="font-serif text-2xl text-dtw-black">Start a Profile</h2>

              <div>
                <label htmlFor="donorName" className="block text-xs font-semibold text-dtw-warm-gray tracking-[1px] mb-2">
                  Donor name
                </label>
                <input
                  type="text"
                  id="donorName"
                  value={donorName}
                  onChange={(e) => setDonorName(e.target.value)}
                  placeholder="e.g., Craig Newmark"
                  className="w-full text-[15px] text-dtw-black border border-dtw-light-gray border-b-2 rounded px-4 py-3.5
                             focus:border-dtw-green focus:border-b-dtw-green focus:bg-white focus:outline-none
                             placeholder-dtw-mid-gray transition-all"
                  style={{ boxShadow: 'none', background: '#F5F3EF', borderBottomColor: '#D5D2CC' }}
                  onFocus={(e) => { e.target.style.boxShadow = '0 0 0 3px rgba(45,106,79,0.12)'; e.target.style.background = 'white'; }}
                  onBlur={(e) => { e.target.style.boxShadow = 'none'; e.target.style.background = '#F5F3EF'; }}
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="fundraiserName" className="block text-xs font-semibold text-dtw-warm-gray tracking-[1px] mb-2">
                  Fundraiser name
                </label>
                <input
                  type="text"
                  id="fundraiserName"
                  value={fundraiserName}
                  onChange={(e) => setFundraiserName(e.target.value)}
                  placeholder="Your name (for the Meeting Guide)"
                  className="w-full text-[15px] text-dtw-black border border-dtw-light-gray border-b-2 rounded px-4 py-3.5
                             focus:border-dtw-green focus:border-b-dtw-green focus:bg-white focus:outline-none
                             placeholder-dtw-mid-gray transition-all"
                  style={{ boxShadow: 'none', background: '#F5F3EF', borderBottomColor: '#D5D2CC' }}
                  onFocus={(e) => { e.target.style.boxShadow = '0 0 0 3px rgba(45,106,79,0.12)'; e.target.style.background = 'white'; }}
                  onBlur={(e) => { e.target.style.boxShadow = 'none'; e.target.style.background = '#F5F3EF'; }}
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-dtw-warm-gray tracking-[1px] mb-2">
                  LinkedIn profile PDF
                </label>
                <div
                  className={`relative rounded border-2 border-dashed px-4 py-5 text-center cursor-pointer transition-all ${
                    isDragging
                      ? 'border-purple-500 bg-purple-50'
                      : linkedinPdf
                        ? 'border-dtw-green bg-green-50/50'
                        : 'border-dtw-light-gray hover:border-purple-300'
                  }`}
                  style={{ background: isDragging ? undefined : linkedinPdf ? undefined : '#F5F3EF' }}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const file = e.dataTransfer.files[0];
                    if (file?.type === 'application/pdf') setLinkedinPdf(file);
                  }}
                  onClick={() => document.getElementById('linkedinPdf')?.click()}
                >
                  <input
                    type="file"
                    id="linkedinPdf"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => setLinkedinPdf(e.target.files?.[0] || null)}
                    disabled={isLoading}
                  />
                  {linkedinPdf ? (
                    <div className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 text-dtw-green" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      <span className="text-sm text-dtw-black font-medium">{linkedinPdf.name}</span>
                      <button
                        type="button"
                        className="ml-2 text-xs text-dtw-mid-gray hover:text-dtw-red"
                        onClick={(e) => { e.stopPropagation(); setLinkedinPdf(null); }}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-dtw-mid-gray">
                        <span className="font-medium text-purple-700">Choose a file</span> or drag and drop
                      </p>
                      <p className="text-xs text-dtw-mid-gray/70 mt-1">PDF only</p>
                    </div>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-dtw-mid-gray">
                  Recommended — ensures accurate title and career history.<br />
                  <span className="font-medium">How to save:</span> Open their LinkedIn profile &rarr; More &rarr; Save to PDF
                </p>
              </div>

              <div>
                <label htmlFor="seedUrls" className="block text-xs font-semibold text-dtw-warm-gray tracking-[1px] mb-2">
                  Seed URL <span className="text-dtw-red">*</span>
                </label>
                <input
                  type="url"
                  id="seedUrls"
                  value={seedUrls}
                  onChange={(e) => setSeedUrls(e.target.value)}
                  placeholder="https://linkedin.com/in/donor-name"
                  className={`w-full text-[15px] text-dtw-black border border-dtw-light-gray border-b-2 rounded px-4 py-3.5
                             focus:border-dtw-green focus:border-b-dtw-green focus:bg-white focus:outline-none
                             placeholder-dtw-mid-gray transition-all
                             ${hasValidUrl ? 'border-dtw-green' : ''}`}
                  style={{
                    boxShadow: 'none',
                    background: '#F5F3EF',
                    borderBottomColor: hasValidUrl ? '#2D6A4F' : '#D5D2CC',
                  }}
                  onFocus={(e) => { e.target.style.boxShadow = '0 0 0 3px rgba(45,106,79,0.12)'; e.target.style.background = 'white'; }}
                  onBlur={(e) => { e.target.style.boxShadow = 'none'; e.target.style.background = '#F5F3EF'; }}
                  disabled={isLoading}
                />
                <p className="mt-1.5 text-xs text-dtw-mid-gray">
                  Paste a LinkedIn, company bio, or interview link to anchor research
                </p>
              </div>

              <div className="border-t border-dtw-light-gray pt-6">
                <button
                  type="submit"
                  disabled={isLoading || !donorName.trim() || !seedUrls.trim()}
                  className="w-full rounded-pill text-[15px] font-semibold text-white py-[18px] px-8 tracking-[0.3px]
                             hover:-translate-y-0.5
                             disabled:bg-dtw-light-gray disabled:text-dtw-mid-gray disabled:cursor-not-allowed disabled:hover:translate-y-0
                             transition-all duration-300"
                  style={{
                    boxShadow: 'none',
                    background: (!donorName.trim() || !seedUrls.trim()) ? undefined : '#6B21A8',
                    ...((!donorName.trim() || !seedUrls.trim()) ? { border: '1px solid #D5D2CC' } : {}),
                  }}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.background = '#581C87'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(107,33,168,0.3)'; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = (!donorName.trim() || !seedUrls.trim()) ? '' : '#6B21A8'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  Generate Profile
                </button>
                <p className="text-center text-xs text-dtw-mid-gray mt-3">
                  Takes 2 – 4 minutes. You&apos;ll see progress in real time.
                </p>
              </div>
            </form>
          </div>

          {/* RIGHT: What you'll get */}
          <div className="flex-1 lg:pt-[40px]" style={{ borderLeft: '3px solid #6B21A8', paddingLeft: '24px' }}>
            <p className="text-[11px] font-semibold tracking-[3px] uppercase text-dtw-mid-gray mb-8">
              What you&apos;ll get
            </p>

            <div className="space-y-8">
              <div className="flex items-start gap-5">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                     style={{ background: '#7B2D8E' }}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-serif text-[22px] text-dtw-black mb-1">Persuasion Profile</h3>
                  <p className="text-sm text-dtw-mid-gray leading-relaxed">Behavioral analysis of how they think, decide, and what moves them</p>
                </div>
              </div>

              <div className="flex items-start gap-5">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                     style={{ background: '#2D6A4F' }}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-serif text-[22px] text-dtw-black mb-1">Meeting Guide</h3>
                  <p className="text-sm text-dtw-mid-gray leading-relaxed">Tactical prep for your conversation — what to say and when</p>
                </div>
              </div>

              <div className="flex items-start gap-5">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                     style={{ background: '#E07A5F' }}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
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

      <div className="bg-dtw-green py-20 px-4 text-center">
        <h2 className="font-serif text-[42px] tracking-tight text-white mb-3">
          Not just facts. <span className="italic">Intelligence.</span>
        </h2>
        <p className="text-[17px] text-white/65 max-w-md mx-auto">
          Every profile is built from behavioral patterns, not Wikipedia summaries.
        </p>
      </div>

      <footer
        className="py-6 text-center"
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(123,45,142,0.08), #1A1A1A 70%)',
          borderTop: '1px solid rgba(123,45,142,0.3)',
        }}
      >
        <span className="text-[11px] font-semibold tracking-[3px] uppercase text-white/25">
          Democracy Takes Work &middot; ProspectAI &middot; 2026
        </span>
      </footer>
    </div>
  );
}
