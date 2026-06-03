'use client';

import { useState } from 'react';
import PageWrapper from '../common/PageWrapper';
import { motion, AnimatePresence } from 'framer-motion';

type Tab = 'general' | 'appearance' | 'about';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('general');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'about', label: 'About' },
  ];

  return (
    <PageWrapper title="Settings">
      <div
        className="rounded-2xl border border-white/10 overflow-hidden"
        style={{
          background: 'rgba(26, 29, 46, 0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        {/* Tabs Header with Underline Indicator */}
        <div className="flex gap-8 px-6 pt-6 pb-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative pb-3 text-sm font-medium transition-colors duration-200 ${
                activeTab === tab.id ? 'text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-primary"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {activeTab === 'general' && (
              <motion.div
                key="general"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-1"
              >
                <h3 className="text-lg font-semibold text-white mb-4">General Settings</h3>
                <div className="space-y-0">
                  <div className="flex justify-between items-center py-3.5 px-2 hover:bg-white/[0.02] rounded-lg transition-colors">
                    <div>
                      <p className="text-white font-medium">Language</p>
                      <p className="text-gray-400 text-sm">Select your preferred language</p>
                    </div>
                    <span className="text-gray-400">English</span>
                  </div>
                  <div className="flex justify-between items-center py-3.5 px-2 hover:bg-white/[0.02] rounded-lg transition-colors">
                    <div>
                      <p className="text-white font-medium">Notifications</p>
                      <p className="text-gray-400 text-sm">Enable desktop notifications</p>
                    </div>
                    <span className="text-gray-400">Disabled</span>
                  </div>
                  <div className="flex justify-between items-center py-3.5 px-2 hover:bg-white/[0.02] rounded-lg transition-colors">
                    <div>
                      <p className="text-white font-medium">Auto-save</p>
                      <p className="text-gray-400 text-sm">Automatically save chat history</p>
                    </div>
                    <span className="text-gray-400">Enabled</span>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'appearance' && (
              <motion.div
                key="appearance"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-1"
              >
                <h3 className="text-lg font-semibold text-white mb-4">Appearance</h3>
                <div className="space-y-0">
                  <div className="flex justify-between items-center py-3.5 px-2 hover:bg-white/[0.02] rounded-lg transition-colors">
                    <p className="text-white font-medium">Theme</p>
                    <span className="text-gray-400">Dark</span>
                  </div>
                  <div className="flex justify-between items-center py-3.5 px-2 hover:bg-white/[0.02] rounded-lg transition-colors">
                    <div>
                      <p className="text-white font-medium">Sidebar</p>
                      <p className="text-gray-400 text-sm">Position of the sidebar</p>
                    </div>
                    <span className="text-gray-400">Left</span>
                  </div>
                  <div className="flex justify-between items-center py-3.5 px-2 hover:bg-white/[0.02] rounded-lg transition-colors">
                    <div>
                      <p className="text-white font-medium">Compact Mode</p>
                      <p className="text-gray-400 text-sm">Reduce spacing in UI elements</p>
                    </div>
                    <span className="text-gray-400">Off</span>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'about' && (
              <motion.div
                key="about"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-1"
              >
                <h3 className="text-lg font-semibold text-white mb-4">About SnapPredict</h3>
                <div className="space-y-0">
                  <div className="flex justify-between items-center py-3.5 px-2 hover:bg-white/[0.02] rounded-lg transition-colors">
                    <p className="text-white font-medium">Version</p>
                    <span className="text-gray-400">0.1.0</span>
                  </div>
                  <div className="flex justify-between items-center py-3.5 px-2 hover:bg-white/[0.02] rounded-lg transition-colors">
                    <p className="text-white font-medium">Build</p>
                    <span className="text-gray-400">Next.js 16</span>
                  </div>
                  <div className="py-4 px-2">
                    <p className="text-gray-400 text-sm leading-relaxed">
                      SnapPredict is an AI-powered prediction platform built with Next.js.
                      It features a modern glass morphism UI design with dark/light theme support.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PageWrapper>
  );
}
