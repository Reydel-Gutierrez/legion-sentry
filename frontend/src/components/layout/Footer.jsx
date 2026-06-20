import { BRANDING } from '../../config/branding';
import SentryLogo from '../common/SentryLogo';

export default function Footer({ topBar }) {
  return (
    <footer className="app-footer">
      <div className="footer-left">
        <SentryLogo size="compact" className="footer-logo" />
        <span>© {BRANDING.manufacturer}</span>
        <span className="footer-sep">·</span>
        <span className="footer-muted">{BRANDING.productName}</span>
      </div>
      <div className="footer-center">
        <span className="footer-muted">Firmware</span>
        <span className="footer-value">0.1.0-dev</span>
        {topBar && (
          <>
            <span className="footer-sep">·</span>
            <span className="footer-muted">IP</span>
            <span className="footer-value">{topBar.ip}</span>
          </>
        )}
      </div>
      <div className="footer-right">
        <span className="footer-muted">{BRANDING.productCode}</span>
      </div>
    </footer>
  );
}
