import Link from "next/link";
import { ArrowRight, ExternalLink, Sparkles } from "lucide-react";

export default function AppPlaceholder() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div
        className="relative max-w-xl w-full rounded-2xl p-8 text-center border border-white/10"
        style={{
          background: "rgba(26, 29, 46, 0.6)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <div className="absolute -top-4 -right-4 w-20 h-20 bg-accent-primary/10 rounded-full blur-2xl" />

        <div className="flex items-center justify-center gap-1.5 mb-4">
          <Sparkles size={12} className="text-accent-primary" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-primary">
            App Coming Soon
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: "var(--color-accent-primary)" }}
          />
        </div>

        <h1 className="text-3xl md:text-4xl font-black mb-4 text-gradient-white">
          The DeepWatch app is on its way.
        </h1>
        <p className="text-gray-400 mb-8">
          We're rebuilding the trading terminal on this new stack. In the
          meantime, follow the journey on GitHub.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-black font-semibold hover:bg-accent-primary-hover transition-all"
          >
            Back to Home
          </Link>
          <a
            href="https://github.com/pisuthd/deepwatch"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-white/20 text-white font-medium hover:bg-white/5 transition-all"
          >
            View on GitHub
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </main>
  );
}
