export function AutonomousBanner({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <div className="autonomous-banner" aria-hidden="true">
      <div className="autonomous-banner-inner">
        <div className="autonomous-stripe autonomous-stripe-top" />
        <span className="autonomous-banner-eyebrow">System alert</span>
        <span className="glitch-text autonomous-banner-title" data-text="AUTONOMOUS MODE">
          AUTONOMOUS MODE
        </span>
        <div className="autonomous-banner-rule" />
        <span className="autonomous-banner-caption">No operator at the helm — K-DIRECTIVE is deciding alone</span>
        <div className="autonomous-stripe autonomous-stripe-bottom" />
      </div>
    </div>
  );
}
