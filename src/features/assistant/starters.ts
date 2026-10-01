import { UNIVERSE, type AssetId } from '@shared/universe'
import { NAV } from '../../app/nav'
import type { PageContextValue } from './context'

// Route-derived defaults: the page name from the navigation, a generic
// context when a page registers none, and starter questions per page type.

/** Navigation label of the section a route belongs to ("Quant Lab"). PURE. */
export function sectionLabel(pathname: string): string {
  const items = NAV.flatMap((g) => g.items)
  const hit = items.filter((i) => (i.end ? pathname === i.to : pathname === i.to || pathname.startsWith(`${i.to}/`))).sort((a, b) => b.to.length - a.to.length)[0]
  return hit?.label ?? 'Real Assets Dashboard'
}

/** Context from the route alone: section, sub-page, asset in focus and URL parameters. PURE. */
export function fallbackContext(pathname: string, search: string, asset: AssetId): PageContextValue {
  const section = sectionLabel(pathname)
  const sub = pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent).join(' / ')
  const params = [...new URLSearchParams(search).entries()].map(([k, v]) => `${k}=${v}`).join(', ')
  return {
    label: sub ? `${section} · ${sub}` : section,
    summary: [`Section: ${section}${sub ? ` (${sub})` : ''}`, `Asset in focus: ${UNIVERSE[asset].label}`, params ? `URL parameters: ${params}` : ''].filter(Boolean).join('\n'),
  }
}

/** 3–4 starter questions for the page type. PURE. */
export function startersFor(pathname: string): string[] {
  const inst = pathname.match(/^\/quant\/i\/([^/]+)/)
  if (inst) {
    const id = decodeURIComponent(inst[1])
    if (id.includes('.fly.'))
      return ['What does OU fail mean here?', 'How would I trade this butterfly?', 'What do the letters and numbers in these contract names mean?', 'Why is the verdict what it is in this mode?']
    if (id.includes('.cal.')) return ['Is the carry gate blocking this calendar?', 'How would I trade this calendar spread?', 'What do the contract codes in the legs mean?', 'Why is the verdict what it is in this mode?']
    if (id.includes('.seas.')) return ['Is this seasonal window validated out-of-sample?', 'When would I enter and exit this trade?', 'What do the month letters in the name mean?']
    if (id.endsWith('.basis')) return ['How does this cash-and-carry trade make money?', 'Is the excess carry rich or cheap right now?', 'What are the risks of this basis trade?']
    if (id.includes('.ratio') || id.includes('.spread')) return ['How would I size this pair dollar-neutral?', 'Why is the half-life flagged?', 'What is the verdict and why?']
    return ['Explain the verdict on this instrument.', 'What does the OU half-life tell me here?', 'How is the QT rank built for this one?']
  }
  if (pathname === '/quant' || pathname === '/quant/') return ['Which of these is the most actionable, and why?', 'How is the QT rank calculated?', 'What is the difference between conservative and aggressive?', 'What does OU fail mean?']
  if (pathname.startsWith('/quant/relative-value')) return ['How would I size this ratio trade dollar-neutral?', 'Why is the ratio’s half-life flagged?', 'What drives this ratio?']
  if (pathname.startsWith('/quant/seasonality')) return ['How do I read this seasonal envelope?', 'What does the walk-forward test require to pass?', 'What do the month letters mean?']
  if (pathname.startsWith('/quant')) return ['How does a butterfly differ from a calendar spread?', 'What is the structural-move gate?', 'How are spreads executed on CME?']
  if (pathname.startsWith('/markets/curve')) return ['Is the curve in contango or backwardation, and what does it imply?', 'What does Z26 mean in these contract names?', 'Why compare term carry with the T-bill?']
  if (pathname.startsWith('/markets/etfs')) return ['Which ETF trades at a premium or discount?', 'How is the premium calculated for closed-end trusts?', 'What does tracking difference include?']
  if (pathname.startsWith('/markets')) return ['What stands out on this page?', 'How do the futures month codes work?', 'How do ETF premiums work?']
  if (pathname.startsWith('/portfolio/performance')) return ['How has the fund performed vs the benchmark?', 'What is the difference between TWR and IRR?', 'How should I read VaR and CVaR here?']
  if (pathname.startsWith('/portfolio')) return ['Summarise my holdings and exposure.', 'How is NAV per unit computed?', 'What does the physical haircut do?']
  if (pathname.startsWith('/macro')) return ['Which drivers are tailwinds right now?', 'How should I read managed-money positioning?', 'What would change this regime?']
  if (pathname.startsWith('/intelligence')) return ['Is the ML signal validated, and what does that mean?', 'What do AUC and the permutation p-value mean?', 'Why is the probability shown muted?']
  if (pathname.startsWith('/settings')) return ['What does each API key enable?', 'How does the assistant budget work?', 'What is the admin PIN for?']
  return ['What can I do on this page?', 'How does the Quant Lab decide BUY or SELL?', 'What do futures month codes like Z26 mean?']
}
