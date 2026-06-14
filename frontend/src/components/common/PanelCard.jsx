export default function PanelCard({ title, children, className = '' }) {
  return (
    <div className={`sentry-card ${className}`.trim()}>
      {title && <div className="card-header">{title}</div>}
      <div className="card-body">{children}</div>
    </div>
  );
}
