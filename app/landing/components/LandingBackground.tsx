'use client';

import { motion } from 'framer-motion';

export default function LandingBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Subtle gradient orbs - fixed positions, no animation */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-br from-accent-primary/10 to-transparent rounded-full blur-[120px]" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gradient-to-tr from-blue-500/5 to-transparent rounded-full blur-[100px]" />
      
      {/* Grid pattern overlay */}
      <div className="absolute inset-0 opacity-[0.02]" style={{
        backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                         linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
        backgroundSize: '50px 50px',
      }} />

      {/* Data visualization lines - subtle chart pattern */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.04]" preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00E68A" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#00E68A" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        
        {/* Horizontal grid lines */}
        {[20, 40, 60, 80].map((y) => (
          <line
            key={y}
            x1="0"
            y1={`${y}%`}
            x2="100%"
            y2={`${y}%`}
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="0.5"
          />
        ))}
        
        {/* Chart line 1 - upward trend */}
        <polyline
          fill="none"
          stroke="url(#chartGradient)"
          strokeWidth="1.5"
          points="0,80 20,75 40,65 60,50 80,35 100,20"
        />
        
        {/* Chart line 2 - secondary */}
        <polyline
          fill="none"
          stroke="rgba(59, 130, 246, 0.4)"
          strokeWidth="1"
          strokeDasharray="4,4"
          points="0,90 20,85 40,78 60,70 80,60 100,45"
        />
        
        {/* Data points */}
        {[
          { x: 40, y: 65 },
          { x: 60, y: 50 },
          { x: 80, y: 35 },
        ].map((point, i) => (
          <circle
            key={i}
            cx={`${point.x}%`}
            cy={`${point.y}%`}
            r="3"
            fill="#00E68A"
            opacity="0.6"
          />
        ))}
      </svg>
    </div>
  );
}