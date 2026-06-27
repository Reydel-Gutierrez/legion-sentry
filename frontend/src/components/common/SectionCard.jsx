export default function SectionCard({
  title,
  actions,
  status,
  children,
  className = '',
  bodyClassName = '',
  noBody = false,
}) {
  const hasHeader = title || actions || status;
  return (
    <div className={`sentry-card section-card${className ? ` ${className}` : ''}`}>
      {hasHeader && (
        <div className="section-card-header">
          <div className="section-card-heading">
            {title && <span className="section-card-title">{title}</span>}
            {status && <span className="section-card-status">{status}</span>}
          </div>
          {actions && <div className="section-card-actions">{actions}</div>}
        </div>
      )}
      {noBody ? children : (
        <div className={`card-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
      )}
    </div>
  );
}
