export function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/5 px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-5 text-sm text-zinc-500 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <img
              src="/kodiak-logo.jpeg"
              alt="Kodiak"
              className="h-10 w-10 rounded-xl object-cover"
            />
            <span>© 2026 Kodiak</span>
          </div>
          <p>Built on Solana. Powered by Raydium LaunchLab.</p>
        </div>

        <p className="mt-5 border-t border-white/5 pt-5 text-xs leading-5 text-zinc-600">
          Kodiak is in public beta. Digital assets are speculative and transactions are irreversible. Review transaction details before signing and only use funds you can afford to risk.
        </p>
      </div>
    </footer>
  );
}
