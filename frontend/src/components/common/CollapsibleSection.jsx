import { useState } from 'react';

export default function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
  className = '',
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsible-section${open ? ' open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="collapsible-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="collapsible-caret" aria-hidden="true" />
        <span className="collapsible-title">{title}</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
