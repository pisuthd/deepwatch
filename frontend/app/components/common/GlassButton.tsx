'use client';

interface GlassButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'default' | 'danger' | 'success';
  onClick?: () => void;
  className?: string;
}

const variantStyles = {
  primary: 'border-accent-primary/30 text-accent-primary hover:bg-accent-primary/10',
  default: 'border-white/10 text-gray-300 hover:bg-white/5 hover:text-white',
  danger: 'border-red-500/30 text-red-400 hover:bg-red-500/10',
  success: 'border-accent-primary/30 text-accent-primary hover:bg-accent-primary/10',
};

const glowColors = {
  primary: 'bg-accent-primary/20',
  default: 'bg-white/10',
  danger: 'bg-red-500/20',
  success: 'bg-accent-primary/20',
};

export default function GlassButton({ children, variant = 'default', onClick, className = '' }: GlassButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-xl px-5 py-2.5 border bg-[rgba(26,29,46,0.6)] backdrop-blur-xl transition-all hover:scale-[1.02] ${variantStyles[variant]} ${className}`}
    >
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/5 to-transparent" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className={`absolute -top-8 -right-8 w-16 h-16 rounded-full ${glowColors[variant]} blur-xl`} />
      <span className="relative z-10 text-sm font-semibold">{children}</span>
    </button>
  );
}