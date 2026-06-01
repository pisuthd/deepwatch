'use client';

import { useState } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import PageWrapper from '../common/PageWrapper';
import { useTheme } from '../../context/ThemeContext';

export default function ChatPage() {
  const { isDark } = useTheme();
  const [input, setInput] = useState('');

  return (
    <PageWrapper title="Chat">
      {/* Chat Interface Placeholder */}
      <div className="flex flex-col h-[calc(100vh-200px)]">
        {/* Messages Area */}
        <div className="flex-1 rounded-2xl border border-white/10 overflow-hidden mb-4" style={{
          background: 'rgba(26, 29, 46, 0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}>
          <div className="h-full flex flex-col items-center justify-center p-8">
            <MessageSquare size={48} className="text-gray-500 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Start a Conversation</h3>
            <p className="text-gray-400 text-center max-w-md">
              Send a message to start making predictions with AI. Your chat history will appear here.
            </p>
          </div>
        </div>

        {/* Input Area */}
        <div
          className="rounded-2xl border border-white/10 overflow-hidden"
          style={{
            background: 'rgba(26, 29, 46, 0.6)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
          
          <form className="relative z-10 flex items-center gap-3 p-4">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about predictions..."
              className="flex-1 bg-transparent border-none outline-none text-white placeholder-gray-500 py-2 px-3 rounded-lg bg-[var(--color-bg-elevated)]"
            />
            <button
              type="submit"
              disabled
              className="w-10 h-10 rounded-xl bg-accent-primary flex items-center justify-center text-black hover:bg-accent-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>
    </PageWrapper>
  );
}