'use client';

interface PredictHeaderProps {
  question: string;
  spotPrice: number;
  marketName: string;
  expiry: string;
}

export default function PredictHeader({ question, spotPrice, marketName, expiry }: PredictHeaderProps) {
  const green = '#00E68A';

  return (
    <div className="relative overflow-hidden rounded-2xl p-5 bg-[rgba(26,29,46,0.6)] backdrop-blur-xl border border-white/10">
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full" style={{ background: green, filter: 'blur(80px)', opacity: 0.15 }} />
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-white">{question}</h2>
          <span className="text-xs px-2 py-1 rounded bg-[rgba(40,44,60,0.5)] text-gray-400">
            {expiry}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Spot</span>
            <span className="text-2xl font-bold" style={{ color: green }}>${spotPrice.toLocaleString()}</span>
          </div>
          <div className="w-8 h-8 rounded-lg bg-accent-primary/20 flex items-center justify-center">
            <span className="text-xs font-bold" style={{ color: green }}>{marketName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}