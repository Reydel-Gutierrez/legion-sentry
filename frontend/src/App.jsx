import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import DashboardPage from './pages/Dashboard';
import NetworkPage from './pages/Network';
import BacnetPage from './pages/Bacnet';
import ModbusPage from './pages/Modbus';
import MqttPage from './pages/Mqtt';
import DiagnosticsPage from './pages/Diagnostics';
import LogsPage from './pages/Logs';
import SystemPage from './pages/System';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="network" element={<NetworkPage />} />
        <Route path="bacnet" element={<BacnetPage />} />
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
