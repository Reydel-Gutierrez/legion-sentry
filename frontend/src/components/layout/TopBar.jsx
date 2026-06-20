import { useAuth } from '../../context/AuthContext';
import { BRANDING } from '../../config/branding';
import StatusBadge from '../common/StatusBadge';

function runtimeBadgeProps(runtimeMode) {
  if (runtimeMode === 'REAL HARDWARE') {
    return { status: 'real hardware', label: 'REAL HARDWARE', variant: 'hardware' };
  }
  return { status: 'development', label: 'DEVELOPMENT', variant: 'simulated' };
}

export default function TopBar({ topBar }) {
  const { logout } = useAuth();
  const runtimeBadge = topBar ? runtimeBadgeProps(topBar.runtimeMode) : null;

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <header className="app-topbar">
      <div className="topbar-left">
        {topBar && (
          <div className="topbar-stat">
            <span className="label">Product</span>
            <span className="value">{topBar.productCode || BRANDING.productCode}</span>
          </div>
        )}
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
  );
}
