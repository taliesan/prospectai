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
  meetingGuide?: string;
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

  const renderContent = () => {
    switch (activeTab) {
      case 'persuasion-profile':
        // Show dossier content (now the primary asset)
        // Swap LLM-facing headings for user-friendly display headings
        const headingMap: Record<string, string> = {
          // Life and Career stays as-is (no mapping needed)
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
        if (!data.meetingGuide) {
          return (
            <div className="text-center py-16">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                No Meeting Guide Available
              </h2>
              <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
                Re-generate this profile to include a Meeting Guide.
              </p>
            </div>
          );
        }
        return (
          <article className="prose dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {data.meetingGuide}
            </ReactMarkdown>
          </article>
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
