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
      <p class="decoder-note">
        Decoded on-chain move stream. Damage, status ticks, Q5 timers, and other applied effects are not replayed yet.
      </p>
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
    <section class="turns">
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
  emptyState.hidden = true;
  battleDetail.hidden = false;
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
