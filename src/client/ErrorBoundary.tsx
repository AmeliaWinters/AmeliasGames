import { Component, type ErrorInfo, type ReactNode } from "react";
import { lobbyUrl } from "./route.js";

/**
 * The last thing between a render error and a white page.
 *
 * Everything else that can go wrong here is already handled where it happens:
 * a refused join is a toast, a dead socket is `needsWholeScreen`, a seat taken
 * elsewhere is the superseded screen. All of those are *values* the app knows
 * how to be in. A thrown render is not. React unmounts the whole tree on an
 * uncaught one, which on this app means the board, the topbar and the way back
 * all disappear at once, mid-game, with the other player still sat in the room
 * waiting for a move that is never coming.
 *
 * The room survives it. State is the server's and rejoining is what opening
 * the URL does, so the recovery here is genuinely cheap: re-render, and the
 * socket picks the game back up where it was.
 *
 * Two ways out rather than one, because they fail in opposite directions. A
 * transient throw wants "try again" and reloading would be a needless
 * roundtrip. A board that throws on the state it has been sent will throw
 * again on exactly the same state, and there "try again" is a loop with a
 * button on it -- which is why it stops being offered after the second one and
 * the lobby is what is left. Guessing which kind it is from the error is not
 * possible, so the retry itself is the question and the count is the answer.
 */

/** After this many, the throw is clearly not transient and retrying is a loop. */
const RETRY_LIMIT = 2;

type Props = { children: ReactNode };
type State = { failed: boolean; retries: number };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, retries: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // There is no error reporting in this project and adding one is not this
    // change. The console is what somebody debugging on their own phone
    // actually has, and the component stack is the half a stack trace omits.
    console.error("Board crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    const canRetry = this.state.retries < RETRY_LIMIT;
    return (
      <main className="app setup">
        <h1 className="wordmark">That went sideways</h1>
        <p className="tagline">
          {canRetry
            ? "Something broke while drawing this. Your game is safe on the server, so picking it back up should just work."
            : "It broke again in the same place, so trying once more will not help. The room is still there when you want it."}
        </p>
        {canRetry ? (
          <button
            className="primary"
            onClick={() => this.setState((s) => ({ failed: false, retries: s.retries + 1 }))}
          >
            Try again
          </button>
        ) : (
          <button className="primary" onClick={() => location.assign(lobbyUrl())}>
            Back to the games
          </button>
        )}
      </main>
    );
  }
}
