const form = document.querySelector("#historyForm");
const addressInput = document.querySelector("#addressInput");
const limitInput = document.querySelector("#limitInput");
const fromBlockInput = document.querySelector("#fromBlockInput");
const scanStartsInput = document.querySelector("#scanStartsInput");
const statusEl = document.querySelector("#status");
const summaryText = document.querySelector("#summaryText");
const battleList = document.querySelector("#battleList");
const emptyState = document.querySelector("#emptyState");
const battleDetail = document.querySelector("#battleDetail");

let historyPayload = null;
let selectedKey = null;
let replayCache = new Map(); // battleKey -> replay payload
let replayLoading = new Set();

const params = new URLSearchParams(window.location.search);
if (params.get("address")) {
  addressInput.value = params.get("address");
}
if (params.get("limit")) {
  limitInput.value = params.get("limit");
}
if (params.get("fromBlock")) {
  fromBlockInput.value = params.get("fromBlock");
}
if (["1", "true", "yes"].includes((params.get("scanStarts") || "").toLowerCase())) {
  scanStartsInput.checked = true;
}

function shortHash(value, left = 10, right = 6) {
  if (!value) return "?";
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message, error = false) {
  statusEl.hidden = !message;
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", error);
}

function teamNames(battle, side) {
  const team = battle.teams?.[side] || [];
  return team.map((mon) => mon.name).join(" / ") || "?";
}

function resultClass(result) {
  if (result === "win") return "win";
  if (result === "loss") return "loss";
  return "unknown";
}

function renderList() {
  const battles = historyPayload?.battles || [];
  summaryText.textContent = battles.length
    ? `${historyPayload.wins}W / ${historyPayload.losses}L / ${historyPayload.decodedBattles} decoded`
    : "";

  battleList.innerHTML = battles
    .map((battle) => {
      const ourSide = battle.playerIndex === 1 ? "p1" : "p0";
      const oppSide = ourSide === "p0" ? "p1" : "p0";
      const active = battle.battleKey === selectedKey ? "active" : "";
      const playerNumber = battle.playerBattleNumber ?? "?";
      return `
        <button class="battle-row ${active}" data-key="${escapeHtml(battle.battleKey)}">
          <span class="battle-main">
            <span class="battle-key">P#${escapeHtml(playerNumber)} · ${escapeHtml(shortHash(battle.battleKey))}</span>
            <span class="battle-meta">${escapeHtml(battle.opponentLabel)} · ${battle.engineExecutes} turns · ${battle.moveEvents} moves</span>
            <span class="team-line">${escapeHtml(teamNames(battle, ourSide))} vs ${escapeHtml(teamNames(battle, oppSide))}</span>
          </span>
          <span class="pill ${resultClass(battle.result)}">${escapeHtml(battle.result)}</span>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll(".battle-row").forEach((button) => {
    button.addEventListener("click", () => {
      selectedKey = button.dataset.key;
      renderList();
      renderDetail();
    });
  });
}

function renderTeam(title, team) {
  const chips = (team || [])
    .map((mon) => `<span class="mon-chip">${mon.slot + 1}. ${escapeHtml(mon.name)}</span>`)
    .join("");
  return `
    <div class="team">
      <div class="team-title">${escapeHtml(title)}</div>
      <div class="mon-chips">${chips || '<span class="team-line">Unknown team</span>'}</div>
    </div>
  `;
}

function renderMove(move, playerIndex) {
  const side = move.playerIndex === playerIndex ? "You" : "Opp";
  return `
    <div class="move">
      <div class="side">${side}</div>
      <div class="mono">${escapeHtml(move.activeMon)}</div>
      <div class="action">${escapeHtml(move.label)}</div>
    </div>
  `;
}

function hpBar(mon) {
  const pct = mon.maxHp > 0 ? Math.max(0, Math.min(100, (100 * mon.hp) / mon.maxHp)) : 0;
  let hue = "good";
  if (pct < 25) hue = "low";
  else if (pct < 60) hue = "mid";
  return `
    <div class="hp-bar"><span class="hp-fill ${hue}" style="width:${pct.toFixed(1)}%"></span></div>
    <span class="hp-num">${mon.hp}/${mon.maxHp}</span>
  `;
}

function renderMonRow(mon, active, kod) {
  const classes = ["mon-row"];
  if (active) classes.push("active");
  if (kod || mon.isKnockedOut) classes.push("ko");
  const effChips = (mon.effects || [])
    .map(e => `<span class="effect-chip" title="${escapeHtml(e.extraData || '')}">${escapeHtml(e.name)}</span>`)
    .join("");
  return `
    <div class="${classes.join(' ')}">
      <span class="mon-slot">${mon.slot + 1}</span>
      <span class="mon-name">${escapeHtml(mon.name)}</span>
      ${hpBar(mon)}
      <span class="stamina">⚡${mon.stamina}/${mon.maxStamina}</span>
      <span class="effects">${effChips}</span>
    </div>
  `;
}

function renderFrame(frame, sides, viewerIdx) {
  const ourSide = viewerIdx === 1 ? "p1" : "p0";
  const oursMons = ourSide === "p0" ? frame.p0Mons : frame.p1Mons;
  const oppMons  = ourSide === "p0" ? frame.p1Mons : frame.p0Mons;
  const oursActive = ourSide === "p0" ? frame.activeMonIndex[0] : frame.activeMonIndex[1];
  const oppActive  = ourSide === "p0" ? frame.activeMonIndex[1] : frame.activeMonIndex[0];
  const moves = (frame.moves || []).map(m =>
    `<div class="frame-move ${m.side === ourSide ? 'yours' : 'theirs'}">
       <span class="side-tag">${m.side === ourSide ? 'You' : 'Opp'}</span>
       <span class="mono">${escapeHtml(m.activeMon)}</span>
       <span class="action">${escapeHtml(m.label)}</span>
     </div>`).join("");
  const winnerBadge = frame.winnerIndex !== 2
    ? `<span class="winner-pill">${frame.winnerIndex === viewerIdx ? 'You win' : 'Opp wins'}</span>`
    : "";
  return `
    <div class="frame">
      <div class="frame-head">
        <span class="turn-pill">Turn ${frame.turnId}</span>
        ${winnerBadge}
      </div>
      <div class="frame-moves">${moves || '<span class="muted">no moves</span>'}</div>
      <div class="frame-teams">
        <div class="frame-team">
          <div class="team-head">You</div>
          ${oursMons.map(m => renderMonRow(m, m.slot === oursActive)).join("")}
        </div>
        <div class="frame-team">
          <div class="team-head">Opponent</div>
          ${oppMons.map(m => renderMonRow(m, m.slot === oppActive)).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderReplay(battleKey, viewerIdx) {
  const payload = replayCache.get(battleKey);
  if (replayLoading.has(battleKey)) {
    return `<div class="replay-status">Running replay…</div>`;
  }
  if (!payload) {
    return `<div class="replay-status">
      <button class="replay-btn" data-battle="${escapeHtml(battleKey)}">Run replay</button>
      <span class="muted">Reconstructs HP, stamina, and effects from the on-chain move stream.</span>
    </div>`;
  }
  if (!payload.ok) {
    return `<div class="replay-status error">Replay failed: ${escapeHtml(payload.error || 'unknown')}</div>`;
  }
  const frames = payload.frames || [];
  const final = frames[frames.length - 1];
  return `
    <div class="replay-block">
      <div class="replay-head">
        <strong>Replay timeline</strong>
        <span class="muted">${frames.length} frames · ${final?.winnerIndex !== 2 ? (final.winnerIndex === viewerIdx ? 'you win' : 'opponent wins') : 'unfinished'}</span>
      </div>
      <div class="replay-frames">
        ${frames.slice(1).map(f => renderFrame(f, null, viewerIdx)).join("")}
      </div>
    </div>
  `;
}

function renderDetail() {
  const battle = (historyPayload?.battles || []).find((item) => item.battleKey === selectedKey);
  if (!battle) {
    emptyState.hidden = false;
    battleDetail.hidden = true;
    battleDetail.innerHTML = "";
    return;
  }

  const playerIndex = battle.playerIndex ?? 0;
  const ourSide = playerIndex === 1 ? "p1" : "p0";
  const oppSide = ourSide === "p0" ? "p1" : "p0";
  const turns = battle.turns || [];
  const txLink = battle.battleUrl
    ? `<a class="tx-link" href="${escapeHtml(battle.battleUrl)}" target="_blank" rel="noreferrer">Open start tx</a>`
    : "";

  battleDetail.innerHTML = `
    <header class="detail-head">
      <div class="detail-title">
        <h2 class="mono">P#${escapeHtml(battle.playerBattleNumber ?? "?")} · ${escapeHtml(shortHash(battle.battleKey, 18, 8))}</h2>
        ${txLink}
      </div>
      <div class="battle-meta">
        ${escapeHtml(battle.p0)} vs ${escapeHtml(battle.p1)}
      </div>
      <div class="stats-grid">
        <div class="stat"><span>Result</span><strong>${escapeHtml(battle.result)}</strong></div>
        <div class="stat"><span>Opponent</span><strong>${escapeHtml(battle.opponentLabel)}</strong></div>
        <div class="stat"><span>Blocks</span><strong>${escapeHtml(battle.startBlock)} → ${escapeHtml(battle.completeBlock || "?")}</strong></div>
        <div class="stat"><span>Turns</span><strong>${battle.engineExecutes}</strong></div>
      </div>
    </header>
    <section class="teams">
      ${renderTeam("You", battle.teams?.[ourSide])}
      ${renderTeam("Opponent", battle.teams?.[oppSide])}
    </section>
    <section id="replaySection" class="replay">
      ${renderReplay(battle.battleKey, playerIndex)}
    </section>
    <section class="turns">
      <div class="section-head"><h3>On-chain move stream</h3></div>
      ${turns
        .map(
          (turn) => `
            <div class="turn">
              <div class="turn-title">
                <span>Turn ${turn.turn}</span>
                <span class="turn-meta">block ${escapeHtml(turn.blockNumber || "?")} · ${escapeHtml(shortHash(turn.transactionHash, 8, 4))}</span>
              </div>
              <div class="move-list">
                ${(turn.moves || []).map((move) => renderMove(move, playerIndex)).join("") || '<span class="turn-meta">No decoded moves</span>'}
              </div>
            </div>
          `
        )
        .join("")}
    </section>
  `;

  const replayBtn = battleDetail.querySelector(".replay-btn");
  if (replayBtn) {
    replayBtn.addEventListener("click", () => runReplay(battle.battleKey, playerIndex));
  }
  emptyState.hidden = true;
  battleDetail.hidden = false;
}

async function runReplay(battleKey, viewerIdx) {
  const address = (historyPayload?.address || "").trim();
  if (!address) return;
  if (replayLoading.has(battleKey) || replayCache.has(battleKey)) return;
  replayLoading.add(battleKey);
  renderDetail();
  try {
    const query = new URLSearchParams({ address, battle: battleKey });
    const response = await fetch(`/api/replay?${query}`);
    const payload = await response.json();
    replayCache.set(battleKey, payload);
  } catch (err) {
    replayCache.set(battleKey, { ok: false, error: err.message });
  } finally {
    replayLoading.delete(battleKey);
    renderDetail();
  }
}

async function fetchHistory(event) {
  event.preventDefault();
  const address = addressInput.value.trim();
  const limit = limitInput.value || "30";
  const scanStarts = scanStartsInput.checked ? "true" : "false";
  const fromBlock = fromBlockInput.value.trim();
  const submit = form.querySelector("button");
  const submitText = submit.textContent;
  submit.disabled = true;
  submit.textContent = "Fetching...";
  setStatus("Fetching public chain data...");

  try {
    const query = new URLSearchParams({ address, limit, scanStarts, enrich: "true" });
    if (fromBlock) {
      query.set("fromBlock", fromBlock);
    }
    const response = await fetch(`/api/history?${query}`);
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    historyPayload = payload;
    selectedKey = payload.battles?.[0]?.battleKey || null;
    renderList();
    renderDetail();
    const warnings = payload.warnings?.length ? ` Warnings: ${payload.warnings.length}.` : "";
    setStatus(`Decoded ${payload.decodedBattles} battles from ${payload.discoveredBattles} discovered.${warnings}`);
    const url = new URL(window.location.href);
    url.searchParams.set("address", address);
    url.searchParams.set("limit", limit);
    url.searchParams.set("scanStarts", scanStarts);
    if (fromBlock) {
      url.searchParams.set("fromBlock", fromBlock);
    } else {
      url.searchParams.delete("fromBlock");
    }
    window.history.replaceState(null, "", url);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    submit.disabled = false;
    submit.textContent = submitText;
  }
}

form.addEventListener("submit", fetchHistory);

if (["1", "true", "yes"].includes((params.get("auto") || "").toLowerCase())) {
  form.requestSubmit();
}
