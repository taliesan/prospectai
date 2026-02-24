'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';

interface ProfileSummary {
  id: string;
  donorName: string;
  status: string;
  sourceCount: number | null;
  confidenceScores: string | null;
  pipelineVersion: string | null;
  createdAt: string;
}

function getAvgConfidence(scoresJson: string | null): number | null {
  if (!scoresJson) return null;
  try {
    const data = JSON.parse(scoresJson);
    const sections = data.sections;
    if (!Array.isArray(sections) || sections.length === 0) return null;
    const sum = sections.reduce((acc: number, s: { score: number }) => acc + (s.score || 0), 0);
    return Math.round((sum / sections.length) * 10) / 10;
  } catch {
    return null;
  }
}

export default function ProfilesPage() {
  const { data: session } = useSession();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchProfiles();
  }, []);

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/profiles');
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles);
      }
    } catch (err) {
      console.error('Failed to fetch profiles:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteProfile = async (id: string) => {
    if (!confirm('Delete this profile? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setProfiles(prev => prev.filter(p => p.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete profile:', err);
    }
  };

  // Group profiles by donor name
  const grouped = profiles.reduce<Record<string, ProfileSummary[]>>((acc, p) => {
    if (!acc[p.donorName]) acc[p.donorName] = [];
    acc[p.donorName].push(p);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-dtw-off-white">
      <div className="h-[5px] w-full" style={{
        background: 'linear-gradient(90deg, #7B2D8E, #C77DFF, #2D6A4F, #40916C, #7B2D8E)',
        backgroundSize: '300% 100%',
      }} />

      <nav className="bg-dtw-black px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-[11px] font-semibold tracking-[3px] uppercase text-white/50 hover:text-white transition-colors">
            ProspectAI
          </a>
          <span className="text-white/20">/</span>
          <span className="text-[11px] font-semibold tracking-[3px] uppercase text-white/50">
            Profiles
          </span>
        </div>
        <div className="flex items-center gap-4">
          {session?.user?.name && (
            <span className="text-xs text-white/40">{session.user.name}</span>
          )}
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
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-serif text-3xl text-dtw-black">Your Profiles</h1>
          <a
            href="/"
            className="px-4 py-2 text-sm font-semibold rounded-lg text-white transition-all hover:-translate-y-0.5"
            style={{ background: '#6B21A8' }}
          >
            New Profile
          </a>
        </div>

        {isLoading ? (
          <div className="text-center py-20">
            <div className="text-dtw-mid-gray font-serif text-xl">Loading...</div>
          </div>
        ) : profiles.length === 0 ? (
          <div className="text-center py-20">
            <h2 className="font-serif text-2xl text-dtw-black mb-2">No profiles yet</h2>
            <p className="text-dtw-mid-gray mb-6">Generate your first donor profile to get started.</p>
            <a
              href="/"
              className="inline-block px-6 py-3 text-sm font-semibold rounded-lg text-white"
              style={{ background: '#6B21A8' }}
            >
              Generate Profile
            </a>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([donorName, donorProfiles]) => (
              <div key={donorName} className="bg-white rounded-2xl border border-dtw-light-gray overflow-hidden"
                   style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
                <div className="px-6 py-4 border-b border-dtw-light-gray flex items-center justify-between">
                  <h2 className="font-serif text-xl text-dtw-black">{donorName}</h2>
                  <span className="text-xs text-dtw-mid-gray">{donorProfiles.length} version{donorProfiles.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="divide-y divide-dtw-light-gray">
                  {donorProfiles.map((profile) => {
                    const date = new Date(profile.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    });
                    return (
                      <div key={profile.id} className="px-6 py-4 flex items-center justify-between hover:bg-dtw-off-white/50 transition-colors">
                        <div className="flex items-center gap-4">
                          <a href={`/profile/${profile.id}`} className="text-sm font-medium text-dtw-black hover:text-dtw-purple transition-colors">
                            {date}
                          </a>
                          {profile.sourceCount && (
                            <span className="text-xs text-dtw-mid-gray">{profile.sourceCount} sources</span>
                          )}
                          {(() => {
                            const avg = getAvgConfidence(profile.confidenceScores);
                            return avg !== null ? (
                              <span className="text-xs text-dtw-mid-gray" title="Average confidence score">
                                {avg}/10
                              </span>
                            ) : null;
                          })()}
                          {profile.pipelineVersion && (
                            <span className="text-[10px] font-semibold tracking-[1px] uppercase text-dtw-mid-gray border border-dtw-light-gray rounded px-1.5 py-0.5">
                              {profile.pipelineVersion}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <a
                            href={`/profile/${profile.id}`}
                            className="px-3 py-1.5 text-xs font-medium rounded bg-dtw-off-white hover:bg-dtw-light-gray text-dtw-warm-gray transition-colors"
                          >
                            View
                          </a>
                          <button
                            onClick={() => deleteProfile(profile.id)}
                            className="px-3 py-1.5 text-xs font-medium rounded text-dtw-mid-gray hover:text-dtw-red hover:bg-red-50 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
