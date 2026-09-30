import { PageHeader, Panel, EmptyState } from '../ui'

/** Temporary page body for sections still being built. */
export function Placeholder({ eyebrow, title, description }: { eyebrow?: string; title: string; description: string }) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <Panel>
        <EmptyState title="This section is being built">
          It will appear here once its workstream lands. Nothing on this page is live yet.
        </EmptyState>
      </Panel>
    </>
  )
}
