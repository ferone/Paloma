import type { ReactNode } from 'react'
import { RiQuestionAnswerLine } from 'react-icons/ri'
import { askPrompt, useAssistant } from '../features/assistant/context'

const DEFAULT_TITLE = 'How to read this'

/** Collapsible "How to read this" block. Native <details>: no JS, keyboard-accessible. */
export function Explainer({ title = DEFAULT_TITLE, ask, children }: { title?: ReactNode; ask?: string; children: ReactNode }) {
  const assistant = useAssistant()
  const term = ask ?? (typeof title === 'string' && title !== DEFAULT_TITLE ? title : undefined)
  return (
    <details className="group rounded-md border border-border bg-surface-2/50 text-xs">
      <summary className="cursor-pointer select-none list-none px-3 py-2 text-muted hover:text-foreground pointer-coarse:py-3">
        <span className="mr-1.5 inline-block transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
        {title}
      </summary>
      <div className="space-y-2 px-3 pb-3 leading-relaxed text-muted">
        {children}
        {assistant && term && (
          <button
            type="button"
            onClick={() => assistant.open(askPrompt(term))}
            className="no-print inline-flex items-center gap-1 text-2xs text-faint transition-colors hover:text-brand pointer-coarse:py-2"
          >
            <RiQuestionAnswerLine size={12} aria-hidden />
            Ask about this
          </button>
        )}
      </div>
    </details>
  )
}

/** Inline definition tooltip for jargon (z-score, contango, TWR…). */
export function HelpTip({ term, ask, children }: { term: ReactNode; ask?: string; children: ReactNode }) {
  const assistant = useAssistant()
  const askTerm = ask ?? (typeof term === 'string' ? term : undefined)
  return (
    <span className="group relative inline-flex items-center">
      {/* tabIndex: a tap focuses the term, and focus-within shows the definition on touch screens. */}
      <span tabIndex={0} className="cursor-help border-b border-dotted border-muted focus:outline-none">{term}</span>
      {assistant && askTerm && (
        // A span, not a <button>: HelpTip often sits inside sortable table-header buttons.
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            assistant.open(askPrompt(askTerm))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
              e.preventDefault()
              assistant.open(askPrompt(askTerm))
            }
          }}
          aria-label={`Ask the assistant about ${askTerm}`}
          title="Ask about this"
          className="no-print ml-0.5 cursor-pointer rounded p-px text-faint opacity-0 transition-opacity pointer-coarse:p-1.5 pointer-coarse:opacity-100 hover:text-brand focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <RiQuestionAnswerLine size={11} aria-hidden />
        </span>
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-md border border-border bg-surface-3 px-3 py-2 text-xs leading-relaxed text-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  )
}
