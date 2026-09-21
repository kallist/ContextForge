"use strict";
const $ = (id) => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem("contextforge-capability") || "";
if (location.hash) { sessionStorage.setItem("contextforge-capability", token); globalThis.history.replaceState(null, "", "/"); }
let opened = null, entries = [], controls = [], offset = 0, activeCandidateId = null, snapshotEvidence = null, replayStatus = null, snapshotTransition = null, selectedPaths = new Set(), inspectedPath = null;
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
  finally { buttons.forEach((b) => { b.disabled = false; }); $("copy").disabled = !opened?.payload; }
}
const groups = { proposal: "context", context: "context", review: "context", evidence: "why", coverage: "why", history: "history", changes: "history", replay: "history" };
function tab(name) {
  const group = groups[name];
  document.querySelectorAll("[data-nav]").forEach((e) => { e.classList.toggle("active", e.dataset.nav === group); if (e.dataset.nav === group) e.setAttribute("aria-current", "page"); else e.removeAttribute("aria-current"); });
  document.querySelectorAll(".view-tabs [data-tab]").forEach((e) => { e.hidden = e.dataset.tab === "review" && !opened?.capsule.deterministic.review; });
  $("start").hidden = group !== "context"; $("start").classList.toggle("has-result", !!opened);
  $("workspace").hidden = !opened || name === "history";
  $("empty-view").hidden = !!opened || group !== "why";
  const panel = name === "evidence" ? "proposal" : name;
  document.querySelectorAll("[data-panel]").forEach((e) => { e.hidden = e.dataset.panel !== panel; });
  document.querySelectorAll(".view-tabs [data-tab]").forEach((e) => { e.classList.toggle("active", e.dataset.tab === name || (name === "evidence" && e.dataset.tab === "proposal")); });
}
document.querySelectorAll("[data-nav]").forEach((e) => e.addEventListener("click", () => tab({ context: "proposal", changes: "changes", history: "history" }[e.dataset.nav])));
document.querySelectorAll("[data-history-action]").forEach((e) => e.addEventListener("click", () => { if (opened) tab(e.dataset.historyAction); else showStatus("Open a saved context first."); }));
function mode(review) { $("task-composer").hidden = review; $("review-composer").hidden = !review; $("mode-task").setAttribute("aria-pressed", String(!review)); $("mode-review").setAttribute("aria-pressed", String(review)); }
$("mode-task").addEventListener("click", () => mode(false));
$("mode-review").addEventListener("click", () => mode(true));
document.querySelectorAll("[data-tab]").forEach((e) => e.addEventListener("click", () => tab(e.dataset.tab)));
$("exact-context-shortcut").addEventListener("click", () => tab("context"));
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
const reasonLabels = { SELECTED: "Included in the context", REQUIRED_INSTRUCTION: "Required repository instruction", BUDGET_EXHAUSTED: "Available budget was exhausted", LOWER_PRIORITY: "Not allocated by the recorded priority decision", DUPLICATE: "Already represented in context", STALE_SOURCE: "Source differs from the indexed version", SECTION_LIMIT: "The section allocation could not fit this candidate", UNSUPPORTED_CONTENT: "Content representation is unsupported", NO_USEFUL_RANGE: "No useful source range was available", SOURCE_VERIFICATION_LIMIT: "Source verification reached its bound", GLOBAL_BUDGET: "The total context budget prevented inclusion", SAFETY_LIMIT: "A safety bound prevented inclusion", REDUNDANT_RANGE: "Source range is already represented" };
function renderRuler() {
  const ruler = document.querySelector(".ruler"); if (!ruler || !opened) return;
  const b = opened.capsule.deterministic.budget;
  const used = Math.max(0, Math.round(b.estimatedTokens)), budget = Math.max(1, Math.round(b.requested));
  const util = Math.max(0, Math.min(1, used / budget));
  const usedBar = ruler.querySelector(".ruler-used"), remainingBar = ruler.querySelector(".ruler-remaining");
  if (usedBar) usedBar.style.width = (util * 100).toFixed(2) + "%";
  if (remainingBar) remainingBar.style.width = ((1 - util) * 100).toFixed(2) + "%";
  const budgetLabel = ruler.querySelector("[data-ruler-budget]"), mark = ruler.querySelector("[data-ruler-mark]");
  if (budgetLabel) budgetLabel.textContent = budget.toLocaleString() + " budget";
  if (mark) mark.textContent = used.toLocaleString() + " used";
  ruler.setAttribute("aria-label", "Context budget ruler. " + used.toLocaleString() + " of " + budget.toLocaleString() + " estimator tokens used by " + opened.capsule.deterministic.selected.length + " selected files; " + Math.max(0, budget - used).toLocaleString() + " remaining. " + opened.capsule.deterministic.dropped.length + " files were considered but not selected.");
}
function fact(parent, label, value) { const e = node("div", undefined, "fact"); e.append(node("small", label), node("p", value)); parent.append(e); }
function renderSelectionBar() {
  const bar = $("selection-bar"); if (!bar) return;
  const paths = [...selectedPaths];
  if (!paths.length) { bar.hidden = true; bar.replaceChildren(); return; }
  bar.hidden = false; bar.replaceChildren();
  bar.append(node("span", paths.length === 1 ? "1 file selected" : paths.length + " files selected", "selection-count"));
  for (const [kind, label] of [["PIN", "Include"], ["PREFER", "Prefer"], ["EXCLUDE", "Exclude"]]) {
    const button = node("button", label);
    button.classList.toggle("active", paths.every((path) => controls.some((control) => control.kind === kind && control.path === path)));
    button.addEventListener("click", () => { for (const path of paths) applyControl(path, kind); renderControls(); renderCandidates(); renderInspectorControls(inspectedPath); showStatus(label + " applied to " + paths.length + (paths.length === 1 ? " file" : " files") + " in the next build. Rebuild to create a new Capsule."); });
    bar.append(button);
  }
  const clear = node("button", "Clear selection"); clear.addEventListener("click", () => { selectedPaths.clear(); renderCandidates(); }); bar.append(clear);
}
function buildInspector(target, path, state, result) {
  const sentences = (result.facts.decisions || []).map((d) => reasonLabels[d.reason] || "A recorded decision applied").filter(Boolean);
  const lead = node("p", undefined, "reason-lead");
  lead.append(node("strong", state === "SELECTED" ? "Included in this context. " : state === "DROPPED" ? "Considered, not selected. " : "Excluded by a recorded boundary. "), sentences.length ? sentences.join(". ") + "." : "The recorded decision is shown below.");
  target.append(lead);
  const evidence = (result.facts.evidence || []);
  if (evidence.length) {
    const list = node("ul", undefined, "evidence-list");
    for (const e of evidence.slice(0, 40)) {
      const item = node("li", undefined, "evidence-item");
      item.append(node("span", e.code + (e.querySignal ? " · " + e.querySignal : ""), "evidence-reason"));
      item.append(node("span", String(e.family) + " evidence", "evidence-source"));
      list.append(item);
    }
    target.append(node("h4", "Recorded evidence"), list);
    if (evidence.length > 40) target.append(node("p", "First 40 evidence records shown. Export the Capsule for the complete captured set.", "muted"));
  }
  const relations = (result.facts.review?.impact || []).filter((r) => r.from === path || r.to === path).slice(0, 20);
  if (relations.length) {
    const list = node("ul", undefined, "evidence-list");
    for (const r of relations) {
      const item = node("li", undefined, "evidence-item");
      item.append(node("span", r.from + " → " + r.to, "evidence-relation"));
      item.append(node("span", String(r.type) + " · " + String(r.classification), "evidence-source"));
      list.append(item);
    }
    target.append(node("h4", "Structural relationships"), list);
  }
  const codes = node("details");
  codes.append(node("summary", "Decision details"), node("pre", (result.facts.decisions || []).map((d) => d.reason + " (" + d.decisionSource + ")").join("\n")));
  if (result.facts.selection) codes.append(node("p", "Context role: " + result.facts.selection.role, "muted"));
  if (result.facts.ranges?.length) codes.append(node("p", "Ranges: " + result.facts.ranges.map((r) => "L" + r.startLine + "–" + r.endLine).join(", "), "mono muted"));
  if (result.facts.symbols?.length) codes.append(node("p", "Symbols: " + result.facts.symbols.map((s) => s.qualifiedName).join(", "), "mono muted"));
  target.append(codes);
}
function renderExplainInto(target, path, state, result) { target.replaceChildren(node("h3", path)); buildInspector(target, path, state, result); }


function display(data) {
  opened = data; controls = structuredClone(data.capsule.deterministic.overrides[0]?.controls || []); activeCandidateId = null; snapshotEvidence = null; replayStatus = null; selectedPaths = new Set(); inspectedPath = null;
  snapshotTransition = data.diff?.candidates?.find((item) => item.before?.disposition && item.after?.disposition && item.before.disposition !== item.after.disposition) || null; renderControls();
  const c = data.capsule.deterministic;
  $("workspace").hidden = false; $("identity").textContent = data.capsule.capsuleHash.slice(0, 12);
  $("usage").textContent = `${c.budget.estimatedTokens.toLocaleString()} of ${c.budget.requested.toLocaleString()} estimator tokens`;
  $("budget-bar").value = 100 * c.budget.utilization;
  $("counts").textContent = `${c.selected.length} selected · ${c.dropped.length} considered, not selected`;
  $("generation").textContent = `gen ${c.repository.activeGeneration} · ${c.repository.gitCommit?.slice(0, 8) || "no Git"}`;
  $("repo-label").textContent = c.repository.gitCommit ? `Repository · ${c.repository.gitCommit.slice(0, 8)}` : "Local repository";
  $("index-state").lastChild.textContent = " Indexed";
  $("result-task").textContent = c.task.text || (c.review ? "Tracked Git change" : "Redacted task");
  document.querySelectorAll(".capsule-identity").forEach((element) => { element.textContent = data.capsule.capsuleHash.slice(0, 12); });
  $("provenance").textContent = JSON.stringify({ task: c.task, repository: c.repository, strategies: c.strategies, overrides: c.overrides, payloadHash: c.payloadHash, capsuleHash: data.capsule.capsuleHash }, null, 2);
  $("whatif-budget").value = c.budget.requested;
  $("payload").textContent = data.payload || "Exact context is not stored in history. Verify replay to reconstruct it from matching current sources. Path-bearing payloads remain available only through the explicit CLI output boundary.";
  $("payload-note").textContent = data.payload ? `Exact ephemeral payload · SHA-256 ${c.payloadHash}` : data.payloadStatus;
  $("copy").disabled = !data.payload;
  $("explain").replaceChildren(node("div", undefined, "inspector-empty"));
  $("explain").firstChild.append(node("span", "→", "inspector-glyph"), node("h3", "Select a file"), node("p", "Inspect why it was selected, dropped, or excluded. These are recorded compiler facts."));
  $("inspector-controls").hidden = true; $("inspector-controls").replaceChildren(); $("replay-result").replaceChildren(); renderRuler();
  renderCandidates(); renderCoverage(data.coverage); renderReview();
  if (data.diff) { renderDiff(data.diff); tab("changes"); } else { $("changes").replaceChildren(node("p", "Choose a prior Capsule to compare, or try human controls.")); tab("proposal"); }
}
function renderCandidates() {
  if (!opened) return;
  const c = opened.capsule.deterministic; $("candidates").replaceChildren();
  const fileMap = new Map(c.files.map((f) => [f.id, f]));
  let shown = 0;
  for (const candidate of [...c.candidates].sort((a, b) => Number(b.disposition === "SELECTED") - Number(a.disposition === "SELECTED"))) {
    if ($("filter").value !== "ALL" && candidate.disposition !== $("filter").value) continue;
    const file = fileMap.get(candidate.fileRef), selection = c.selected.find((s) => s.candidateRef === candidate.id);
    const tr = node("tr"); tr.dataset.candidate = candidate.id; tr.dataset.state = candidate.disposition;
    tr.dataset.selected = String(selectedPaths.has(file.path));
    tr.classList.toggle("active", activeCandidateId === candidate.id);
    const fileCell = node("td"), button = node("button");
    button.append(node("span", (candidate.rank || "—") + "  ", "rank"), node("span", file.path));
    button.addEventListener("click", () => work("Reading captured explanation…", async () => {
      const result = await api({ action: "explain", id: opened.capsule.capsuleHash, query: { type: `WHY_${candidate.disposition}`, subject: candidate.id } });
      activeCandidateId = candidate.id; inspectedPath = file.path;
      selectedPaths.clear(); selectedPaths.add(file.path);
      const target = $("explain"); renderExplainInto(target, file.path, candidate.disposition, result);
      snapshotEvidence = { path: file.path, state: candidate.disposition, decision: result.facts.decisions.map((d) => reasonLabels[d.reason] || d.reason).join(" · "), relationship: result.facts.review?.impact?.find((r) => r.from === file.path || r.to === file.path) };
      renderInspectorControls(file.path);
      renderCandidates();
      tab("evidence");
      target.tabIndex = -1; target.focus();
      showStatus(`Explain: ${result.status}. These are recorded compiler facts, not a model's reasoning.`);
    }));
    fileCell.append(button);
    const state = node("td"); state.append(node("span", candidate.disposition, `tag ${candidate.disposition}`));
    tr.append(fileCell, state, node("td", selection ? selection.estimatedTokens.toLocaleString() : "—"));
    shown += 1; $("candidates").append(tr);
  }
  if (!shown) { const tr = node("tr"), cell = node("td", "No file matches this filter. Choose All to see every considered file.", "muted"); cell.colSpan = 3; tr.append(cell); $("candidates").append(tr); }
  renderSelectionBar();
}
function applyControl(path, kind) {
  controls = controls.filter((control) => control.path !== path);
  if (kind === "—") return true;
  let control = { kind, path };
  if (kind === "FOCUS") control.path = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : path;
  if (kind === "RANGE") {
    const text = window.prompt("Inclusive verified line range, for example 2-8", "1-3");
    if (!/^\d+-\d+$/.test(text || "")) return false;
    const [startLine, endLine] = text.split("-").map(Number); control = { ...control, startLine, endLine };
  }
  controls.push(control); return true;
}
function renderInspectorControls(path) {
  const target = $("inspector-controls");
  if (!path) { target.hidden = true; target.replaceChildren(); return; }
  target.hidden = false; target.replaceChildren();
  target.append(node("span", "Next build", "eyebrow"));
  for (const [kind, label] of [["PIN", "Include"], ["PREFER", "Prefer"], ["EXCLUDE", "Exclude"], ["FOCUS", "Focus"], ["RANGE", "Range"]]) {
    const button = node("button", label); button.classList.toggle("active", controls.some((control) => control.kind === kind && control.path === path));
    button.addEventListener("click", () => { if (!applyControl(path, kind)) return; renderControls(); renderCandidates(); renderInspectorControls(path); showStatus(`${label} ${path} in the next build. Rebuild to create a new Capsule.`); });
    target.append(button);
  }
}
function renderControls() {
  const pending = $("pending"); pending.replaceChildren();
  if (!controls.length) { pending.append(node("span", "No pending controls. The recorded Capsule above is unchanged.", "muted")); return; }
  pending.append(...controls.map((c) => node("span", `${({ PIN: "Include", EXCLUDE: "Exclude", PREFER: "Prefer", FOCUS: "Focus", RANGE: "Range" })[c.kind]} ${c.path}${c.kind === "RANGE" ? ` L${c.startLine}–${c.endLine}` : ""}`, "chip")));
}
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
function canvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || "").split(/\s+/u); const lines = []; let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else { lines.push(line); line = word; if (lines.length === maxLines - 1) break; }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(" ").split(/\s+/u).length;
  if (consumed < words.length && lines.length) { while (ctx.measureText(`${lines.at(-1)}…`).width > maxWidth) lines[lines.length - 1] = lines.at(-1).slice(0, -1); lines[lines.length - 1] += "…"; }
  for (let index = 0; index < lines.length; index += 1) { if (ctx.measureText(lines[index]).width > maxWidth) { while (lines[index] && ctx.measureText(`${lines[index]}…`).width > maxWidth) lines[index] = lines[index].slice(0, -1); lines[index] += "…"; } }
  lines.forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight)); return y + lines.length * lineHeight;
}
function fitPath(ctx, path, maxWidth) {
  if (ctx.measureText(path).width <= maxWidth) return path;
  const tail = path.slice(-28); let head = path.slice(0, 18);
  while (head && ctx.measureText(`${head}…${tail}`).width > maxWidth) head = head.slice(0, -1);
  return `${head}…${tail}`;
}
function renderSnapshot() {
  if (!opened) return;
  const canvas = $("snapshot"), ctx = canvas.getContext("2d"), c = opened.capsule.deterministic;
  const fileMap = new Map(c.files.map((file) => [file.id, file.path]));
  const selectedPaths = c.selected.map((selection) => c.candidates.find((candidate) => candidate.id === selection.candidateRef)).filter(Boolean).map((candidate) => fileMap.get(candidate.fileRef)).filter(Boolean).slice(0, 5);
  ctx.clearRect(0, 0, 1200, 630); ctx.fillStyle = "#f8f6f1"; ctx.fillRect(0, 0, 1200, 630);
  ctx.strokeStyle = "#d4cbbd"; ctx.lineWidth = 1; ctx.strokeRect(28.5, 28.5, 1143, 573);
  ctx.fillStyle = "#211f1b"; ctx.font = "600 22px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText("RepoBound", 66, 76);
  ctx.strokeStyle = "#211f1b"; ctx.strokeRect(42.5, 49.5, 16, 20); ctx.font = "500 7px 'JetBrains Mono', monospace"; ctx.fillText("RB", 45, 62);
  ctx.fillStyle = "#a96818"; ctx.font = "600 12px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText("CONTEXT SNAPSHOT", 932, 71);
  ctx.fillStyle = "#827a70"; ctx.font = "12px 'JetBrains Mono', monospace"; ctx.fillText(opened.capsule.capsuleHash.slice(0, 12), 1038, 92);
  ctx.strokeStyle = "#e7e1d7"; ctx.beginPath(); ctx.moveTo(66, 108.5); ctx.lineTo(1134, 108.5); ctx.stroke();
  ctx.fillStyle = "#a96818"; ctx.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText("TASK", 66, 144);
  ctx.fillStyle = "#211f1b"; ctx.font = "600 35px 'IBM Plex Sans', system-ui, sans-serif";
  const taskBottom = canvasText(ctx, c.task.text || (c.review ? "Review tracked Git change" : "Redacted task"), 66, 184, 640, 43, 3);
  const metricsY = Math.max(310, taskBottom + 30);
  ctx.fillStyle = "#211f1b"; ctx.font = "600 27px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText(String(c.selected.length), 66, metricsY); ctx.fillText(String(c.dropped.length), 190, metricsY); ctx.fillText(`${(c.budget.estimatedTokens / 1000).toFixed(c.budget.estimatedTokens >= 1000 ? 1 : 2)}k`, 330, metricsY);
  ctx.fillStyle = "#827a70"; ctx.font = "600 10px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText("SELECTED", 66, metricsY + 23); ctx.fillText("DROPPED", 190, metricsY + 23); ctx.fillText(`/ ${(c.budget.requested / 1000).toFixed(c.budget.requested >= 1000 ? 0 : 2)}k BUDGET`, 330, metricsY + 23);
  ctx.fillStyle = "#e7e1d7"; ctx.fillRect(66, metricsY + 42, 620, 4); ctx.fillStyle = "#a96818"; ctx.fillRect(66, metricsY + 42, Math.min(620, 620 * c.budget.utilization), 4);
  ctx.fillStyle = "#a96818"; ctx.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText("KEY CONTEXT", 66, metricsY + 84);
  ctx.font = "13px 'JetBrains Mono', monospace"; selectedPaths.forEach((path, index) => { ctx.fillStyle = index === 0 ? "#a96818" : "#5f5a52"; ctx.fillRect(66, metricsY + 105 + index * 28, index === 0 ? 3 : 1, 16); ctx.fillStyle = "#211f1b"; ctx.fillText(fitPath(ctx, path, 585), 81, metricsY + 118 + index * 28); });
  ctx.strokeStyle = "#e7e1d7"; ctx.beginPath(); ctx.moveTo(748.5, 132); ctx.lineTo(748.5, 533); ctx.stroke();
  ctx.fillStyle = "#a96818"; ctx.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText(snapshotTransition ? "LAST CHANGE" : "WHY", 790, 144);
  if (snapshotTransition) {
    ctx.fillStyle = "#211f1b"; ctx.font = "500 16px 'JetBrains Mono', monospace"; ctx.fillText(fitPath(ctx, snapshotTransition.path, 344), 790, 181);
    ctx.fillStyle = "#a96818"; ctx.font = "600 15px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText(`${snapshotTransition.before.disposition} → ${snapshotTransition.after.disposition}`, 790, 214);
  } else if (snapshotEvidence) {
    ctx.fillStyle = "#211f1b"; ctx.font = "500 16px 'JetBrains Mono', monospace"; ctx.fillText(fitPath(ctx, snapshotEvidence.path, 344), 790, 181);
    ctx.fillStyle = "#a96818"; ctx.font = "600 12px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText(snapshotEvidence.state, 790, 207);
    ctx.fillStyle = "#5f5a52"; ctx.font = "15px 'IBM Plex Sans', system-ui, sans-serif"; canvasText(ctx, snapshotEvidence.decision, 790, 242, 330, 24, 5);
    if (snapshotEvidence.relationship) { ctx.fillStyle = "#827a70"; ctx.font = "12px 'JetBrains Mono', monospace"; canvasText(ctx, `${snapshotEvidence.relationship.from} → ${snapshotEvidence.relationship.to}`, 790, 390, 330, 20, 3); }
  } else {
    ctx.fillStyle = "#211f1b"; ctx.font = "600 19px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText("Recorded selection", 790, 183);
    ctx.fillStyle = "#5f5a52"; ctx.font = "15px 'IBM Plex Sans', system-ui, sans-serif"; canvasText(ctx, "Open a file in Why to add its recorded decision to this Snapshot.", 790, 220, 330, 24, 4);
  }
  if (replayStatus) { ctx.fillStyle = "#a96818"; ctx.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText(`REPLAY ${replayStatus}`, 790, 488); }
  ctx.strokeStyle = "#e7e1d7"; ctx.beginPath(); ctx.moveTo(66, 548.5); ctx.lineTo(1134, 548.5); ctx.stroke();
  ctx.fillStyle = "#5f5a52"; ctx.font = "12px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText("Local-first  ·  Hard declared estimator budget  ·  Context evidence, not agent outcome", 66, 580);
}
function downloadSnapshot() {
  renderSnapshot(); $("snapshot").toBlob((blob) => { if (!blob || !opened) return; const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `repobound-context-${opened.capsule.capsuleHash.slice(0, 8)}.png`; link.click(); URL.revokeObjectURL(url); }, "image/png");
}
$("compile").addEventListener("click", () => work("Compiling safe sources and saving provenance…", async () => { const task = $("task").value; display(await api({ action: "compile", task, budget: Number($("budget").value), refreshIndex: $("refresh").checked })); $("task").value = opened.capsule.deterministic.task.text || ""; await refreshHistory(); showStatus("Compiled and saved. Inspect the proposal, then try a control."); }));
$("recompile").addEventListener("click", () => work("Applying controls under the same safety and budget rules…", async () => { if (!opened) return; const task = $("replay-task").value; display(await api({ action: "recompile", id: opened.capsule.capsuleHash, budget: Number($("whatif-budget").value), controls, ...(task ? { task } : {}) })); $("replay-task").value = ""; await refreshHistory(); showStatus("New Capsule saved. The original is unchanged; inspect the semantic diff."); }));
$("verify").addEventListener("click", () => work("Verifying current sources and recompiling recorded inputs…", async () => { const task = $("replay-task").value; const data = await api({ action: "verify", id: opened.capsule.capsuleHash, ...(task ? { task } : {}) }); display(data.opened); replayStatus = data.replay.status; $("replay-task").value = ""; tab("replay"); $("replay-result").append(node("h3", data.replay.status), node("p", data.replay.reason)); if (data.replay.changedFiles.length) fact($("replay-result"), "MISMATCHED FILE IDENTITIES", data.replay.changedFiles.join(", ")); showStatus(`Replay: ${data.replay.status}`); }));
$("diff").addEventListener("click", () => work("Comparing recorded compilation facts…", async () => { if (!$("compare").value) return; renderDiff(await api({ action: "diff", before: $("compare").value, after: opened.capsule.capsuleHash })); showStatus("Semantic comparison complete."); }));
$("clear").addEventListener("click", () => { controls = []; selectedPaths.clear(); renderControls(); renderCandidates(); renderInspectorControls(inspectedPath); showStatus("Pending controls cleared. The recorded Capsule was not changed."); });
$("filter").addEventListener("change", renderCandidates);
$("more").addEventListener("click", () => work("Loading history summaries…", () => refreshHistory(true)));
$("copy").addEventListener("click", () => work("Copying exact context…", async () => { if (opened?.payload) { await navigator.clipboard.writeText(opened.payload); showStatus("Exact compiled context copied."); } }));
$("share").addEventListener("click", () => { if (!opened) return; renderSnapshot(); $("share-panel").hidden = false; $("share-close").focus(); });
$("share-close").addEventListener("click", () => { $("share-panel").hidden = true; $("share").focus(); });
$("snapshot-download").addEventListener("click", downloadSnapshot);
$("share-panel").addEventListener("click", (event) => { if (event.target === $("share-panel")) $("share-close").click(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("share-panel").hidden) $("share-close").click(); });
$("delete").addEventListener("click", () => work("Deleting selected history metadata…", async () => { if (!opened || !window.confirm("Delete this Capsule from local history? This does not securely erase disk pages.")) return; await api({ action: "delete", id: opened.capsule.capsuleHash }); opened = null; $("workspace").hidden = true; tab("history"); await refreshHistory(); showStatus("Capsule removed from local history."); }));
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
      if (item) { const pin = node("button", "PIN"); pin.setAttribute("aria-label", `Pin ${path}`); pin.addEventListener("click", () => { applyControl(path, "PIN"); renderControls(); renderCandidates(); showStatus(`Include ${path} in the next build. Rebuild to create a new Capsule.`); }); card.append(pin); }
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
void work("Opening local history…", async () => { await refreshHistory(); tab("proposal"); showStatus("Ready. Build task context, choose Current Git Change, or open History."); });
