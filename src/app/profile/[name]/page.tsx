'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ProfileData {
  research: { rawMarkdown: string };
  dossier: { rawMarkdown: string };
  profile: { profile: string; status: string; validationPasses: number };
}

type Tab = 'profile' | 'dossier' | 'research';

export default function ProfilePage() {
  const params = useParams();
  const donorName = decodeURIComponent(params.name as string);
  const [data, setData] = useState<ProfileData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('profile');
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
    { id: 'profile', label: 'Profile', description: 'Meeting prep guide' },
    { id: 'dossier', label: 'Dossier', description: 'Behavioral analysis' },
    { id: 'research', label: 'Research', description: 'Raw sources' },
  ];

  const getContent = () => {
    switch (activeTab) {
      case 'profile':
        return data.profile.profile;
      case 'dossier':
        return data.dossier.rawMarkdown;
      case 'research':
        return data.research.rawMarkdown;
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
              {data.profile.status === 'complete' && (
                <span className="text-sm text-green-600 dark:text-green-400">
                  ✓ Validated ({data.profile.validationPasses} pass{data.profile.validationPasses !== 1 ? 'es' : ''})
                </span>
              )}
              {data.profile.status === 'validation_failed' && (
                <span className="text-sm text-yellow-600 dark:text-yellow-400">
                  ⚠ Best effort (validation incomplete)
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const content = getContent();
                  const blob = new Blob([content], { type: 'text/markdown' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${donorName.replace(/\s+/g, '_')}_${activeTab}.md`;
                  a.click();
                }}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700
                           hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Download {activeTab}
              </button>
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
        <article className="prose dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {getContent()}
          </ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
