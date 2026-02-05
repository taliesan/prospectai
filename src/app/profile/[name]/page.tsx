'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  dossier: { rawMarkdown: string };
  profile: { profile: string; status: string; validationPasses: number };
}

type Tab = 'persuasion-profile' | 'meeting-guide' | 'sources';

export default function ProfilePage() {
  const params = useParams();
  const donorName = decodeURIComponent(params.name as string);
  const [data, setData] = useState<ProfileData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('persuasion-profile');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load from localStorage (in production, would fetch from API/database)
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

  // Extract sources from research markdown or use sources array if available
  const extractSources = (): Source[] => {
    if (!data) return [];

    // If sources array exists, use it
    if (data.research.sources && data.research.sources.length > 0) {
      return data.research.sources;
    }

    // Otherwise, extract URLs from the raw markdown
    const markdown = data.research.rawMarkdown || '';
    const urlRegex = /https?:\/\/[^\s\)]+/g;
    const urls = markdown.match(urlRegex) || [];

    // Dedupe and create source objects
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

  // Group sources by domain
  const groupSourcesByDomain = (sources: Source[]): Map<string, Source[]> => {
    const grouped = new Map<string, Source[]>();
    sources.forEach(source => {
      try {
        const domain = new URL(source.url).hostname.replace('www.', '');
        if (!grouped.has(domain)) {
          grouped.set(domain, []);
        }
        grouped.get(domain)!.push(source);
      } catch {
        if (!grouped.has('other')) {
          grouped.set('other', []);
        }
        grouped.get('other')!.push(source);
      }
    });
    return grouped;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Profile Not Found
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            No profile data found for {donorName}
          </p>
          <a
            href="/"
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            ← Generate a new profile
          </a>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; description: string }[] = [
    { id: 'persuasion-profile', label: 'Persuasion Profile', description: 'Behavioral analysis' },
    { id: 'meeting-guide', label: 'Meeting Guide', description: 'Tactical prep' },
    { id: 'sources', label: 'Sources', description: 'Bibliography' },
  ];

  const getDownloadLabel = () => {
    switch (activeTab) {
      case 'persuasion-profile':
        return 'Download Profile';
      case 'meeting-guide':
        return null; // No download for placeholder
      case 'sources':
        return null; // No download for sources
    }
  };

  const handleDownload = () => {
    if (activeTab === 'persuasion-profile') {
      const content = data.dossier.rawMarkdown;
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${donorName.replace(/\s+/g, '_')}_persuasion_profile.md`;
      a.click();
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'persuasion-profile':
        // Show dossier content (now the primary asset)
        // Swap LLM-facing headings for user-friendly display headings
        const headingMap: Record<string, string> = {
          "The Exit Pattern and Institutional Allergies": "When They Move",
          "Authority Calibration and Access Architecture": "Power & Influence",
          "The Question as Weapon System": "How They Test You",
          "Loyalty Architecture and Relationship Durability": "Who They Protect",
          "Power Recognition and Status Games": "How They Read Power",
          "Truth-Telling as Identity Architecture": "What They Can't Fake",
          "Risk Calibration and Boundary Testing": "What They'll Risk",
          "Learning Style and Information Processing": "How They Take In Information",
          "Authority Relationship and Institutional Positioning": "Who They Answer To",
          "Communication Strategy and Audience Architecture": "How They Hold Attention",
          "The Contradiction Matrix: Where Leverage Lives": "Where to Start",
        };

        let displayMarkdown = data.dossier.rawMarkdown;
        for (const [original, replacement] of Object.entries(headingMap)) {
          displayMarkdown = displayMarkdown.replace(original, replacement);
        }

        return (
          <article className="prose dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {displayMarkdown}
            </ReactMarkdown>
          </article>
        );

      case 'meeting-guide':
        // Placeholder for future Meeting Guide
        return (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🚧</div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Meeting Guide Coming Soon
            </h2>
            <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
              We're building a tactical meeting preparation document with specific openers,
              pivot points, and follow-up strategies tailored to this donor.
            </p>
          </div>
        );

      case 'sources':
        // Clean source bibliography
        const sources = extractSources();
        const groupedSources = groupSourcesByDomain(sources);

        if (sources.length === 0) {
          return (
            <div className="text-center py-16">
              <p className="text-gray-600 dark:text-gray-400">
                No sources available
              </p>
            </div>
          );
        }

        return (
          <div className="space-y-6">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {sources.length} source{sources.length !== 1 ? 's' : ''} used to generate this profile
            </p>

            {Array.from(groupedSources.entries()).sort().map(([domain, domainSources]) => (
              <div key={domain} className="space-y-2">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                  {domain}
                </h3>
                <ul className="space-y-2">
                  {domainSources.map((source, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-gray-400 mt-1">•</span>
                      <div className="flex-1 min-w-0">
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-700 dark:text-blue-400
                                     dark:hover:text-blue-300 break-all text-sm"
                        >
                          {source.title || source.url}
                        </a>
                        {source.title && source.title !== new URL(source.url).hostname.replace('www.', '') && (
                          <p className="text-xs text-gray-500 dark:text-gray-500 truncate">
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
        );
    }
  };

  const downloadLabel = getDownloadLabel();

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-950 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <a
                href="/"
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                ← Back
              </a>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {donorName}
              </h1>
            </div>
            <div className="flex gap-2">
              {downloadLabel && (
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700
                             hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  {downloadLabel}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {tab.label}
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                  {tab.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {renderContent()}
      </main>
    </div>
  );
}
