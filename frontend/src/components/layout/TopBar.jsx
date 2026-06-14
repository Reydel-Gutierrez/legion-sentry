import { Link, useLocation } from 'react-router-dom';
import StatusBadge from '../common/StatusBadge';

const ROUTE_LABELS = {
  '/': 'Dashboard',
  '/network': 'Network',
  '/bacnet': 'BACnet',
  '/modbus': 'Modbus',
  '/mqtt': 'MQTT',
  '/diagnostics': 'Diagnostics',
  '/logs': 'Logs',
  '/system': 'System',
};

export default function TopBar({ topBar }) {
  const location = useLocation();
  const pageLabel = ROUTE_LABELS[location.pathname] || 'Sentry G1';

  return (
    <>
      <header className="app-topbar">
        <div className="topbar-left">
          <nav className="topbar-breadcrumb" aria-label="Breadcrumb">
            <Link to="/" className="breadcrumb-home" title="Dashboard">
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
                <path d="M10 3l7 6v8H3V9l7-6zm0 2.3L5 10.2V15h3v-4h4v4h3v-4.8L10 5.3z" />
              </svg>
            </Link>
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-device">Sentry G1</span>
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current">{pageLabel}</span>
          </nav>
        </div>
        <div className="topbar-right">
          {topBar && (
            <>
              <StatusBadge status="simulated" label={topBar.badge} />
              <div className="topbar-stat">
                <span className="label">IP</span>
                <span className="value">{topBar.ip}</span>
              </div>
            </>
          )}
        </div>
      </header>

      {topBar && (
        <div className="app-statusbar">
          <div className="statusbar-left">
            <span className="statusbar-item">
              <StatusBadge status="running" label="Service Online" />
            </span>
            <span className="statusbar-item">
              <span className="statusbar-label">Uptime</span>
              <span className="statusbar-value">{topBar.uptime}</span>
            </span>
            <span className="statusbar-item">
              <span className="statusbar-label">Mode</span>
              <span className="statusbar-value accent">Simulated</span>
            </span>
          </div>
          <div className="statusbar-right">
            <span className="statusbar-label">Product</span>
            <span className="statusbar-value mono">{topBar.productCode}</span>
          </div>
        </div>
      )}
    </>
  );
}
