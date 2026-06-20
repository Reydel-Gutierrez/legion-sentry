import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../common/StatusBadge';

const ROUTE_LABELS = {
  '/': 'Dashboard',
  '/devices': 'Devices',
  '/network': 'Network',
  '/bacnet': 'BACnet',
  '/modbus': 'Modbus',
  '/mqtt': 'MQTT',
  '/diagnostics': 'Diagnostics',
  '/logs': 'Logs',
  '/system': 'System',
};

function getPageLabel(pathname) {
  if (pathname.startsWith('/devices/')) return 'Device Details';
  return ROUTE_LABELS[pathname] || 'Sentry G1';
}

function runtimeBadgeProps(runtimeMode) {
  if (runtimeMode === 'REAL HARDWARE') {
    return { status: 'real hardware', label: 'REAL HARDWARE', variant: 'hardware' };
  }
  return { status: 'development', label: 'DEVELOPMENT', variant: 'simulated' };
}

export default function TopBar({ topBar }) {
  const location = useLocation();
  const { logout } = useAuth();
  const pageLabel = getPageLabel(location.pathname);
  const runtimeBadge = topBar ? runtimeBadgeProps(topBar.runtimeMode) : null;

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <>
      <header className="app-topbar">
        <div className="topbar-left">
          <nav className="topbar-breadcrumb" aria-label="Breadcrumb">
            <span className="breadcrumb-device">{topBar?.hostname || 'Sentry G1'}</span>
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-current">{pageLabel}</span>
          </nav>
        </div>
        <div className="topbar-right">
          {topBar && (
            <>
              {runtimeBadge && (
                <StatusBadge
                  status={runtimeBadge.status}
                  label={runtimeBadge.label}
                  variant={runtimeBadge.variant}
                />
              )}
              <div className="topbar-stat">
                <span className="label">IP</span>
                <span className="value">{topBar.ip}</span>
              </div>
              <div className="topbar-stat">
                <span className="label">Uptime</span>
                <span className="value">{topBar.uptime}</span>
              </div>
              <button type="button" className="btn btn-sentry-secondary btn-sm topbar-logout" onClick={handleLogout}>
                Logout
              </button>
            </>
          )}
        </div>
      </header>

      {topBar && (
        <div className="app-statusbar">
          <div className="statusbar-left">
            <span className="statusbar-item">
              <span className="statusbar-label">Product</span>
              <span className="statusbar-value mono">{topBar.productCode}</span>
            </span>
            {topBar.liveDataNote && (
              <span className="statusbar-item statusbar-note">
                <span className="statusbar-value">{topBar.liveDataNote}</span>
              </span>
            )}
          </div>
          <div className="statusbar-right">
            <span className="statusbar-label">Legion Controls</span>
            <span className="statusbar-value">{topBar.productName || 'Sentry G1'}</span>
          </div>
        </div>
      )}
    </>
  );
}
