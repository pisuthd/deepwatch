'use client';

import { motion } from 'framer-motion';
import { Telescope, Menu, X } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';

export default function Navbar() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

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
                    <a href="/app" className="text-gray-400 hover:text-white transition-colors">Trade</a>
                    <a href="#how-it-works" className="text-gray-400 hover:text-white transition-colors">How It Works</a>
                    <a href="https://github.com/pisuthd/deepwatch" target='_blank' className="text-gray-400 hover:text-white transition-colors">GitHub</a>
                </nav>

                {/* CTA Button */}
                <div className="flex items-center gap-4">
                    <Link
                        href="/app"
                        className="hidden sm:inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-accent-primary text-black font-semibold text-sm hover:bg-accent-primary-hover transition-all"
                    >
                        Enter App
                    </Link>

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
                        <a href="/app" onClick={() => setIsMenuOpen(false)} className="text-gray-400 hover:text-white transition-colors py-2">Trade</a>
                        <a href="#how-it-works" onClick={() => setIsMenuOpen(false)} className="text-gray-400 hover:text-white transition-colors py-2">How It Works</a>
                        <a href="https://github.com/pisuthd/deepwatch" target='_blank' onClick={() => setIsMenuOpen(false)} className="text-gray-400 hover:text-white transition-colors py-2">GitHub</a>
                        <Link
                            href="/app"
                            onClick={() => setIsMenuOpen(false)}
                            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-accent-primary text-black font-semibold text-sm hover:bg-accent-primary-hover transition-all mt-2"
                        >
                            Enter App
                        </Link>
                    </nav>
                </motion.div>
            )}
        </header>
    );
}
