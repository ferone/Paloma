import { familywiseFalsePassRate, ML_ALPHA_ADJUSTED, ML_GATE, ML_TEST_COUNT, type MlFold, type MlGate, type MlRunDetail } from '@shared/ml'
import { fmtNum, fmtPct } from '../../../design/format'
import { PALETTE } from '../../../design/tokens'
import { Chip, DataTable, Explainer, HelpTip, Panel, Stat, type Column } from '../../../ui'
import { AucByYear, PermutationHistogram } from '../components/charts'
import { ValidationChip } from '../components/common'
import { runProvenance } from '../components/provenance'
import { RunScope } from '../components/RunScope'

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const countWord = (n: number) => WORDS[n] ?? String(n)
/** p-values and thresholds below 0.01 get five decimals (0.00832 vs 0.00833), otherwise three. */
const fmtP = (v: number | null | undefined) => (v != null && v < 0.01 ? fmtNum(v, 5) : fmtNum(v, 3))

/** The permutation threshold a run was gated with (runs before the correction used the raw 0.05). */
function gateAlpha(gate: MlGate): number {
  return gate.multipleTesting?.alphaAdjusted ?? ML_GATE.pValue
}

function MultipleTestingNote({ gate, p }: { gate: MlGate; p: number | null }) {
  const mt = gate.multipleTesting
  if (!mt) {
    return (
      <p className="mt-3 text-2xs text-muted">
        This run predates the multiple-testing correction and was gated at p &lt; {fmtNum(ML_GATE.pValue, 2)}. Retrain to apply the
        corrected threshold ({fmtP(ML_ALPHA_ADJUSTED)}).
      </p>
    )
  }
  if (mt.tests <= 1) return null
  const nominalOnly = p != null && p < mt.alpha && p >= mt.alphaAdjusted
  return (
    <div className="mt-3 space-y-2 text-2xs text-muted">
      <p>
        The p-value threshold is Bonferroni-corrected: {fmtNum(mt.alpha, 2)} / {mt.tests} markets ={' '}
        <span className="num text-foreground">{fmtP(mt.alphaAdjusted)}</span>.
      </p>
      {nominalOnly && (
        <p className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-xs text-foreground">
          Nominally significant (p = <span className="num">{fmtP(p)}</span> &lt; {fmtNum(mt.alpha, 2)}), but not after correcting for
          testing {countWord(mt.tests)} markets, so this model is <strong>not validated</strong>. A result this strong turns up by luck
          in one of {countWord(mt.tests)} markets far too often to act on.
        </p>
      )}
    </div>
  )
}

function GatePanel({ run, gate }: { run: MlRunDetail; gate: MlGate }) {
  const fmt = (id: string, v: number | null) =>
    v == null ? '—' : id === 'hit' ? fmtPct(v, 1) : id === 'folds' ? String(v) : id === 'pValue' ? fmtP(v) : fmtNum(v, 3)
  const rows = gate.checks
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'label', header: 'Check', cell: (c) => c.label },
    {
      key: 'value', header: 'Value', numeric: true,
      cell: (c) => (c.id === 'baseline' ? `${fmt('auc', run.metrics!.summary.auc)} vs ${fmt('auc', c.value)}` : fmt(c.id, c.value)),
    },
    {
      key: 'threshold', header: 'Needs', numeric: true,
      cell: (c) =>
        c.id === 'baseline' ? '> baseline' : c.id === 'pValue' ? `< ${fmt('pValue', c.threshold)}` : `≥ ${fmt(c.id, c.threshold)}`,
    },
    { key: 'ok', header: 'Result', cell: (c) => <Chip tone={c.ok ? 'strong' : 'avoid'}>{c.ok ? 'Pass' : 'Fail'}</Chip> },
  ]
  return (
    <Panel
      eyebrow="Out-of-sample gate"
      title={<span className="inline-flex items-center gap-2">Validation status <ValidationChip status={gate.status} /></span>}
      provenance={{ source: runProvenance(run) }}
    >
      {gate.reasons.length > 0 && (
        <p className="mb-3 text-xs text-muted">
          {gate.status === 'failed' ? 'Failed because ' : 'Untested: '}
          <span className="num text-foreground">{gate.reasons.join('; ')}</span>.
        </p>
      )}
      <DataTable dense columns={columns} rows={rows} rowKey={(c) => c.id} />
      <MultipleTestingNote gate={gate} p={run.metrics!.permutation?.pValue ?? null} />
    </Panel>
  )
}

export default function ValidationPage() {
  return (
    <RunScope>
      {(run) => {
        const m = run.metrics!
        const s = m.summary
        const perm = m.permutation
        const alpha = gateAlpha(m.gate)
        const foldCols: Column<MlFold>[] = [
          { key: 'y', header: 'Test year', cell: (f) => <span className="num">{f.testYear}</span>, sortValue: (f) => f.testYear },
          { key: 'n', header: 'Train / test', numeric: true, cell: (f) => `${f.nTrain.toLocaleString('en-US')} / ${f.nTest}` },
          { key: 'auc', header: 'AUC', numeric: true, sortValue: (f) => f.auc, cell: (f) => <span className={f.auc != null && f.auc >= 0.55 ? 'text-pos-text' : f.auc != null && f.auc < 0.5 ? 'text-neg-text' : ''}>{fmtNum(f.auc, 3)}</span> },
          { key: 'bauc', header: 'Baseline AUC', numeric: true, sortValue: (f) => f.baselineAuc, cell: (f) => fmtNum(f.baselineAuc, 3) },
          { key: 'hit', header: 'Hit', numeric: true, sortValue: (f) => f.hit, cell: (f) => fmtPct(f.hit, 1) },
          { key: 'base', header: 'Up share', numeric: true, cell: (f) => fmtPct(f.baseRate, 1) },
          { key: 'brier', header: 'Brier', numeric: true, cell: (f) => fmtNum(f.brier, 3) },
          { key: 'ic', header: 'Move IC', numeric: true, cell: (f) => fmtNum(f.ic, 2) },
        ]
        return (
          <div className="space-y-6">
            <GatePanel run={run} gate={m.gate} />

            <Panel title="Walk-forward summary" density="dense">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
                <Stat size="sm" label="Mean AUC" value={fmtNum(s.auc, 3)} />
                <Stat size="sm" label="Pooled AUC" value={fmtNum(s.pooledAuc, 3)} hint="all test years together" />
                <Stat size="sm" label="Baseline AUC" value={fmtNum(s.baselineAuc, 3)} hint="logistic regression" />
                <Stat size="sm" label="Hit rate" value={fmtPct(s.hit, 1)} />
                <Stat size="sm" label="Always-up hit" value={fmtPct(s.baseRate, 1)} hint="share of up 20d windows" />
                <Stat size="sm" label="Brier" value={fmtNum(s.brier, 3)} hint="lower is better; 0.25 = coin flip" />
                <Stat size="sm" label="Test years" value={String(s.folds)} />
              </div>
              <p className="mt-3 text-2xs text-muted">
                {m.nRows.toLocaleString('en-US')} labeled days from {m.dataFrom} to {m.labelThrough}. Each fold trains on every earlier
                year (at least five) and drops the last 20 training days, whose forward labels would overlap the test year.
              </p>
            </Panel>

            <Panel title="AUC by test year" provenance={{ source: runProvenance(run) }}>
              <AucByYear folds={m.folds} />
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
                <span><span className="mr-1 inline-block h-2 w-3 rounded-sm align-middle" style={{ background: PALETTE.pos }} />≥ 0.55</span>
                <span><span className="mr-1 inline-block h-2 w-3 rounded-sm align-middle" style={{ background: PALETTE.faint }} />0.50–0.55</span>
                <span><span className="mr-1 inline-block h-2 w-3 rounded-sm align-middle" style={{ background: PALETTE.neg }} />&lt; 0.50 (worse than chance)</span>
                <span><span className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: PALETTE.foreground }} />logistic baseline</span>
              </p>
              <div className="mt-4">
                <DataTable dense columns={foldCols} rows={m.folds} rowKey={(f) => String(f.testYear)} initialSort={{ key: 'y', dir: 'desc' }} />
              </div>
            </Panel>

            <Panel title="Permutation test" eyebrow={perm ? `Holdout ${perm.holdoutYear}` : undefined}>
              {perm ? (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
                    <Stat size="sm" label="Real AUC" value={fmtNum(perm.realAuc, 3)} />
                    <Stat size="sm" label="Null mean" value={fmtNum(perm.nullMean, 3)} />
                    <Stat size="sm" label="Null 95th pct" value={fmtNum(perm.null95, 3)} />
                    <Stat size="sm" label="Raw p-value" value={fmtP(perm.pValue)} hint={perm.pValue < alpha ? 'significant after correction' : 'not significant after correction'} />
                    <Stat size="sm" label="Threshold" value={fmtP(alpha)} hint={m.gate.multipleTesting ? `0.05 / ${m.gate.multipleTesting.tests} markets` : 'uncorrected (older run)'} />
                  </div>
                  <PermutationHistogram nullAucs={perm.nullAucs} realAuc={perm.realAuc} null95={perm.null95} />
                  <p className="mt-2 text-2xs text-muted">
                    {perm.nPerm} refits on shuffled labels · {perm.method}. Uses a lighter model for both real and shuffled fits. The
                    smallest p this test can report is 1 / ({perm.nPerm} + 1) = {fmtP(1 / (perm.nPerm + 1))}.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">The permutation test could not run (too little data in the latest test year).</p>
              )}
            </Panel>

            <Explainer title="How to read AUC, hit rate and the permutation test">
              <p>
                <HelpTip term="AUC">Area under the ROC curve.</HelpTip> is the chance that the model ranks a randomly chosen up-window above a
                randomly chosen down-window. 0.50 is a coin flip; below 0.50 means it ranked them the wrong way round in that year.
              </p>
              <p>
                Hit rate is the share of days where "P(up) above 50%" matched the outcome. Compare it with the always-up share: in a strong
                bull year, saying "up" every day scores high without any skill.
              </p>
              <p>
                The permutation test refits the model on training labels shuffled in 20-day blocks, which destroys any real relationship
                but keeps the overlap between neighbouring labels. If the real model does not clearly beat these shuffled models, its score
                in the holdout year could be luck. One year of 20-day labels holds only about a dozen independent outcomes, so this test is
                strict by design.
              </p>
              <p>
                <HelpTip term="Why the threshold is not 0.05">Bonferroni correction for multiple testing.</HelpTip> We test{' '}
                {countWord(ML_TEST_COUNT)} markets, so a 1-in-20 fluke would be expected to pass about{' '}
                {fmtPct(familywiseFalsePassRate(ML_TEST_COUNT), 0)} of the time across them, even if none of the models had any skill. To
                keep that chance near 5%, each model must reach p &lt; 0.05 / {ML_TEST_COUNT} = {fmtP(ML_ALPHA_ADJUSTED)}. A model with p
                between that and 0.05 is reported as failed. The raw p is still shown so you can see how close it came.
              </p>
            </Explainer>
          </div>
        )
      }}
    </RunScope>
  )
}
