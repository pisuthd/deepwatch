'use client';

import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '../components/layout/Sidebar';
import TopBar from '../components/layout/TopBar';
import type { PageId } from '../types/navigation';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  
  // Map pathname to pageId
  const getPageId = (): PageId => {
    const path = pathname.replace('/app/', '');
    const pageMap: Record<string, PageId> = {
      'predict': 'predict',
      'spot': 'spot',
      'margin': 'margin',
      'add-insight': 'add-insight',
      'recent-insights': 'recent-insights',
      'account-overview': 'account-overview',
      'positions': 'positions', 
      'settings': 'settings',
    };
    return pageMap[path] || 'spot';
  };

  // PageId to route mapping
  const pageToRoute: Record<PageId, string> = {
    'predict': '/app/predict',
    'spot': '/app/spot',
    'margin': '/app/margin',
    'add-insight': '/app/add-insight',
    'recent-insights': '/app/recent-insights',
    'account-overview': '/app/account-overview',
    'positions': '/app/positions', 
    'settings': '/app/settings',
  };

  const handleNavigate = (pageId: PageId) => {
    router.push(pageToRoute[pageId]);
  };

  return (
    <div className="h-screen flex bg-[var(--color-bg-base)]">
      <Sidebar activePage={getPageId()} onNavigate={handleNavigate} />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar activePage={getPageId()} />
        <main className="flex-1 overflow-y-auto"> 
          {children}
        </main>
      </div>
    </div>
  );
}