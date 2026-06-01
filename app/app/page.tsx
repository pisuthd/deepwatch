'use client';

import { useState } from 'react';
import Sidebar from '../components/layout/Sidebar';
import TopBar from '../components/layout/TopBar';
import OverviewPage from '../components/pages/OverviewPage';
import ChatPage from '../components/pages/ChatPage';
import SettingsPage from '../components/pages/SettingsPage';
import type { PageId } from '../types/navigation';

export default function DashboardPage() {
  const [activePage, setActivePage] = useState<PageId>('overview');

  const handleNavigate = (pageId: PageId) => {
    setActivePage(pageId);
  };

  const renderPage = () => {
    switch (activePage) {
      case 'overview':
        return <OverviewPage onNavigate={handleNavigate} />;
      case 'chat':
        return <ChatPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <OverviewPage onNavigate={handleNavigate} />;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-base)]">
      <div className="flex flex-1 min-h-0">
        <Sidebar activePage={activePage} onNavigate={handleNavigate} />
        <div className="flex flex-col flex-1 min-w-0">
          <TopBar activePage={activePage} />
          <main className="flex-1 overflow-y-auto"> 
            {renderPage()}
          </main>
        </div>
      </div>
    </div>
  );
}