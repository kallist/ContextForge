export type ContextForgeErrorCode =
  | "USAGE"
  | "PATH"
  | "ACCESS"
  | "UNSAFE_ROOT"
  | "SCAN_LIMIT"
  | "PARSER_UNAVAILABLE"
  | "INDEX"
  | "INDEX_BUSY"
  | "INDEX_NOT_FOUND"
  | "INDEX_REQUIRED"
  | "INVALID_TASK"
  | "TASK_TOO_LARGE"
  | "SEARCH_FAILED"
  | "INVALID_BUDGET"
  | "BUDGET_TOO_SMALL"
  | "PACK_FAILED"
  | "OUTPUT_EXISTS"
  | "OUTPUT_WRITE_FAILED";

const EXIT_CODES: Record<ContextForgeErrorCode, number> = {
  USAGE: 2,
  PATH: 2,
  ACCESS: 3,
  UNSAFE_ROOT: 3,
  SCAN_LIMIT: 4,
  PARSER_UNAVAILABLE: 5,
  INDEX: 6,
  INDEX_BUSY: 7,
  INDEX_NOT_FOUND: 8,
  INDEX_REQUIRED: 8,
  INVALID_TASK: 2,
  TASK_TOO_LARGE: 2,
  SEARCH_FAILED: 9,
  INVALID_BUDGET: 2,
  BUDGET_TOO_SMALL: 10,
  PACK_FAILED: 11,
  OUTPUT_EXISTS: 12,
  OUTPUT_WRITE_FAILED: 13,
};

export class ContextForgeError extends Error {
  readonly code: ContextForgeErrorCode;
  readonly exitCode: number;

  constructor(code: ContextForgeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ContextForgeError";
    this.code = code;
    this.exitCode = EXIT_CODES[code];
  }
}
