'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ProgressEvent {
  type: 'status' | 'complete' | 'error';
  message: string;
  stage?: 'research' | 'dossier' | 'profile';
  detail?: string;
}

export default function Home() {
  const [donorName, setDonorName] = useState('');
  const [seedUrls, setSeedUrls] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progressMessages, setProgressMessages] = useState<ProgressEvent[]>([]);
  const [currentStage, setCurrentStage] = useState<string>('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!donorName.trim()) return;

    setIsLoading(true);
    setProgressMessages([]);
    setCurrentStage('Starting...');

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

      // Handle SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Stream ended - process any remaining data in buffer
          if (buffer.trim()) {
            console.log('[SSE] Processing remaining buffer after stream end:', buffer);
            // Process the remaining buffer as a final message
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

        // Process complete SSE messages
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // Keep incomplete message in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: ProgressEvent = JSON.parse(line.slice(6));

              // Update UI based on event type
              if (event.type === 'status') {
                setProgressMessages(prev => [...prev, event]);
                if (event.stage) {
                  setCurrentStage(event.stage.charAt(0).toUpperCase() + event.stage.slice(1));
                }
              } else if (event.type === 'complete' && event.detail) {
                // Parse and store the final result
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

      // If we get here, stream ended without a complete event
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
            {isLoading ? `Generating Profile... (${currentStage})` : 'Generate Profile'}
          </button>

          {/* Progress Feed */}
          {isLoading && progressMessages.length > 0 && (
            <div className="mt-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 max-h-64 overflow-y-auto">
              <div className="space-y-1 font-mono text-sm">
                {progressMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`${
                      msg.type === 'error'
                        ? 'text-red-600 dark:text-red-400'
                        : msg.message.startsWith('✓')
                          ? 'text-green-600 dark:text-green-400'
                          : msg.message.startsWith('⚠')
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    {msg.stage && (
                      <span className="text-gray-400 dark:text-gray-500 mr-2">
                        [{msg.stage}]
                      </span>
                    )}
                    {msg.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error Display (when not loading) */}
          {!isLoading && progressMessages.some(m => m.type === 'error') && (
            <div className="p-4 rounded-lg bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {progressMessages.find(m => m.type === 'error')?.message}
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
            What you&apos;ll get:
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
