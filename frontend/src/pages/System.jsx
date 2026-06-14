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
    setMessage({ type: 'success', text: 'Configuration export — file download not yet implemented.' });
  };

  const handleImport = () => {
    setMessage({ type: 'success', text: 'Configuration import — file upload not yet implemented.' });
  };

  if (!info) return <div className="loading-state">Loading system information…</div>;

  return (
    <>
      <PageHeader title="System" subtitle="Device information and maintenance" />

      {message && (
        <div className="alert-sentry alert-sentry-success">{message.text}</div>
      )}

      <Row>
        <Col lg={6}>
          <PanelCard title="System Information">
            <KvRow label="Hostname" value={info.hostname} />
            <KvRow label="IP" value={info.ip} />
            <KvRow label="OS" value={info.os} />
            <KvRow label="Node Version" value={info.nodeVersion} />
            <KvRow label="Firmware Version" value={info.firmwareVersion} />
            <KvRow label="Hardware Profile" value={info.hardwareProfile} />
            <KvRow label="Product Code" value={info.productCode} />
            <MetricBar label="Disk Usage" value={info.diskUsage} barClass="bar-storage" />
            <KvRow label="Memory" value={`${info.memoryFreeMb} MB free / ${info.memoryTotalMb} MB total`} />
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="Maintenance">
            <div className="d-flex flex-column gap-2">
              <button type="button" className="btn btn-sentry-secondary" onClick={handleExport}>
                Export Configuration
              </button>
              <button type="button" className="btn btn-sentry-secondary" onClick={handleImport}>
                Import Configuration
              </button>
              <button type="button" className="btn btn-sentry-secondary" disabled title="Requires confirmation — not implemented">
                Restart Services
              </button>
              <button type="button" className="btn btn-sentry-danger" disabled title="Requires confirmation — not implemented">
                Reboot Device
              </button>
              <button type="button" className="btn btn-sentry-danger" disabled title="Requires confirmation — not implemented">
                Factory Reset
              </button>
              <button type="button" className="btn btn-sentry-secondary" disabled title="Firmware update — not implemented">
                Firmware Update
              </button>
            </div>
          </PanelCard>
        </Col>
      </Row>
    </>
  );
}
