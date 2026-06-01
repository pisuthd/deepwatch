'use client';

import { useState } from 'react';
import PageWrapper from '../common/PageWrapper';
import GlassButton from '../common/GlassButton';
import { useTheme } from '../../context/ThemeContext';

type Tab = 'general' | 'appearance' | 'about';

export default function SettingsPage() {
  const { isDark } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>('general');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'about', label: 'About' },
  ];

  return (
    <PageWrapper title="Settings">
      {/* Settings Tabs */}
      <div className="flex gap-2 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-accent-primary-dim text-accent-primary'
                : isDark
                  ? 'text-gray-400 hover:bg-white/5'
                  : 'text-gray-600 hover:bg-gray-100'
            }`}
            style={{
              background: activeTab === tab.id ? undefined : isDark ? 'rgba(26, 29, 46, 0.6)' : 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div
        className="rounded-2xl border border-white/10 p-6"
        style={{
          background: 'rgba(26, 29, 46, 0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        {activeTab === 'general' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-white mb-4">General Settings</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-3 border-b border-white/10">
                <div>
                  <p className="text-white font-medium">Language</p>
                  <p className="text-gray-400 text-sm">Select your preferred language</p>
                </div>
                <span className="text-gray-400">English</span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-white/10">
                <div>
                  <p className="text-white font-medium">Notifications</p>
                  <p className="text-gray-400 text-sm">Enable desktop notifications</p>
                </div>
                <span className="text-gray-400">Disabled</span>
              </div>
              <div className="flex justify-between items-center py-3">
                <div>
                  <p className="text-white font-medium">Auto-save</p>
                  <p className="text-gray-400 text-sm">Automatically save chat history</p>
                </div>
                <span className="text-gray-400">Enabled</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'appearance' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-white mb-4">Appearance</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-3 border-b border-white/10">
                <p className="text-white font-medium">Theme</p>
                <span className="text-gray-400">{isDark ? 'Dark' : 'Light'}</span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-white/10">
                <div>
                  <p className="text-white font-medium">Sidebar</p>
                  <p className="text-gray-400 text-sm">Position of the sidebar</p>
                </div>
                <span className="text-gray-400">Left</span>
              </div>
              <div className="flex justify-between items-center py-3">
                <div>
                  <p className="text-white font-medium">Compact Mode</p>
                  <p className="text-gray-400 text-sm">Reduce spacing in UI elements</p>
                </div>
                <span className="text-gray-400">Off</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-white mb-4">About SnapPredict</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-3 border-b border-white/10">
                <p className="text-white font-medium">Version</p>
                <span className="text-gray-400">0.1.0</span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-white/10">
                <p className="text-white font-medium">Build</p>
                <span className="text-gray-400">Next.js 16</span>
              </div>
              <div className="py-4">
                <p className="text-gray-400 text-sm leading-relaxed">
                  SnapPredict is an AI-powered prediction platform built with Next.js. 
                  It features a modern glass morphism UI design with dark/light theme support.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageWrapper>
  );
}