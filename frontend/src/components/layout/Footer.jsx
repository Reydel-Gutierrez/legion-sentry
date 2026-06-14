export default function Footer({ topBar }) {
  return (
    <footer className="app-footer">
      <div className="footer-left">
        <span>© Legion Controls</span>
        <span className="footer-sep">·</span>
        <span className="footer-muted">Sentry G1</span>
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
        <span className="footer-muted">LCG1DEV10026</span>
      </div>
    </footer>
  );
}
