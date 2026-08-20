'use client';

import { AccountMenu } from './AccountMenu';

export function TopBar({
  connected,
  isAutonomous,
  isAdmin,
  isObserver,
  accessToken,
  onOpenNotes,
}: {
  connected: boolean;
  isAutonomous: boolean;
  isAdmin: boolean;
  isObserver: boolean;
  accessToken: string;
  onOpenNotes: () => void;
}) {
  return (
    <header className="relative bg-void flex items-center justify-between px-3 py-2.5 border-b-2 border-danger shrink-0">
      <div className="font-display text-sm tracking-[0.25em] text-danger uppercase">
        K-APEX-08 <span className="text-ash font-medium">{'//'} Kobata Matrix Corporation</span>
      </div>
      <div className="flex items-center gap-3.5 text-[11px]">
        <span className={connected ? 'text-signal' : 'text-danger'}>{connected ? '● LINK UP' : '○ LINK DOWN'}</span>
        {isObserver && (
          <span
            title="Observer accounts can view everything but can't issue any command — that's enforced server-side, not just hidden buttons."
            className="bg-void border border-ash text-ash font-display tracking-widest uppercase text-[10px] px-2.5 py-1"
          >
            Observer — read only
          </span>
        )}
        {isAutonomous && (
          <span className="bg-void border border-danger text-danger font-display tracking-widest uppercase text-[10px] px-2.5 py-1">
            AUTONOMOUS MODE ACTIVE
          </span>
        )}
        <button
          onClick={onOpenNotes}
          className="bg-void border border-ash text-ash hover:border-ash-bright hover:text-ash-bright font-display tracking-widest uppercase text-[10px] px-2.5 py-1 transition-colors"
        >
          Notes
        </button>
        {isAdmin && (
          <a
            href="/admin"
            className="bg-void border border-ash text-ash hover:border-ash-bright hover:text-ash-bright font-display tracking-widest uppercase text-[10px] px-2.5 py-1 transition-colors"
          >
            Admin panel
          </a>
        )}
        <AccountMenu accessToken={accessToken} />
      </div>
    </header>
  );
}
