/**
 * useMarginMarkets - Hook for Margin Markets
 * 
 * Returns hardcoded margin markets data.
 */

import { useState, useEffect, useMemo } from 'react'
import { MARGIN_MARKETS, type MarginMarket } from '../lib/marginMarkets'

export { type MarginMarket } from '../lib/marginMarkets'

export function useMarginMarkets() {
  const [searchQuery, setSearchQuery] = useState('')

  // Filter markets based on search query
  const filteredMarkets = useMemo(() => {
    if (!searchQuery.trim()) return MARGIN_MARKETS
    
    const query = searchQuery.toLowerCase()
    return MARGIN_MARKETS.filter(
      (market) =>
        market.market.toLowerCase().includes(query) ||
        market.baseAssetSymbol.toLowerCase().includes(query) ||
        market.quoteAssetSymbol.toLowerCase().includes(query)
    )
  }, [searchQuery])

  return {
    markets: MARGIN_MARKETS,
    filteredMarkets,
    searchQuery,
    setSearchQuery,
  }
}