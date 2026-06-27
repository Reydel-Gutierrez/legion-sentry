import { NavLink, useLocation } from 'react-router-dom';
import BrandIdentity from '../common/BrandIdentity';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true, icon: 'dashboard' },
  { to: '/devices', label: 'Devices', icon: 'devices' },
  { to: '/managed-devices', label: 'Managed Devices', icon: 'managed' },
  { to: '/network', label: 'Network', icon: 'network' },
  { to: '/bacnet', label: 'BACnet', icon: 'bacnet' },
  { to: '/modbus', label: 'Modbus', icon: 'modbus' },
  { to: '/mqtt', label: 'MQTT', icon: 'mqtt' },
  { to: '/diagnostics', label: 'Diagnostics', icon: 'diagnostics' },
  { to: '/logs', label: 'Logs', icon: 'logs' },
  { to: '/system', label: 'System', icon: 'system' },
];

function NavIcon({ name }) {
  const icons = {
    dashboard: (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M3 3h6v6H3V3zm8 0h6v6h-6V3zM3 11h6v6H3v-6zm8 0h6v6h-6v-6z" />
      </svg>
    ),
    devices: (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M4 3h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1zm2 3v2h8V6H6zm0 4v2h5v-2H6z" />
      </svg>
    ),
    managed: (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 2a4 4 0 00-4 4v1H5a2 2 0 00-2 2v7a2 2 0 002 2h10a2 2 0 002-2V9a2 2 0 00-2-2h-1V6a4 4 0 00-4-4zm-2 5V6a2 2 0 114 0v1H8zm2 4a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
      </svg>
    ),
    network: (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M3 6h14v2H3V6zm2 4h10v2H5v-2zm2 4h6v2H7v-2z" />
      </svg>
    ),
    bacnet: (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M4 5h12v2H4V5zm0 4h8v2H4V9zm0 4h10v2H4v-2z" />
      </svg>
    ),
    modbus: (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M3 4h14v3H3V4zm0 5h10v3H3V9zm0 5h12v3H3v-3z" />
      </svg>
    ),
    mqtt: (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 3c-3.3 0-6 2-6 5.5 0 2.2 1.4 4.1 3.5 4.8L5 17l3.5-2.2c.5.1 1 .2 1.5.2 3.3 0 6-2 6-5.5S13.3 3 10 3z" />
      </svg>
    ),
    diagnostics: (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 2l1.8 3.6L16 6.5l-2.8 2.7.7 4.1L10 11.8 6.1 13.3l.7-4.1L4 6.5l4.2-.9L10 2z" />
      </svg>
    ),
    logs: (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M5 4h10v2H5V4zm0 4h10v2H5V8zm0 4h7v2H5v-2z" />
      </svg>
    ),
    system: (
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 2a2 2 0 012 2v1.1a5 5 0 013.9 3.9H17v2h-1.1A5 5 0 0112 14.9V16a2 2 0 11-4 0v-1.1A5 5 0 014.1 11H3V9h1.1A5 5 0 018 5.1V4a2 2 0 012-2zm0 5a3 3 0 100 6 3 3 0 000-6z" />
      </svg>
    ),
  };

  return <span className="nav-icon">{icons[name]}</span>;
}

export default function Sidebar() {
  const location = useLocation();

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <BrandIdentity size="sidebar" />
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section nav-section--flat">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => {
                const active = isActive
                  || (item.to === '/devices' && location.pathname.startsWith('/devices/'))
                  || (item.to === '/managed-devices' && location.pathname.startsWith('/managed-devices'));
                return `nav-link${active ? ' active' : ''}`;
              }}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="sidebar-footer">
        <div className="device-chip">
          <span className="device-chip-label">Hardware</span>
          <span className="device-chip-value">Sentry DEV-1</span>
        </div>
      </div>
    </aside>
  );
}
