'use client';

// NOTE (behavior change vs. what's live today): the current deployed banner
// (AutonomousBanner.tsx) is pointer-events: none — it's an announcement,
// nothing underneath is actually blocked. The mockup calls for a real
// lockdown: everything behind goes gray AND stops responding to clicks,
// with "Stand down" as the one working control, living inside the overlay
// itself so there's still a way out. AutonomousBanner.tsx is left in place
// (unused now) rather than deleted, in case the softer non-blocking version
// is ever wanted back — this component replaces it in ConsolePage.
export function LockdownOverlay({ onStandDown, busy }: { onStandDown: () => void; busy: boolean }) {
  return (
    <div className="autonomous-banner" style={{ pointerEvents: 'auto' }} role="alertdialog" aria-label="Autonomous mode lockdown">
      <div className="autonomous-banner-inner" style={{ pointerEvents: 'auto' }}>
        <div className="autonomous-stripe autonomous-stripe-top" />
        <span className="autonomous-banner-eyebrow">System alert</span>
        <span className="glitch-text autonomous-banner-title" data-text="AUTONOMOUS MODE">
          AUTONOMOUS MODE
        </span>
        <div className="autonomous-banner-rule" />
        <span className="autonomous-banner-caption">No operator at the helm — K-DIRECTIVE is deciding alone</span>
        <div className="autonomous-stripe autonomous-stripe-bottom" />
        <button
          onClick={onStandDown}
          disabled={busy}
          className="mt-4 border border-warn text-warn font-display tracking-widest uppercase text-xs px-6 py-2 hover:bg-warn hover:text-void transition-colors disabled:opacity-50 pointer-events-auto"
        >
          {busy ? 'Working…' : 'Stand down'}
        </button>
      </div>
    </div>
  );
}
