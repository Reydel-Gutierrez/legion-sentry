export default function FormSection({ title, children, className = '' }) {
  return (
    <div className={`form-section${className ? ` ${className}` : ''}`}>
      {title && <div className="form-section-title">{title}</div>}
      <div className="form-section-body">{children}</div>
    </div>
  );
}
