'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Telescope, Menu, X, ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import ConnectWallet from './ConnectWallet';

export default function Navbar() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isMoreOpen, setIsMoreOpen] = useState(false);
    const moreRef = useRef<HTMLDivElement>(null);

    // Click-outside handler for the "More" dropdown
    useEffect(() => {
        if (!isMoreOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
                setIsMoreOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isMoreOpen]);

    return (
        <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4" style={{
            background: 'rgba(15, 17, 23, 0.8)',
            backdropFilter: 'blur(20px)',
            borderBottom: '1px solid var(--color-border-subtle)',
        }}>
            <div className="max-w-6xl mx-auto flex items-center justify-between">
                {/* Logo - Scroll to top */}
                <a href="#" className="flex items-center gap-3 cursor-pointer">
                    <div className="w-10 h-10 rounded-xl bg-accent-primary flex items-center justify-center">
                        <Telescope size={20} className="text-[#0F1117]" strokeWidth={2} />
                    </div>
                    <span className={`text-lg font-black tracking-widest font-brand text-gradient-white`}>
                        DeepWatch
                    </span>
                </a>

                {/* Desktop Nav */}
                <nav className="hidden md:flex items-center gap-8">
                    <a href="/compare" className="text-gray-400 hover:text-white transition-colors">Compare</a>
                    <a href="/stake" className="text-gray-400 hover:text-white transition-colors">Stake</a>
                    <a href="/leaderboard" className="text-gray-400 hover:text-white transition-colors">Leaderboard</a>
                     
                    {/* "More" dropdown (GitHub) */}
                    <div className="relative z-50" ref={moreRef}>
                        <button
                            onClick={() => setIsMoreOpen((o) => !o)}
                            className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors"
                        >
                            More
                            <ChevronDown
                                size={12}
                                className={`transition-transform ${isMoreOpen ? 'rotate-180' : ''}`}
                            />
                        </button>

                        <AnimatePresence>
                            {isMoreOpen && (
                                <motion.div
                                    initial={{ opacity: 0, y: -8, scale: 0.96 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -8, scale: 0.96 }}
                                    transition={{ duration: 0.15 }}
                                    className="absolute top-full right-0 mt-2 w-44 py-1 rounded-lg border border-white/10 z-50 overflow-hidden shadow-lg shadow-black/40"
                                    style={{ background: 'var(--color-bg-elevated)' }}
                                >
                                    <a
                                        href="https://github.com/pisuthd/deepwatch"
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={() => setIsMoreOpen(false)}
                                        className="block px-3 py-2 text-sm text-gray-300 hover:bg-[var(--color-sidebar-hover)] hover:text-white transition-colors"
                                    >
                                        GitHub
                                    </a>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </nav>

                {/* CTA Button */}
                <div className="flex items-center gap-4">
                    <div className="hidden sm:block">
                        <ConnectWallet />
                    </div>

                    {/* Mobile Menu Toggle */}
                    <button
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className="md:hidden w-10 h-10 rounded-lg border border-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                        style={{ background: 'rgba(26, 29, 46, 0.6)' }}
                    >
                        {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            {isMenuOpen && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="md:hidden mt-4 pt-4 border-t border-white/10"
                >
                    <nav className="flex flex-col gap-4">
                        <a href="/compare" onClick={() => setIsMenuOpen(false)} className="text-gray-400 hover:text-white transition-colors py-2">Compare</a>
                        <a href="/stake" onClick={() => setIsMenuOpen(false)} className="text-gray-400 hover:text-white transition-colors py-2">Stake</a>
                        <a href="/leaderboard" onClick={() => setIsMenuOpen(false)} className="text-gray-400 hover:text-white transition-colors py-2">Leaderboard</a>
                        <a href="https://github.com/pisuthd/deepwatch" target='_blank' onClick={() => setIsMenuOpen(false)} className="text-gray-400 hover:text-white transition-colors py-2">GitHub</a>
                        <div className="mt-2">
                            <ConnectWallet />
                        </div>
                    </nav>
                </motion.div>
            )}
        </header>
    );
}
