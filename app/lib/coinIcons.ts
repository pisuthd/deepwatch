// CoinMarketCap icon URLs for DeepBook assets

export const COIN_ICONS: Record<string, string> = {
  // Stablecoins
  'USDC': 'https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png',
  'DBUSDC': 'https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png',
  'WUSDC': 'https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png',
  'WUSDT': 'https://s2.coinmarketcap.com/static/img/coins/64x64/3257.png',
  
  // Native tokens
  'SUI': 'https://s2.coinmarketcap.com/static/img/coins/64x64/20947.png',
  
  // DeFi tokens
  'DEEP': 'https://s2.coinmarketcap.com/static/img/coins/64x64/33391.png',
  'WAL': 'https://s2.coinmarketcap.com/static/img/coins/64x64/27437.png',
  'NS': 'https://s2.coinmarketcap.com/static/img/coins/64x64/26423.png',
  'AUSD': 'https://s2.coinmarketcap.com/static/img/coins/64x64/26423.png',
  
  // BTC variants
  'BTC': 'https://s2.coinmarketcap.com/static/img/coins/64x64/1.png',
  'xBTC': 'https://s2.coinmarketcap.com/static/img/coins/64x64/1.png',
  'BETH': 'https://s2.coinmarketcap.com/static/img/coins/64x64/0.png',
  'LZWBTC': 'https://s2.coinmarketcap.com/static/img/coins/64x64/1.png',
}

// Default icon for unknown coins
export const DEFAULT_COIN_ICON = 'https://s2.coinmarketcap.com/static/img/coins/64x64/1.png'

/**
 * Get CoinMarketCap icon URL for a given symbol
 */
export function getCoinIcon(symbol: string): string {
  return COIN_ICONS[symbol] || DEFAULT_COIN_ICON
}

/**
 * Get multiple coin icons for a trading pair
 */
export function getPairIcons(baseAsset: string, quoteAsset: string): [string, string] {
  return [getCoinIcon(baseAsset), getCoinIcon(quoteAsset)]
}