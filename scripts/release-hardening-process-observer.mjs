function unavailable(reason) {
  return {
    rssBytes: null,
    handles: null,
    attempted: true,
    unavailableReason: reason,
  };
}

export function observeWindowsProcess({ pid, runCommand, cwd, timeoutMs = 10_000 }) {
  const script = `$p=Get-Process -Id ${pid} -ErrorAction Stop; [pscustomobject]@{rss=$p.WorkingSet64;handles=$p.HandleCount}|ConvertTo-Json -Compress`;
  let result;
  try {
    result = runCommand("powershell.exe", ["-NoProfile", "-Command", script], cwd, { timeout: timeoutMs });
  } catch (error) {
    return unavailable(error instanceof Error && "code" in error && error.code === "ETIMEDOUT"
      ? "POWERSHELL_TIMEOUT"
      : "POWERSHELL_ERROR");
  }

  if (result.status !== 0) return unavailable("POWERSHELL_NONZERO_EXIT");

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return unavailable("POWERSHELL_INVALID_OUTPUT");
  }

  const rssBytes = Number.isSafeInteger(parsed?.rss) && parsed.rss >= 0 ? parsed.rss : null;
  const handles = Number.isSafeInteger(parsed?.handles) && parsed.handles >= 0 ? parsed.handles : null;
  if (rssBytes === null || handles === null) return unavailable("POWERSHELL_INVALID_METRICS");

  return { rssBytes, handles, attempted: true, unavailableReason: null };
}

export function summarizeProcessObservations(observations) {
  const samplesAttempted = observations.filter((observation) => observation.attempted).length;
  const rssSamplesAvailable = observations.filter((observation) => observation.rssBytes !== null).length;
  const handleSamplesAvailable = observations.filter((observation) => observation.handles !== null).length;
  const status = rssSamplesAvailable === observations.length && handleSamplesAvailable === observations.length
    ? "AVAILABLE"
    : rssSamplesAvailable === 0 && handleSamplesAvailable === 0
      ? "UNAVAILABLE"
      : "PARTIAL";
  return {
    status,
    samplesRequested: observations.length,
    samplesAttempted,
    rssSamplesAvailable,
    handleSamplesAvailable,
    unavailableReason: observations.find((observation) => observation.unavailableReason !== null)?.unavailableReason ?? null,
  };
}
