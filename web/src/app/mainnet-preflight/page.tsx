import Link from "next/link";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import {
  CREATE_CPMM_POOL_PROGRAM,
  getPdaLaunchpadConfigId,
  LAUNCHPAD_PROGRAM,
  LaunchpadConfig,
  PlatformConfig,
} from "@raydium-io/raydium-sdk-v2";

import { KODIAK_FEE_LABELS } from "@/lib/fees";
import { KODIAK_MAINNET_CPMM_CONFIG_ID } from "@/lib/solana/network";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAINNET_PLATFORM_ID =
  "5d63yX2vRpyS2BPFwJJB15tMmctWCKwiKychEjP3gy4W";

const EXPECTED_PLATFORM_FEE_RATE = "5000";
const EXPECTED_CREATOR_FEE_RATE = "4500";

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

function validPublicKey(value: string) {
  if (!value) return false;

  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function bnLikeToString(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "toString" in value &&
    typeof value.toString === "function"
  ) {
    return value.toString();
  }

  return null;
}

type Check = {
  label: string;
  pass: boolean;
  detail: string;
};

function CheckRow({ check }: { check: Check }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 20,
        padding: "18px 0",
        borderBottom: "1px solid #222",
      }}
    >
      <div>
        <div style={{ fontWeight: 800 }}>{check.label}</div>
        <div
          style={{
            color: "#8d8d98",
            marginTop: 6,
            fontSize: 14,
            lineHeight: 1.5,
            overflowWrap: "anywhere",
          }}
        >
          {check.detail}
        </div>
      </div>
      <div
        style={{
          flexShrink: 0,
          fontWeight: 900,
          color: check.pass ? "#55e6b2" : "#ff6b6b",
        }}
      >
        {check.pass ? "PASS" : "FAIL"}
      </div>
    </div>
  );
}

export default async function MainnetLaunchPreflightPage() {
  const requestedNetwork =
    env("NEXT_PUBLIC_SOLANA_NETWORK").toLowerCase();

  const mainnetRequested =
    requestedNetwork === "mainnet" ||
    requestedNetwork === "mainnet-beta";

  const mainnetEnabled =
    env("NEXT_PUBLIC_KODIAK_MAINNET_ENABLED").toLowerCase() === "true";

  const rpcUrl =
    env("SOLANA_MAINNET_RPC_URL") ||
    env("NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL");

  const configuredPlatformId =
    env("KODIAK_MAINNET_PLATFORM_ID") ||
    env("NEXT_PUBLIC_KODIAK_MAINNET_PLATFORM_ID") ||
    MAINNET_PLATFORM_ID;

  const authorityNames = [
    "NEXT_PUBLIC_KODIAK_PLATFORM_ADMIN_WALLET",
    "NEXT_PUBLIC_KODIAK_PLATFORM_CLAIM_FEE_WALLET",
    "NEXT_PUBLIC_KODIAK_PLATFORM_LOCK_NFT_WALLET",
    "NEXT_PUBLIC_KODIAK_TRANSFER_FEE_AUTH_WALLET",
  ] as const;

  const authorities = authorityNames.map((name) => ({
    name,
    value: env(name),
  }));

  const authorityValues = authorities.map((item) => item.value);
  const authoritiesValid = authorityValues.every(validPublicKey);
  const authoritiesConsistent =
    authoritiesValid &&
    new Set(authorityValues).size === 1;

  const checks: Check[] = [
    {
      label: "Production requests Mainnet",
      pass: mainnetRequested,
      detail:
        "NEXT_PUBLIC_SOLANA_NETWORK must request Mainnet so the final enable flag can activate the production network.",
    },
    {
      label: "Global Mainnet switch is enabled",
      pass: mainnetEnabled,
      detail:
        "NEXT_PUBLIC_KODIAK_MAINNET_ENABLED must be true for this post-activation production verification.",
    },
    {
      label: "Dedicated Mainnet RPC configured",
      pass: Boolean(rpcUrl),
      detail: rpcUrl
        ? "A dedicated Mainnet RPC is configured. The RPC value is intentionally not displayed."
        : "No Mainnet RPC environment variable was found.",
    },
    {
      label: "Launch path PlatformConfig ID",
      pass:
        validPublicKey(configuredPlatformId) &&
        configuredPlatformId === MAINNET_PLATFORM_ID,
      detail: configuredPlatformId || "Missing Mainnet PlatformConfig ID.",
    },
    {
      label: "Production authority wallets",
      pass: authoritiesValid,
      detail: authoritiesValid
        ? "All four production authority environment variables contain valid Solana public keys."
        : "One or more production authority wallet values are missing or invalid.",
    },
    {
      label: "Production authorities are intentionally consistent",
      pass: authoritiesConsistent,
      detail: authoritiesConsistent
        ? `All four authority roles currently resolve to ${authorityValues[0]}.`
        : "The four authority roles do not all resolve to the same configured production wallet. Review before launch.",
    },
    {
      label: "IPFS metadata credential",
      pass: Boolean(env("PINATA_JWT")),
      detail: env("PINATA_JWT")
        ? "PINATA_JWT is present. Its value is intentionally not displayed."
        : "PINATA_JWT is missing, so token metadata upload would fail.",
    },
  ];

  let rpcReachable = false;
  let launchLabConfigExists = false;
  let launchLabConfigOwnedCorrectly = false;
  let platformExists = false;
  let platformOwnedCorrectly = false;
  let platformCpmmMatches = false;
  let platformFeeMatches = false;
  let creatorFeeMatches = false;
  let cpmmConfigExists = false;
  let cpmmConfigOwnedCorrectly = false;
  let launchLabConfigAddress = "Not checked";
  let rpcError = "";

  if (rpcUrl) {
    try {
      const connection = new Connection(rpcUrl, "confirmed");
      await connection.getLatestBlockhash("confirmed");
      rpcReachable = true;

      const launchConfigId = getPdaLaunchpadConfigId(
        LAUNCHPAD_PROGRAM,
        NATIVE_MINT,
        0,
        0,
      ).publicKey;

      launchLabConfigAddress = launchConfigId.toBase58();

      const [launchConfigAccount, platformAccount, cpmmConfigAccount] =
        await Promise.all([
          connection.getAccountInfo(launchConfigId, "confirmed"),
          connection.getAccountInfo(
            new PublicKey(MAINNET_PLATFORM_ID),
            "confirmed",
          ),
          connection.getAccountInfo(
            new PublicKey(KODIAK_MAINNET_CPMM_CONFIG_ID),
            "confirmed",
          ),
        ]);

      launchLabConfigExists = Boolean(launchConfigAccount);
      launchLabConfigOwnedCorrectly = Boolean(
        launchConfigAccount?.owner.equals(LAUNCHPAD_PROGRAM),
      );

      if (launchConfigAccount) {
        // Decode the exact LaunchLab config used by launch/page.tsx.
        LaunchpadConfig.decode(launchConfigAccount.data);
      }

      platformExists = Boolean(platformAccount);
      platformOwnedCorrectly = Boolean(
        platformAccount?.owner.equals(LAUNCHPAD_PROGRAM),
      );

      if (platformAccount) {
        const decoded = PlatformConfig.decode(
          platformAccount.data,
        ) as unknown as {
          cpConfigId?: PublicKey;
          feeRate?: unknown;
          creatorFeeRate?: unknown;
        };

        const cpConfigId =
          decoded.cpConfigId instanceof PublicKey
            ? decoded.cpConfigId.toBase58()
            : "";

        platformCpmmMatches =
          cpConfigId === KODIAK_MAINNET_CPMM_CONFIG_ID;

        platformFeeMatches =
          bnLikeToString(decoded.feeRate) ===
          EXPECTED_PLATFORM_FEE_RATE;

        creatorFeeMatches =
          bnLikeToString(decoded.creatorFeeRate) ===
          EXPECTED_CREATOR_FEE_RATE;
      }

      cpmmConfigExists = Boolean(cpmmConfigAccount);
      cpmmConfigOwnedCorrectly = Boolean(
        cpmmConfigAccount?.owner.equals(CREATE_CPMM_POOL_PROGRAM),
      );
    } catch (error) {
      rpcError =
        error instanceof Error
          ? error.message
          : "Unknown Mainnet RPC error.";
    }
  }

  checks.push(
    {
      label: "Mainnet RPC responds",
      pass: rpcReachable,
      detail: rpcReachable
        ? "Kodiak successfully read a confirmed Mainnet blockhash."
        : rpcError || "Mainnet RPC was not checked because it is missing.",
    },
    {
      label: "Raydium Mainnet LaunchLab config exists",
      pass: launchLabConfigExists,
      detail: launchLabConfigAddress,
    },
    {
      label: "LaunchLab config owner",
      pass: launchLabConfigOwnedCorrectly,
      detail:
        "The config account used by Kodiak's launch builder must be owned by Raydium's Mainnet LaunchLab program.",
    },
    {
      label: "Kodiak Mainnet PlatformConfig exists",
      pass: platformExists,
      detail: MAINNET_PLATFORM_ID,
    },
    {
      label: "PlatformConfig owner",
      pass: platformOwnedCorrectly,
      detail:
        "Kodiak's PlatformConfig must be owned by Raydium's Mainnet LaunchLab program.",
    },
    {
      label: "PlatformConfig migration target",
      pass: platformCpmmMatches,
      detail: `Expected CPMM index 8 config: ${KODIAK_MAINNET_CPMM_CONFIG_ID}`,
    },
    {
      label: `Kodiak platform fee = ${KODIAK_FEE_LABELS.kodiakPlatform}`,
      pass: platformFeeMatches,
      detail: `Expected on-chain feeRate ${EXPECTED_PLATFORM_FEE_RATE}.`,
    },
    {
      label: `Creator curve fee = ${KODIAK_FEE_LABELS.creatorCurve}`,
      pass: creatorFeeMatches,
      detail: `Expected on-chain creatorFeeRate ${EXPECTED_CREATOR_FEE_RATE}.`,
    },
    {
      label: "Mainnet CPMM index 8 config exists",
      pass: cpmmConfigExists,
      detail: KODIAK_MAINNET_CPMM_CONFIG_ID,
    },
    {
      label: "CPMM config owner",
      pass: cpmmConfigOwnedCorrectly,
      detail:
        "The migration target must be owned by Raydium's Mainnet CPMM program.",
    },
  );

  const passed = checks.filter((check) => check.pass).length;
  const allPassed = passed === checks.length;

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "72px 24px 120px",
      }}
    >
      <div
        style={{
          color: "#55e6b2",
          fontWeight: 900,
          letterSpacing: "0.22em",
          fontSize: 14,
        }}
      >
        MAINNET LAUNCH PREFLIGHT Â· READ ONLY
      </div>

      <h1
        style={{
          fontSize: "clamp(42px, 8vw, 72px)",
          lineHeight: 1,
          margin: "18px 0 20px",
        }}
      >
        Kodiak Mainnet Preflight
      </h1>

      <p
        style={{
          color: "#a1a1aa",
          fontSize: 20,
          lineHeight: 1.7,
          maxWidth: 760,
        }}
      >
        This page verifies the production launch dependencies without connecting
        a wallet, signing anything, spending SOL, creating a token, or changing
        Kodiak&apos;s Mainnet enable flag.
      </p>

      <div
        style={{
          marginTop: 34,
          padding: 28,
          border: `1px solid ${allPassed ? "#075f46" : "#7f1d1d"}`,
          borderRadius: 24,
          background: allPassed ? "#061812" : "#1b0b0b",
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 900,
            color: allPassed ? "#55e6b2" : "#ff6b6b",
          }}
        >
          {allPassed ? "MAINNET ACTIVATION VERIFIED" : "MAINNET VERIFICATION FAILED"}
        </div>
        <div style={{ marginTop: 10, color: "#b3b3bd", lineHeight: 1.6 }}>
          {passed} of {checks.length} checks passed.
          {allPassed
            ? " Kodiak is running in Mainnet mode and all audited production launch dependencies are aligned for the first controlled Mainnet launch."
            : " One or more post-activation production checks failed. Do not submit a Mainnet launch transaction until every item passes."}
        </div>
      </div>

      <section
        style={{
          marginTop: 34,
          padding: "8px 28px",
          border: "1px solid #27272a",
          borderRadius: 24,
          background: "#0b0b0d",
        }}
      >
        {checks.map((check) => (
          <CheckRow key={check.label} check={check} />
        ))}
      </section>

      <section
        style={{
          marginTop: 34,
          padding: 28,
          border: "1px solid #27272a",
          borderRadius: 24,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 22 }}>What this does not do</div>
        <p style={{ color: "#9999a3", lineHeight: 1.7, marginBottom: 0 }}>
          No transaction is constructed or simulated. No wallet is connected.
          No Mainnet SOL is touched. This is intentionally a dependency and
          configuration audit only; the first real Mainnet launch remains a
          separate controlled step.
        </p>
      </section>

      <div style={{ marginTop: 34 }}>
        <Link
          href="/platform-setup"
          style={{
            display: "inline-block",
            padding: "14px 18px",
            border: "1px solid #333",
            borderRadius: 14,
            color: "white",
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          Back to PlatformConfig verification
        </Link>
      </div>
    </main>
  );
}
