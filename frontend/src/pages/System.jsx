import { useEffect, useState } from 'react';
import { Col, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import MetricBar from '../components/common/MetricBar';
import PanelCard from '../components/common/PanelCard';
import PageHeader from '../components/common/PageHeader';

export default function SystemPage() {
  const [info, setInfo] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    api.getSystemInfo().then(setInfo).catch(console.error);
  }, []);

  const handleExport = () => {
    setMessage({ type: 'success', text: 'Configuration export placeholder — file download not yet implemented.' });
  };

  const handleImport = () => {
    setMessage({ type: 'success', text: 'Configuration import placeholder — file upload not yet implemented.' });
  };

  if (!info) return <div className="loading-state">Loading system information…</div>;

  return (
    <>
      <PageHeader title="System" subtitle="Device information and maintenance actions" />

      {message && (
        <div className="alert-sentry alert-sentry-success">{message.text}</div>
      )}

      <Row>
        <Col lg={6}>
          <PanelCard title="System Info">
            <KvRow label="OS" value={info.os} />
            <KvRow label="Node Version" value={info.nodeVersion} />
            <KvRow label="App Version" value={info.appVersion} />
            <KvRow label="Hardware Profile" value={info.hardwareProfile} />
            <KvRow label="Architecture" value={info.architecture} />
            <KvRow label="Hostname" value={info.hostname} />
            <KvRow label="Product Code" value={info.productCode} />
            <KvRow label="CPU Cores" value={info.cpuCount} />
            <MetricBar label="Disk Usage" value={info.diskUsage} barClass="bar-storage" />
            <KvRow label="Memory" value={`${info.memoryFreeMb} MB free / ${info.memoryTotalMb} MB total`} />
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="Maintenance">
            <p style={{ color: '#58677d', fontSize: '0.8rem', marginBottom: '1rem' }}>
              Destructive actions are disabled in this development build. Placeholders are shown for future hardware integration.
            </p>
            <div className="d-flex flex-column gap-2">
              <button type="button" className="btn btn-sentry-secondary" disabled title="Requires confirmation — not implemented">
                Restart Sentry Service
              </button>
              <button type="button" className="btn btn-sentry-danger" disabled title="Requires confirmation — not implemented">
                Reboot Device
              </button>
              <button type="button" className="btn btn-sentry-danger" disabled title="Requires confirmation — not implemented">
                Factory Reset
              </button>
              <button type="button" className="btn btn-sentry-secondary" onClick={handleExport}>
                Export Configuration
              </button>
              <button type="button" className="btn btn-sentry-secondary" onClick={handleImport}>
                Import Configuration
              </button>
            </div>
          </PanelCard>
        </Col>
      </Row>
    </>
  );
}
