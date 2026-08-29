export type ContextForgeErrorCode = "USAGE" | "PATH" | "ACCESS" | "UNSAFE_ROOT" | "SCAN_LIMIT";

const EXIT_CODES: Record<ContextForgeErrorCode, number> = {
  USAGE: 2,
  PATH: 2,
  ACCESS: 3,
  UNSAFE_ROOT: 3,
  SCAN_LIMIT: 4,
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
