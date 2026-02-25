'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

interface ProjectContext {
  id: string;
  name: string;
  rawDescription: string | null;
  processedBrief: string;
  issueAreas: string | null;
  defaultAsk: string | null;
  updatedAt: string;
  materials: { id: string; type: string; filename: string | null; url: string | null; charCount: number | null }[];
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [contexts, setContexts] = useState<ProjectContext[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', rawDescription: '', issueAreas: '', defaultAsk: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchContexts();
  }, []);

  const fetchContexts = async () => {
    try {
      const res = await fetch('/api/project-context');
      const data = await res.json();
      setContexts(data.contexts || []);
    } catch (err) {
      console.warn('Failed to load contexts:', err);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (ctx: ProjectContext) => {
    setEditingId(ctx.id);
    setEditForm({
      name: ctx.name,
      rawDescription: ctx.rawDescription || '',
      issueAreas: ctx.issueAreas || '',
      defaultAsk: ctx.defaultAsk || '',
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await fetch(`/api/project-context/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    // Re-process brief
    await fetch(`/api/project-context/${editingId}/process`, { method: 'POST' });
    setEditingId(null);
    fetchContexts();
  };

  const deleteContext = async (id: string) => {
    if (!confirm('Delete this organization/project? This cannot be undone.')) return;
    await fetch(`/api/project-context/${id}`, { method: 'DELETE' });
    fetchContexts();
  };

  const deleteMaterial = async (contextId: string, materialId: string) => {
    await fetch(`/api/project-context/${contextId}/materials/${materialId}`, { method: 'DELETE' });
    fetchContexts();
  };

  return (
    <div className="min-h-screen bg-brand-off-white">
      {/* Nav */}
      <nav className="bg-brand-black px-6 py-4 flex items-center justify-between">
        <a href="/" className="text-[11px] font-semibold tracking-[3px] uppercase text-white/50 hover:text-white/70 transition-colors">
          ProspectAI
        </a>
        <div className="flex items-center gap-4">
          <a href="/profiles" className="text-xs text-white/40 hover:text-white/70 transition-colors">
            Profiles
          </a>
          <span className="text-xs text-white/60">Settings</span>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto py-12 px-4">
        <h1 className="font-serif text-3xl text-brand-black mb-2">Settings</h1>
        <p className="text-sm text-brand-warm-gray mb-8">
          Manage your saved organizations and projects.
        </p>

        {loading ? (
          <p className="text-sm text-brand-mid-gray">Loading...</p>
        ) : contexts.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            <p className="text-brand-warm-gray mb-2">No organizations or projects saved yet.</p>
            <p className="text-sm text-brand-mid-gray">
              Organizations are created automatically when you generate a profile with project context.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {contexts.map(ctx => (
              <div key={ctx.id} className="bg-white rounded-xl p-6 relative" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
                {editingId === ctx.id ? (
                  // Edit mode
                  <div className="space-y-4">
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full text-lg font-semibold text-brand-black border border-brand-light-gray rounded px-3 py-2 focus:border-brand-green focus:outline-none"
                    />
                    <textarea
                      value={editForm.rawDescription}
                      onChange={(e) => setEditForm(prev => ({ ...prev, rawDescription: e.target.value }))}
                      placeholder="Description"
                      rows={4}
                      className="w-full text-sm text-brand-black border border-brand-light-gray rounded px-3 py-2 focus:border-brand-green focus:outline-none resize-y"
                    />
                    <input
                      type="text"
                      value={editForm.issueAreas}
                      onChange={(e) => setEditForm(prev => ({ ...prev, issueAreas: e.target.value }))}
                      placeholder="Issue areas"
                      className="w-full text-sm text-brand-black border border-brand-light-gray rounded px-3 py-2 focus:border-brand-green focus:outline-none"
                    />
                    <input
                      type="text"
                      value={editForm.defaultAsk}
                      onChange={(e) => setEditForm(prev => ({ ...prev, defaultAsk: e.target.value }))}
                      placeholder="Default ask"
                      className="w-full text-sm text-brand-black border border-brand-light-gray rounded px-3 py-2 focus:border-brand-green focus:outline-none"
                    />
                    <div className="flex gap-3">
                      <button
                        onClick={saveEdit}
                        className="text-sm font-semibold text-white bg-brand-green rounded px-4 py-2 hover:bg-brand-green-light transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-sm text-brand-mid-gray hover:text-brand-black transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-serif text-xl text-brand-black">{ctx.name}</h3>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => startEdit(ctx)}
                          className="text-xs text-brand-purple hover:text-brand-purple-light transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteContext(ctx.id)}
                          className="text-xs text-brand-mid-gray hover:text-brand-red transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {ctx.issueAreas && (
                      <p className="text-xs text-brand-mid-gray mb-2">
                        <span className="font-semibold">Issue areas:</span> {ctx.issueAreas}
                      </p>
                    )}

                    {ctx.rawDescription && (
                      <p className="text-sm text-brand-warm-gray mb-3 line-clamp-3">{ctx.rawDescription}</p>
                    )}

                    {ctx.materials.length > 0 && (
                      <div className="border-t border-brand-light-gray pt-3 mt-3">
                        <p className="text-[10px] font-semibold tracking-[2px] uppercase text-brand-mid-gray mb-2">
                          Materials ({ctx.materials.length})
                        </p>
                        <div className="space-y-1">
                          {ctx.materials.map(m => (
                            <div key={m.id} className="flex items-center justify-between text-xs">
                              <span className="text-brand-warm-gray truncate">
                                {m.type === 'file' ? m.filename : m.url}
                                {m.charCount && <span className="text-brand-mid-gray ml-1">({(m.charCount / 1000).toFixed(1)}k chars)</span>}
                              </span>
                              <button
                                onClick={() => deleteMaterial(ctx.id, m.id)}
                                className="text-brand-mid-gray hover:text-brand-red ml-2 flex-shrink-0"
                              >
                                &times;
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="text-[10px] text-brand-mid-gray mt-3">
                      Updated {new Date(ctx.updatedAt).toLocaleDateString()}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
