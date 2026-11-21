// OWNER: Dev 3. Per-run session state for the Gemini Managed Agent (Interactions API).
// One session per agent run (one claim, one role). Never reuse a session or its environment across claims:
// startAgent() creates a fresh one for every run.

/** A function call the agent made that we still owe a function_result for. */
export interface PendingCall {
  id: string;
  name: string;
}

export interface AgentSession {
  /** id of the latest interaction; sent as previous_interaction_id on the next turn. */
  interactionId?: string;
  /** environment_id from the first response; sent as environment on every later turn. */
  environmentId?: string;
  /** The call handed to the loop this turn; its result goes back on the next turn. */
  pending?: PendingCall;
  /** Extra calls from the same turn; they go back as is_error results so the session isn't left hanging. */
  extra?: PendingCall[];
}

/** A fresh, empty session for one agent run. */
export function newSession(): AgentSession {
  return {};
}
