'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { downloadProfile, type DownloadableProfile } from '@/lib/download-document';
import { parseProfileForPDF } from '@/lib/pdf/parse-profile';
import MeetingGuideRenderer from '@/components/MeetingGuideRenderer';

interface Source {
  url: string;
  title: string;
  snippet?: string;
}

interface ProfileData {
  research: {
    rawMarkdown: string;
    sources?: Source[];
  };
  researchProfile: { rawMarkdown: string };
  profile: { profile: string; status: string; validationPasses: number };
  meetingGuide?: string;
  meetingGuideHtml?: string;
}

type Tab = 'persuasion-profile' | 'meeting-guide' | 'sources';

// Per-tab accent colors
const tabAccents: Record<Tab, { border: string; color: string; bg: string }> = {
  'persuasion-profile': { border: '#D894E8', color: '#D894E8', bg: '#7B2D8E' },
  'meeting-guide': { border: '#40916C', color: '#40916C', bg: '#2D6A4F' },
  'sources': { border: '#E07A5F', color: '#E07A5F', bg: '#E07A5F' },
};

export default function ProfilePage() {
  const params = useParams();
  const donorName = decodeURIComponent(params.name as string);
  const [data, setData] = useState<ProfileData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('persuasion-profile');
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async (format: 'html' | 'markdown' = 'html') => {
    if (!data) return;
    setIsDownloading(true);
    try {
      let fundraiserName = '';
      try {
        const raw = localStorage.getItem('lastProfile');
        if (raw) {
          const parsed = JSON.parse(raw);
          fundraiserName = parsed.fundraiserName || '';
        }
      } catch { /* ignore */ }

      const downloadData: DownloadableProfile = {
        donorName,
        fundraiserName,
        profile: data.researchProfile.rawMarkdown,
        meetingGuide: data.meetingGuide,
        sources: extractSources(),
      };
      downloadProfile(downloadData, format);
    } catch (err) {
      console.error('Download failed:', err);
      alert('Download failed. Please try again.');
    } finally {
      setTimeout(() => setIsDownloading(false), 800);
    }
  };

  const handleDownloadPDF = async () => {
    if (!data) return;
    setIsDownloading(true);
    try {
      let fundraiserName = '';
      try {
        const raw = localStorage.getItem('lastProfile');
        if (raw) {
          const parsed = JSON.parse(raw);
          fundraiserName = parsed.fundraiserName || '';
        }
      } catch { /* ignore */ }

      const sources = extractSources();
      const profileData = parseProfileForPDF(
        donorName,
        fundraiserName,
        data.researchProfile.rawMarkdown,
        data.meetingGuide,
        sources
      );

      const response = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileData }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `PDF generation failed (${response.status})`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeName = donorName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
      link.href = url;
      link.download = `ProspectAI_${safeName}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error('PDF download failed:', err);
      // Fall back to HTML download
      handleDownload('html');
    } finally {
      setTimeout(() => setIsDownloading(false), 800);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem('lastProfile');
    if (stored) {
      try {
        setData(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse stored profile:', e);
      }
    }
    setIsLoading(false);
  }, []);

  const extractSources = (): Source[] => {
    if (!data) return [];
    if (data.research.sources && data.research.sources.length > 0) {
      return data.research.sources;
    }
    const markdown = data.research.rawMarkdown || '';
    const urlRegex = /https?:\/\/[^\s\)]+/g;
    const urls = markdown.match(urlRegex) || [];
    const uniqueUrls = Array.from(new Set(urls));
    return uniqueUrls.map(url => {
      try {
        const domain = new URL(url).hostname.replace('www.', '');
        return { url, title: domain };
      } catch {
        return { url, title: url };
      }
    });
  };

  const groupSourcesByDomain = (sources: Source[]): Map<string, Source[]> => {
    const grouped = new Map<string, Source[]>();
    sources.forEach(source => {
      try {
        const domain = new URL(source.url).hostname.replace('www.', '');
        if (!grouped.has(domain)) grouped.set(domain, []);
        grouped.get(domain)!.push(source);
      } catch {
        if (!grouped.has('other')) grouped.set('other', []);
        grouped.get('other')!.push(source);
      }
    });
    return grouped;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-dtw-off-white flex items-center justify-center">
        <div className="text-dtw-mid-gray font-serif text-xl">Loading...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-dtw-off-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-serif text-3xl text-dtw-black mb-4">Profile Not Found</h1>
          <p className="text-dtw-mid-gray mb-6">No profile data found for {donorName}</p>
          <a href="/" className="text-dtw-green hover:text-dtw-green-light transition-colors">
            ← Generate a new profile
          </a>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'persuasion-profile', label: 'Persuasion Profile' },
    { id: 'meeting-guide', label: 'Meeting Guide' },
    { id: 'sources', label: 'Sources' },
  ];

  const currentAccent = tabAccents[activeTab];
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const renderContent = () => {
    switch (activeTab) {
      case 'persuasion-profile': {
        const headingMap: Record<string, string> = {
          "Decision-Making Patterns": "How They Decide",
          "Trust Calibration": "How They Build Trust",
          "Influence Susceptibility": "What Moves Them",
          "Communication Style": "How They Communicate",
          "Learning Style": "How They Learn",
          "Time Orientation": "How They Think About Time",
          "Identity & Self-Concept": "Who They Think They Are",
          "Values Hierarchy": "What They Value Most",
          "Status & Recognition": "How They Read Status",
          "Boundary Conditions": "Where They Draw Lines",
          "Emotional Triggers": "What Sets Them Off",
          "Relationship Patterns": "How They Build Relationships",
          "Risk Tolerance": "What They'll Risk",
          "Resource Philosophy": "How They Think About Resources",
          "Commitment Patterns": "How They Commit",
          "Knowledge Areas": "What They Know",
          "Contradiction Patterns": "Where to Start",
        };

        let displayMarkdown = data.researchProfile.rawMarkdown;
        for (const [original, replacement] of Object.entries(headingMap)) {
          displayMarkdown = displayMarkdown.replace(original, replacement);
        }

        return (
          <div className="bg-white rounded-2xl border border-dtw-light-gray relative overflow-hidden"
               style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
            <div className="absolute top-0 left-7 right-7 h-1 bg-dtw-purple rounded-b-sm" />
            <div className="p-9 pt-10">
              <article className="prose max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => {
                      const text = String(children);
                      const match = text.match(/^PERSUASION PROFILE\s*[—–-]\s*(.+)$/i);
                      if (match) {
                        return (
                          <div className="not-prose mb-12 relative">
                            <div className="text-xs font-medium tracking-[0.12em] uppercase text-stone-500 mb-1.5">
                              Persuasion Profile
                            </div>
                            <div className="font-serif text-[32px] font-bold tracking-tight leading-tight text-stone-900">
                              {match[1]}
                            </div>
                            <div className="mt-5 h-0.5 bg-stone-900" />
                          </div>
                        );
                      }
                      return <h1>{children}</h1>;
                    },
                  }}
                >
                  {displayMarkdown}
                </ReactMarkdown>
              </article>
            </div>
          </div>
        );
      }

      case 'meeting-guide': {
        if (!data.meetingGuide) {
          return (
            <div className="bg-white rounded-2xl border border-dtw-light-gray p-12 text-center"
                 style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
              <h2 className="font-serif text-2xl text-dtw-black mb-2">No Meeting Guide Available</h2>
              <p className="text-dtw-mid-gray max-w-md mx-auto">
                Re-generate this profile to include a Meeting Guide.
              </p>
            </div>
          );
        }

        // Primary path: render markdown with React component (site-side rendering)
        return (
          <div
            className="rounded-2xl border border-dtw-light-gray relative overflow-hidden bg-white"
            style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}
          >
            <div className="absolute top-0 left-7 right-7 h-1 bg-dtw-green rounded-b-sm" />
            <MeetingGuideRenderer markdown={data.meetingGuide} />
          </div>
        );
      }

      case 'sources': {
        const sources = extractSources();
        const groupedSources = groupSourcesByDomain(sources);

        if (sources.length === 0) {
          return (
            <div className="bg-white rounded-2xl border border-dtw-light-gray p-12 text-center"
                 style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
              <p className="text-dtw-mid-gray">No sources available</p>
            </div>
          );
        }

        return (
          <div className="bg-white rounded-2xl border border-dtw-light-gray relative overflow-hidden"
               style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
            <div className="absolute top-0 left-7 right-7 h-1 bg-dtw-coral rounded-b-sm" />
            <div className="p-9 pt-10 space-y-8">
              <div className="flex items-center justify-between">
                <p className="text-sm text-dtw-mid-gray">
                  {sources.length} source{sources.length !== 1 ? 's' : ''} used to generate this profile
                </p>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/research-dump?name=${encodeURIComponent(donorName)}`);
                      if (!res.ok) throw new Error('No research data available');
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      const safe = donorName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
                      link.href = url;
                      link.download = `${safe}-research.json`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      setTimeout(() => URL.revokeObjectURL(url), 5000);
                    } catch {
                      alert('Research data not available. Generate a new profile to capture research data.');
                    }
                  }}
                  className="text-xs font-medium text-dtw-coral hover:text-dtw-warm-gray transition-colors"
                >
                  Download Research Data
                </button>
              </div>

              {Array.from(groupedSources.entries()).sort().map(([domain, domainSources]) => (
                <div key={domain} className="space-y-3">
                  <h3 className="text-xs font-semibold text-dtw-warm-gray uppercase tracking-[1px]">
                    {domain}
                  </h3>
                  <ul className="space-y-2">
                    {domainSources.map((source, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-dtw-coral mt-0.5 text-xs font-semibold">{'\u2022'}</span>
                        <div className="flex-1 min-w-0">
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-dtw-coral hover:text-dtw-warm-gray break-all text-sm transition-colors"
                          >
                            {source.title || source.url}
                          </a>
                          {source.title && source.title !== new URL(source.url).hostname.replace('www.', '') && (
                            <p className="text-xs text-dtw-mid-gray truncate mt-0.5">
                              {source.url}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        );
      }
    }
  };

  return (
    <div className="min-h-screen bg-dtw-off-white">
      {/* Rainbow accent bar */}
      <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, #7B2D8E, #2D6A4F, #E07A5F)' }} />

      {/* Dark header */}
      <header className="bg-dtw-black">
        <div className="max-w-4xl mx-auto px-6 pt-5 pb-0">
          {/* Top row: back link + download button */}
          <div className="flex items-center justify-between mb-6">
            <a href="/" className="text-[13px] text-white/50 hover:text-white transition-colors">
              ← New Profile
            </a>
            <button
              onClick={handleDownloadPDF}
              disabled={isDownloading}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-pill
                         bg-white text-dtw-black hover:bg-dtw-gold
                         disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isDownloading ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Preparing...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download
                </>
              )}
            </button>
          </div>

          {/* Overline */}
          <p className="text-[11px] font-semibold tracking-[3px] uppercase mb-3" style={{ color: '#D894E8' }}>
            Donor Intelligence Report
          </p>

          {/* Donor name */}
          <h1 className="font-serif text-[56px] leading-[1.1] text-white mb-2">{donorName}</h1>

          {/* Date */}
          <p className="text-[15px] text-white/40 mb-8">{date}</p>

          {/* Tabs */}
          <div className="flex gap-1">
            {tabs.map(tab => {
              const accent = tabAccents[tab.id];
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="px-5 py-3.5 text-sm font-medium transition-colors relative"
                  style={{ color: isActive ? 'white' : 'rgba(255,255,255,0.4)' }}
                >
                  {tab.label}
                  {isActive && (
                    <div
                      className="absolute bottom-0 left-2 right-2 h-[3px] rounded-t-sm"
                      style={{ background: accent.border }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[800px] mx-auto px-4 py-10">
        {renderContent()}

        {/* Debug Downloads */}
        <details className="mt-8 border-t border-dtw-light-gray pt-4">
          <summary className="cursor-pointer text-sm text-dtw-mid-gray hover:text-dtw-warm-gray transition-colors">
            Debug Files
          </summary>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { file: 'screening-audit', label: 'Screening Audit' },
              { file: 'source-selection', label: 'Source Selection' },
              { file: 'source-packet-manifest', label: 'Source Packet Manifest' },
              { file: 'deep-research-developer-msg', label: 'Deep Research Dev Msg' },
              { file: 'deep-research-user-msg', label: 'Deep Research User Msg' },
              { file: 'fact-check', label: 'Fact Check' },
              { file: 'research-package', label: 'Research Package' },
              { file: 'research-conversation', label: 'Agent Conversation' },
              { file: 'prompt', label: 'Profile Prompt' },
              { file: 'first-draft', label: 'First Draft' },
              { file: 'critique-prompt', label: 'Critique Prompt' },
              { file: 'final', label: 'Final Profile' },
              { file: 'meeting-guide-prompt', label: 'Meeting Guide Prompt' },
              { file: 'meeting-guide', label: 'Meeting Guide (MD)' },
              { file: 'meeting-guide-html', label: 'Meeting Guide (HTML)' },
              { file: 'linkedin', label: 'LinkedIn Data' },
            ].map(({ file, label }) => {
              const ext = file === 'linkedin' || file === 'fact-check' ? 'json'
                : file === 'meeting-guide-html' ? 'html'
                : file === 'meeting-guide' ? 'md'
                : 'txt';
              return (
                <a
                  key={file}
                  href={`/api/debug-dump?file=${file}`}
                  download={`DEBUG-${file}.${ext}`}
                  className="px-3 py-1.5 text-xs font-medium bg-dtw-off-white hover:bg-dtw-light-gray text-dtw-warm-gray rounded transition-colors"
                >
                  {label}
                </a>
              );
            })}
          </div>
        </details>
      </main>

      {/* Footer */}
      <footer className="bg-dtw-black py-6 text-center">
        <span className="text-[11px] font-semibold tracking-[3px] uppercase text-white/25">
          Democracy Takes Work &middot; ProspectAI &middot; 2026
        </span>
      </footer>
    </div>
  );
}
