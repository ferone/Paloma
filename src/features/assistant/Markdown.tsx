import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Markdown for assistant answers. react-markdown never renders raw HTML (it is
// escaped), so model output cannot inject markup. Styling follows the app's
// tokens; no typography plugin.

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-4">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  h1: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold text-foreground">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold text-foreground">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-3 text-[13px] font-semibold text-foreground">{children}</h4>,
  h4: ({ children }) => <h4 className="mb-1 mt-2 text-[13px] font-medium text-foreground">{children}</h4>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="num rounded bg-surface-2 px-1 py-px text-[12px] text-foreground">{children}</code>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-surface-2 p-2 text-[12px]">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-border-strong pl-3 text-muted">{children}</blockquote>,
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="label border-b border-border px-1.5 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="num border-b border-border/60 px-1.5 py-1 align-top">{children}</td>,
}

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  )
}
