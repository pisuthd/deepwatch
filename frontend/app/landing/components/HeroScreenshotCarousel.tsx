'use client';

import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const screenshots = [
    {
        src: '/hero-1.png',
        alt: 'Predict Markets',
        caption: 'DeepBook Terminal — Trade spot, margin, and predict in one place',
    },
    {
        src: '/hero-5.png',
        alt: 'Cross-Venue Compare',
        caption: 'Cross-Venue Compare — Polymarket, Kalshi, and Predict side by side',
    }, 
    {
        src: '/hero-7.png',
        alt: 'AI Insights',
        caption: 'AI Insights — SVI + Polymarket + Kalshi distilled into plain English',
    },
];

export default function HeroScreenshotCarousel() {
    const [current, setCurrent] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrent((prev) => (prev + 1) % screenshots.length);
        }, 8000);
        return () => clearInterval(timer);
    }, []);

    const prev = () => setCurrent((prev) => (prev - 1 + screenshots.length) % screenshots.length);
    const next = () => setCurrent((prev) => (prev + 1) % screenshots.length);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="block my-8 md:my-0"
        >
            <div className="relative w-full max-w-2xl mx-auto">
                {/* Glow */}
                <div className="absolute inset-0 bg-gradient-to-br from-accent-primary/20 via-transparent to-blue-500/20 rounded-3xl blur-3xl" />

                {/* Card */}
                <div className="relative bg-[var(--color-bg-surface)] border border-white/10 rounded-3xl p-4 backdrop-blur-xl overflow-hidden">
                    <div className="relative aspect-video bg-[var(--color-bg-elevated)] rounded-2xl overflow-hidden">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={current}
                                initial={{ opacity: 0, x: 50 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -50 }}
                                transition={{ duration: 0.5 }}
                                className="absolute inset-0"
                            >
                                <Image
                                    src={screenshots[current].src}
                                    alt={screenshots[current].alt}
                                    fill
                                    sizes="(max-width: 1024px) 100vw, 50vw"
                                    className="object-cover object-top"
                                    priority
                                />
                            </motion.div>
                        </AnimatePresence>

                        {/* Navigation arrows */}
                        <button
                            onClick={prev}
                            className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 backdrop-blur-sm text-white/70 hover:text-white transition-colors"
                        >
                            <ChevronLeft size={20} />
                        </button>
                        <button
                            onClick={next}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 backdrop-blur-sm text-white/70 hover:text-white transition-colors"
                        >
                            <ChevronRight size={20} />
                        </button>
                    </div>

                    {/* Caption */}
                    <motion.p
                        key={`caption-${current}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.2 }}
                        className="text-center text-sm text-gray-400 mt-4 px-4"
                    >
                        {screenshots[current].caption}
                    </motion.p>

                    {/* Dot indicators */}
                    <div className="flex items-center justify-center gap-2 mt-3">
                        {screenshots.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setCurrent(i)}
                                className={`transition-all rounded-full ${
                                    i === current
                                        ? 'w-6 h-2 bg-accent-primary'
                                        : 'w-2 h-2 bg-white/30 hover:bg-white/50'
                                }`}
                            />
                        ))}
                    </div>
                </div>

                {/* Decorative glow */}
                <div className="absolute -top-4 -right-4 w-20 h-20 bg-accent-primary/10 rounded-full blur-2xl" />
            </div>
        </motion.div>
    );
}
