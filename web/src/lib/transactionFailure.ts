export type KodiakFailure = {
  code: string;
  message: string;
  action: string;
  technical: string;
};

function rawMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  try {
    const encoded = JSON.stringify(error);
    if (encoded && encoded !== "{}") return encoded;
  } catch {}
  return fallback;
}

export function classifyKodiakFailure(error: unknown, fallback: string): KodiakFailure {
  const technical = rawMessage(error, fallback);
  const text = technical.toLowerCase();

  if (/user reject|user rejected|rejected the request|declined|cancelled before wallet|canceled before wallet/.test(text)) {
    return { code: "WALLET_REJECTED", message: "The wallet approval was cancelled. No transaction was submitted.", action: "Try again when you are ready and approve the transaction in your wallet.", technical };
  }
  if (/insufficient|not enough|0x1|insufficient funds/.test(text) && /sol|lamport|fund|balance|fee/.test(text)) {
    return { code: "INSUFFICIENT_SOL", message: "The wallet does not have enough SOL to complete this transaction and pay network costs.", action: "Add SOL or reduce the amount, then try again.", technical };
  }
  if (/blockhash|block height exceeded|expired|transaction expired/.test(text)) {
    return { code: "TRANSACTION_EXPIRED", message: "The transaction expired before Solana could confirm it.", action: "Retry. Kodiak will rebuild the transaction with a fresh blockhash.", technical };
  }
  if (/429|too many requests|fetch failed|failed to fetch|network request failed|rpc|service unavailable|gateway|timeout|timed out/.test(text)) {
    return { code: "RPC_UNAVAILABLE", message: "Kodiak could not reliably reach Solana right now.", action: "Wait a few seconds and retry. If it repeats, Kodiak support can use the technical details below.", technical };
  }
  if (/slippage|amount out|price impact|min.*out|exceeded.*slippage/.test(text)) {
    return { code: "PRICE_MOVED", message: "The price moved enough that Kodiak stopped the trade instead of executing at an unexpected price.", action: "Refresh the quote and try again.", technical };
  }
  if (/state changed after simulation|graduation|waiting for.*cpmm|bonding target/.test(text)) {
    return { code: "TOKEN_STATE_CHANGED", message: "The token changed state while the transaction was being prepared, so Kodiak stopped the transaction for safety.", action: "Refresh the token. If graduation is in progress, wait for Kodiak to detect the CPMM pool before trading again.", technical };
  }
  if (/simulation/.test(text)) {
    return { code: "SIMULATION_FAILED", message: "Kodiak's safety simulation found a problem, so the wallet transaction was not sent.", action: "Do not keep retrying blindly. Open the technical details if support needs the Solana program logs.", technical };
  }

  return { code: "TRANSACTION_FAILED", message: fallback, action: "Retry once. If the same error repeats, send Kodiak support the support code and technical details shown below.", technical };
}
