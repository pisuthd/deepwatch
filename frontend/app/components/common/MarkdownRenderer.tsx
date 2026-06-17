'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const green = '#00E68A';

/**
 * Reusable markdown renderer for user-authored insight bodies.
 *
 * Used in two places:
 *  - `InsightsPage`'s streamed AI summary (live preview while streaming)
 *  - `SavedInsightsPanel`'s body view (read-only view of a saved insight)
 *
 * `react-markdown` + `remark-gfm` gives us GFM tables, strikethrough, task
 * lists, autolinks, and fenced code blocks out of the box. Component
 * overrides restyle the rendered HTML to match the rest of the app's
 * inline-styled typography (no `@tailwindcss/typography` dependency).
 */
export default function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div
      className="text-sm leading-relaxed"
      style={{ color: textPrimary }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1
              className="text-xl font-bold mt-3 mb-2"
              style={{ color: textPrimary }}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              className="text-lg font-bold mt-3 mb-1.5"
              style={{ color: textPrimary }}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className="text-base font-semibold mt-2.5 mb-1"
              style={{ color: textPrimary }}
            >
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="my-2" style={{ color: textPrimary }}>
              {children}
            </p>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: green }}
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ color: textPrimary }}>{children}</li>
          ),
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-');
            return isBlock ? (
              <pre
                className="rounded-lg p-3 my-2 text-xs overflow-x-auto"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <code>{children}</code>
              </pre>
            ) : (
              <code
                className="px-1 py-0.5 rounded text-xs font-mono"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                {children}
              </code>
            );
          },
          blockquote: ({ children }) => (
            <blockquote
              className="border-l-2 pl-3 my-2"
              style={{ borderColor: 'rgba(0,230,138,0.4)', color: textSecondary }}
            >
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table
                className="text-xs"
                style={{ borderCollapse: 'collapse' }}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              className="px-2 py-1 text-left font-semibold"
              style={{ border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className="px-2 py-1"
              style={{ border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {children}
            </td>
          ),
          hr: () => (
            <hr
              className="my-3"
              style={{ borderColor: 'rgba(255,255,255,0.08)' }}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
