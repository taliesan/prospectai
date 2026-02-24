'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  email: string;
  name: string;
  approved: boolean;
  isAdmin: boolean;
  createdAt: string;
  _count: { profiles: number };
}

interface AdminProfile {
  id: string;
  donorName: string;
  status: string;
  sourceCount: number | null;
  confidenceScores: string | null;
  pipelineVersion: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

type AdminTab = 'users' | 'profiles';
type SortField = 'donorName' | 'userName' | 'userEmail' | 'createdAt' | 'status' | 'confidenceScores';
type SortDirection = 'asc' | 'desc';

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user?.isAdmin) {
      router.push('/');
      return;
    }
    fetchUsers();
    fetchProfiles();
  }, [session, status, router]);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/admin/profiles');
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles);
      }
    } catch (err) {
      console.error('Failed to fetch profiles:', err);
    }
  };

  const updateUser = async (id: string, data: { approved?: boolean; isAdmin?: boolean }) => {
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        fetchUsers();
      }
    } catch (err) {
      console.error('Failed to update user:', err);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'createdAt' ? 'desc' : 'asc');
    }
  };

  const parseConfidenceScore = (scores: string | null): number | null => {
    if (!scores) return null;
    try {
      const parsed = JSON.parse(scores);
      if (typeof parsed.overall === 'number') return parsed.overall;
      if (typeof parsed.overallScore === 'number') return parsed.overallScore;
      const values = Object.values(parsed).filter((v): v is number => typeof v === 'number');
      if (values.length > 0) return values.reduce((a, b) => a + b, 0) / values.length;
    } catch { /* ignore */ }
    return null;
  };

  const sortedProfiles = useMemo(() => {
    return [...profiles].sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'donorName':
          return dir * a.donorName.localeCompare(b.donorName);
        case 'userName':
          return dir * a.user.name.localeCompare(b.user.name);
        case 'userEmail':
          return dir * a.user.email.localeCompare(b.user.email);
        case 'createdAt':
          return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        case 'status':
          return dir * a.status.localeCompare(b.status);
        case 'confidenceScores': {
          const scoreA = parseConfidenceScore(a.confidenceScores) ?? -1;
          const scoreB = parseConfidenceScore(b.confidenceScores) ?? -1;
          return dir * (scoreA - scoreB);
        }
        default:
          return 0;
      }
    });
  }, [profiles, sortField, sortDirection]);

  const formatConfidence = (scores: string | null): string => {
    const score = parseConfidenceScore(scores);
    if (score === null) return '--';
    return `${Math.round(score * 100)}%`;
  };

  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <span className="text-dtw-light-gray ml-1">&udarr;</span>;
    }
    return <span className="ml-1">{sortDirection === 'asc' ? '\u2191' : '\u2193'}</span>;
  };

  if (status === 'loading' || isLoading) {
    return (
      <div className="min-h-screen bg-dtw-off-white flex items-center justify-center">
        <div className="text-dtw-mid-gray font-serif text-xl">Loading...</div>
      </div>
    );
  }

  const pendingCount = users.filter(u => !u.approved).length;
  const approvedCount = users.filter(u => u.approved).length;

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
            Admin
          </span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="font-serif text-3xl text-dtw-black mb-8">Admin Dashboard</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 border-b border-dtw-light-gray">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-5 py-3 text-sm font-medium transition-colors relative ${
              activeTab === 'users' ? 'text-dtw-black' : 'text-dtw-mid-gray hover:text-dtw-warm-gray'
            }`}
          >
            Users
            {pendingCount > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold rounded-full text-white"
                    style={{ background: '#E07A5F' }}>
                {pendingCount}
              </span>
            )}
            {activeTab === 'users' && (
              <div className="absolute bottom-0 left-2 right-2 h-[3px] rounded-t-sm" style={{ background: '#7B2D8E' }} />
            )}
          </button>
          <button
            onClick={() => setActiveTab('profiles')}
            className={`px-5 py-3 text-sm font-medium transition-colors relative ${
              activeTab === 'profiles' ? 'text-dtw-black' : 'text-dtw-mid-gray hover:text-dtw-warm-gray'
            }`}
          >
            All Profiles
            <span className="ml-2 text-xs text-dtw-mid-gray">({profiles.length})</span>
            {activeTab === 'profiles' && (
              <div className="absolute bottom-0 left-2 right-2 h-[3px] rounded-t-sm" style={{ background: '#2D6A4F' }} />
            )}
          </button>
        </div>

        {activeTab === 'users' && (
          <>
            {/* Stats */}
            <div className="flex gap-4 mb-8">
              <div className="bg-white rounded-xl px-5 py-3 border border-dtw-light-gray">
                <div className="text-2xl font-semibold text-dtw-black">{users.length}</div>
                <div className="text-xs text-dtw-mid-gray">Total Users</div>
              </div>
              <div className="bg-white rounded-xl px-5 py-3 border border-dtw-light-gray">
                <div className="text-2xl font-semibold" style={{ color: '#E07A5F' }}>{pendingCount}</div>
                <div className="text-xs text-dtw-mid-gray">Pending</div>
              </div>
              <div className="bg-white rounded-xl px-5 py-3 border border-dtw-light-gray">
                <div className="text-2xl font-semibold text-dtw-green">{approvedCount}</div>
                <div className="text-xs text-dtw-mid-gray">Approved</div>
              </div>
            </div>

            {/* User list */}
            <div className="bg-white rounded-2xl border border-dtw-light-gray overflow-hidden"
                 style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-dtw-light-gray">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-dtw-warm-gray tracking-[1px] uppercase">Name</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-dtw-warm-gray tracking-[1px] uppercase">Email</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-dtw-warm-gray tracking-[1px] uppercase">Created</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-dtw-warm-gray tracking-[1px] uppercase">Profiles</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-dtw-warm-gray tracking-[1px] uppercase">Status</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-dtw-warm-gray tracking-[1px] uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b border-dtw-light-gray last:border-0 hover:bg-dtw-off-white/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-dtw-black">{user.name}</div>
                        {user.isAdmin && (
                          <span className="text-[10px] font-semibold tracking-[1px] uppercase px-1.5 py-0.5 rounded"
                                style={{ background: '#7B2D8E', color: 'white' }}>
                            Admin
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-dtw-mid-gray">{user.email}</td>
                      <td className="px-6 py-4 text-sm text-dtw-mid-gray">
                        {new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-6 py-4 text-sm text-dtw-mid-gray">{user._count.profiles}</td>
                      <td className="px-6 py-4">
                        {user.approved ? (
                          <span className="text-xs font-medium text-dtw-green">Approved</span>
                        ) : (
                          <span className="text-xs font-medium" style={{ color: '#E07A5F' }}>Pending</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {user.id !== session?.user?.id && (
                          <div className="flex gap-2 justify-end">
                            {!user.approved ? (
                              <button
                                onClick={() => updateUser(user.id, { approved: true })}
                                className="px-3 py-1.5 text-xs font-medium rounded bg-dtw-green text-white hover:bg-dtw-green-light transition-colors"
                              >
                                Approve
                              </button>
                            ) : (
                              <button
                                onClick={() => updateUser(user.id, { approved: false })}
                                className="px-3 py-1.5 text-xs font-medium rounded text-dtw-mid-gray hover:text-dtw-red border border-dtw-light-gray hover:border-dtw-red transition-colors"
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'profiles' && (
          <>
            {/* Profile stats */}
            <div className="flex gap-4 mb-8">
              <div className="bg-white rounded-xl px-5 py-3 border border-dtw-light-gray">
                <div className="text-2xl font-semibold text-dtw-black">{profiles.length}</div>
                <div className="text-xs text-dtw-mid-gray">Total Profiles</div>
              </div>
              <div className="bg-white rounded-xl px-5 py-3 border border-dtw-light-gray">
                <div className="text-2xl font-semibold text-dtw-green">
                  {profiles.filter(p => p.status === 'complete').length}
                </div>
                <div className="text-xs text-dtw-mid-gray">Complete</div>
              </div>
              <div className="bg-white rounded-xl px-5 py-3 border border-dtw-light-gray">
                <div className="text-2xl font-semibold" style={{ color: '#E07A5F' }}>
                  {profiles.filter(p => p.status === 'failed').length}
                </div>
                <div className="text-xs text-dtw-mid-gray">Failed</div>
              </div>
            </div>

            {/* Profiles table */}
            <div className="bg-white rounded-2xl border border-dtw-light-gray overflow-hidden"
                 style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
              {profiles.length === 0 ? (
                <div className="px-6 py-12 text-center text-dtw-mid-gray">
                  No profiles have been generated yet.
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-dtw-light-gray">
                      <th
                        className="text-left px-6 py-3 text-xs font-semibold text-dtw-warm-gray tracking-[1px] uppercase cursor-pointer hover:text-dtw-black select-none"
                        onClick={() => handleSort('donorName')}
                      >
                        Donor Name<SortIndicator field="donorName" />
                      </th>
                      <th
                        className="text-left px-6 py-3 text-xs font-semibold text-dtw-warm-gray tracking-[1px] uppercase cursor-pointer hover:text-dtw-black select-none"
                        onClick={() => handleSort('userName')}
                      >
                        User<SortIndicator field="userName" />
                      </th>
                      <th
                        className="text-left px-6 py-3 text-xs font-semibold text-dtw-warm-gray tracking-[1px] uppercase cursor-pointer hover:text-dtw-black select-none"
                        onClick={() => handleSort('userEmail')}
                      >
                        Email<SortIndicator field="userEmail" />
                      </th>
                      <th
                        className="text-left px-6 py-3 text-xs font-semibold text-dtw-warm-gray tracking-[1px] uppercase cursor-pointer hover:text-dtw-black select-none"
                        onClick={() => handleSort('createdAt')}
                      >
                        Created<SortIndicator field="createdAt" />
                      </th>
                      <th
                        className="text-left px-6 py-3 text-xs font-semibold text-dtw-warm-gray tracking-[1px] uppercase cursor-pointer hover:text-dtw-black select-none"
                        onClick={() => handleSort('status')}
                      >
                        Status<SortIndicator field="status" />
                      </th>
                      <th
                        className="text-left px-6 py-3 text-xs font-semibold text-dtw-warm-gray tracking-[1px] uppercase cursor-pointer hover:text-dtw-black select-none"
                        onClick={() => handleSort('confidenceScores')}
                      >
                        Confidence<SortIndicator field="confidenceScores" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProfiles.map((profile) => (
                      <tr
                        key={profile.id}
                        className="border-b border-dtw-light-gray last:border-0 hover:bg-dtw-off-white/50 transition-colors cursor-pointer"
                        onClick={() => router.push(`/profile/${profile.id}`)}
                      >
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-dtw-black">{profile.donorName}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-dtw-mid-gray">{profile.user.name}</td>
                        <td className="px-6 py-4 text-sm text-dtw-mid-gray">{profile.user.email}</td>
                        <td className="px-6 py-4 text-sm text-dtw-mid-gray">
                          {new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="px-6 py-4">
                          {profile.status === 'complete' ? (
                            <span className="text-xs font-medium text-dtw-green">Complete</span>
                          ) : (
                            <span className="text-xs font-medium" style={{ color: '#E07A5F' }}>Failed</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-dtw-mid-gray">
                          {formatConfidence(profile.confidenceScores)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
