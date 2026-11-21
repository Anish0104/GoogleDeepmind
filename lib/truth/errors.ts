// OWNER: Dev 2. Typed failures for the truth pipeline, so callers can tell bad input, missing
// integration and bad model output apart. None of these ever carries a label or a score.

class TruthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** splitClaims(): invalid input, failed model call, or a response that does not match the schema. */
export class ClaimExtractionError extends TruthError {}

/** splitClaims(): the model answered, but its output was not valid JSON or did not match the schema. */
export class ClaimOutputError extends ClaimExtractionError {}

/** audit(): the citation itself is invalid (camera, window, provenance). Nothing was sent to a model. */
export class AuditInputError extends TruthError {}

/** audit(): the cited media could not be reached (checkWindow/decide failed or no media supplied). */
export class AuditUnavailableError extends TruthError {}

/** audit(): the media service answered with something we cannot trust (malformed, wrong window). */
export class AuditResponseError extends TruthError {}

/** judge(): every attempt failed at the model client, or the inputs are unusable. */
export class JudgeError extends TruthError {}
