"use strict";
const $ = (id) => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem("contextforge-capability") || "";
if (location.hash) { sessionStorage.setItem("contextforge-capability", token); history.replaceState(null, "", "/"); }
let opened = null, entries = [], controls = [], offset = 0;
const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = String(text); if (className) e.className = className; return e; };
const showStatus = (text) => { $("status").textContent = text; };
async function api(request) {
  const response = await fetch("/api", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(request) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${data.code}: ${data.message || "Open the private local Studio URL printed by the CLI."}`);
  return data;
}
async function work(label, operation) {
  const buttons = [...document.querySelectorAll("button")]; buttons.forEach((b) => { b.disabled = true; });
  showStatus(label);
  try { await operation(); }
  catch (error) { showStatus(error.message); }
  finally { buttons.forEach((b) => { b.disabled = false; }); }
}
function tab(name) {
  document.querySelectorAll("[data-panel]").forEach((e) => { e.hidden = e.dataset.panel !== name; });
  document.querySelectorAll("[data-tab]").forEach((e) => { e.classList.toggle("active", e.dataset.tab === name); });
}
document.querySelectorAll("[data-tab]").forEach((e) => e.addEventListener("click", () => tab(e.dataset.tab)));
async function refreshHistory(more = false) {
  if (!more) { entries = []; offset = 0; }
  const data = await api({ action: "history", offset }); entries.push(...data.entries); offset += data.entries.length;
  $("history").replaceChildren(); $("compare").replaceChildren();
  for (const entry of entries) {
    const button = node("button", undefined, "history-entry"); button.dataset.id = entry.id;
    button.classList.toggle("selected", opened?.capsule.capsuleHash === entry.id);
    button.append(node("span", entry.task?.startsWith("Review tracked changes ") ? "Review Context · tracked changes" : entry.task || "Redacted task"), node("small", `${entry.id.slice(0, 10)} · ${entry.tokens.toLocaleString()} / ${entry.budget.toLocaleString()} tokens`));
    button.addEventListener("click", () => work("Opening recorded Capsule…", async () => { display(await api({ action: "open", id: entry.id })); showStatus("Saved metadata opened. Verify replay to recover context from current sources."); }));
    $("history").append(button);
    if (entry.id !== opened?.capsule.capsuleHash) { const option = node("option", `${entry.id.slice(0, 10)} · ${entry.task || "Task"}`); option.value = entry.id; $("compare").append(option); }
  }
  $("more").hidden = data.entries.length < 30;
  $("storage").textContent = `${data.stats.count} saved · ${(data.stats.storedBytes / 1024).toFixed(1)} KiB compressed metadata`;
}
function fact(parent, label, value) { const e = node("div", undefined, "fact"); e.append(node("small", label), node("p", value)); parent.append(e); }
function display(data) {
  opened = data; controls = structuredClone(data.capsule.deterministic.overrides[0]?.controls || []); renderControls();
  const c = data.capsule.deterministic;
  $("workspace").hidden = false; $("identity").textContent = data.capsule.capsuleHash.slice(0, 12);
  $("usage").textContent = `${c.budget.estimatedTokens.toLocaleString()} / ${c.budget.requested.toLocaleString()}`;
  $("budget-bar").value = 100 * c.budget.utilization;
  $("counts").textContent = `${c.selected.length} selected · ${c.dropped.length} dropped`;
  $("generation").textContent = `gen ${c.repository.activeGeneration} · ${c.repository.gitCommit?.slice(0, 8) || "no Git"}`;
  $("provenance").textContent = JSON.stringify({ task: c.task, repository: c.repository, strategies: c.strategies, overrides: c.overrides, payloadHash: c.payloadHash, capsuleHash: data.capsule.capsuleHash }, null, 2);
  $("whatif-budget").value = c.budget.requested;
  $("payload").textContent = data.payload || "Exact context is not stored in history. Verify replay to reconstruct it from matching current sources. Path-bearing payloads remain available only through the explicit CLI output boundary.";
  $("payload-note").textContent = data.payload ? `Exact ephemeral payload · SHA-256 ${c.payloadHash}` : data.payloadStatus;
  $("copy").disabled = !data.payload;
  $("explain").replaceChildren(); $("replay-result").replaceChildren();
  renderCandidates(); renderCoverage(data.coverage); renderReview();
  if (data.diff) { renderDiff(data.diff); tab("changes"); } else { $("changes").replaceChildren(node("p", "Choose a prior Capsule to compare, or try human controls.")); tab(c.review ? "review" : "proposal"); }
}
function renderCandidates() {
  if (!opened) return;
  const c = opened.capsule.deterministic; $("candidates").replaceChildren();
  const files = new Map(c.files.map((f) => [f.id, f]));
  for (const candidate of c.candidates) {
    if ($("filter").value !== "ALL" && candidate.disposition !== $("filter").value) continue;
    const file = files.get(candidate.fileRef), selection = c.selected.find((s) => s.candidateRef === candidate.id);
    const tr = node("tr"); tr.dataset.candidate = candidate.id;
    const fileCell = node("td"), button = node("button", `${candidate.rank || "—"}  ${file.path}`);
    button.addEventListener("click", () => work("Reading captured explanation…", async () => {
      const result = await api({ action: "explain", id: opened.capsule.capsuleHash, query: { type: `WHY_${candidate.disposition}`, subject: candidate.id } });
      const target = $("explain"); target.replaceChildren(node("h3", file.path));
      fact(target, "RECORDED DECISION", result.facts.decisions.map((d) => `${d.reason} (${d.decisionSource})`).join(" · "));
      if (result.facts.selection) fact(target, "CONTEXT ROLE", result.facts.selection.role);
      if (result.facts.ranges?.length) fact(target, "RANGES", result.facts.ranges.map((r) => `L${r.startLine}–${r.endLine}`).join(", "));
      if (result.facts.symbols?.length) fact(target, "SYMBOLS", result.facts.symbols.map((s) => s.qualifiedName).join(", "));
      for (const e of (result.facts.evidence || []).slice(0, 40)) fact(target, `${e.stage} · ${e.derivation}`, `${e.code} · ${e.family}${e.querySignal ? ` · ${e.querySignal}` : ""}`);
      for (const r of (result.facts.review?.impact || []).filter((r) => r.from === file.path || r.to === file.path).slice(0, 20)) fact(target, `${r.type} · ${r.classification}`, `${r.from} → ${r.to}`);
      if ((result.facts.evidence?.length || 0) > 40) fact(target, "BOUNDED DISPLAY", "First 40 evidence records shown. Export Capsule for full captured details.");
      showStatus(`Explain: ${result.status}. These are compiler facts, not a model's reasoning.`);
    }));
    fileCell.append(button); const state = node("td"); state.append(node("span", candidate.disposition, `tag ${candidate.disposition}`));
    const controlCell = node("td"), select = node("select"); select.setAttribute("aria-label", `Control ${file.path}`);
    for (const optionName of ["—", "PIN", "EXCLUDE", "PREFER", "FOCUS", "RANGE"]) { const option = node("option", optionName); option.value = optionName; select.append(option); }
    select.value = controls.find((control) => control.path === file.path)?.kind || "—";
    select.addEventListener("change", () => {
      controls = controls.filter((control) => control.path !== file.path);
      const kind = select.value;
      if (kind !== "—") {
        let control = { kind, path: file.path };
        if (kind === "FOCUS") control.path = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : file.path;
        if (kind === "RANGE") {
          const text = window.prompt("Inclusive verified line range, for example 2-8", "1-3");
          if (!/^\d+-\d+$/.test(text || "")) { select.value = "—"; renderControls(); return; }
          const [startLine, endLine] = text.split("-").map(Number); control = { ...control, startLine, endLine };
        }
        controls = controls.filter((existing) => !(existing.path === control.path && existing.kind === control.kind)); controls.push(control);
      }
      renderControls();
    });
    controlCell.append(select); tr.append(fileCell, state, node("td", selection?.estimatedTokens || "—"), controlCell); $("candidates").append(tr);
  }
}
function renderControls() { $("pending").replaceChildren(...controls.map((c) => node("span", `${c.kind} ${c.path}${c.kind === "RANGE" ? ` L${c.startLine}–${c.endLine}` : ""}`, "chip"))); }
function renderCoverage(coverage) {
  const target = $("coverage"); target.replaceChildren();
  fact(target, "BOUNDED CANDIDATES", `${coverage.candidates.selected} selected of ${coverage.candidates.available} captured; ${coverage.candidates.excluded} safety exclusions.`);
  fact(target, "RECORDED EVIDENCE", `${coverage.evidence.referencedBySelection} of ${coverage.evidence.captured} evidence records referenced by selection.`);
  fact(target, "PLAN ROLES", coverage.planner === "NOT_RUN" ? "V1 does not run the experimental planner. Role availability is not inferred." : coverage.roles.map((r) => `${r.role}: ${r.selected} selected / ${r.available} available`).join(" · "));
  const lints = $("lints"); lints.replaceChildren();
  for (const lint of coverage.lints) { const card = node("article", undefined, "card warning"); card.append(node("h3", `${lint.severity} · ${lint.code}`), node("p", lint.explanation), node("small", `${lint.evidence.code} · ${lint.entities.length} affected entities`)); lints.append(card); }
  if (!coverage.lints.length) lints.append(node("p", "No recorded condition triggered the current lint rules. This does not prove context completeness."));
}
function renderDiff(diff) {
  if (diff.review) showStatus(`Review comparison: ${diff.review.changeSetChanged ? "change set changed" : "same change set"}; ${diff.review.relationshipsAdded.length} relationships added, ${diff.review.relationshipsRemoved.length} removed.`);
  const target = $("changes"); target.replaceChildren(node("p", `${diff.before.slice(0, 12)} → ${diff.after.slice(0, 12)} · ${diff.identical ? "Identical compilation" : "Changed compilation"}`));
  if (diff.review) {
    fact(target, "REVIEW CHANGE SET", diff.review.changeSetChanged ? "Changed" : "Same recorded change");
    fact(target, "SYMBOL / IMPACT TRANSITIONS", `Symbols ${diff.review.symbolsChanged ? "changed" : "unchanged"}; ${diff.review.relationshipsAdded.length} relationships added, ${diff.review.relationshipsRemoved.length} removed`);
    for (const [label, coverage] of [["BEFORE", diff.review.coverageBefore], ["AFTER", diff.review.coverageAfter]]) if (coverage) fact(target, `${label} · CHANGED SYMBOLS REPRESENTED`, `${coverage.changedSymbols.represented} / ${coverage.changedSymbols.available}`);
  }
  for (const item of diff.compilation) fact(target, "COMPILATION CHANGE", item.dimension);
  for (const item of diff.candidates) {
    const card = node("article", undefined, "card");
    card.append(node("h3", item.path), node("p", `${item.before?.disposition || "ABSENT"} → ${item.after?.disposition || "ABSENT"}`), node("p", `Changed: ${item.changes.join(", ")}`));
    if (item.before && item.after) card.append(node("small", `Tokens ${item.before.tokens} → ${item.after.tokens}; reasons ${item.before.reasons.join(", ")} → ${item.after.reasons.join(", ")}`));
    target.append(card);
  }
  if (!diff.candidates.length) target.append(node("p", "No captured candidate changed semantically."));
}
$("compile").addEventListener("click", () => work("Compiling safe sources and saving provenance…", async () => { const task = $("task").value; display(await api({ action: "compile", task, budget: Number($("budget").value), refreshIndex: $("refresh").checked })); $("task").value = opened.capsule.deterministic.task.text || ""; await refreshHistory(); showStatus("Compiled and saved. Inspect the proposal, then try a control."); }));
$("recompile").addEventListener("click", () => work("Applying controls under the same safety and budget rules…", async () => { if (!opened) return; const task = $("replay-task").value; display(await api({ action: "recompile", id: opened.capsule.capsuleHash, budget: Number($("whatif-budget").value), controls, ...(task ? { task } : {}) })); $("replay-task").value = ""; await refreshHistory(); showStatus("New Capsule saved. The original is unchanged; inspect the semantic diff."); }));
$("verify").addEventListener("click", () => work("Verifying current sources and recompiling recorded inputs…", async () => { const task = $("replay-task").value; const data = await api({ action: "verify", id: opened.capsule.capsuleHash, ...(task ? { task } : {}) }); display(data.opened); $("replay-task").value = ""; tab("replay"); $("replay-result").append(node("h3", data.replay.status), node("p", data.replay.reason)); if (data.replay.changedFiles.length) fact($("replay-result"), "MISMATCHED FILE IDENTITIES", data.replay.changedFiles.join(", ")); showStatus(`Replay: ${data.replay.status}`); }));
$("diff").addEventListener("click", () => work("Comparing recorded compilation facts…", async () => { if (!$("compare").value) return; renderDiff(await api({ action: "diff", before: $("compare").value, after: opened.capsule.capsuleHash })); showStatus("Semantic comparison complete."); }));
$("clear").addEventListener("click", () => { controls = []; renderControls(); renderCandidates(); });
$("filter").addEventListener("change", renderCandidates);
$("more").addEventListener("click", () => work("Loading history summaries…", () => refreshHistory(true)));
$("copy").addEventListener("click", () => work("Copying exact context…", async () => { if (opened?.payload) { await navigator.clipboard.writeText(opened.payload); showStatus("Exact compiled context copied."); } }));
$("delete").addEventListener("click", () => work("Deleting selected history metadata…", async () => { if (!opened || !window.confirm("Delete this Capsule from local history? This does not securely erase disk pages.")) return; await api({ action: "delete", id: opened.capsule.capsuleHash }); opened = null; $("workspace").hidden = true; await refreshHistory(); showStatus("Capsule removed from local history."); }));
$("import").addEventListener("change", () => work("Validating imported Capsule…", async () => { const file = $("import").files[0]; if (!file) return; if (file.size > 8 * 1024 * 1024) throw new Error("Capsule exceeds the 8 MiB import limit."); display(await api({ action: "import", capsule: JSON.parse(await file.text()) })); await refreshHistory(); showStatus("Capsule validated and saved. Source bodies were not imported."); }));
function renderReview() {
  const c = opened.capsule.deterministic, review = c.review;
  $("review-tab").hidden = !review;
  if (!review) return;
  $("review-ref").textContent = `${review.base.slice(0, 8)} → working tree`;
  const fileMap = new Map(c.files.map((f) => [f.id, f.path]));
  const candidate = (path) => c.candidates.find((i) => fileMap.get(i.fileRef) === path);
  $("review-files").replaceChildren();
  const labels = { FILE_IMPORTS_FILE: "Imports / dependents", TEST_RELATES_TO_FILE: "Associated tests", DOCUMENT_RELATES_TO_FILE: "Related documentation", SYMBOL_REFERENCES_SYMBOL: "Direct symbol references", TEST_REFERENCES_SYMBOL: "Direct test references", SYMBOL_IMPLEMENTS_SYMBOL: "Interface / implementation" };
  function inspect(change) {
    const target = $("review-detail"); target.replaceChildren(node("p", change.status, "eyebrow"), node("h3", change.path, "mono"));
    if (change.previousPath) target.append(node("p", `Renamed from ${change.previousPath}`, "muted"));
    for (const s of change.symbols) {
      const symbol = node("div", undefined, "symbol-row"); symbol.append(node("span", s.change, `tag ${s.change}`), node("strong", s.name), node("small", `${s.kind} · L${s.startLine}–${s.endLine}`)); target.append(symbol);
    }
    if (!change.symbols.length) target.append(node("p", change.availability === "VERIFIED" ? "File-level change. No supported changed symbol was captured." : "Deleted file: metadata only. Historical source is not recovered.", "muted"));
    target.append(node("h4", "Changed ranges"));
    for (const range of change.ranges.slice(0, 30)) { const row = node("div", undefined, "range-row"); row.append(node("span", `− L${range.before.startLine} · ${range.before.count} lines`, "removed-lines"), node("span", `+ L${range.after.startLine} · ${range.after.count} lines`, "added-lines")); target.append(row); }
    if (change.ranges.length > 30) target.append(node("p", "First 30 ranges shown. Capsule retains all bounded ranges.", "muted"));
    const item = candidate(change.path);
    if (item) { target.append(node("p", `Context decision: ${item.disposition}`, "muted")); const button = node("button", "Inspect selection & controls →"); button.addEventListener("click", () => tab("proposal")); target.append(button); }
    $("review-impact").replaceChildren();
    const links = review.impact.filter((r) => r.from === change.path || r.to === change.path);
    for (const relation of links.slice(0, 40)) {
      const path = relation.from === change.path ? relation.to : relation.from;
      const item = candidate(path), card = node("article", undefined, "impact-card");
      card.append(node("small", labels[relation.type] || relation.type, "relation-label"), node("h4", path, "mono"), node("p", `${relation.from} → ${relation.to}`, "relation-chain"), node("span", relation.classification === "HEURISTIC" ? "Heuristic association" : "Structural fact", `provenance ${relation.classification}`), node("span", item?.disposition || "NOT AVAILABLE", `tag ${item?.disposition || ""}`));
      if (item) { const pin = node("button", "PIN"); pin.setAttribute("aria-label", `Pin ${path}`); pin.addEventListener("click", () => { controls = controls.filter((control) => control.path !== path); controls.push({ kind: "PIN", path }); renderControls(); renderCandidates(); showStatus(`Pinned ${path}. Recompile to create a new Capsule.`); }); card.append(pin); }
      $("review-impact").append(card);
    }
    if (!links.length) $("review-impact").append(node("p", "No supported one-hop relationship captured. This does not prove there is no impact.", "muted"));
    if (links.length > 40) $("review-impact").append(node("p", "First 40 relations shown; export the Capsule for all recorded evidence.", "muted"));
    for (const button of $("review-files").children) button.classList.toggle("selected", button.dataset.path === change.path);
  }
  for (const change of review.changes) { const button = node("button", undefined, "change-file"); button.dataset.path = change.path; button.append(node("span", change.status.slice(0, 1), `change-letter ${change.status}`), node("span", change.path), node("small", `${change.symbols.length} symbols`)); button.addEventListener("click", () => inspect(change)); $("review-files").append(button); }
  if (review.changes[0]) inspect(review.changes[0]);
  const coverage = opened.coverage.review;
  $("review-summary").replaceChildren();
  fact($("review-summary"), "CHANGE SURFACE", `${review.changes.length} files · ${review.changes.reduce((n, f) => n + f.symbols.length, 0)} symbol changes`);
  fact($("review-summary"), "BOUNDARY", `One hop · ${review.excludedChanges} excluded changes · tracked files only`);
  if (coverage) {
    fact($("review-summary"), "CURRENT SYMBOLS REPRESENTED", `${coverage.changedSymbols.represented} / ${coverage.changedSymbols.available}`);
    for (const lint of coverage.lints) { const card = node("article", undefined, "card"); card.append(node("small", `${lint.severity} · ${lint.code}`), node("p", lint.explanation), node("p", lint.entities.join(", "), "mono muted")); $("lints").append(card); }
  }
}
$("review-compile").addEventListener("click", () => work("Analyzing tracked changes, verifying sources and compiling Review Context…", async () => {
  display(await api({ action: "review", base: $("review-base").value, budget: Number($("review-budget").value), refreshIndex: true }));
  await refreshHistory(); showStatus("Review Context saved. Follow the impact evidence, then shape the proposal.");
}));
void work("Opening local history…", async () => { await refreshHistory(); showStatus("Ready. Build Review Context, compile a coding task, or open a saved Capsule."); });
