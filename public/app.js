const CREDENTIAL_KEY = "aiconnect-leaderboards-credential";
const NAME_KEY = "aiconnect-leaderboards-name";
const REFRESH_INTERVAL = 12000;

const state = {
  systems: [],
  votingOpen: false,
  credential: localStorage.getItem(CREDENTIAL_KEY),
  participantName: localStorage.getItem(NAME_KEY),
  currentVote: null,
  busy: false
};

const elements = {
  status: document.querySelector("#voting-status"),
  totalVotes: document.querySelector("#total-votes"),
  totalSystems: document.querySelector("#total-systems"),
  yourSelection: document.querySelector("#your-selection"),
  selectionNote: document.querySelector("#selection-note"),
  notice: document.querySelector("#notice"),
  participantForm: document.querySelector("#participant-form"),
  participantName: document.querySelector("#participant-name"),
  joinButton: document.querySelector("#join-button"),
  participantSummary: document.querySelector("#participant-summary"),
  participantDisplayName: document.querySelector("#participant-display-name"),
  participantAvatar: document.querySelector("#participant-avatar"),
  systemsList: document.querySelector("#systems-list"),
  leaderboardList: document.querySelector("#leaderboard-list")
};

elements.participantForm.addEventListener("submit", handleRegistration);
elements.systemsList.addEventListener("click", handleVoteClick);

async function initialize() {
  renderParticipant();
  await refreshData();
  if (state.credential) await refreshCurrentParticipant();
  window.setInterval(refreshData, REFRESH_INTERVAL);
}

async function refreshData() {
  try {
    const [statusResponse, leaderboardResponse] = await Promise.all([
      fetch("/api/status", { cache: "no-store" }),
      fetch("/api/leaderboard", { cache: "no-store" })
    ]);
    if (!statusResponse.ok || !leaderboardResponse.ok) throw new Error("Could not load voting data.");
    const status = await statusResponse.json();
    const leaderboard = await leaderboardResponse.json();
    state.votingOpen = Boolean(status.votingOpen);
    state.systems = Array.isArray(leaderboard.systems) ? leaderboard.systems : [];
    renderStatus();
    renderStats(leaderboard.totalVotes || 0);
    renderSystems();
    renderLeaderboard();
  } catch (error) {
    showNotice(error.message || "Could not refresh results. Check your connection and try again.", "error");
  }
}

async function refreshCurrentParticipant() {
  try {
    const response = await fetch("/api/me", {
      headers: { authorization: `Bearer ${state.credential}` },
      cache: "no-store"
    });
    if (response.status === 401) {
      clearParticipant();
      renderParticipant();
      showNotice("Your saved voting session is no longer valid. Join again to vote.", "error");
      return;
    }
    if (!response.ok) throw new Error("Could not load your saved vote.");
    const result = await response.json();
    state.participantName = result.participant.name;
    state.currentVote = result.vote ? result.vote.system_id : null;
    localStorage.setItem(NAME_KEY, state.participantName);
    renderParticipant();
    renderSystems();
    renderStats();
  } catch (error) {
    showNotice(error.message || "Could not load your saved vote.", "error");
  }
}

async function handleRegistration(event) {
  event.preventDefault();
  if (state.busy) return;
  const name = elements.participantName.value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 50) {
    showNotice("Enter a name between 2 and 50 characters.", "error");
    return;
  }
  state.busy = true;
  elements.joinButton.disabled = true;
  elements.joinButton.textContent = "Joining…";
  try {
    const response = await fetch("/api/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not register this name.");
    state.credential = result.credential;
    state.participantName = result.participant.name;
    state.currentVote = null;
    localStorage.setItem(CREDENTIAL_KEY, state.credential);
    localStorage.setItem(NAME_KEY, state.participantName);
    renderParticipant();
    renderSystems();
    renderStats();
    showNotice(`You're in, ${state.participantName}. Select a system below to cast your vote.`, "success");
  } catch (error) {
    showNotice(error.message || "Could not register. Please try again.", "error");
  } finally {
    state.busy = false;
    elements.joinButton.disabled = false;
    elements.joinButton.textContent = "Join voting";
  }
}

async function handleVoteClick(event) {
  const button = event.target.closest("[data-vote-system]");
  if (!button || button.disabled || state.busy) return;
  if (!state.credential) {
    elements.participantName.focus();
    showNotice("Enter your name and join voting before choosing a system.", "error");
    return;
  }
  if (!state.votingOpen) {
    showNotice("Voting is closed. You can still view the leaderboard.", "error");
    return;
  }
  const systemId = button.dataset.voteSystem;
  const system = state.systems.find(item => item.id === systemId);
  if (!system) return;
  const action = state.currentVote === systemId ? "keep your vote on" : state.currentVote ? "change your vote to" : "vote for";
  if (!window.confirm(`Do you want to ${action} "${system.name}"?`)) return;

  state.busy = true;
  renderSystems();
  try {
    const response = await fetch("/api/vote", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${state.credential}`
      },
      body: JSON.stringify({ systemId })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save your vote.");
    state.currentVote = result.vote.system_id;
    showNotice(`Your vote for ${system.name} has been saved.`, "success");
    await refreshData();
    renderStats();
  } catch (error) {
    showNotice(error.message || "Could not save your vote. Please try again.", "error");
    await refreshData();
  } finally {
    state.busy = false;
    renderSystems();
  }
}

function clearParticipant() {
  localStorage.removeItem(CREDENTIAL_KEY);
  localStorage.removeItem(NAME_KEY);
  state.credential = null;
  state.participantName = null;
  state.currentVote = null;
}

function renderParticipant() {
  const joined = Boolean(state.credential && state.participantName);
  elements.participantForm.hidden = joined;
  elements.participantSummary.hidden = !joined;
  if (joined) {
    elements.participantDisplayName.textContent = state.participantName;
    elements.participantAvatar.textContent = state.participantName.trim().charAt(0).toUpperCase();
  }
}

function renderStatus() {
  elements.status.textContent = state.votingOpen ? "Voting open" : "Voting closed";
  elements.status.classList.toggle("is-open", state.votingOpen);
  elements.status.classList.toggle("is-closed", !state.votingOpen);
}

function renderStats(totalVotes) {
  elements.totalVotes.textContent = String(totalVotes ?? state.systems.reduce((sum, system) => sum + system.votes, 0));
  elements.totalSystems.textContent = String(state.systems.length);
  const selected = state.systems.find(system => system.id === state.currentVote);
  elements.yourSelection.textContent = selected ? selected.name : "Not voted";
  elements.selectionNote.textContent = selected ? "Your current active vote" : state.credential ? "Choose a system below" : "Enter your name to participate";
}

function renderSystems() {
  if (state.systems.length === 0) {
    elements.systemsList.innerHTML = '<div class="empty-state"><strong>Team entries are coming soon.</strong>The voting list will appear here once the organizer adds the actual teams to <code>systems.csv</code>.</div>';
    return;
  }

  elements.systemsList.replaceChildren();
  for (const system of state.systems) {
    const card = document.createElement("article");
    card.className = `system-card${state.currentVote === system.id ? " is-selected" : ""}`;

    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = system.name;
    const description = document.createElement("p");
    description.textContent = system.description || "Team submission for the AIConnect bootcamp.";
    copy.append(title, description);

    const actions = document.createElement("div");
    actions.className = "system-actions";
    const count = document.createElement("span");
    count.className = "vote-count";
    count.textContent = `${system.votes} ${system.votes === 1 ? "vote" : "votes"}`;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.voteSystem = system.id;
    button.className = `button vote-button ${state.currentVote === system.id ? "is-current" : "button-quiet"}`;
    button.textContent = state.currentVote === system.id ? "Your vote ✓" : state.currentVote ? "Change vote" : "Vote";
    button.disabled = !state.credential || !state.votingOpen || state.busy;
    button.setAttribute("aria-label", `${state.currentVote === system.id ? "Current vote:" : "Vote for"} ${system.name}`);
    actions.append(count, button);
    card.append(copy, actions);
    elements.systemsList.append(card);
  }
}

function renderLeaderboard() {
  if (state.systems.length === 0) {
    elements.leaderboardList.innerHTML = '<li class="empty-state">The leaderboard will appear when team entries are added.</li>';
    return;
  }

  const maxVotes = Math.max(1, ...state.systems.map(system => system.votes));
  elements.leaderboardList.replaceChildren();
  for (const system of state.systems) {
    const item = document.createElement("li");
    item.className = "leaderboard-item";
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `#${system.rank}`;
    const detail = document.createElement("div");
    detail.className = "leaderboard-detail";
    const name = document.createElement("div");
    name.className = "leaderboard-name";
    name.textContent = system.name;
    const bar = document.createElement("div");
    bar.className = "vote-bar";
    const fill = document.createElement("span");
    fill.style.width = `${(system.votes / maxVotes) * 100}%`;
    bar.append(fill);
    detail.append(name, bar);
    const votes = document.createElement("span");
    votes.className = "leaderboard-votes";
    votes.textContent = `${system.votes} ${system.votes === 1 ? "vote" : "votes"}`;
    item.append(rank, detail, votes);
    elements.leaderboardList.append(item);
  }
}

function showNotice(message, type = "") {
  elements.notice.textContent = message;
  elements.notice.className = `notice${type ? ` is-${type}` : ""}`;
  elements.notice.hidden = false;
}

initialize();
