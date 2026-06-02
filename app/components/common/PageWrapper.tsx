'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
 
interface PageWrapperProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}

export default function PageWrapper({ title, children, className = '', action }: PageWrapperProps) {
  const isDark = true
  const gradientClass = isDark ? 'text-gradient-white' : 'text-gradient-light';
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [title]);

  return (
    <div className={`p-8 ${className}`} ref={topRef}>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex items-center justify-between"
      >
        <h1 className={`text-2xl font-bold ${gradientClass}`}>
          {title}
        </h1>
        {action && <div>{action}</div>}
      </motion.div>
      {children}
    </div>
  )}