import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

/** Contains a render error to its subtree and offers a retry. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      this.props.fallback ?? (
        <div role="alert" className="rounded-md border border-neg/30 bg-neg/5 px-4 py-6 text-center">
          <p className="text-sm font-medium text-neg-text">This panel failed to render</p>
          <p className="mt-1 text-xs text-muted">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded-md border border-border-strong bg-surface px-3 py-1 text-xs text-foreground hover:bg-surface-2"
          >
            Try again
          </button>
        </div>
      )
    )
  }
}
