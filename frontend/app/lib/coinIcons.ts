// CoinMarketCap icon URLs for DeepBook assets

export const COIN_ICONS: Record<string, string> = {
  // Stablecoins
  'USDC': 'https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png',
  'DBUSDC': 'https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png',
  'WUSDC': 'https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png',
  'WUSDT': 'https://s2.coinmarketcap.com/static/img/coins/64x64/3257.png',
  'USDT' : 'https://bridge-assets.sui.io/usdt.png',
  'SUIUSDE' : 'https://s2.coinmarketcap.com/static/img/coins/64x64/29470.png',
  'USDSUI' : 'https://s2.coinmarketcap.com/static/img/coins/64x64/38942.png',
  'NS' : 'https://token-image.suins.io/icon.svg',

  // Native tokens
  'SUI': 'https://s2.coinmarketcap.com/static/img/coins/64x64/20947.png',
  
  // DeFi tokens
  'DEEP': 'https://s2.coinmarketcap.com/static/img/coins/64x64/33391.png',
  'WAL': 'https://s2.coinmarketcap.com/static/img/coins/64x64/36119.png', 
  'AUSD': 'https://s2.coinmarketcap.com/static/img/coins/64x64/26423.png',
  
  // BTC variants
  'BTC': 'https://s2.coinmarketcap.com/static/img/coins/64x64/1.png',
  'XBTC': 'https://s2.coinmarketcap.com/static/img/coins/64x64/39577.png',
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