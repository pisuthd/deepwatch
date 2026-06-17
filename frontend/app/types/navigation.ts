export type PageId = 'predict' | 'spot' | 'margin' | 'account-overview' | 'positions' | 'add-insight' | 'download-agent';

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
    title: 'Predict',
    items: [
      { icon: 'LineChart', label: 'Predict', pageId: 'predict' },
      { icon: 'Sparkles', label: 'Compare', pageId: 'add-insight' },
    ],
  },
  {
    title: 'Trade',
    items: [
      { icon: 'RefreshCcw', label: 'Spot', pageId: 'spot' },
    ],
  },
  {
    title: 'Account',
    items: [
      { icon: 'LayoutDashboard', label: 'Overview', pageId: 'account-overview' },
      { icon: 'List', label: 'Positions', pageId: 'positions' },
    ],
  },
];

export const routeMeta: Record<PageId, { category: string; label: string }> = {
  'predict': { category: 'Predict', label: 'Predict' },
  'spot': { category: 'Trade', label: 'Spot' },
  'margin': { category: 'Trade', label: 'Margin' },
  'account-overview': { category: 'Account', label: 'Overview' },
  'positions': { category: 'Account', label: 'Positions' },
  'add-insight': { category: 'Predict', label: 'Compare' },
  'download-agent': { category: 'Tools', label: 'Download Agent' },
};