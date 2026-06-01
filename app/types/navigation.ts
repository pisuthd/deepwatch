export type PageId = 'markets' | 'add-insight' | 'recent-insights' | 'account-overview' | 'positions' | 'buy-dbusdc' | 'settings';

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
    title: 'Trade',
    items: [
      { icon: 'ChartCandlestick', label: 'Markets', pageId: 'markets' },
      { icon: 'Plus', label: 'Add Insight', pageId: 'add-insight' },
      { icon: 'Archive', label: 'Recent Insights', pageId: 'recent-insights' },
    ],
  },
  {
    title: 'Account',
    items: [
      { icon: 'LayoutDashboard', label: 'Overview', pageId: 'account-overview' },
      { icon: 'List', label: 'Positions', pageId: 'positions' },
      { icon: 'RefreshCcw', label: 'Buy DBUSDC', pageId: 'buy-dbusdc' },
    ],
  },
];

export const routeMeta: Record<PageId, { category: string; label: string }> = {
  'markets': { category: 'Trade', label: 'Markets' },
  'add-insight': { category: 'Trade', label: 'Add Insight' },
  'recent-insights': { category: 'Trade', label: 'Recent Insights' },
  'account-overview': { category: 'Account', label: 'Overview' },
  'positions': { category: 'Account', label: 'Positions' },
  'buy-dbusdc': { category: 'Account', label: 'Buy DBUSDC' },
  'settings': { category: 'Settings', label: 'Settings' },
};
