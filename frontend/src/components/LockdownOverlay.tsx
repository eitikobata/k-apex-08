'use client';

// NOTE: replaces the old non-blocking AutonomousBanner (announcement
// only, pointer-events: none, nothing underneath was actually blocked).
// This is a real lockdown: everything behind goes gray AND stops
// responding to clicks, with "Stand down" as the one working control,
// living inside the overlay itself so there's still a way out.
//
// NOTE (no readOnly variant anymore): autonomous-mode toggle is unlocked
// for every rank now, OBSERVER included (see k-directive.controller.ts —
// the PermissionsGuard requiring TOGGLE_AUTONOMOUS was removed entirely).
// This used to render a non-working, explanatory message instead of the
// button for OBSERVER specifically, back when only ADMIN/granted roles
// could actually stand it down. Not needed anymore — everyone gets the
// same working button.
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
