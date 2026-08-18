'use client';

import { useEffect, useState } from 'react';

interface StickyNote {
  id: string;
  text: string;
  createdAt: string;
}

const STORAGE_KEY = 'kapex08.notes';

// localStorage on purpose, not sessionStorage like the auth session — notes
// are meant to survive a tab close/reopen (operator's own scratch pad),
// unlike credentials which shouldn't linger. Notes are deliberately
// non-editable after creation: this is a scratch pad for quick flags
// during a shift, not a document editor. If it needs editing, delete and
// re-add — keeps the data model (and the UI) trivial.
function loadNotes(): StickyNote[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StickyNote[];
  } catch {
    return [];
  }
}

function saveNotes(notes: StickyNote[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

export function NotesPanel() {
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setNotes(loadNotes());
    setHydrated(true);
  }, []);

  function addNote() {
    const text = draft.trim();
    if (!text) return;
    const next: StickyNote[] = [
      { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() },
      ...notes,
    ];
    setNotes(next);
    saveNotes(next);
    setDraft('');
  }

  function deleteNote(id: string) {
    const next = notes.filter((n) => n.id !== id);
    setNotes(next);
    saveNotes(next);
  }

  if (!hydrated) return null;

  return (
    <div className="p-3 h-full flex flex-col gap-3 text-xs">
      <p className="text-ash leading-relaxed">
        Personal scratch pad — stored only in this browser (localStorage), never sent to the
        backend. Notes can&apos;t be edited once created: delete and re-add if something changed.
      </p>

      <div className="flex gap-2 shrink-0">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote();
          }}
          placeholder="New note… (Ctrl/Cmd+Enter to save)"
          rows={2}
          className="flex-1 bg-void panel-border px-2 py-1.5 text-ash-bright outline-none focus:border-signal resize-none"
        />
        <button
          onClick={addNote}
          disabled={!draft.trim()}
          className="border border-signal text-signal font-display tracking-widest uppercase text-[10px] px-3 hover:bg-signal hover:text-void transition-colors disabled:opacity-40 shrink-0"
        >
          Pin
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-2 gap-2 auto-rows-min">
        {notes.length === 0 && <span className="text-ash col-span-2">No notes pinned.</span>}
        {notes.map((note) => (
          <div
            key={note.id}
            className="panel-border bg-panel/60 p-2 flex flex-col gap-1.5 justify-between"
          >
            <p className="text-ash-bright whitespace-pre-wrap break-words">{note.text}</p>
            <div className="flex items-center justify-between text-[10px] text-ash">
              <span>{new Date(note.createdAt).toLocaleString()}</span>
              <button
                onClick={() => deleteNote(note.id)}
                className="text-danger hover:underline"
              >
                delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
