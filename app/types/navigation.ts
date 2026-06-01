export type PageId = 'overview' | 'chat' | 'settings';

export interface NavItem {
  icon: string;
  label: string;
  pageId: PageId;
}

export interface NavCategory {
  title: string;
  items: NavItem[];
}

export const categories: NavCategory[] = [
  {
    title: 'Chat',
    items: [
      { icon: 'MessageSquare', label: 'Chat', pageId: 'chat' },
    ],
  },
  {
    title: 'Control',
    items: [
      { icon: 'LayoutDashboard', label: 'Overview', pageId: 'overview' },
    ],
  },
];

export const routeMeta: Record<PageId, { category: string; label: string }> = {
  'overview': { category: 'Control', label: 'Overview' },
  'chat': { category: 'Chat', label: 'Chat' },
  'settings': { category: 'Settings', label: 'Settings' },
};