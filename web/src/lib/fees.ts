/*
 * Kodiak fee metadata.
 *
 * These values describe Kodiak's current fee model for UI and accounting.
 * Raydium's on-chain PlatformConfig / CPMM config remains the authority for
 * fees actually charged by the programs.
 */
export const KODIAK_FEES = {
  creatorCurveRate: 0.0045,
  kodiakPlatformRate: 0.005,
  raydiumProtocolRate: 0.0025,
  totalCurveRate: 0.012,

  creatorCurveBps: 45,
  kodiakPlatformBps: 50,
  raydiumProtocolBps: 25,
  totalCurveBps: 120,

  creatorSuccessFundShareOfKodiakRevenue: 0.05,
  creatorSuccessFundShareBps: 500,
  creatorSuccessFundPercent: 5,

  creatorFeeKeyLpSharePercent: 10,
  migratedLpBurnPercent: 90,
  platformLpSharePercent: 0,
} as const;

export const KODIAK_FEE_LABELS = {
  creatorCurve: "0.45%",
  kodiakPlatform: "0.50%",
  raydiumProtocol: "0.25%",
  totalCurve: "1.20%",
  creatorSuccessFund: "5%",
  creatorFeeKeyLpShare: "10%",
  migratedLpBurn: "90%",
  platformLpShare: "0%",
} as const;
