'use client';

// Replaces the inline Notes column — the full note-taking UI (create/
// delete, localStorage) needs more room than a 260px dashboard column can
// give it without squeezing everything else, so it lives in the "Notes"
// button's full-view modal (top bar) instead. This column shows the thing
// that actually fits: a quick command reference, since every button in the
// console has a typed equivalent (see terminal-parser.util.ts on the
// backend — this list mirrors that grammar exactly).
//
// NOTE (design decision): CONFIRM's tier word (SPLICE/SHATTER/nothing) is
// no longer functionally checked by the backend at all — CommandService
// looks the incident's real tier up from the DB itself. It's kept as a
// difficulty knob on purpose: LATCH only needs a bare "CONFIRM", SPLICE
// needs the tier word typed, SHATTER needs it too (and never gets the
// "AI resolves?" fallback in the Incidents panel — see the honesty flag
// there). Spacing before "//" doesn't matter either way — the backend
// just searches for "//<id>" anywhere in the line.
const COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: 'CONFIRM //<id>', desc: 'Confirm a LATCH-tier incident — least friction' },
  { cmd: 'CONFIRM SPLICE //<id>', desc: 'Confirm a SPLICE-tier incident' },
  { cmd: 'CONFIRM SHATTER //<id>', desc: 'Confirm a SHATTER-tier incident — no AI fallback, no shortcuts' },
  { cmd: 'ISOLATE //<rogueAiId>', desc: 'Rogue AI: isolate step' },
  { cmd: 'TRACE //<rogueAiId>', desc: 'Rogue AI: trace step' },
  { cmd: 'PURGE //<rogueAiId> --confirm', desc: 'Rogue AI: purge step (final, irreversible)' },
  { cmd: 'AUTONOMOUS ON', desc: 'Manually go autonomous' },
  { cmd: 'AUTONOMOUS OFF', desc: 'Stand down' },
];

export function InstructionsPanel() {
  return (
    <div className="p-3 h-full overflow-y-auto flex flex-col gap-2 text-[10px]">
      <p className="text-ash leading-relaxed">
        Type the command below first (with a trailing space), <em>then</em> click the tier button on
        an incident row — it appends <span className="text-signal">{'//<id>'}</span> for you. Spacing
        before the {'//'} doesn&apos;t matter.
      </p>
      {COMMANDS.map((c) => (
        <div key={c.cmd} className="border-b border-grid pb-1.5">
          <div className="font-mono text-signal">{c.cmd}</div>
          <div className="text-ash">{c.desc}</div>
        </div>
      ))}
    </div>
  );
}
