import React from 'react'

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 text-red-400 font-mono text-sm bg-zinc-950 min-h-screen">
          <p className="font-bold mb-2 text-red-300">Renderer error</p>
          <pre className="whitespace-pre-wrap text-red-400/80">{this.state.error.message}</pre>
          <pre className="mt-2 whitespace-pre-wrap text-zinc-600 text-xs">{this.state.error.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}
