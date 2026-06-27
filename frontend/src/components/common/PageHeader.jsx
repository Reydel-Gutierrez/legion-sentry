export default function PageHeader({
  title,
  subtitle,
  actions,
  summary,
  children,
}) {
  return (
    <div className="page-header">
      <div className="page-header-row">
        <div className="page-header-titles">
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>

      {summary && summary.length > 0 && (
        <div className="summary-cards">
          {summary.map((item) => (
            <div
              key={item.label}
              className={`summary-card${item.variant ? ` summary-card--${item.variant}` : ''}`}
            >
              <span className="summary-card-label">{item.label}</span>
              <span className="summary-card-value">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}
