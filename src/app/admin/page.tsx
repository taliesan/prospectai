'use client';

import { useState, useEffect } from 'react';
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

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user?.isAdmin) {
      router.push('/');
      return;
    }
    fetchUsers();
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

      <div className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="font-serif text-3xl text-dtw-black mb-8">User Management</h1>

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
      </div>
    </div>
  );
}
