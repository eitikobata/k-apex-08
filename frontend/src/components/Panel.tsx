import type { ReactNode } from 'react';

export function Panel({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel-border bg-panel flex flex-col min-h-0 ${className}`}>
      {title && (
        <div className="border-b-2 border-danger px-3 py-2 shrink-0">
          <span className="font-display text-xs tracking-[0.2em] text-danger uppercase">
            [ {title} ]
          </span>
        </div>
      )}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
