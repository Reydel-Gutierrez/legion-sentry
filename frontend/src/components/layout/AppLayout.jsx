import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { api } from '../../api/client';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import Footer from './Footer';

export default function AppLayout() {
  const [topBar, setTopBar] = useState(null);

  useEffect(() => {
    const load = () => {
      api.getSystemStatus()
        .then((data) => setTopBar(data.topBar))
        .catch(() => {});
    };

    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <TopBar topBar={topBar} />
        <main className="app-content">
          <Outlet />
        </main>
        <Footer topBar={topBar} />
      </div>
    </div>
  );
}
