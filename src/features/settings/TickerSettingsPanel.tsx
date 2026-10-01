import { UNIVERSE } from '@shared/universe'
import { Panel } from '../../ui'
import { TickerChooser } from '../../app/TickerStrip'
import { defaultTickerKeys, tickerItems, useTickerConfig } from '../../app/tickerConfig'
import { useSettings } from '../../store/settings-context'

/** Settings → which quotes the top bar shows. Same store as the strip's own popover (this browser only). */
export function TickerSettingsPanel() {
  const { asset } = useSettings()
  const [cfg, setCfg] = useTickerConfig()
  const defaults = tickerItems(defaultTickerKeys(asset))
    .map((i) => i.label)
    .join(', ')
  return (
    <Panel title="Top-bar tickers" eyebrow="This browser">
      <p className="mb-4 text-sm leading-relaxed text-muted">
        By default the top bar shows the asset in focus ({UNIVERSE[asset].label}), gold, bitcoin and one ratio, now <span className="num">{defaults}</span>; the rest
        open from the <span className="num">+N</span> button. Ticking items here makes a custom list that is shown in full.
      </p>
      <TickerChooser cfg={cfg} focus={asset} onChange={setCfg} />
    </Panel>
  )
}
