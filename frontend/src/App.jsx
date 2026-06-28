import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/auth/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import DevicesPage from './pages/Devices';
import ManagedDevicesPage from './pages/ManagedDevices';
import ExecutionPage from './pages/Execution';
import DeviceDetailPage from './pages/DeviceDetail';
import NetworkPage from './pages/Network';
import BacnetIpPage from './pages/BacnetIp';
import BacnetMstpPage from './pages/BacnetMstp';
import ModbusPage from './pages/Modbus';
import MqttPage from './pages/Mqtt';
import DiagnosticsPage from './pages/Diagnostics';
import LogsPage from './pages/Logs';
import SystemPage from './pages/System';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={(
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        )}
      >
        <Route index element={<DashboardPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="managed-devices" element={<ManagedDevicesPage />} />
        <Route path="execution" element={<ExecutionPage />} />
        <Route path="devices/:id" element={<DeviceDetailPage />} />
        <Route path="network" element={<NetworkPage />} />
        <Route path="bacnet" element={<Navigate to="/bacnet/ip" replace />} />
        <Route path="bacnet/ip" element={<BacnetIpPage />} />
        <Route path="bacnet/mstp" element={<BacnetMstpPage />} />
        <Route path="modbus" element={<ModbusPage />} />
        <Route path="mqtt" element={<MqttPage />} />
        <Route path="diagnostics" element={<DiagnosticsPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="system" element={<SystemPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
