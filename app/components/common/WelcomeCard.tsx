'use client';

interface WelcomeCardProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export default function WelcomeCard({ title, description, action }: WelcomeCardProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-6 bg-[rgba(26,29,46,0.6)] backdrop-blur-xl border border-white/10">
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-accent-primary/10 blur-3xl" />
      
      <div className="relative z-10">
        <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
        {description && <p className="text-gray-400 mb-4">{description}</p>}
        {action}
      </div>
    </div>
  );
}