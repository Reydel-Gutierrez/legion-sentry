import { BRANDING } from '../../config/branding';
import SentryLogo from './SentryLogo';

export default function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div className="page-header-main">
        <div className="page-eyebrow">
          <SentryLogo size="header" className="page-eyebrow-logo" />
          <span className="page-eyebrow-text">
            <span className="page-eyebrow-manufacturer">{BRANDING.manufacturer}</span>
            <span className="page-eyebrow-product">{BRANDING.productName}</span>
          </span>
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </div>
  );
}
