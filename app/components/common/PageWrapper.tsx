'use client';

interface PageWrapperProps {
  title: string;
  children: React.ReactNode;
}

export default function PageWrapper({ title, children }: PageWrapperProps) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{title}</h1>
      </div>
      {children}
    </div>
  );
}