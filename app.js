// Core config
const STORAGE_KEY = "watch_party_state_v1";
const COOLDOWN_MS = 5000;

// --- Multi-device toggle ---
// Set USE_REMOTE = true to TRY Firebase multi-device mode.
// If Firebase isn't available, we automatically fall back to local mode.
const USE_REMOTE = true;
const ROOM_CODE = "demo-room";

// Sample starter lists
const SAMPLE_LISTS = [
  {
    id: "movie_plot",
    source: "sample",
    name: "Movie Night – Plot Twists",
    category: "Movie",
    events: [
      "Someone says “I have a bad feeling about this”",
      "Phone rings at the worst possible moment",
      "Jump scare or loud sting",
      "Villain explains their master plan",
      "Hero ignores obvious warning",
      "Car won’t start when they need it",
      "Dramatic slow clap",
      "Flashback explains hidden truth",
      "Character whispers “trust me”",
      "Plot twist reveals secret ally",
      "Someone dramatically drops a glass",
      "Fake-out death",
      "Surprise romance reveal"
    ]
  },
  {
    id: "nfl_game",
    source: "sample",
    name: "NFL – Sunday Chaos",
    category: "Sports",
    events: [
      "Field goal blocked",
      "Challenge flag thrown",
      "Coach slams headset",
      "Booth says “momentum shift”",
      "QB gets sacked",
      "Two-point conversion attempt",
      "Big one-handed catch",
      "Turnover in red zone",
      "Ref huddle lasts forever",
      "Broadcaster mentions fantasy football",
      "“This crowd is electric”",
      "Time-out right before a kick",
      "Trick play or flea flicker"
    ]
  },
  {
    id: "sitcom_bingo",
    source: "sample",
    name: "Sitcom – Laugh Track Bingo",
    category: "Series",
    events: [
      "Door slam for comedic effect",
      "Obvious studio audience laugh",
      "Spit-take or nearly spit drink",
      "Awkward silence after a joke",
      "Character enters to applause",
      "Catchphrase moment",
      "Someone storms out of the room",
      "Misunderstood conversation",
      "Someone hides in a closet or under bed",
      "“We need to talk” moment",
      "Group hug to end scene",
      "Cheesy freeze-frame",
      "Very special episode speech"
    ]
  }
];

// Local state (used in both local & remote modes)
let state = {
  hostName: "",
  players: [],          // {id,name,emoji}
  customLists: [],      // {id,name,category,events}
  currentList: null,    // {id,source}
  activePlayerId: null,
  scores: {},           // playerId -> number
  cooldowns: {},        // eventKey -> timestamp (local mode only)
  history: []           // {id,playerId,eventKey,label,time,points,vetoed}
};

// --- Remote (Firebase) helpers ---
let remotePlayerId = null;
let remoteEnabled = false; // becomes true only when Firebase is actually connected

// simple id generator
function generateId(prefix) {
  return prefix + "_" + Date.now() + "_" + Math.floor(Math.random() * 999999);
}

function joinRemoteRoomIfNeeded() {
  if (!USE_REMOTE) {
    remoteEnabled = false;
    return;
  }

  if (typeof firebase === "undefined" || typeof db === "undefined") {
    console.warn("Remote mode requested but Firebase is not available. Falling back to local-only.");
    remoteEnabled = false;
    return;
  }

  try {
    // Ask this device for a display name (once)
    let name = localStorage.getItem("watch_party_player_name") || "";
    if (!name) {
      name = prompt("Enter your name for this Watch Party:") || "Guest";
      name = name.trim() || "Guest";
      localStorage.setItem("watch_party_player_name", name);
    }

    // Random emoji for this device
    const emojis = ["🎮", "🍿", "🏈", "🎬", "😂", "🔥", "⭐", "🎧"];
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];

    // Device-specific player id
    remotePlayerId = localStorage.getItem("watch_party_player_id");
    if (!remotePlayerId) {
      remotePlayerId = generateId("p");
      localStorage.setItem("watch_party_player_id", remotePlayerId);
    }

    const roomRef = db.ref("rooms/" + ROOM_CODE);

    // Add / update this player
    roomRef.child("players/" + remotePlayerId).set({
      name,
      emoji
    });

    // Ensure this player has a score entry
    roomRef.child("scores/" + remotePlayerId).transaction((current) => {
      if (current === null || current === undefined) return 0;
      return current;
    });

    // --- Listen for shared state updates ---

    roomRef.child("players").on("value", (snap) => {
      const val = snap.val() || {};
      state.players = Object.entries(val).map(([id, p]) => ({
        id,
        name: p.name,
        emoji: p.emoji
      }));
      // Active player = this device
      state.activePlayerId = remotePlayerId;
      renderPlayersChips();
      renderPlayersList();
      renderProfileSummary();
    });

    roomRef.child("scores").on("value", (snap) => {
      state.scores = snap.val() || {};
      renderPlayersChips();
    });

    roomRef.child("history").on("value", (snap) => {
      const val = snap.val() || {};
      state.history = Object.entries(val).map(([id, a]) => ({
        id,
        ...a
      }));
      renderFeed();
    });

    remoteEnabled = true;
    console.log("Remote mode enabled for room:", ROOM_CODE);
  } catch (err) {
    console.warn("Error while joining remote room, falling back to local-only.", err);
    remoteEnabled = false;
  }
}

// ------- DOM refs -------

const screens = {
  setup: document.getElementById("screen-setup"),
  lists: document.getElementById("screen-lists"),
  game: document.getElementById("screen-game")
};

const hostNameInput = document.getElementById("hostNameInput");
const playerNameInput = document.getElementById("playerNameInput");
const playerAvatarSelect = document.getElementById("playerAvatarSelect");
const addPlayerBtn = document.getElementById("addPlayerBtn");
const playersList = document.getElementById("playersList");
const toListsBtn = document.getElementById("toListsBtn");

const profileSummary = document.getElementById("profileSummary");
const sampleListsEl = document.getElementById("sampleLists");
const customListsEl = document.getElementById("customLists");
const listNameInput = document.getElementById("listNameInput");
const listCategorySelect = document.getElementById("listCategorySelect");
const listEventsInput = document.getElementById("listEventsInput");
const saveListBtn = document.getElementById("saveListBtn");

const listsBackBtn = document.getElementById("listsBackBtn");
const gameBackToListsBtn = document.getElementById("gameBackToListsBtn");

const nowPlayingTitle = document.getElementById("nowPlayingTitle");
const nowPlayingMeta = document.getElementById("nowPlayingMeta");
const playersChips = document.getElementById("playersChips");
const resetScoresBtn = document.getElementById("resetScoresBtn");
const eventSearchInput = document.getElementById("eventSearchInput");
const eventsList = document.getElementById("eventsList");
const feedList = document.getElementById("feedList");
const vetoBtn = document.getElementById("vetoBtn");

const toastEl = document.getElementById("toast");

// ------- Storage helpers -------

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      state = Object.assign(state, parsed);
    }
  } catch (e) {
    console.warn("Failed to load state", e);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to save state", e);
  }
}

// ------- Utils -------

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 2100);
}

function setScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  const el = screens[name];
  if (el) el.classList.add("active");
}

function findListByRef(ref) {
  if (!ref) return null;
  if (ref.source === "sample") {
    return SAMPLE_LISTS.find((l) => l.id === ref.id) || null;
  }
  if (ref.source === "custom") {
    return state.customLists.find((l) => l.id === ref.id) || null;
  }
  return null;
}

function formatTime(t) {
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isRemoteActive() {
  return USE_REMOTE && remoteEnabled;
}

// ------- Render: players (setup) -------

function renderPlayersList() {
  playersList.innerHTML = "";
  if (!state.players.length) {
    const p = document.createElement("p");
    p.className = "subtle";
    if (isRemoteActive()) {
      p.textContent = `Multi-device: open this page on each phone to join room "${ROOM_CODE}".`;
    } else if (USE_REMOTE && !remoteEnabled) {
      p.textContent = "Cloud mode unavailable; using local hotseat. Add players below.";
    } else {
      p.textContent = "Add at least one player so we can track points.";
    }
    playersList.appendChild(p);
    return;
  }
  state.players.forEach((pl) => {
    const chip = document.createElement("div");
    chip.className = "player-chip";
    chip.dataset.id = pl.id;
    chip.innerHTML = `
      <span class="emoji">${pl.emoji}</span>
      <span>${pl.name}</span>
      <span class="remove" title="Remove">&times;</span>
    `;
    chip.addEventListener("click", (e) => {
      if (e.target.classList.contains("remove")) {
        if (isRemoteActive()) {
          showToast("Players are managed automatically in multi-device mode.");
        } else {
          removePlayer(pl.id);
        }
      } else {
        setActivePlayer(pl.id);
        setScreen("game");
      }
    });
    playersList.appendChild(chip);
  });
}

// ------- Render: profile summary -------

function renderProfileSummary() {
  const count = state.players.length;
  const name = state.hostName || "No host";
  if (!count) {
    if (isRemoteActive()) {
      profileSummary.textContent = `${name} • room "${ROOM_CODE}" • waiting for players`;
    } else {
      profileSummary.textContent = `${name} • no players yet`;
    }
  } else {
    if (isRemoteActive()) {
      profileSummary.textContent = `${name} • room "${ROOM_CODE}" • ${count} player${count > 1 ? "s" : ""}`;
    } else {
      profileSummary.textContent = `${name} • ${count} player${count > 1 ? "s" : ""}`;
    }
  }
}

// ------- Render: list cards -------

function buildListCard(list, source) {
  const card = document.createElement("div");
  card.className = "list-card";
  const main = document.createElement("div");
  main.className = "list-card-main";
  const title = document.createElement("h4");
  title.textContent = list.name;
  const meta = document.createElement("div");
  meta.className = "list-card-meta";
  meta.textContent = `${list.category} • ${list.events.length} events`;
  main.appendChild(title);
  main.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "list-card-actions";
  const loadBtn = document.createElement("button");
  loadBtn.className = "btn btn-primary small";
  loadBtn.textContent = "Load & play";
  loadBtn.addEventListener("click", () => {
    state.currentList = { id: list.id, source };
    state.cooldowns = {};
    state.history = [];
    saveState();
    renderGameScreen();
    setScreen("game");
    showToast(`Loaded: ${list.name}`);
  });
  actions.appendChild(loadBtn);

  if (source === "custom") {
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-ghost small";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => {
      if (!confirm("Delete this list?")) return;
      state.customLists = state.customLists.filter((l) => l.id !== list.id);
      if (state.currentList && state.currentList.id === list.id && state.currentList.source === "custom") {
        state.currentList = null;
      }
      saveState();
      renderListsScreen();
    });
    actions.appendChild(delBtn);
  }

  card.appendChild(main);
  card.appendChild(actions);
  return card;
}

function renderListsScreen() {
  // Sample lists
  sampleListsEl.innerHTML = "";
  SAMPLE_LISTS.forEach((list) => {
    sampleListsEl.appendChild(buildListCard(list, "sample"));
  });

  // Custom lists
  customListsEl.innerHTML = "";
  if (!state.customLists.length) {
    customListsEl.classList.add("empty-state");
    const p = document.createElement("p");
    p.className = "subtle";
    p.textContent = "No custom lists yet. Build one for your favorite show.";
    customListsEl.appendChild(p);
  } else {
    customListsEl.classList.remove("empty-state");
    state.customLists.forEach((list) => {
      customListsEl.appendChild(buildListCard(list, "custom"));
    });
  }

  renderProfileSummary();
}

// ------- Render: players bar in game -------

function renderPlayersChips() {
  playersChips.innerHTML = "";
  if (!state.players.length) {
    const p = document.createElement("p");
    p.className = "subtle";
    if (isRemoteActive()) {
      p.textContent = `Ask friends to open the same URL on their phones to join room "${ROOM_CODE}".`;
    } else if (USE_REMOTE && !remoteEnabled) {
      p.textContent = "Cloud mode unavailable; using local hotseat. Add players on the crew screen.";
    } else {
      p.textContent = "Add players on the crew screen to start scoring.";
    }
    playersChips.appendChild(p);
    return;
  }
  state.players.forEach((pl) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "player-chip";
    chip.dataset.id = pl.id;
    const isActive = pl.id === state.activePlayerId;
    if (isActive) chip.classList.add("active");
    const score = state.scores[pl.id] || 0;
    chip.innerHTML = `
      <span class="emoji">${pl.emoji}</span>
      <span>${pl.name}</span>
      <span class="score">${score}</span>
    `;
    chip.addEventListener("click", () => {
      setActivePlayer(pl.id);
    });
    playersChips.appendChild(chip);
  });
}

// ------- Render: events list -------

function getCurrentEvents() {
  const list = findListByRef(state.currentList);
  if (!list) return [];
  return list.events.map((label, idx) => {
    const eventKey = `${list.id}|${idx}`;
    return { key: eventKey, label };
  });
}

function renderEventsList() {
  eventsList.innerHTML = "";
  const events = getCurrentEvents();
  if (!events.length) {
    const p = document.createElement("p");
    p.className = "subtle";
    p.textContent = "No events for this list yet.";
    eventsList.appendChild(p);
    return;
  }
  const q = (eventSearchInput.value || "").toLowerCase();
  events
    .filter((ev) => ev.label.toLowerCase().includes(q))
    .forEach((ev) => {
      const card = document.createElement("button");
      card.className = "event-card";
      card.type = "button";
      card.dataset.key = ev.key;
      card.dataset.label = ev.label;

      const labelEl = document.createElement("div");
      labelEl.className = "event-card-label";
      labelEl.textContent = ev.label;

      const metaEl = document.createElement("div");
      metaEl.className = "event-card-meta";
      metaEl.innerHTML = `<span>Tap when it happens</span>`;

      card.appendChild(labelEl);
      card.appendChild(metaEl);

      card.addEventListener("click", () => handleEventTap(ev.key, ev.label, card));

      eventsList.appendChild(card);
    });
}

// ------- Render: feed -------

function renderFeed() {
  feedList.innerHTML = "";
  if (!state.history.length) {
    const li = document.createElement("li");
    li.className = "subtle";
    li.textContent = "No taps yet. First one to call something gets the point.";
    feedList.appendChild(li);
    vetoBtn.disabled = true;
    return;
  }
  vetoBtn.disabled = !state.history.some((a) => !a.vetoed);
  const recent = [...state.history].slice(-12).reverse();
  recent.forEach((a) => {
    const li = document.createElement("li");
    li.className = "feed-item";
    if (a.vetoed) li.classList.add("vetoed");
    const pl = state.players.find((p) => p.id === a.playerId);
    const name = pl ? pl.name : "Unknown";
    const emoji = pl ? pl.emoji : "❓";
    const main = document.createElement("div");
    main.className = "feed-main";
    const line = document.createElement("div");
    line.textContent = `${emoji} ${name} • ${a.label}`;
    const meta = document.createElement("div");
    meta.className = "feed-meta";
    const actionLabel = a.vetoed ? "VETO" : "Tap";
    meta.textContent = `${actionLabel} • ${formatTime(a.time)}`;
    main.appendChild(line);
    main.appendChild(meta);

    const pts = document.createElement("div");
    pts.className = "feed-points";
    pts.textContent = a.vetoed ? "−1" : "+1";

    li.appendChild(main);
    li.appendChild(pts);
    feedList.appendChild(li);
  });
}

// ------- Render: game screen -------

function renderGameScreen() {
  const list = findListByRef(state.currentList);
  if (!list) {
    nowPlayingTitle.textContent = "No list loaded";
    nowPlayingMeta.textContent = isRemoteActive()
      ? `Room "${ROOM_CODE}" • load a list to start.`
      : "";
  } else {
    nowPlayingTitle.textContent = list.name;
    nowPlayingMeta.textContent = `${list.category} • ${list.events.length} events`;
  }
  renderPlayersChips();
  renderEventsList();
  renderFeed();
}

// ------- Mutators -------

function ensureActivePlayer() {
  if (isRemoteActive() && remotePlayerId) {
    state.activePlayerId = remotePlayerId;
    return;
  }
  if (state.activePlayerId && state.players.some((p) => p.id === state.activePlayerId)) return;
  if (state.players.length) {
    state.activePlayerId = state.players[0].id;
  } else {
    state.activePlayerId = null;
  }
}

function setActivePlayer(id) {
  if (!state.players.some((p) => p.id === id)) return;
  state.activePlayerId = id;
  saveState();
  renderPlayersChips();
  showToast("Active player switched");
}

function addPlayer(name, emoji) {
  const n = name.trim();
  if (!n) {
    showToast("Enter a name for the player.");
    return;
  }
  const id = "p_" + Date.now() + "_" + Math.floor(Math.random() * 9999);
  state.players.push({ id, name: n, emoji });
  if (!state.scores[id]) state.scores[id] = 0;
  ensureActivePlayer();
  saveState();
  renderPlayersList();
}

function removePlayer(id) {
  state.players = state.players.filter((p) => p.id !== id);
  delete state.scores[id];
  if (state.activePlayerId === id) {
    state.activePlayerId = null;
    ensureActivePlayer();
  }
  saveState();
  renderPlayersList();
}

// ------- Event tap (local + remote) -------

function handleEventTap(eventKey, label, el) {
  // Remote: write tap to Firebase so all devices see it
  if (isRemoteActive() && remotePlayerId && typeof db !== "undefined") {
    const roomRef = db.ref("rooms/" + ROOM_CODE);
    const historyRef = roomRef.child("history");
    const scoresRef = roomRef.child("scores/" + remotePlayerId);

    const actionId = historyRef.push().key;
    const now = Date.now();
    const action = {
      playerId: remotePlayerId,
      eventKey,
      label,
      time: now,
      points: 1,
      vetoed: false
    };

    historyRef.child(actionId).set(action);
    scoresRef.transaction((current) => (current || 0) + 1);

    el.classList.add("pressed");
    setTimeout(() => {
      el.classList.remove("pressed");
    }, 220);

    showToast("You got it!");
    return;
  }

  // Local fallback
  if (!state.players.length) {
    showToast("Add at least one player first.");
    return;
  }
  ensureActivePlayer();
  if (!state.activePlayerId) {
    showToast("Choose who is tapping.");
    return;
  }
  const lastTs = state.cooldowns[eventKey];
  if (lastTs && Date.now() - lastTs < COOLDOWN_MS) {
    showToast("Locked for a moment so nobody can spam it.");
    return;
  }
  const action = {
    id: "a_" + Date.now() + "_" + Math.floor(Math.random() * 9999),
    playerId: state.activePlayerId,
    eventKey,
    label,
    time: Date.now(),
    points: 1,
    vetoed: false
  };
  state.history.push(action);
  state.cooldowns[eventKey] = action.time;
  state.scores[state.activePlayerId] = (state.scores[state.activePlayerId] || 0) + 1;
  saveState();

  el.classList.add("pressed", "cooling");
  setTimeout(() => {
    el.classList.remove("pressed");
  }, 220);
  setTimeout(() => {
    if (Date.now() - state.cooldowns[eventKey] >= COOLDOWN_MS) {
      const still = eventsList.querySelector(`.event-card[data-key="${eventKey}"]`);
      if (still) still.classList.remove("cooling");
    }
  }, COOLDOWN_MS + 100);

  renderPlayersChips();
  renderFeed();
  renderEventsList();
}

// ------- Veto last tap (local + remote) -------

function vetoLastTap() {
  if (isRemoteActive() && typeof db !== "undefined") {
    const roomRef = db.ref("rooms/" + ROOM_CODE);
    const historyRef = roomRef.child("history");

    historyRef.once("value").then((snap) => {
      const val = snap.val() || {};
      const entries = Object.entries(val);
      if (!entries.length) {
        showToast("No tap to veto.");
        return;
      }
      // sort by time and find last non-vetoed
      const sorted = entries.sort((a, b) => (a[1].time || 0) - (b[1].time || 0));
      const last = [...sorted].reverse().find(([, a]) => !a.vetoed);
      if (!last) {
        showToast("No tap to veto.");
        return;
      }
      const [actionId, action] = last;

      historyRef.child(actionId).child("vetoed").set(true);
      const scoreRef = roomRef.child("scores/" + action.playerId);
      scoreRef.transaction((current) => (current || 0) - 1);

      showToast("Last tap vetoed.");
    });
    return;
  }

  // Local behavior
  const lastTap = [...state.history].reverse().find((a) => !a.vetoed);
  if (!lastTap) {
    showToast("No tap to veto.");
    return;
  }
  lastTap.vetoed = true;
  const pid = lastTap.playerId;
  state.scores[pid] = (state.scores[pid] || 0) - 1;
  saveState();
  renderPlayersChips();
  renderFeed();
  showToast("Last tap vetoed. Point removed.");
}

function resetScores() {
  if (!state.players.length) return;

  if (isRemoteActive() && typeof db !== "undefined") {
    if (!confirm("Reset all scores for this room?")) return;
    const roomRef = db.ref("rooms/" + ROOM_CODE);
    roomRef.child("scores").set({});
    showToast("Scores reset for this room.");
    return;
  }

  if (!confirm("Reset all scores for this session?")) return;
  state.players.forEach((p) => {
    state.scores[p.id] = 0;
  });
  saveState();
  renderPlayersChips();
  showToast("Scores reset.");
}

function saveCustomList() {
  const name = listNameInput.value.trim();
  const cat = listCategorySelect.value.trim() || "Other";
  const raw = listEventsInput.value;
  const events = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (!name) {
    showToast("Give your list a name.");
    return;
  }
  if (!events.length) {
    showToast("Add at least one event.");
    return;
  }
  const list = {
    id: "c_" + Date.now() + "_" + Math.floor(Math.random() * 9999),
    source: "custom",
    name,
    category: cat,
    events
  };
  state.customLists.push(list);
  saveState();
  listNameInput.value = "";
  listEventsInput.value = "";
  renderListsScreen();
  showToast("List saved to this device.");
}

// ------- Init -------

function initFromState() {
  hostNameInput.value = state.hostName || "";

  const hintEl = document.querySelector(".field-hint");
  if (hintEl) {
    if (isRemoteActive()) {
      hintEl.textContent = `Multi-device: open this page on each phone to join room "${ROOM_CODE}".`;
    } else if (USE_REMOTE && !remoteEnabled) {
      hintEl.textContent = "Cloud mode unavailable; using local hotseat on this device.";
    } else {
      hintEl.textContent = "Hotseat: everyone shares this device.";
    }
  }

  renderPlayersList();
  renderListsScreen();
  ensureActivePlayer();
  renderGameScreen();
}

// ------- Event listeners -------

hostNameInput.addEventListener("input", () => {
  state.hostName = hostNameInput.value.trim();
  saveState();
  renderProfileSummary();
});

addPlayerBtn.addEventListener("click", () => {
  if (isRemoteActive()) {
    showToast("In multi-device mode, each phone is its own player. Just open this page on each device.");
    return;
  }
  addPlayer(playerNameInput.value, playerAvatarSelect.value);
  playerNameInput.value = "";
  playerNameInput.focus();
});

playerNameInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    if (isRemoteActive()) {
      showToast("In multi-device mode, each phone is its own player.");
      return;
    }
    addPlayer(playerNameInput.value, playerAvatarSelect.value);
    playerNameInput.value = "";
  }
});

toListsBtn.addEventListener("click", () => {
  if (!state.players.length && !isRemoteActive()) {
    showToast("Add at least one player first.");
    return;
  }
  setScreen("lists");
});

listsBackBtn.addEventListener("click", () => {
  setScreen("setup");
});

gameBackToListsBtn.addEventListener("click", () => {
  setScreen("lists");
});

saveListBtn.addEventListener("click", saveCustomList);

eventSearchInput.addEventListener("input", () => {
  renderEventsList();
});

vetoBtn.addEventListener("click", vetoLastTap);
resetScoresBtn.addEventListener("click", resetScores);

// ------- Boot -------

loadState();
initFromState();
joinRemoteRoomIfNeeded();
