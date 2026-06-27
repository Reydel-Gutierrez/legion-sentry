import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import SectionCard from '../components/common/SectionCard';
import StatusChip from '../components/common/StatusChip';
import PageHeader from '../components/common/PageHeader';
import ActionButton from '../components/common/ActionButton';
import DataTable from '../components/common/DataTable';

function formatLastSeen(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleString();
}

function isMstp(device) {
  return device.transport === 'BACnet MS/TP' || device.transport === 'mstp';
}

function mstpMac(device) {
  if (!isMstp(device)) return '—';
  const mac = device.mstpMacAddress ?? device.macAddress;
  return mac != null ? mac : '—';
}

function mstpNetwork(device) {
  if (!isMstp(device)) return device.networkNumber ?? '—';
  return device.configuredNetworkNumber ?? device.networkNumber ?? '—';
}

const MSTP_STATUS_META = {
  seen_latest_scan: { tone: 'success', label: 'Seen latest scan' },
  recently_seen: { tone: 'warn', label: 'Recently seen' },
  stale: { tone: 'neutral', label: 'Not rediscovered' },
  never_confirmed: { tone: 'neutral', label: 'Unknown' },
};

function mstpStatusChip(device) {
  const meta = MSTP_STATUS_META[device.mstpStatus] || MSTP_STATUS_META.never_confirmed;
  const title = device.mstpStatus === 'stale'
    ? 'Known inventory device, but it did not answer the latest Who-Is scan.'
    : undefined;
  return <StatusChip tone={meta.tone} label={meta.label} title={title} />;
}

export default function DevicesPage() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState([]);
  const [latestSessionId, setLatestSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const load = () => {
    api.getDevices()
      .then((data) => {
        setDevices(data.devices);
        setLatestSessionId(data.latestDiscoverySessionId || null);
      })
      .catch((err) => setMessage({ type: 'error', text: err.message }));
  };

  useEffect(() => { load(); }, []);

  const handleRefresh = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.refreshDevices();
      setDevices(result.devices);
      if (result.devices.length === 0) {
        setMessage({ type: 'info', text: 'No devices in inventory. Run BACnet/IP discovery first.' });
      } else {
        const online = result.summary?.online ?? result.devices.filter((d) => d.status === 'online').length;
        setMessage({ type: 'success', text: `Health refresh complete — ${online} of ${result.devices.length} online.` });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDiscoverIp = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.discoverBacnetIp(5000);
      const inventory = result.inventory || {};
      setDevices(inventory.devices || []);
      const found = result.devices?.length ?? inventory.devicesFound ?? 0;
      if (found === 0) {
        setMessage({ type: 'info', text: 'No BACnet/IP devices discovered.' });
      } else {
        setMessage({
          type: 'success',
          text: `BACnet/IP discovery complete — ${found} device(s) found in ${result.durationMs}ms.`,
        });
      }
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('Remove this device from inventory?')) return;
    setLoading(true);
    try {
      await api.deleteDevice(id);
      load();
      setMessage({ type: 'success', text: 'Device removed from inventory.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDiscoverMstp = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.discoverBacnetMstp({ timeoutMs: 8000 });
      const inventory = result.inventory || {};
      setDevices(inventory.devices?.length ? inventory.devices : (await api.getDevices()).devices);
      const found = result.devices?.length ?? 0;
      if (found === 0) {
        setMessage({ type: 'info', text: result.message || 'No MS/TP responses received.' });
      } else {
        setMessage({
          type: 'success',
          text: `BACnet MS/TP discovery complete — ${found} device(s) found in ${result.durationMs}ms.`,
        });
      }
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Clear entire device inventory? This cannot be undone.')) return;
    setLoading(true);
    try {
      await api.clearDevices();
      setDevices([]);
      setMessage({ type: 'success', text: 'Device inventory cleared.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleClearSession = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await api.clearBacnetMstpSession();
      load();
      setMessage({ type: 'success', text: 'Latest scan results cleared. Device inventory was preserved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      key: 'status',
      header: 'Status',
      render: (device) => {
        if (isMstp(device)) return mstpStatusChip(device);
        const seenLatest = Boolean(latestSessionId)
          && device.discoverySessionId === latestSessionId;
        return (
          <div className="d-flex gap-2 align-items-center">
            <StatusChip label={device.status} />
            {seenLatest && <StatusChip tone="success" label="Latest scan" title="Responded in the most recent scan" />}
          </div>
        );
      },
    },
    { key: 'transport', header: 'Transport', render: (d) => d.network || d.transport },
    { key: 'network', header: 'Network', render: (d) => mstpNetwork(d) },
    { key: 'mac', header: 'MS/TP MAC', cellClassName: 'mono', render: (d) => mstpMac(d) },
    { key: 'deviceInstance', header: 'Instance' },
    { key: 'objectName', header: 'Object Name', render: (d) => d.objectName || '—' },
    { key: 'vendor', header: 'Vendor', render: (d) => d.vendor || d.vendorName || '—' },
    { key: 'model', header: 'Model', render: (d) => d.model || d.modelName || '—' },
    { key: 'lastSeen', header: 'Last Seen', render: (d) => formatLastSeen(d.lastSeen || d.lastSeenAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (device) => (
        <ActionButton variant="danger" size="sm" onClick={(e) => handleDelete(e, device.id)} disabled={loading}>
          Remove
        </ActionButton>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Device Inventory"
        subtitle="All discovered BACnet/IP and MS/TP devices."
        actions={(
          <ActionButton variant="primary" onClick={handleDiscoverIp} disabled={loading}>
            Discover BACnet/IP
          </ActionButton>
        )}
      />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'error' ? 'error' : message.type === 'info' ? 'info' : 'success'} mb-3`}>
          {message.text}
        </div>
      )}

      <SectionCard title="Devices" className="mb-3">
        <DataTable
          columns={columns}
          rows={devices}
          rowKey={(d) => d.id}
          pageSize={10}
          onRowClick={(device) => navigate(`/devices/${device.id}`)}
          emptyMessage="No devices in inventory."
        />
      </SectionCard>

      <SectionCard title="Discovery Actions">
        <div className="action-bar">
          <ActionButton onClick={handleRefresh} disabled={loading}>
            Refresh
          </ActionButton>
          <ActionButton onClick={handleDiscoverMstp} disabled={loading}>
            Discover BACnet MS/TP
          </ActionButton>
          <ActionButton onClick={handleClearSession} disabled={loading}>
            Clear Latest Scan
          </ActionButton>
          <ActionButton variant="danger" onClick={handleClear} disabled={loading || devices.length === 0}>
            Clear Inventory
          </ActionButton>
        </div>
      </SectionCard>
    </>
  );
}
