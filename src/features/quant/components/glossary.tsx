import { Fragment, type ReactNode } from 'react'
import { fillGlossary, glossaryEntry } from '@shared/glossary'
import { Explainer } from '../../../ui'

// "How to read this" blocks for the Quant Lab's jargon. The text lives in
// shared/glossary.ts (one source with the AI assistant): plain language first,
// then the exact rule the engine applies.

/** Inline markup of glossary bodies: **bold** and *italic*. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** Paragraphs (blank-line separated) and "- " bullet lists of a glossary body. */
// eslint-disable-next-line react-refresh/only-export-components
export function renderGlossary(body: string): ReactNode {
  return body.split(/\n\n+/).map((block, i) => {
    const lines = block.split('\n')
    if (lines.every((l) => l.startsWith('- ')))
      return (
        <ul key={i} className="list-disc space-y-1 pl-4">
          {lines.map((l, j) => (
            <li key={j}>{inline(l.slice(2))}</li>
          ))}
        </ul>
      )
    return <p key={i}>{inline(block)}</p>
  })
}

/** Explainer rendered from one glossary entry (template placeholders filled from `vars`). */
export function GlossaryExplainer({ id, vars }: { id: string; vars?: Record<string, string> }) {
  const e = glossaryEntry(id)
  return (
    <Explainer title={fillGlossary(e.title ?? e.term, vars)} ask={e.term}>
      {renderGlossary(fillGlossary(e.body, vars))}
    </Explainer>
  )
}

export const ZScoreExplainer = () => <GlossaryExplainer id="zscore" />
export const OuExplainer = () => <GlossaryExplainer id="ou" />
export const ContangoExplainer = () => <GlossaryExplainer id="carry" />
export const ButterflyExplainer = () => <GlossaryExplainer id="butterfly" />
export const StructuralExplainer = () => <GlossaryExplainer id="structural" />
export const SeasonalExplainer = () => <GlossaryExplainer id="seasonality" />
export const BacktestExplainer = () => <GlossaryExplainer id="backtest" />
export const VerdictExplainer = () => <GlossaryExplainer id="verdict" />
export const KellyExplainer = () => <GlossaryExplainer id="kelly" />

/** Explains a relative-value ratio `num ÷ den` (labels and front roots from the universe). */
export function RatioExplainer({ num, den, numRoot, denRoot }: { num: string; den: string; numRoot: string; denRoot: string }) {
  return <GlossaryExplainer id="ratio" vars={{ n: num.toLowerCase(), d: den.toLowerCase(), numRoot, denRoot }} />
}
