// Hardcoded margin markets data from DeepBook Margin Indexer
// Source: /margin_managers_info endpoint

export interface MarginMarket {
  market: string           // Display name: "DEEP/SUI"
  baseAssetSymbol: string  // "DEEP"
  quoteAssetSymbol: string // "SUI"
  baseAssetId: string
  quoteAssetId: string
  deepbookPoolId: string
  baseMarginPoolId: string
  quoteMarginPoolId: string
}

export const MARGIN_MARKETS: MarginMarket[] = [
  {
    market: "DEEP/SUI",
    baseAssetSymbol: "DEEP",
    quoteAssetSymbol: "SUI",
    baseAssetId: "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP",
    quoteAssetId: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
    deepbookPoolId: "0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f",
    baseMarginPoolId: "0x610640613f21d9e688d6f8103d17df22315c32e0c80590ce64951a1991378b55",
    quoteMarginPoolId: "0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea"
  },
  {
    market: "SUI/DBUSDC",
    baseAssetSymbol: "SUI",
    quoteAssetSymbol: "DBUSDC",
    baseAssetId: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
    quoteAssetId: "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC",
    deepbookPoolId: "0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5",
    baseMarginPoolId: "0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea",
    quoteMarginPoolId: "0xf08568da93834e1ee04f09902ac7b1e78d3fdf113ab4d2106c7265e95318b14d"
  },
  {
    market: "DEEP/DBUSDC",
    baseAssetSymbol: "DEEP",
    quoteAssetSymbol: "DBUSDC",
    baseAssetId: "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP",
    quoteAssetId: "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC",
    deepbookPoolId: "0xe86b991f8632217505fd859445f9803967ac84a9d4a1219065bf191fcb74b622",
    baseMarginPoolId: "0x610640613f21d9e688d6f8103d17df22315c32e0c80590ce64951a1991378b55",
    quoteMarginPoolId: "0xf08568da93834e1ee04f09902ac7b1e78d3fdf113ab4d2106c7265e95318b14d"
  },
  {
    market: "DBTC/DBUSDC",
    baseAssetSymbol: "DBTC",
    quoteAssetSymbol: "DBUSDC",
    baseAssetId: "0x6502dae813dbe5e42643c119a6450a518481f03063febc7e20238e43b6ea9e86::dbtc::DBTC",
    quoteAssetId: "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC",
    deepbookPoolId: "0x0dce0aa771074eb83d1f4a29d48be8248d4d2190976a5241f66b43ec18fa34de",
    baseMarginPoolId: "0xf3440b4aafcc8b12fc4b242e9590c52873b8238a0d0e52fbf9dae61d2970796a",
    quoteMarginPoolId: "0xf08568da93834e1ee04f09902ac7b1e78d3fdf113ab4d2106c7265e95318b14d"
  }
]