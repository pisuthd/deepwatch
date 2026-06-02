export type PageId = 'predict' | 'spot' | 'margin' | 'account-overview' | 'positions' | 'buy-dbusdc' | 'add-insight' | 'recent-insights' | 'settings';

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
      { icon: 'Goal', label: 'Predict', pageId: 'predict' },
      { icon: 'RefreshCcw', label: 'Spot', pageId: 'spot' },
      { icon: 'ChartCandlestick', label: 'Margin', pageId: 'margin' },
    ],
  },
  {
    title: 'Account',
    items: [
      { icon: 'LayoutDashboard', label: 'Overview', pageId: 'account-overview' }, 
      { icon: 'Sparkle', label: 'Find Insight', pageId: 'add-insight' },
      { icon: 'Sparkles', label: 'Recent Insights', pageId: 'recent-insights' },
    ],
  },
];

export const routeMeta: Record<PageId, { category: string; label: string }> = {
  'predict': { category: 'Trade', label: 'Predict' },
  'spot': { category: 'Trade', label: 'Spot' },
  'margin': { category: 'Trade', label: 'Margin' },
  'account-overview': { category: 'Account', label: 'Overview' },
  'positions': { category: 'Account', label: 'Positions' },
  'buy-dbusdc': { category: 'Account', label: 'Buy DBUSDC' },
  'add-insight': { category: 'Account', label: 'Add Insight' },
  'recent-insights': { category: 'Account', label: 'Recent Insights' },
  'settings': { category: 'Settings', label: 'Settings' },
};