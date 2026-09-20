import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const observerPath = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "scripts",
  "release-hardening-process-observer.mjs",
);

interface ProcessObservation {
  rssBytes: number | null;
  handles: number | null;
  attempted: boolean;
  unavailableReason: string | null;
}

type ObserveWindowsProcess = (options: {
  pid: number;
  cwd: string;
  timeoutMs?: number;
  runCommand: (
    command: string,
    args: string[],
    cwd: string,
    options: { timeout: number },
  ) => { status: number | null; stdout: string };
}) => ProcessObservation;

type SummarizeProcessObservations = (observations: ProcessObservation[]) => {
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  samplesRequested: number;
  samplesAttempted: number;
  rssSamplesAvailable: number;
  handleSamplesAvailable: number;
  unavailableReason: string | null;
};

test("Windows process observation reports timeout and command failures as unavailable diagnostics", async () => {
  const { observeWindowsProcess, summarizeProcessObservations } = await import(pathToFileURL(observerPath).href) as {
    observeWindowsProcess: ObserveWindowsProcess;
    summarizeProcessObservations: SummarizeProcessObservations;
  };
  const timeout = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });

  const timedOut = observeWindowsProcess({
    pid: 123,
    cwd: process.cwd(),
    timeoutMs: 1,
    runCommand: (_command, _args, _cwd, options) => {
      assert.equal(options.timeout, 1);
      throw timeout;
    },
  });
  assert.deepEqual(timedOut, {
    rssBytes: null,
    handles: null,
    attempted: true,
    unavailableReason: "POWERSHELL_TIMEOUT",
  });

  const failed = observeWindowsProcess({
    pid: 123,
    cwd: process.cwd(),
    runCommand: () => ({ status: 1, stdout: "" }),
  });
  assert.deepEqual(failed, {
    rssBytes: null,
    handles: null,
    attempted: true,
    unavailableReason: "POWERSHELL_NONZERO_EXIT",
  });

  assert.deepEqual(summarizeProcessObservations([
    timedOut,
    { rssBytes: null, handles: null, attempted: false, unavailableReason: "POWERSHELL_TIMEOUT" },
  ]), {
    status: "UNAVAILABLE",
    samplesRequested: 2,
    samplesAttempted: 1,
    rssSamplesAvailable: 0,
    handleSamplesAvailable: 0,
    unavailableReason: "POWERSHELL_TIMEOUT",
  });
});
