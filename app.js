// Version & keys
const VERSION = "v0.9.6.35";

const STORAGE_KEY = "watch_party_state_v1";
const SAVED_GAMES_KEY = "watch_party_saved_games";
const TUTORIAL_KEY = "watch_party_tutorial_seen";
const THEME_KEY = "watch_party_theme";
const HAND_KEY = "watch_party_hand";
const MOTION_KEY = "watch_party_motion";

const COOLDOWN_MS = 5000;

// We TRY to use Firebase cloud mode. If it fails, we fall back to local hotseat.
const USE_REMOTE = true;

// Sample starter lists
const SAMPLE_LISTS = [
  // MOVIES
  {
    id: "movie_tropes",
    source: "sample",
    name: "Blockbuster – Movie Night Tropes",
    category: "Movie",
    events: [
      "Opening shot over a city skyline",
      "Someone says \"I have a bad feeling about this\"",
      "Phone rings at the worst possible moment",
      "Car won’t start when they need it",
      "Slow clap or sarcastic clap",
      "Villain explains their master plan",
      "Hero ignores an obvious warning",
      "Dramatic walk-away from an explosion",
      "Fake-out death or \"you thought I was gone\"",
      "End credits tease a sequel"
    ]
  },

  // LIVE SPORTS
  {
    id: "sports_nfl",
    source: "sample",
    name: "NFL – Sunday Chaos",
    category: "Sports",
    events: [
      "Field goal blocked",
      "Turnover in the red zone",
      "Coach slams headset or clipboard",
      "Challenge flag thrown",
      "Broadcaster says \"momentum shift\"",
      "QB gets sacked on 3rd down",
      "One-handed catch",
      "Flag on a huge play",
      "Time-out right before a kick",
      "Booth mentions fantasy football"
    ]
  },
  {
    id: "sports_nba",
    source: "sample",
    name: "NBA – Crunch Time Energy",
    category: "Sports",
    events: [
      "Fast-break dunk",
      "Player gets a technical foul",
      "Coach calls timeout after a big run",
      "Commentator says \"that’s a heat check\"",
      "Replay review for out-of-bounds or foul",
      "Crowd starts a loud chant",
      "3-pointer from way beyond the arc",
      "And-one free throw",
      "Someone complains about a no-call",
      "Announcer says \"this crowd is electric\""
    ]
  },

  // TV / SERIES
  {
    id: "tv_drama",
    source: "sample",
    name: "Prime Time Drama – Twist Watch",
    category: "Series",
    events: [
      "\"We need to talk\" moment",
      "Someone overhears a conversation they shouldn’t",
      "Flashback reveals missing information",
      "Character keeps a big secret from someone",
      "Cliffhanger right before a commercial break",
      "Text message changes everything",
      "Storm or blackout used for drama",
      "Someone dramatically walks out of a room",
      "Unexpected character shows up at the door",
      "Last line of the episode is a twist"
    ]
  },
  {
    id: "tv_sitcom",
    source: "sample",
    name: "Comfort Sitcom – Laugh Track Bingo",
    category: "Series",
    events: [
      "Door slam for comedic effect",
      "Obvious studio audience laugh",
      "Spit-take or almost spit drink",
      "Awkward silence after a joke",
      "Catchphrase moment",
      "Someone trips, falls, or bumps into something",
      "Misunderstood conversation causes chaos",
      "Someone hides in a closet or under a bed",
      "Group hug to end a scene",
      "Freeze-frame or cheesy final shot"
    ]
  },

  // OTHER / FAMILY / PARTY
  {
    id: "other_family",
    source: "sample",
    name: "Family Gathering – Chaos Mode",
    category: "Other",
    events: [
      "Someone brings up an old embarrassing story",
      "Two people talk over each other",
      "Awkward silence after a comment",
      "Someone disappears to \"check on the food\"",
      "Phone comes out to show a meme or video",
      "Family photo attempt takes way too long",
      "Someone says \"remember when…\"",
      "Food or drink is spilled",
      "Inside joke nobody explains to new people",
      "Conversation suddenly gets way too deep"
    ]
  }
];

// Local state (used in both local & remote modes)
let state = {
  hostName: "",
  roomCode: "",
  players: [],          // {id,name,emoji,team} - team can be null, "blue", or "red"
  customLists: [],      // {id,name,category,events}
  currentList: null,    // {id,source}
  activePlayerId: null,
  scores: {},           // playerId -> number
  cooldowns: {},        // eventKey -> timestamp (local mode only)
  history: [],          // {id,playerId,eventKey,label,time,points,vetoed}
  teamMode: false,      // whether team scoring is enabled
  rosterLocked: false,  // whether team assignments are finalized
  gamePaused: false     // whether scoring is paused (break time)
};

// Saved games storage
let savedGames = [];

// --- Remote (Firebase) helpers ---
let remotePlayerId = null;
let remoteEnabled = false; // becomes true only when Firebase is actually connected
let isRoomHost = false; // true if this device created/first joined the room
let roomHostId = null; // the player ID of the room host

// Tutorial state
let tutorialIndex = 0;
let tutorialTouchStartX = null;

// simple id generator
function generateId(prefix) {
  return prefix + "_" + Date.now() + "_" + Math.floor(Math.random() * 999999);
}

// short human room codes, e.g. "4FG9"
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoid confusing chars
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function getRoomCodeLabel() {
  return (state.roomCode || "").trim().toUpperCase();
}

function isRemoteActive() {
  return USE_REMOTE && remoteEnabled && !!getRoomCodeLabel();
}

function joinRemoteRoomIfNeeded() {
  if (!USE_REMOTE) {
    remoteEnabled = false;
    updateModeHint();
    return;
  }

  if (remoteEnabled) {
    showToast(`Already connected to room "${getRoomCodeLabel()}".`);
    return;
  }

  if (typeof firebase === "undefined" || typeof db === "undefined") {
    console.warn("Remote mode requested but Firebase is not available. Falling back to local-only.");
    remoteEnabled = false;
    updateModeHint();
    return;
  }

  const rawCode = getRoomCodeLabel();
  if (!rawCode) {
    showToast("Enter a room code first.");
    remoteEnabled = false;
    updateModeHint();
    return;
  }

  try {
    let name = localStorage.getItem("watch_party_player_name") || "";
    if (!name) {
      name = prompt("Enter your name for this Watch Party:") || "Guest";
      name = name.trim() || "Guest";
      localStorage.setItem("watch_party_player_name", name);
    }

    const emoji = ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)];

    remotePlayerId = localStorage.getItem("watch_party_player_id");
    if (!remotePlayerId) {
      remotePlayerId = generateId("p");
      localStorage.setItem("watch_party_player_id", remotePlayerId);
    }

    const roomRef = db.ref("rooms/" + rawCode);

    // Set up host tracking - first player becomes host
    roomRef.child("hostId").transaction((currentHost) => {
      if (currentHost === null) {
        return remotePlayerId;
      }
      return currentHost;
    }).then((result) => {
      isRoomHost = result.snapshot.val() === remotePlayerId;
      updateTeamModeUI();
    });

    // Listen for host changes
    roomRef.child("hostId").on("value", (snap) => {
      roomHostId = snap.val();
      isRoomHost = roomHostId === remotePlayerId;
      updateTeamModeUI();
      renderPlayersList();
      renderPlayersChips();
      renderTeamRoster();
    });

    roomRef.child("players/" + remotePlayerId).set({
      name,
      emoji,
      team: null
    });

    roomRef.child("scores/" + remotePlayerId).transaction((current) => {
      if (current === null || current === undefined) return 0;
      return current;
    });

    // Listen for player changes (including team assignments)
    roomRef.child("players").on("value", (snap) => {
      const val = snap.val() || {};
      state.players = Object.entries(val).map(([id, p]) => ({
        id,
        name: p.name,
        emoji: p.emoji,
        team: p.team || null
      }));
      state.activePlayerId = remotePlayerId;
      
      // Host auto-assigns teams to new players when Team Play is active
      if (isRoomHost && state.teamMode && !state.rosterLocked) {
        const playersWithoutTeam = state.players.filter(p => !p.team);
        if (playersWithoutTeam.length > 0) {
          let blueCount = state.players.filter(p => p.team === "blue").length;
          let redCount = state.players.filter(p => p.team === "red").length;
          
          playersWithoutTeam.forEach(pl => {
            const assignTeam = blueCount <= redCount ? "blue" : "red";
            roomRef.child("players/" + pl.id + "/team").set(assignTeam);
            if (assignTeam === "blue") blueCount++;
            else redCount++;
          });
        }
      }
      
      renderPlayersChips();
      renderPlayersList();
      renderProfileSummary();
      renderTeamRoster();
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

    // Listen for team settings changes
    roomRef.child("settings").on("value", (snap) => {
      const settings = snap.val() || {};
      state.teamMode = settings.teamMode || false;
      state.rosterLocked = settings.rosterLocked || false;
      state.gamePaused = settings.gamePaused || false;
      
      if (teamModeToggle) teamModeToggle.checked = state.teamMode;
      
      if (state.teamMode) {
        teamRosterSection.classList.remove("hidden");
        teamModeHint.textContent = "Blue vs Red: player scores combine into team totals.";
        if (state.rosterLocked) {
          teamRosterSection.classList.add("roster-locked");
          lockRosterBtn.textContent = "Unlock Roster";
        } else {
          teamRosterSection.classList.remove("roster-locked");
          lockRosterBtn.textContent = "Lock Roster";
        }
      } else {
        teamRosterSection.classList.add("hidden");
        teamModeHint.textContent = "Off: individual scores. On: Blue vs Red team scores.";
      }
      
      updatePauseUI();
      renderTeamRoster();
      renderPlayersChips();
    });

    remoteEnabled = true;
    console.log("Remote mode enabled for room:", rawCode);
    showToast(`Connected to cloud room "${rawCode}".`);
    updateModeHint();
  } catch (err) {
    console.warn("Error while joining remote room, falling back to local-only.", err);
    remoteEnabled = false;
    updateModeHint();
  }
}

// ------- DOM refs -------

const screens = {
  setup: document.getElementById("screen-setup"),
  lists: document.getElementById("screen-lists"),
  game: document.getElementById("screen-game"),
  parties: document.getElementById("screen-parties")
};

const bottomNav = document.getElementById("bottomNav");
const navSettingsBtn = document.getElementById("navSettingsBtn");
const navPartiesBtn = document.getElementById("navPartiesBtn");
const openPartiesList = document.getElementById("openPartiesList");
const pauseGameBtn = document.getElementById("pauseGameBtn");
const pauseBanner = document.getElementById("pauseBanner");
const partiesBackBtn = document.getElementById("partiesBackBtn");

const hostNameInput = document.getElementById("hostNameInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const roomConnectBtn = document.getElementById("roomConnectBtn");

const playersList = document.getElementById("playersList");
const toListsBtn = document.getElementById("toListsBtn");

// Setup tabs
const hostTabBtn = document.getElementById("hostTabBtn");
const partyTabBtn = document.getElementById("partyTabBtn");
const hostPanel = document.getElementById("hostPanel");
const partyPanel = document.getElementById("partyPanel");

// Party panel refs
const partyRoomCodeInput = document.getElementById("partyRoomCodeInput");
const partyConnectBtn = document.getElementById("partyConnectBtn");
const partyPlayerNameInput = document.getElementById("partyPlayerNameInput");
const partyAvatarBtn = document.getElementById("partyAvatarBtn");
const partyAvatarPreview = document.getElementById("partyAvatarPreview");
const partyTeamSection = document.getElementById("partyTeamSection");
const partyBlueTeamBtn = document.getElementById("partyBlueTeamBtn");
const partyRedTeamBtn = document.getElementById("partyRedTeamBtn");
const partyReadyBtn = document.getElementById("partyReadyBtn");
const waitingRoom = document.getElementById("waitingRoom");

// Settings avatar button
const chooseAvatarBtn = document.getElementById("chooseAvatarBtn");
const selectedAvatarPreview = document.getElementById("selectedAvatarPreview");

// Avatar modal refs
const avatarModal = document.getElementById("avatarModal");
const avatarGrid = document.getElementById("avatarGrid");
const avatarModalCloseBtn = document.getElementById("avatarModalCloseBtn");
const avatarSaveBtn = document.getElementById("avatarSaveBtn");

// All available emojis
const ALL_EMOJIS = ["🎮", "🍿", "🏈", "🎬", "😂", "🔥", "⭐", "🎧", "😺", "🦴", "🐕", "💅", "🦾", "💝", "💕", "💔", "👽", "🤖", "👾", "🫠", "😇", "😘", "🫣", "🤐", "🫥", "🤥", "😴", "🤒", "🤯", "🤠", "🥳", "🥸", "😭", "😱", "🦍", "🦝", "💤"];
let selectedAvatar = "🎮";

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
const versionFooter = document.getElementById("versionFooter");

// Settings & tutorial DOM refs
const settingsBtn = document.getElementById("settingsBtn");
const settingsOverlay = document.getElementById("settingsOverlay");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const settingsTutorialBtn = document.getElementById("settingsTutorialBtn");
const settingsThemeSelect = document.getElementById("settingsThemeSelect");
const settingsHandToggle = document.getElementById("settingsHandToggle");
const settingsMotionToggle = document.getElementById("settingsMotionToggle");

const tutorialOverlay = document.getElementById("tutorialOverlay");
const tutorialSlidesWrapper = document.getElementById("tutorialSlidesWrapper");
const tutorialSlides = document.querySelectorAll(".tutorial-slide");
const tutorialDots = document.querySelectorAll(".tutorial-dot");
const tutorialPrevBtn = document.getElementById("tutorialPrevBtn");
const tutorialNextBtn = document.getElementById("tutorialNextBtn");
const tutorialSkipBtn = document.getElementById("tutorialSkipBtn");

// Auth DOM refs
const googleSignInBtn = document.getElementById("googleSignInBtn");
const userInfoEl = document.getElementById("userInfo");
const userAvatarEl = document.getElementById("userAvatar");
const userNameEl = document.getElementById("userName");
const settingsUserInfo = document.getElementById("settingsUserInfo");
const settingsUserAvatar = document.getElementById("settingsUserAvatar");

const teamModeToggle = document.getElementById("teamModeToggle");
const teamModeHint = document.getElementById("teamModeHint");
const teamRosterSection = document.getElementById("teamRosterSection");
const blueTeamList = document.getElementById("blueTeamList");
const redTeamList = document.getElementById("redTeamList");
const lockRosterBtn = document.getElementById("lockRosterBtn");
const settingsUserName = document.getElementById("settingsUserName");
const settingsSignInBtn = document.getElementById("settingsSignInBtn");
const settingsSignOutBtn = document.getElementById("settingsSignOutBtn");

// Current user state
let currentUser = null;

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

function loadSavedGames() {
  try {
    const raw = localStorage.getItem(SAVED_GAMES_KEY);
    if (raw) {
      savedGames = JSON.parse(raw) || [];
    }
  } catch (e) {
    console.warn("Failed to load saved games", e);
    savedGames = [];
  }
}

function saveSavedGames() {
  try {
    localStorage.setItem(SAVED_GAMES_KEY, JSON.stringify(savedGames));
  } catch (e) {
    console.warn("Failed to save games list", e);
  }
}

function saveCurrentGame() {
  if (!state.currentList) return false;
  
  const list = findListByRef(state.currentList);
  if (!list) return false;
  
  const gameId = `game_${state.roomCode}_${Date.now()}`;
  const game = {
    id: gameId,
    roomCode: state.roomCode,
    listName: list.name,
    listRef: state.currentList,
    players: [...state.players],
    scores: {...state.scores},
    history: [...state.history],
    teamMode: state.teamMode,
    rosterLocked: state.rosterLocked,
    savedAt: Date.now()
  };
  
  const existingIdx = savedGames.findIndex(g => g.roomCode === state.roomCode);
  if (existingIdx >= 0) {
    savedGames[existingIdx] = game;
  } else {
    savedGames.unshift(game);
  }
  
  if (savedGames.length > 10) {
    savedGames = savedGames.slice(0, 10);
  }
  
  saveSavedGames();
  return true;
}

function loadSavedGame(gameId) {
  const game = savedGames.find(g => g.id === gameId);
  if (!game) {
    showToast("Game not found.");
    return;
  }
  
  state.roomCode = game.roomCode;
  state.currentList = game.listRef;
  state.players = game.players || [];
  state.scores = game.scores || {};
  state.history = game.history || [];
  state.teamMode = game.teamMode || false;
  state.rosterLocked = game.rosterLocked || false;
  state.gamePaused = false;
  
  saveState();
  
  if (roomCodeInput) roomCodeInput.value = state.roomCode;
  
  renderPlayersList();
  renderGameScreen();
  setScreen("game");
  // Silently resumed - no toast needed
}

function deleteSavedGame(gameId) {
  savedGames = savedGames.filter(g => g.id !== gameId);
  saveSavedGames();
  renderOpenParties();
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

let currentScreen = "setup";

function setScreen(name) {
  // Auto-save when leaving game screen
  if (currentScreen === "game" && name !== "game") {
    if (state.currentList && state.history.length > 0) {
      saveCurrentGame();
    }
  }
  
  currentScreen = name;
  
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  const el = screens[name];
  if (el) el.classList.add("active");
  
  updateBottomNav(name);
  
  if (name === "parties") {
    renderOpenParties();
  }
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

function formatRelativeTime(t) {
  const now = Date.now();
  const diff = now - t;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function updateBottomNav(screenName) {
  if (!bottomNav) return;
  
  bottomNav.querySelectorAll(".bottom-nav-btn").forEach(btn => {
    btn.classList.remove("active");
  });
  
  if (screenName === "parties" && navPartiesBtn) {
    navPartiesBtn.classList.add("active");
  }
}

function renderOpenParties() {
  if (!openPartiesList) return;
  
  openPartiesList.innerHTML = "";
  
  if (!savedGames.length) {
    const empty = document.createElement("div");
    empty.className = "empty-parties";
    empty.innerHTML = `
      <p class="subtle">No saved games yet.</p>
      <p class="subtle">Start a game and it will be saved automatically when you leave.</p>
    `;
    openPartiesList.appendChild(empty);
    return;
  }
  
  savedGames.forEach(game => {
    const card = document.createElement("div");
    card.className = "saved-game-card";
    
    const playerCount = (game.players || []).length;
    const eventCount = (game.history || []).filter(h => !h.vetoed).length;
    
    card.innerHTML = `
      <div class="saved-game-icon">
        <span class="icon-text">${eventCount}</span>
      </div>
      <div class="saved-game-info">
        <h4>${game.listName}</h4>
        <p class="subtle">${playerCount} player${playerCount !== 1 ? 's' : ''} | ${eventCount} event${eventCount !== 1 ? 's' : ''} logged</p>
        <p class="subtle">${formatRelativeTime(game.savedAt)}</p>
      </div>
      <div class="saved-game-actions">
        <button class="btn btn-primary small resume-btn" data-id="${game.id}">Resume</button>
        <button class="btn btn-ghost small delete-btn" data-id="${game.id}">Delete</button>
      </div>
    `;
    
    card.querySelector(".resume-btn").addEventListener("click", () => {
      loadSavedGame(game.id);
    });
    
    card.querySelector(".delete-btn").addEventListener("click", () => {
      if (confirm("Delete this saved game?")) {
        deleteSavedGame(game.id);
      }
    });
    
    openPartiesList.appendChild(card);
  });
}

function toggleGamePause() {
  if (isRemoteActive() && !isRoomHost) {
    showToast("Only the host can pause the game.");
    return;
  }
  
  state.gamePaused = !state.gamePaused;
  
  if (isRemoteActive()) {
    const rawCode = getRoomCodeLabel();
    db.ref("rooms/" + rawCode + "/settings/gamePaused").set(state.gamePaused);
  }
  
  updatePauseUI();
  saveState();
  
  if (state.gamePaused) {
    showToast("Game paused - scoring disabled");
  } else {
    showToast("Game resumed - scoring enabled");
  }
}

function updatePauseUI() {
  if (pauseGameBtn) {
    if (state.gamePaused) {
      pauseGameBtn.textContent = "Resume Game";
      pauseGameBtn.classList.add("paused");
    } else {
      pauseGameBtn.textContent = "Pause";
      pauseGameBtn.classList.remove("paused");
    }
    
    if (isRemoteActive() && !isRoomHost) {
      pauseGameBtn.style.display = "none";
    } else {
      pauseGameBtn.style.display = "";
    }
  }
  
  if (pauseBanner) {
    if (state.gamePaused) {
      pauseBanner.classList.remove("hidden");
    } else {
      pauseBanner.classList.add("hidden");
    }
  }
}

// Theme & layout

function applyTheme(theme) {
  const body = document.body;
  if (theme === "light") {
    body.classList.add("theme-light");
  } else {
    body.classList.remove("theme-light");
    theme = "dark";
  }
  localStorage.setItem(THEME_KEY, theme);
  if (settingsThemeSelect) settingsThemeSelect.value = theme;
}

function applyHandedness(mode) {
  const body = document.body;
  if (mode === "right") {
    body.classList.add("right-handed");
  } else {
    body.classList.remove("right-handed");
    mode = "left";
  }
  localStorage.setItem(HAND_KEY, mode);
  if (settingsHandToggle) settingsHandToggle.checked = mode === "right";
}

function applyMotion(reduced) {
  const body = document.body;
  if (reduced) {
    body.classList.add("reduce-motion");
  } else {
    body.classList.remove("reduce-motion");
  }
  localStorage.setItem(MOTION_KEY, reduced ? "1" : "0");
  if (settingsMotionToggle) settingsMotionToggle.checked = reduced;
}

function updateRoomCodeHeader() {
  // Room code header removed from UI
}

function updateModeHint() {
  const hintEl = document.querySelector(".field-hint");
  if (!hintEl) {
    updateRoomCodeHeader();
    return;
  }

  if (isRemoteActive()) {
    hintEl.textContent = `Multi-device: share this code and tap Connect on each phone to join "${getRoomCodeLabel()}".`;
  } else if (USE_REMOTE && !remoteEnabled && getRoomCodeLabel()) {
    hintEl.textContent = "Tap Connect to sync with other devices in this room.";
  } else if (USE_REMOTE && !remoteEnabled) {
    hintEl.textContent = "Choose a room code and tap Connect to play with others.";
  } else {
    hintEl.textContent = "Enter a room code and tap Connect to start.";
  }

  updateRoomCodeHeader();
}

// ------- Tutorial helpers -------

function hasSeenTutorial() {
  return localStorage.getItem(TUTORIAL_KEY) === "1";
}

function markTutorialSeen() {
  localStorage.setItem(TUTORIAL_KEY, "1");
}

function setTutorialSlide(idx) {
  const maxIndex = tutorialSlides.length - 1;
  tutorialIndex = Math.max(0, Math.min(idx, maxIndex));

  tutorialSlides.forEach((s, i) => {
    if (i === tutorialIndex) s.classList.add("active");
    else s.classList.remove("active");
  });

  tutorialDots.forEach((d, i) => {
    if (i === tutorialIndex) d.classList.add("active");
    else d.classList.remove("active");
  });

  if (tutorialIndex === 0) {
    tutorialPrevBtn.disabled = true;
  } else {
    tutorialPrevBtn.disabled = false;
  }

  if (tutorialIndex === maxIndex) {
    tutorialNextBtn.textContent = "Done";
  } else {
    tutorialNextBtn.textContent = "Next";
  }
}

function openTutorial(initial = false) {
  if (!tutorialOverlay) return;
  tutorialOverlay.classList.add("open");
  setTutorialSlide(0);
}

function closeTutorial(markSeen) {
  if (!tutorialOverlay) return;
  tutorialOverlay.classList.remove("open");
  if (markSeen) {
    markTutorialSeen();
  }
}

function maybeShowTutorial() {
  if (!hasSeenTutorial()) {
    openTutorial(true);
  }
}

// ------- Render: players (setup) -------

function renderPlayersList() {
  playersList.innerHTML = "";
  if (!state.players.length) {
    const p = document.createElement("p");
    p.className = "subtle";
    if (isRemoteActive()) {
      p.textContent = `Multi-device: friends who join room "${getRoomCodeLabel()}" will appear here.`;
    } else if (USE_REMOTE && !remoteEnabled) {
      p.textContent = "Tap Connect to join a room and start playing.";
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
    const isHostPlayer = isRemoteActive() && pl.id === roomHostId;
    const displayName = isHostPlayer ? `${pl.name} *` : pl.name;
    chip.innerHTML = `
      <span class="emoji">${pl.emoji}</span>
      <span>${displayName}</span>
      <span class="remove" title="Remove">&times;</span>
    `;
    chip.addEventListener("click", (e) => {
      if (e.target.classList.contains("remove")) {
        if (isRemoteActive()) {
          showToast("Players are managed automatically in multi-device mode.");
        } else {
          removePlayer(pl.id);
        }
      } else if (isRemoteActive() && pl.id === remotePlayerId) {
        // Clicking on your own chip opens avatar picker
        openAvatarModal(null);
      } else {
        setActivePlayer(pl.id);
        setScreen("game");
      }
    });
    playersList.appendChild(chip);
  });
}

// ------- Team Mode Functions -------

function updateTeamModeUI() {
  if (!teamModeToggle || !lockRosterBtn) return;
  
  if (isRemoteActive() && !isRoomHost) {
    teamModeToggle.disabled = true;
    lockRosterBtn.disabled = true;
    teamModeHint.textContent = state.teamMode 
      ? "Blue vs Red mode (host controls settings)."
      : "Off: individual scores. Host can enable Team Play.";
  } else {
    teamModeToggle.disabled = false;
    lockRosterBtn.disabled = false;
  }
}

function toggleTeamMode(enabled) {
  // In remote mode, only host can toggle
  if (isRemoteActive() && !isRoomHost) {
    showToast("Only the host can change Team Play settings.");
    if (teamModeToggle) teamModeToggle.checked = state.teamMode;
    return;
  }
  
  state.teamMode = enabled;
  state.rosterLocked = false;
  
  if (isRemoteActive()) {
    // Write settings to Firebase
    const rawCode = getRoomCodeLabel();
    const roomRef = db.ref("rooms/" + rawCode);
    roomRef.child("settings").set({
      teamMode: enabled,
      rosterLocked: false
    });
    
    // Auto-assign teams and write to Firebase
    if (enabled) {
      state.players.forEach((pl, idx) => {
        if (!pl.team) {
          const newTeam = idx % 2 === 0 ? "blue" : "red";
          roomRef.child("players/" + pl.id + "/team").set(newTeam);
        }
      });
    } else {
      state.players.forEach((pl) => {
        roomRef.child("players/" + pl.id + "/team").set(null);
      });
    }
  } else {
    // Local mode behavior
    if (enabled) {
      teamRosterSection.classList.remove("hidden");
      teamRosterSection.classList.remove("roster-locked");
      teamModeHint.textContent = "Blue vs Red: player scores combine into team totals.";
      state.players.forEach((pl, idx) => {
        if (!pl.team) {
          pl.team = idx % 2 === 0 ? "blue" : "red";
        }
      });
    } else {
      teamRosterSection.classList.add("hidden");
      teamModeHint.textContent = "Off: individual scores. On: Blue vs Red team scores.";
      state.players.forEach((pl) => {
        pl.team = null;
      });
    }
    
    saveState();
    renderTeamRoster();
    renderPlayersList();
    renderPlayersChips();
  }
}

function renderTeamRoster() {
  if (!blueTeamList || !redTeamList) return;
  
  blueTeamList.innerHTML = "";
  redTeamList.innerHTML = "";
  
  const bluePlayers = state.players.filter(p => p.team === "blue");
  const redPlayers = state.players.filter(p => p.team === "red");
  
  bluePlayers.forEach(pl => {
    const chip = document.createElement("div");
    chip.className = "team-player-chip";
    if (canEditTeam(pl.id)) {
      chip.classList.add("editable");
    }
    const isHostPlayer = isRemoteActive() && pl.id === roomHostId;
    const displayName = isHostPlayer ? `${pl.name} *` : pl.name;
    chip.innerHTML = `<span class="emoji">${pl.emoji}</span><span>${displayName}</span>`;
    chip.addEventListener("click", () => switchPlayerTeam(pl.id));
    blueTeamList.appendChild(chip);
  });
  
  redPlayers.forEach(pl => {
    const chip = document.createElement("div");
    chip.className = "team-player-chip";
    if (canEditTeam(pl.id)) {
      chip.classList.add("editable");
    }
    const isHostPlayer = isRemoteActive() && pl.id === roomHostId;
    const displayName = isHostPlayer ? `${pl.name} *` : pl.name;
    chip.innerHTML = `<span class="emoji">${pl.emoji}</span><span>${displayName}</span>`;
    chip.addEventListener("click", () => switchPlayerTeam(pl.id));
    redTeamList.appendChild(chip);
  });
  
  if (!bluePlayers.length) {
    blueTeamList.innerHTML = '<p class="subtle" style="font-size:0.75rem;margin:0;">No players</p>';
  }
  if (!redPlayers.length) {
    redTeamList.innerHTML = '<p class="subtle" style="font-size:0.75rem;margin:0;">No players</p>';
  }
  
  // Update hint text based on context
  const hintEl = document.querySelector(".team-switch-hint");
  if (hintEl) {
    if (state.rosterLocked) {
      hintEl.textContent = "Roster is locked. Host can unlock to allow team changes.";
    } else if (isRemoteActive() && !isRoomHost) {
      hintEl.textContent = "Tap your name to switch teams.";
    } else {
      hintEl.textContent = "Tap a player to switch teams before locking the roster.";
    }
  }
}

function canEditTeam(playerId) {
  if (state.rosterLocked) return false;
  if (!isRemoteActive()) return true;
  if (isRoomHost) return true;
  return playerId === remotePlayerId;
}

function switchPlayerTeam(playerId) {
  if (state.rosterLocked) {
    showToast("Roster is locked. Ask the host to unlock.");
    return;
  }
  
  if (!canEditTeam(playerId)) {
    showToast("You can only switch your own team.");
    return;
  }
  
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;
  
  const newTeam = player.team === "blue" ? "red" : "blue";
  
  if (isRemoteActive()) {
    const rawCode = getRoomCodeLabel();
    db.ref("rooms/" + rawCode + "/players/" + playerId + "/team").set(newTeam);
  } else {
    player.team = newTeam;
    saveState();
    renderTeamRoster();
    renderPlayersList();
  }
  
  showToast(`${player.name} moved to ${newTeam === "blue" ? "Blue" : "Red"} Team`);
}

function toggleRosterLock() {
  // In remote mode, only host can lock/unlock roster
  if (isRemoteActive() && !isRoomHost) {
    showToast("Only the host can lock/unlock the roster.");
    return;
  }
  
  const newLocked = !state.rosterLocked;
  
  if (isRemoteActive()) {
    const rawCode = getRoomCodeLabel();
    db.ref("rooms/" + rawCode + "/settings/rosterLocked").set(newLocked);
  } else {
    state.rosterLocked = newLocked;
    if (state.rosterLocked) {
      teamRosterSection.classList.add("roster-locked");
      lockRosterBtn.textContent = "Unlock Roster";
    } else {
      teamRosterSection.classList.remove("roster-locked");
      lockRosterBtn.textContent = "Lock Roster";
    }
    saveState();
    renderTeamRoster();
  }
  
  showToast(newLocked ? "Roster locked! Teams are set." : "Roster unlocked. You can switch teams.");
}

function getTeamScores() {
  let blueScore = 0;
  let redScore = 0;
  
  state.players.forEach(pl => {
    const score = state.scores[pl.id] || 0;
    if (pl.team === "blue") {
      blueScore += score;
    } else if (pl.team === "red") {
      redScore += score;
    }
  });
  
  return { blue: blueScore, red: redScore };
}

// ------- Render: profile summary -------

function renderProfileSummary() {
  const count = state.players.length;
  const name = state.hostName || "No host";
  const code = getRoomCodeLabel();
  if (!count) {
    if (isRemoteActive()) {
      profileSummary.textContent = `${name} • room "${code}" • waiting for players`;
    } else if (code) {
      profileSummary.textContent = `${name} • room "${code}" • no players yet`;
    } else {
      profileSummary.textContent = `${name} • no players yet`;
    }
  } else {
    if (isRemoteActive()) {
      profileSummary.textContent = `${name} • room "${code}" • ${count} player${count > 1 ? "s" : ""}`;
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
  loadBtn.addEventListener("click", async () => {
    state.currentList = { id: list.id, source };
    state.cooldowns = {};
    state.history = [];
    saveState();
    renderGameScreen();
    setScreen("game");
    
    // Signal game started to party players
    if (isRemoteActive()) {
      const rawCode = getRoomCodeLabel();
      await db.ref("rooms/" + rawCode + "/settings").update({
        gameStarted: true,
        currentListId: list.id,
        currentListSource: source
      });
    }
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
  sampleListsEl.innerHTML = "";
  SAMPLE_LISTS.forEach((list) => {
    sampleListsEl.appendChild(buildListCard(list, "sample"));
  });

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
  
  if (state.teamMode && state.players.length) {
    const teamScores = getTeamScores();
    const teamBar = document.createElement("div");
    teamBar.className = "team-scores-bar";
    teamBar.innerHTML = `
      <div class="team-score-card blue">
        <span>Blue Team</span>
        <span class="team-score-value">${teamScores.blue}</span>
      </div>
      <div class="team-score-card red">
        <span>Red Team</span>
        <span class="team-score-value">${teamScores.red}</span>
      </div>
    `;
    playersChips.appendChild(teamBar);
  }
  
  if (!state.players.length) {
    const p = document.createElement("p");
    p.className = "subtle";
    if (isRemoteActive()) {
      p.textContent = `Ask friends to join room "${getRoomCodeLabel()}" to appear here.`;
    } else if (USE_REMOTE && !remoteEnabled) {
      p.textContent = "Tap Connect to join a room, then add players on the crew screen.";
    } else {
      p.textContent = "Add players on the crew screen to start scoring.";
    }
    playersChips.appendChild(p);
    return;
  }
  
  const chipsContainer = document.createElement("div");
  chipsContainer.className = "chips-row";
  
  state.players.forEach((pl) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "player-chip";
    chip.dataset.id = pl.id;
    const isActive = pl.id === state.activePlayerId;
    if (isActive) chip.classList.add("active");
    if (state.teamMode && pl.team) {
      chip.classList.add(`team-${pl.team}-indicator`);
    }
    const score = state.scores[pl.id] || 0;
    const isHostPlayer = isRemoteActive() && pl.id === roomHostId;
    const displayName = isHostPlayer ? `${pl.name} *` : pl.name;
    chip.innerHTML = `
      <span class="emoji">${pl.emoji}</span>
      <span>${displayName}</span>
      <span class="score">${score}</span>
    `;
    chip.addEventListener("click", () => {
      setActivePlayer(pl.id);
    });
    chipsContainer.appendChild(chip);
  });
  
  playersChips.appendChild(chipsContainer);
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
    const isHostPlayer = isRemoteActive() && a.playerId === roomHostId;
    const baseName = pl ? pl.name : "Unknown";
    const name = isHostPlayer ? `${baseName} *` : baseName;
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
  const code = getRoomCodeLabel();
  if (!list) {
    nowPlayingTitle.textContent = "No list loaded";
    nowPlayingMeta.textContent = isRemoteActive() && code
      ? `Room "${code}" • load a list to start.`
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
  const team = state.teamMode ? (state.players.length % 2 === 0 ? "blue" : "red") : null;
  state.players.push({ id, name: n, emoji, team });
  if (!state.scores[id]) state.scores[id] = 0;
  state.activePlayerId = id;
  saveState();
  renderPlayersList();
  renderPlayersChips();
  showToast(`${n} added and selected`);
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
  // Check if game is paused
  if (state.gamePaused) {
    showToast("Game is paused - wait for the host to resume.");
    return;
  }
  
  // Check cooldown (applies to both local and remote)
  const lastTs = state.cooldowns[eventKey];
  if (lastTs && Date.now() - lastTs < COOLDOWN_MS) {
    showToast("Wait a moment before tapping again.");
    return;
  }
  
  // Remote: write tap to Firebase so all devices in this room see it
  if (isRemoteActive() && remotePlayerId && typeof db !== "undefined") {
    const roomRef = db.ref("rooms/" + getRoomCodeLabel());
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
    
    // Set local cooldown
    state.cooldowns[eventKey] = now;

    el.classList.add("pressed", "cooling");
    setTimeout(() => {
      el.classList.remove("pressed");
    }, 220);
    setTimeout(() => {
      if (Date.now() - state.cooldowns[eventKey] >= COOLDOWN_MS) {
        el.classList.remove("cooling");
      }
    }, COOLDOWN_MS + 100);

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
  saveCurrentGame(); // Auto-save after each event

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
    // Only host can veto in remote mode
    if (!isRoomHost) {
      showToast("Only the host can veto points.");
      return;
    }
    
    const roomRef = db.ref("rooms/" + getRoomCodeLabel());
    const historyRef = roomRef.child("history");

    historyRef.once("value").then((snap) => {
      const val = snap.val() || {};
      const entries = Object.entries(val);
      if (!entries.length) {
        showToast("No tap to veto.");
        return;
      }
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
    if (!confirm("Reset all scores and events for this room?")) return;
    const roomRef = db.ref("rooms/" + getRoomCodeLabel());
    roomRef.child("scores").set({});
    roomRef.child("history").set({});
    showToast("Scores and events reset for this room.");
    return;
  }

  if (!confirm("Reset all scores and events for this session?")) return;
  state.players.forEach((p) => {
    state.scores[p.id] = 0;
  });
  state.history = [];
  state.cooldowns = {};
  saveState();
  renderPlayersChips();
  renderFeed();
  renderEventsList();
  showToast("Scores and events reset.");
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

function applySavedPreferences() {
  const theme = localStorage.getItem(THEME_KEY) || "dark";
  const hand = localStorage.getItem(HAND_KEY) || "left";
  const motion = localStorage.getItem(MOTION_KEY) === "1";

  applyTheme(theme);
  applyHandedness(hand);
  applyMotion(motion);

  if (versionFooter) {
    versionFooter.textContent = `Watch Party ${VERSION}`;
  }
}

function initFromState() {
  hostNameInput.value = state.hostName || "";

  if (!state.roomCode && USE_REMOTE) {
    state.roomCode = generateRoomCode();
    saveState();
  }
  roomCodeInput.value = getRoomCodeLabel();

  if (teamModeToggle) {
    teamModeToggle.checked = state.teamMode || false;
    if (state.teamMode) {
      teamRosterSection.classList.remove("hidden");
      teamModeHint.textContent = "Blue vs Red: player scores combine into team totals.";
      if (state.rosterLocked) {
        teamRosterSection.classList.add("roster-locked");
        if (lockRosterBtn) lockRosterBtn.textContent = "Unlock Roster";
      }
    }
    renderTeamRoster();
  }

  updateModeHint();
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

roomCodeInput.addEventListener("input", () => {
  const val = (roomCodeInput.value || "").toUpperCase();
  roomCodeInput.value = val;
  state.roomCode = val.trim();
  saveState();
  updateModeHint();
});

roomConnectBtn.addEventListener("click", () => {
  const val = (roomCodeInput.value || "").trim().toUpperCase();
  if (!val) {
    showToast("Enter a room code first.");
    return;
  }
  state.roomCode = val;
  saveState();
  joinRemoteRoomIfNeeded();
});


// Avatar modal functions
let currentAvatarTarget = null;

function openAvatarModal(targetPreview) {
  currentAvatarTarget = targetPreview || selectedAvatarPreview;
  const currentEmoji = currentAvatarTarget ? currentAvatarTarget.textContent : selectedAvatar;
  
  avatarGrid.innerHTML = "";
  ALL_EMOJIS.forEach(emoji => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "avatar-option";
    if (emoji === currentEmoji) {
      option.classList.add("selected");
    }
    option.textContent = emoji;
    option.addEventListener("click", () => {
      avatarGrid.querySelectorAll(".avatar-option").forEach(o => o.classList.remove("selected"));
      option.classList.add("selected");
    });
    avatarGrid.appendChild(option);
  });
  avatarModal.classList.add("open");
}

function closeAvatarModal() {
  avatarModal.classList.remove("open");
  currentAvatarTarget = null;
}

function saveAvatarSelection() {
  const selected = avatarGrid.querySelector(".avatar-option.selected");
  if (selected) {
    selectedAvatar = selected.textContent;
    
    if (currentAvatarTarget) {
      currentAvatarTarget.textContent = selectedAvatar;
    }
    
    // Update all avatar previews
    if (partyAvatarPreview) partyAvatarPreview.textContent = selectedAvatar;
    if (selectedAvatarPreview) selectedAvatarPreview.textContent = selectedAvatar;
    
    // If in remote mode, update Firebase and re-render
    if (isRemoteActive() && remotePlayerId) {
      const rawCode = getRoomCodeLabel();
      db.ref("rooms/" + rawCode + "/players/" + remotePlayerId + "/emoji").set(selectedAvatar);
      showToast("Avatar updated!");
    }
  }
  closeAvatarModal();
}

// Avatar button listeners
if (chooseAvatarBtn) {
  chooseAvatarBtn.addEventListener("click", () => openAvatarModal(selectedAvatarPreview));
}
if (partyAvatarBtn) {
  partyAvatarBtn.addEventListener("click", () => openAvatarModal(partyAvatarPreview));
}

avatarModalCloseBtn.addEventListener("click", closeAvatarModal);
avatarSaveBtn.addEventListener("click", saveAvatarSelection);
avatarModal.addEventListener("click", (e) => {
  if (e.target === avatarModal) {
    closeAvatarModal();
  }
});

// Setup tab switching
function switchSetupTab(tab) {
  if (tab === "host") {
    hostTabBtn.classList.add("active");
    partyTabBtn.classList.remove("active");
    hostPanel.classList.add("active");
    partyPanel.classList.remove("active");
  } else {
    hostTabBtn.classList.remove("active");
    partyTabBtn.classList.add("active");
    hostPanel.classList.remove("active");
    partyPanel.classList.add("active");
  }
}

if (hostTabBtn) {
  hostTabBtn.addEventListener("click", () => switchSetupTab("host"));
}
if (partyTabBtn) {
  partyTabBtn.addEventListener("click", () => switchSetupTab("party"));
}

// Party panel: join room
let partyPlayerTeam = "blue";
let partyConnected = false;

if (partyConnectBtn) {
  partyConnectBtn.addEventListener("click", async () => {
    const code = partyRoomCodeInput.value.trim().toUpperCase();
    if (!code) {
      showToast("Enter a room code first.");
      return;
    }
    
    state.roomCode = code;
    roomCodeInput.value = code;
    saveState();
    await joinRemoteRoomIfNeeded();
    
    if (remoteEnabled) {
      partyConnected = true;
      showToast(`Joined room "${code}"!`);
      
      // Check if team mode is enabled
      const rawCode = getRoomCodeLabel();
      const settingsSnap = await db.ref("rooms/" + rawCode + "/settings").once("value");
      const settings = settingsSnap.val() || {};
      if (settings.teamMode) {
        partyTeamSection.classList.remove("hidden");
      }
    }
  });
}

// Party team selection
if (partyBlueTeamBtn) {
  partyBlueTeamBtn.addEventListener("click", () => {
    partyPlayerTeam = "blue";
    partyBlueTeamBtn.classList.add("selected");
    partyRedTeamBtn.classList.remove("selected");
  });
}
if (partyRedTeamBtn) {
  partyRedTeamBtn.addEventListener("click", () => {
    partyPlayerTeam = "red";
    partyRedTeamBtn.classList.add("selected");
    partyBlueTeamBtn.classList.remove("selected");
  });
}

// Party ready button
if (partyReadyBtn) {
  partyReadyBtn.addEventListener("click", async () => {
    const name = partyPlayerNameInput.value.trim();
    if (!name) {
      showToast("Enter your name first.");
      return;
    }
    
    if (!partyConnected) {
      showToast("Join a room first.");
      return;
    }
    
    // Update player name in Firebase
    const rawCode = getRoomCodeLabel();
    if (remotePlayerId) {
      await db.ref("rooms/" + rawCode + "/players/" + remotePlayerId).update({
        name: name,
        emoji: selectedAvatar,
        team: partyPlayerTeam
      });
    }
    
    // Show waiting room
    waitingRoom.classList.remove("hidden");
    showToast("You're ready! Waiting for host...");
    
    // Listen for game start
    db.ref("rooms/" + rawCode + "/settings/gameStarted").on("value", (snap) => {
      if (snap.val() === true) {
        waitingRoom.classList.add("hidden");
        setScreen("game");
      }
    });
  });
}

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

gameBackToListsBtn.addEventListener("click", async () => {
  setScreen("lists");
  if (state.currentList && state.history.length > 0) {
    showToast("Game saved");
  }
  
  // Reset game started flag for party players
  if (isRemoteActive()) {
    const rawCode = getRoomCodeLabel();
    await db.ref("rooms/" + rawCode + "/settings").update({
      gameStarted: false
    });
  }
});

saveListBtn.addEventListener("click", saveCustomList);

eventSearchInput.addEventListener("input", () => {
  renderEventsList();
});

vetoBtn.addEventListener("click", vetoLastTap);
resetScoresBtn.addEventListener("click", resetScores);

teamModeToggle.addEventListener("change", () => {
  toggleTeamMode(teamModeToggle.checked);
});

lockRosterBtn.addEventListener("click", toggleRosterLock);

if (pauseGameBtn) {
  pauseGameBtn.addEventListener("click", toggleGamePause);
}

if (navSettingsBtn) {
  navSettingsBtn.addEventListener("click", () => {
    settingsOverlay.classList.add("open");
  });
}

if (navPartiesBtn) {
  navPartiesBtn.addEventListener("click", () => {
    setScreen("parties");
  });
}

if (partiesBackBtn) {
  partiesBackBtn.addEventListener("click", () => {
    setScreen("setup");
  });
}

// Settings UI
settingsBtn.addEventListener("click", () => {
  settingsOverlay.classList.add("open");
});

settingsCloseBtn.addEventListener("click", () => {
  settingsOverlay.classList.remove("open");
});

settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) {
    settingsOverlay.classList.remove("open");
  }
});

settingsThemeSelect.addEventListener("change", () => {
  applyTheme(settingsThemeSelect.value);
});

settingsHandToggle.addEventListener("change", () => {
  applyHandedness(settingsHandToggle.checked ? "right" : "left");
});

settingsMotionToggle.addEventListener("change", () => {
  applyMotion(settingsMotionToggle.checked);
});

settingsTutorialBtn.addEventListener("click", () => {
  settingsOverlay.classList.remove("open");
  openTutorial(false);
});

// Tutorial UI
tutorialNextBtn.addEventListener("click", () => {
  const maxIndex = tutorialSlides.length - 1;
  if (tutorialIndex < maxIndex) {
    setTutorialSlide(tutorialIndex + 1);
  } else {
    closeTutorial(true);
  }
});

tutorialPrevBtn.addEventListener("click", () => {
  setTutorialSlide(tutorialIndex - 1);
});

tutorialSkipBtn.addEventListener("click", () => {
  closeTutorial(true);
});

tutorialDots.forEach((dot) => {
  dot.addEventListener("click", () => {
    const idx = parseInt(dot.dataset.index, 10) || 0;
    setTutorialSlide(idx);
  });
});

// Swipe emulation for tutorial
if (tutorialSlidesWrapper) {
  tutorialSlidesWrapper.addEventListener("touchstart", (e) => {
    if (!e.touches || !e.touches.length) return;
    tutorialTouchStartX = e.touches[0].clientX;
  });

  tutorialSlidesWrapper.addEventListener("touchend", (e) => {
    if (tutorialTouchStartX === null) return;
    const dx = e.changedTouches[0].clientX - tutorialTouchStartX;
    tutorialTouchStartX = null;
    const threshold = 40;
    if (dx > threshold) {
      setTutorialSlide(tutorialIndex - 1);
    } else if (dx < -threshold) {
      setTutorialSlide(tutorialIndex + 1);
    }
  });
}

// ------- Google Auth -------

function signInWithGoogle() {
  if (typeof auth === "undefined" || typeof googleProvider === "undefined") {
    showToast("Authentication not available.");
    return;
  }
  
  auth.signInWithPopup(googleProvider)
    .then((result) => {
      showToast("Signed in successfully!");
    })
    .catch((error) => {
      console.error("Sign-in error:", error);
      if (error.code === "auth/popup-closed-by-user") {
        showToast("Sign-in cancelled.");
      } else if (error.code === "auth/unauthorized-domain") {
        showToast("This domain is not authorized for sign-in.");
      } else {
        showToast("Sign-in failed. Please try again.");
      }
    });
}

function signOut() {
  if (typeof auth === "undefined") {
    showToast("Authentication not available.");
    return;
  }
  
  auth.signOut()
    .then(() => {
      showToast("Signed out successfully.");
    })
    .catch((error) => {
      console.error("Sign-out error:", error);
      showToast("Sign-out failed.");
    });
}

function updateAuthUI(user) {
  currentUser = user;
  
  if (user) {
    const displayName = user.displayName || user.email || "User";
    const photoURL = user.photoURL || "";
    
    if (userInfoEl) userInfoEl.classList.remove("hidden");
    if (googleSignInBtn) googleSignInBtn.classList.add("hidden");
    if (userAvatarEl && photoURL) {
      userAvatarEl.src = photoURL;
      userAvatarEl.classList.remove("hidden");
    }
    if (userNameEl) userNameEl.textContent = displayName.split(" ")[0];
    
    if (settingsUserInfo) settingsUserInfo.classList.remove("hidden");
    if (settingsSignInBtn) settingsSignInBtn.classList.add("hidden");
    if (settingsSignOutBtn) settingsSignOutBtn.classList.remove("hidden");
    if (settingsUserAvatar && photoURL) settingsUserAvatar.src = photoURL;
    if (settingsUserName) settingsUserName.textContent = displayName;
    
    if (!state.hostName && hostNameInput) {
      state.hostName = displayName.split(" ")[0];
      hostNameInput.value = state.hostName;
      saveState();
    }
  } else {
    if (userInfoEl) userInfoEl.classList.add("hidden");
    if (googleSignInBtn) googleSignInBtn.classList.remove("hidden");
    
    if (settingsUserInfo) settingsUserInfo.classList.add("hidden");
    if (settingsSignInBtn) settingsSignInBtn.classList.remove("hidden");
    if (settingsSignOutBtn) settingsSignOutBtn.classList.add("hidden");
  }
}

function initAuth() {
  if (typeof auth === "undefined") {
    console.warn("Firebase Auth not available.");
    if (googleSignInBtn) googleSignInBtn.classList.add("hidden");
    if (settingsSignInBtn) settingsSignInBtn.classList.add("hidden");
    return;
  }
  
  auth.onAuthStateChanged((user) => {
    updateAuthUI(user);
  });
  
  if (googleSignInBtn) {
    googleSignInBtn.addEventListener("click", signInWithGoogle);
  }
  if (settingsSignInBtn) {
    settingsSignInBtn.addEventListener("click", signInWithGoogle);
  }
  if (settingsSignOutBtn) {
    settingsSignOutBtn.addEventListener("click", signOut);
  }
}

// ------- Boot -------

loadState();
loadSavedGames();
applySavedPreferences();
initFromState();
initAuth();
if (USE_REMOTE && getRoomCodeLabel()) {
  joinRemoteRoomIfNeeded();
}
maybeShowTutorial();
