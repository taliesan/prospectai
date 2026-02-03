'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [donorName, setDonorName] = useState('');
  const [seedUrls, setSeedUrls] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!donorName.trim()) return;

    setIsLoading(true);
    setStatus('Starting research...');

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          donorName: donorName.trim(),
          seedUrls: seedUrls.split('\n').filter(u => u.trim())
        })
      });

      if (!response.ok) {
        throw new Error('Generation failed');
      }

      const data = await response.json();
      
      // Store results and redirect
      localStorage.setItem('lastProfile', JSON.stringify(data));
      router.push(`/profile/${encodeURIComponent(donorName.trim())}`);
    } catch (error) {
      console.error('Error:', error);
      setStatus('Error: Generation failed. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4 text-gray-900 dark:text-white">
            ProspectAI
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400">
            Premium donor intelligence for fundraising meetings
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label 
              htmlFor="donorName" 
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Donor Name
            </label>
            <input
              type="text"
              id="donorName"
              value={donorName}
              onChange={(e) => setDonorName(e.target.value)}
              placeholder="e.g., Craig Newmark"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-700 
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                         focus:ring-2 focus:ring-blue-500 focus:border-transparent
                         placeholder-gray-400"
              disabled={isLoading}
            />
          </div>

          <div>
            <label 
              htmlFor="seedUrls" 
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Seed URLs (optional)
            </label>
            <textarea
              id="seedUrls"
              value={seedUrls}
              onChange={(e) => setSeedUrls(e.target.value)}
              placeholder="Add URLs you know about this donor (one per line)"
              rows={3}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-700 
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                         focus:ring-2 focus:ring-blue-500 focus:border-transparent
                         placeholder-gray-400 resize-none"
              disabled={isLoading}
            />
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Providing seed URLs helps ensure we research the right person
            </p>
          </div>

          <button
            type="submit"
            disabled={isLoading || !donorName.trim()}
            className="w-full py-4 px-6 rounded-lg font-medium text-white
                       bg-blue-600 hover:bg-blue-700 
                       disabled:bg-gray-400 disabled:cursor-not-allowed
                       transition-colors duration-200"
          >
            {isLoading ? 'Generating Profile...' : 'Generate Profile'}
          </button>

          {status && (
            <div className={`p-4 rounded-lg text-center ${
              status.includes('Error') 
                ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
            }`}>
              {status}
            </div>
          )}
        </form>

        <div className="mt-12 text-center text-sm text-gray-500 dark:text-gray-400">
          <p className="mb-2">
            ProspectAI generates behavioral intelligence — not just facts.
          </p>
          <p>
            Each profile includes raw research, behavioral dossier, and meeting prep guide.
          </p>
        </div>

        <div className="mt-8 p-6 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-3">
            What you'll get:
          </h2>
          <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <li className="flex items-start">
              <span className="mr-2">📚</span>
              <span><strong>Raw Research</strong> — All sources, fully traceable</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">🔍</span>
              <span><strong>Behavioral Dossier</strong> — 17-dimension analysis of how they think and decide</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">🎯</span>
              <span><strong>Persuasion Profile</strong> — Tactical guide for your meeting</span>
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
