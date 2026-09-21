import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Findor UI error caught by ErrorBoundary:", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <section className="card" style={{ margin: "2rem auto", maxWidth: "600px" }} role="alert">
          <div className="card-heading">
            <p className="eyebrow" style={{ color: "var(--orange)" }}>Workspace Notice</p>
            <h2>{this.props.fallbackTitle ?? "Findor couldn’t load this workspace."}</h2>
          </div>
          <p className="muted" style={{ margin: "1rem 0" }}>
            An unexpected error occurred while displaying this request view. Your request data,
            operating mandate, and message history remain safely preserved in the database.
          </p>
          <div className="control-actions" style={{ marginTop: "1.5rem" }}>
            <button
              className="primary-button compact-button"
              type="button"
              onClick={this.handleRetry}
            >
              Retry
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                window.location.reload();
              }}
            >
              Reload page
            </button>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
