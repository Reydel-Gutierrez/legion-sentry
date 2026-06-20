import { BRANDING } from '../../config/branding';
import SentryLogo from './SentryLogo';

export default function BrandIdentity({
  size = 'header',
  showCode = true,
  textClassName = 'brand-text',
  className = '',
}) {
  return (
    <div className={`brand-identity${className ? ` ${className}` : ''}`}>
      <SentryLogo size={size} />
      <div className={textClassName}>
        <div className="brand-logo">{BRANDING.manufacturer}</div>
        <div className="brand-product">{BRANDING.productName}</div>
        {showCode && <div className="brand-code">{BRANDING.productCode}</div>}
      </div>
    </div>
  );
}
