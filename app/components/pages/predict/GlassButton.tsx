'use client';

interface GlassButtonProps {
  children: React.ReactNode;
  variant?: 'green' | 'red';
  onClick?: (e?: React.MouseEvent) => void;
}

export default function GlassButton({ children, variant = 'green', onClick }: GlassButtonProps) {
  const bgColor = variant === 'green' ? '#00E68A' : '#ef4444';
  
  return (
    <button
      onClick={(e) => onClick?.(e)}
      className="relative rounded-xl px-4 py-2.5 border border-white/10"
      style={{ 
        background: 'rgba(26, 29, 46, 0.6)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/5 to-transparent" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="absolute -top-4 -right-4 w-12 h-12 rounded-full" style={{ background: bgColor, filter: 'blur(30px)', opacity: 0.15 }} />
      <div className="relative z-10 flex items-center gap-1.5 text-sm font-semibold" style={{ color: bgColor }}>
        {children}
      </div>
    </button>
  );
}