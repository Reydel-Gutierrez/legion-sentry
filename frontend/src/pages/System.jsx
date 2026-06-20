import { useEffect, useState } from 'react';
import { Col, Form, Row } from 'react-bootstrap';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import KvRow from '../components/common/KvRow';
import MetricBar from '../components/common/MetricBar';
import PanelCard from '../components/common/PanelCard';
import LoadingState from '../components/common/LoadingState';

export default function SystemPage() {
  const { refreshSession } = useAuth();
  const [info, setInfo] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    api.getSystemInfo().then(setInfo).catch(console.error);
  }, []);

  const handleExport = () => {
    setMessage({ type: 'info', text: 'Configuration export — file download not yet implemented.' });
  };

  const handleImport = () => {
    setMessage({ type: 'info', text: 'Configuration import — file upload not yet implemented.' });
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refreshSession();
      setMessage({ type: 'success', text: 'Password changed successfully.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!info) return <LoadingState message="Loading system information…" />;

  return (
    <>
      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'error' ? 'error' : message.type === 'info' ? 'info' : 'success'} mb-3`}>
          {message.text}
        </div>
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
            <KvRow label="CPU Load" value={info.cpuLoadPercent != null ? `${info.cpuLoadPercent}%` : '—'} />
            <KvRow label="Temperature" value={info.temperature != null ? `${info.temperature}°C` : '—'} />
            <KvRow label="Uptime" value={info.uptime} />
            <KvRow label="Runtime Mode" value={info.runtimeMode} />
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="Change Password">
            <Form onSubmit={handleChangePassword}>
              <Form.Group className="mb-2">
                <Form.Label>Current Password</Form.Label>
                <Form.Control
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Label>New Password</Form.Label>
                <Form.Control
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Confirm New Password</Form.Label>
                <Form.Control
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </Form.Group>
              <button type="submit" className="btn btn-sentry-primary" disabled={loading}>
                Change Password
              </button>
            </Form>
          </PanelCard>

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
            </div>
          </PanelCard>
        </Col>
      </Row>
    </>
  );
}
