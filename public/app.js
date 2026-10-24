const CREDENTIAL_KEY = "aiconnect-leaderboards-credential";
const NAME_KEY = "aiconnect-leaderboards-name";
const REFRESH_INTERVAL = 12000;

const state = {
  systems: [],
  votingOpen: false,
  credential: localStorage.getItem(CREDENTIAL_KEY),
  participantName: localStorage.getItem(NAME_KEY),
  ratings: {},
  busySystemIds: new Set()
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
elements.systemsList.addEventListener("click", handleRatingClick);

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
    if (!statusResponse.ok || !leaderboardResponse.ok) throw new Error("Could not load rating data.");
    const status = await statusResponse.json();
    const leaderboard = await leaderboardResponse.json();
    state.votingOpen = Boolean(status.votingOpen);
    state.systems = Array.isArray(leaderboard.systems) ? leaderboard.systems : [];
    renderStatus();
    renderStats(leaderboard.totalRatings || 0);
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
      showNotice("Your saved rating session is no longer valid. Join again to rate systems.", "error");
      return;
    }
    if (!response.ok) throw new Error("Could not load your saved ratings.");
    const result = await response.json();
    state.participantName = result.participant.name;
    state.ratings = Object.fromEntries((result.ratings || []).map(item => [item.system_id, item.rating]));
    localStorage.setItem(NAME_KEY, state.participantName);
    renderParticipant();
    renderSystems();
    renderStats();
  } catch (error) {
    showNotice(error.message || "Could not load your saved ratings.", "error");
  }
}

async function handleRegistration(event) {
  event.preventDefault();
  const name = elements.participantName.value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 50) {
    showNotice("Enter a name between 2 and 50 characters.", "error");
    return;
  }
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
    state.ratings = {};
    localStorage.setItem(CREDENTIAL_KEY, state.credential);
    localStorage.setItem(NAME_KEY, state.participantName);
    renderParticipant();
    renderSystems();
    renderStats();
    showNotice(`You're in, ${state.participantName}. Rate each system below from 1 to 5.`, "success");
  } catch (error) {
    showNotice(error.message || "Could not register. Please try again.", "error");
  } finally {
    elements.joinButton.disabled = false;
    elements.joinButton.textContent = "Join voting";
  }
}

async function handleRatingClick(event) {
  const button = event.target.closest("[data-rating-system][data-rating]");
  if (!button || button.disabled) return;
  if (!state.credential) {
    elements.participantName.focus();
    showNotice("Enter your name and join before rating a system.", "error");
    return;
  }
  if (!state.votingOpen) {
    showNotice("Voting is closed. You can still view the leaderboard.", "error");
    return;
  }

  const systemId = button.dataset.ratingSystem;
  const rating = Number(button.dataset.rating);
  const system = state.systems.find(item => item.id === systemId);
  if (!system || !Number.isInteger(rating) || rating < 1 || rating > 5 || state.busySystemIds.has(systemId)) return;

  state.busySystemIds.add(systemId);
  renderSystems();
  try {
    const response = await fetch("/api/ratings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${state.credential}`
      },
      body: JSON.stringify({ systemId, rating })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save your rating.");
    state.ratings[systemId] = result.rating.rating;
    showNotice(`Your rating for ${system.name}: ${rating} out of 5 has been saved.`, "success");
    await refreshData();
    renderStats();
  } catch (error) {
    showNotice(error.message || "Could not save your rating. Please try again.", "error");
    await refreshData();
  } finally {
    state.busySystemIds.delete(systemId);
    renderSystems();
  }
}

function clearParticipant() {
  localStorage.removeItem(CREDENTIAL_KEY);
  localStorage.removeItem(NAME_KEY);
  state.credential = null;
  state.participantName = null;
  state.ratings = {};
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

function renderStats(totalRatings) {
  elements.totalVotes.textContent = String(totalRatings ?? state.systems.reduce((sum, system) => sum + system.ratingCount, 0));
  elements.totalSystems.textContent = String(state.systems.length);
  const ratedCount = Object.keys(state.ratings).length;
  elements.yourSelection.textContent = `${ratedCount} rated`;
  elements.selectionNote.textContent = state.credential
    ? `${ratedCount} of ${state.systems.length} systems rated by you`
    : "Enter your name to rate systems";
}

function renderSystems() {
  if (state.systems.length === 0) {
    elements.systemsList.innerHTML = '<div class="empty-state"><strong>Team entries are coming soon.</strong>The rating list will appear here once the organizer adds the actual teams to <code>systems.csv</code>.</div>';
    return;
  }

  elements.systemsList.replaceChildren();
  for (const system of state.systems) {
    const card = document.createElement("article");
    card.className = "system-card";

    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = system.name;
    const description = document.createElement("p");
    description.textContent = system.description || "Team submission for the AIConnect bootcamp.";
    const summary = document.createElement("p");
    summary.className = "system-rating-summary";
    summary.textContent = system.ratingCount
      ? `Average ${system.averageRating.toFixed(2)} / 5 · ${system.ratingCount} ${system.ratingCount === 1 ? "rating" : "ratings"}`
      : "No ratings yet";
    copy.append(title, description, summary);

    const actions = document.createElement("div");
    actions.className = "rating-actions";
    const ratingLabel = document.createElement("span");
    ratingLabel.className = "rating-label";
    const currentRating = state.ratings[system.id];
    ratingLabel.textContent = currentRating ? `Your rating: ${currentRating}/5` : "Rate 1–5";
    const scale = document.createElement("div");
    scale.className = "rating-scale";
    scale.setAttribute("role", "group");
    scale.setAttribute("aria-label", `Rate ${system.name} from 1 to 5`);

    for (let value = 1; value <= 5; value++) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.ratingSystem = system.id;
      button.dataset.rating = String(value);
      button.className = `rating-button${currentRating === value ? " is-current" : ""}`;
      button.textContent = String(value);
      button.setAttribute("aria-label", `${value} out of 5`);
      button.setAttribute("aria-pressed", String(currentRating === value));
      button.disabled = !state.credential || !state.votingOpen || state.busySystemIds.has(system.id);
      scale.append(button);
    }
    actions.append(ratingLabel, scale);
    card.append(copy, actions);
    elements.systemsList.append(card);
  }
}

function renderLeaderboard() {
  if (state.systems.length === 0) {
    elements.leaderboardList.innerHTML = '<li class="empty-state">The leaderboard will appear when team entries are added.</li>';
    return;
  }

  const maxAverage = Math.max(1, ...state.systems.map(system => system.averageRating));
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
    const meta = document.createElement("div");
    meta.className = "leaderboard-meta";
    meta.textContent = `${system.averageRating.toFixed(2)} / 5 · ${system.ratingCount} ${system.ratingCount === 1 ? "rating" : "ratings"} · ${system.totalPoints} points`;
    const bar = document.createElement("div");
    bar.className = "vote-bar";
    const fill = document.createElement("span");
    fill.style.width = `${(system.averageRating / maxAverage) * 100}%`;
    bar.append(fill);
    detail.append(name, meta, bar);
    const score = document.createElement("span");
    score.className = "leaderboard-votes";
    score.textContent = system.ratingCount ? system.averageRating.toFixed(2) : "—";
    item.append(rank, detail, score);
    elements.leaderboardList.append(item);
  }
}

function showNotice(message, type = "") {
  elements.notice.textContent = message;
  elements.notice.className = `notice${type ? ` is-${type}` : ""}`;
  elements.notice.hidden = false;
}

initialize();
