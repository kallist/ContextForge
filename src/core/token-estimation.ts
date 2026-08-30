export const GENERIC_TOKEN_ESTIMATOR_ID = "contextforge-generic-v1";
export const GENERIC_TOKEN_ESTIMATOR_VERSION = "1.0";

export interface TokenEstimator {
  readonly id: string;
  readonly version: string;
  estimate(serializedText: string): number;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

/**
 * A deterministic, local, deliberately conservative estimator for serialized
 * code and multilingual text. It is not a model-specific tokenizer.
 */
export class GenericTokenEstimator implements TokenEstimator {
  readonly id = GENERIC_TOKEN_ESTIMATOR_ID;
  readonly version = GENERIC_TOKEN_ESTIMATOR_VERSION;

  estimate(serializedText: string): number {
    if (serializedText.length === 0) return 0;
    const normalized = normalizeNewlines(serializedText);
    let asciiBytes = 0;
    let nonAsciiBytes = 0;
    let lineBreaks = 0;
    for (const character of normalized) {
      if (character === "\n") {
        lineBreaks += 1;
      } else if ((character.codePointAt(0) ?? 0) <= 0x7f) {
        asciiBytes += 1;
      } else {
        nonAsciiBytes += Buffer.byteLength(character, "utf8");
      }
    }
    return Math.ceil(asciiBytes / 3) + Math.ceil(nonAsciiBytes / 2) + lineBreaks + 1;
  }
}
