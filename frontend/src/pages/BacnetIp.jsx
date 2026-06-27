import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import SectionCard from '../components/common/SectionCard';
import StatusChip from '../components/common/StatusChip';
import PageHeader from '../components/common/PageHeader';
import ActionButton from '../components/common/ActionButton';
import DataTable from '../components/common/DataTable';
import LoadingState from '../components/common/LoadingState';
import { formatLastSeen, isMstp } from './bacnetUtils';

export default function BacnetIpPage() {
  const navigate = useNavigate();
  const [bacnetStatus, setBacnetStatus] = useState(null);
  const [ipForm, setIpForm] = useState(null);
  const [devices, setDevices] = useState([]);
  const [latestSessionId, setLatestSessionId] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const [status, deviceData] = await Promise.all([
      api.getBacnetStatus(),
      api.getDevices(),
    ]);
    setBacnetStatus(status);
    setDevices(deviceData.devices || []);
    setLatestSessionId(deviceData.latestDiscoverySessionId || null);
    setIpForm({
      enabled: status.ip.enabled,
      deviceInstance: status.ip.deviceInstance,
      udpPort: status.ip.udpPort,
      networkNumber: status.ip.networkNumber,
    });
  }, []);

  useEffect(() => {
    load().catch((err) => setMessage({ type: 'error', text: err.message }));
  }, [load]);

  const handleDiscoverIp = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.discoverBacnetIp(5000);
      await load();
      const found = result.devices?.length ?? result.inventory?.devicesFound ?? 0;
      setMessage({
        type: found ? 'success' : 'info',
        text: found
          ? `BACnet/IP discovery found ${found} device(s) in ${result.durationMs}ms.`
          : 'No BACnet/IP devices discovered.',
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!bacnetStatus || !ipForm) {
    return <LoadingState message="Loading BACnet/IP configuration…" />;
  }

  const ipDevices = devices.filter((device) => !isMstp(device));

  const columns = [
    {
      key: 'status',
      header: 'Status',
      render: (device) => {
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
    { key: 'network', header: 'Network', render: (d) => d.network || d.transport },
    { key: 'deviceInstance', header: 'Device Instance' },
    { key: 'objectName', header: 'Object Name', render: (d) => d.objectName || '—' },
    { key: 'vendor', header: 'Vendor', render: (d) => d.vendor || d.vendorName || '—' },
    { key: 'model', header: 'Model', render: (d) => d.model || d.modelName || '—' },
    { key: 'lastSeen', header: 'Last Seen', render: (d) => formatLastSeen(d.lastSeen || d.lastSeenAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (device) => (
        <ActionButton size="sm" onClick={() => navigate(`/devices/${device.id}`)}>
          Details
        </ActionButton>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="BACnet / IP"
        subtitle="BACnet/IP discovery, status and network identity."
        actions={(
          <ActionButton variant="primary" onClick={handleDiscoverIp} disabled={loading}>
            Discover BACnet/IP
          </ActionButton>
        )}
      />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : message.type === 'info' ? 'info' : 'error'} mb-3`}>
          {message.text}
        </div>
      )}

      <SectionCard
        title="BACnet/IP Status"
        status={<StatusChip label={bacnetStatus.ip.label || bacnetStatus.ip.status} />}
        className="mb-3"
      >
        <KvRow label="Device Instance" value={ipForm.deviceInstance} />
        <KvRow label="UDP Port" value={ipForm.udpPort} />
        <KvRow label="Network Number" value={ipForm.networkNumber} />
      </SectionCard>

      <SectionCard title="Discovered BACnet/IP Devices">
        <DataTable
          columns={columns}
          rows={ipDevices}
          rowKey={(d) => d.id}
          pageSize={10}
          emptyMessage="No BACnet/IP devices discovered yet. Run BACnet/IP discovery."
        />
      </SectionCard>
    </>
  );
}
