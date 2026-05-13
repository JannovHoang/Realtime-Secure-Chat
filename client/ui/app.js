import {
  initChat,
  sendMessage,
  openConversation,
  fetchRecentMessages,
  mergeRecentMessagesForDisplay,
  destroyChat,
  listConversationPeers,
  isPeerReady,
  onPeerReady,
  saveCloudBackup,
  fetchCloudBackup,
  fetchCloudBackupIdentities,
} from "../chat.js";
import {
  initVault,
  hasPersistedVault,
  exportIdentityPayload,
  verifyPersistedVaultPassword,
  encryptIdentityPayload,
  decryptIdentityPayload,
  importIdentityPayload,
  loadIdentityMetadata,
} from "../storage.js";

const $ = (id) => document.getElementById(id);

let currentPeer = null;
let started = false;
let starting = false;
let disconnected = false;
let restoring = false;
let backingUp = false;
let unsubPeerReady = null;
let backupModalResolver = null;
let startGuardResolver = null;
let restoreChoiceResolver = null;
let restoredThisSession = false;
const continueWithoutRestoreFor = new Set();

/** ===== NEW: peer directory from certs =====
 * Keep-case usernames as they appear in certificates.
 * We only normalize by trimming + collapsing weird spaces for matching.
 */
const peers = new Set(); // display usernames (case preserved)
const peerByNorm = new Map(); // norm -> display username

function normalizeKeepCase(u) {
  return String(u ?? "")
    .normalize("NFKC")
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ") // weird spaces -> space
    .replace(/\s+/g, " ")
    .trim();
}

function findPeerDisplay(input) {
  const norm = normalizeKeepCase(input);
  if (!norm) return null;
  return peerByNorm.get(norm) || null; // exact (case-sensitive) key
}

function ensurePeerInDirectory(peerDisplay) {
  const p = normalizeKeepCase(peerDisplay);
  if (!p) return;
  peers.add(peerDisplay);
  peerByNorm.set(p, peerDisplay);
  refreshPeerDatalist();
}

function removePeerFromDirectory(peerDisplay) {
  const p = normalizeKeepCase(peerDisplay);
  if (!p) return;
  peers.delete(peerDisplay);
  // Only delete mapping if it points to this display
  if (peerByNorm.get(p) === peerDisplay) peerByNorm.delete(p);
  refreshPeerDatalist();
}

/* ===================== UI helpers ===================== */
function setStatus(text, ok = true) {
  const el = $("status");
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? "#16a34a" : "#dc2626";
}

function setButtons() {
  const busy = starting || restoring || backingUp;
  $("startBtn").disabled = busy || (started && !disconnected);
  $("restoreBtn").disabled = busy || started || !normalizeKeepCase($("username").value) || !$("password").value;
  $("backupBtn").disabled = busy || !started || disconnected;
  $("logoutBtn").disabled = busy || !started;
  $("startBtn").textContent = disconnected ? "Reconnect" : "Start";

  const canInteract = started && !disconnected;
  $("to").disabled = !canInteract;
  $("msg").disabled = !canInteract;
  $("sendBtn").disabled = !canInteract || starting || !isCurrentPeerReady();
}

function toast(text, type = "info") {
  let wrap = document.getElementById("uiToastWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "uiToastWrap";
    wrap.style.position = "fixed";
    wrap.style.right = "16px";
    wrap.style.bottom = "16px";
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "10px";
    wrap.style.zIndex = "9999";
    document.body.appendChild(wrap);
  }

  const t = document.createElement("div");
  t.textContent = text;
  t.style.padding = "10px 12px";
  t.style.borderRadius = "14px";
  t.style.border = "1px solid #e2e8f0";
  t.style.background = "#ffffff";
  t.style.color = "#0f172a";
  t.style.maxWidth = "70vw";
  t.style.fontSize = "13px";
  t.style.lineHeight = "1.35";
  t.style.boxShadow = "0 10px 30px rgba(15, 23, 42, .12)";

  if (type === "error") t.style.borderColor = "rgba(239,68,68,0.45)";
  if (type === "success") t.style.borderColor = "rgba(34,197,94,0.45)";

  wrap.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function closeBackupModal() {
  const modal = $("backupModal");
  const input = $("backupPassword");
  const toggle = $("backupPasswordToggle");
  if (!modal || !input || !toggle) return;

  modal.classList.add("is-hidden");
  modal.setAttribute("aria-hidden", "true");
  input.value = "";
  input.type = "password";
  toggle.textContent = "Show";
  toggle.setAttribute("aria-label", "Show password");
}

function resolveBackupModal(value) {
  const resolver = backupModalResolver;
  backupModalResolver = null;
  closeBackupModal();
  if (resolver) resolver(value);
}

function closeStartGuardModal() {
  const modal = $("startGuardModal");
  if (!modal) return;
  modal.classList.add("is-hidden");
  modal.setAttribute("aria-hidden", "true");
}

function resolveStartGuard(value) {
  const resolver = startGuardResolver;
  startGuardResolver = null;
  closeStartGuardModal();
  if (resolver) resolver(value);
}

function closeRestoreChoiceModal() {
  const modal = $("restoreChoiceModal");
  const list = $("restoreIdentityList");
  if (!modal || !list) return;
  modal.classList.add("is-hidden");
  modal.setAttribute("aria-hidden", "true");
  list.innerHTML = "";
}

function resolveRestoreChoice(value) {
  const resolver = restoreChoiceResolver;
  restoreChoiceResolver = null;
  closeRestoreChoiceModal();
  if (resolver) resolver(value);
}

function askStartGuard() {
  const modal = $("startGuardModal");
  if (!modal) {
    return Promise.resolve("continue");
  }

  closeStartGuardModal();
  modal.classList.remove("is-hidden");
  modal.setAttribute("aria-hidden", "false");

  return new Promise((resolve) => {
    startGuardResolver = resolve;
    queueMicrotask(() => $("startGuardContinue")?.focus());
  });
}

function askBackupPassword() {
  const modal = $("backupModal");
  const input = $("backupPassword");
  if (!modal || !input) {
    return Promise.resolve(null);
  }

  closeBackupModal();
  modal.classList.remove("is-hidden");
  modal.setAttribute("aria-hidden", "false");

  return new Promise((resolve) => {
    backupModalResolver = resolve;
    queueMicrotask(() => input.focus());
  });
}

function formatIdentityShort(identityId) {
  const normalized = String(identityId || "").trim();
  if (!normalized) return "unknown";
  return normalized.slice(0, 8);
}

function formatRestoreUpdatedAt(value) {
  if (!value) return "unknown time";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "unknown time";
  return dt.toLocaleString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function askRestoreIdentityChoice(items) {
  const modal = $("restoreChoiceModal");
  const list = $("restoreIdentityList");
  if (!modal || !list) {
    return Promise.resolve(null);
  }

  closeRestoreChoiceModal();
  list.innerHTML = "";

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "restore-choice-item";
    button.dataset.identityId = item.identityId;
    button.innerHTML = `
      <span class="restore-choice-id">${formatIdentityShort(item.identityId)}</span>
      <span class="restore-choice-time">updated ${formatRestoreUpdatedAt(item.updatedAt)}</span>
    `;
    button.addEventListener("click", () => resolveRestoreChoice(item.identityId));
    list.appendChild(button);
  }

  modal.classList.remove("is-hidden");
  modal.setAttribute("aria-hidden", "false");

  return new Promise((resolve) => {
    restoreChoiceResolver = resolve;
    queueMicrotask(() => list.querySelector("button")?.focus());
  });
}

async function chooseRestoreIdentity(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Restore failed");
  }

  if (items.length === 1) {
    return items[0].identityId;
  }

  const selectedIdentityId = await askRestoreIdentityChoice(items);
  if (!selectedIdentityId) {
    throw new Error("Restore cancelled");
  }
  return selectedIdentityId;
}

function appendMsg(type, text) {
  const div = document.createElement("div");
  div.className = `msg ${type}`;
  div.textContent = text;
  $("messages").appendChild(div);

  const el = $("messages");
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  if (nearBottom) el.scrollTop = el.scrollHeight;
}

function clearMessages() {
  $("messages").innerHTML = "";
}

function isCurrentPeerReady() {
  if (!currentPeer) return false;
  return isPeerReady(currentPeer);
}

function resetUiAfterLogout(reason) {
  started = false;
  starting = false;
  disconnected = false;
  currentPeer = null;

  $("to").value = "";
  $("msg").value = "";
  clearMessages();

  peers.clear();
  peerByNorm.clear();
  refreshPeerDatalist();
  renderPeerList();

  const pwField = $("passwordField");
  if (pwField) {
    pwField.classList.remove("is-hidden");
    pwField.style.display = "";
  }
  $("password").disabled = false;
  $("username").value = "";
  $("password").value = "";
  restoredThisSession = false;
  continueWithoutRestoreFor.clear();

  setStatus(reason === "logged_in_elsewhere" ? "Logged out (other login)" : "Logged out", true);
  setButtons();
  renderPeerList();
}

function describeForcedLogout(payload) {
  const reason =
    typeof payload === "string" ? payload : payload?.reason || "logged_in_elsewhere";
  const previousIdentityId =
    typeof payload === "object" ? payload?.previousIdentityId || null : null;
  const replacedByIdentityId =
    typeof payload === "object" ? payload?.replacedByIdentityId || null : null;

  if (
    reason === "logged_in_elsewhere" &&
    previousIdentityId &&
    replacedByIdentityId &&
    previousIdentityId !== replacedByIdentityId
  ) {
    return {
      status: "Logged out (other identity active)",
      toast: "Logged out: another identity for this account became active.",
    };
  }

  return {
    status: reason === "logged_in_elsewhere" ? "Logged out (other login)" : "Logged out",
    toast: "Logged out: this account was used elsewhere.",
  };
}

function buildRestoreOverwriteMessage(username, localIdentityMeta, payload) {
  const sameLocalIdentity =
    localIdentityMeta?.identityId &&
    localIdentityMeta.identityId === payload.identityId;
  const targetIdentityShort = formatIdentityShort(payload.identityId);

  if (!localIdentityMeta?.identityId || sameLocalIdentity) {
    return `Restore will overwrite the current local identity for account ${username} in this browser. Continue?`;
  }

  return `This browser currently stores a different local identity for account ${username}. Restoring this backup will replace the current identity with identity ${targetIdentityShort}. Continue?`;
}

function isIncorrectPasswordError(err) {
  return String(err?.message || err || "")
    .toLowerCase()
    .includes("incorrect password");
}

function markDisconnected() {
  if (!started || disconnected) return;
  disconnected = true;
  setStatus("Disconnected", false);
  setButtons();
  toast("Mất kết nối server, vui lòng Start lại.", "error");
}

function markDisconnectedForReconnect() {
  if (!started || disconnected) return;
  disconnected = true;

  const pwField = $("passwordField");
  if (pwField) {
    pwField.classList.remove("is-hidden");
    pwField.style.display = "";
  }

  $("password").disabled = false;
  $("password").value = "";

  setStatus("Disconnected", false);
  setButtons();
  $("password").focus();
  toast("Reconnect required. Re-enter password and press Start.", "error");
}

async function inspectPersistedLocalIdentity(username, password) {
  if (!(await hasPersistedVault(username))) {
    return null;
  }

  try {
    await initVault(password, username);
    return await loadIdentityMetadata();
  } catch {
    return null;
  }
}

async function runRestoreFlow() {
  const username = normalizeKeepCase($("username").value);
  const password = $("password").value;
  if (!username || !password) {
    toast("Please enter username and password.", "error");
    return;
  }

  restoring = true;
  setButtons();
  setStatus("Restoring...", true);

  try {
    const hasLocalVault = await hasPersistedVault(username);
    const backups = await fetchCloudBackupIdentities(username);
    const selectedIdentityId = await chooseRestoreIdentity(backups);
    const blob = await fetchCloudBackup(username, selectedIdentityId);
    const payload = await decryptIdentityPayload(
      blob,
      password,
      username,
      selectedIdentityId
    );
    const localIdentityMeta = hasLocalVault
      ? await inspectPersistedLocalIdentity(username, password)
      : null;

    if (hasLocalVault) {
      const confirmMessage = buildRestoreOverwriteMessage(
        username,
        localIdentityMeta,
        payload
      );
      const confirmed = window.confirm(confirmMessage);
      if (!confirmed) {
        setStatus("Restore cancelled", true);
        return;
      }
    }

    await importIdentityPayload(payload, username, selectedIdentityId);

    restoredThisSession = true;
    continueWithoutRestoreFor.delete(username);
    $("password").value = "";
    $("password").focus();
    setStatus("Restore ready", true);
    toast("Backup restored. Enter password and press Start.", "success");
  } catch (e) {
    console.error("[Restore error]", e);
    if ((e?.message || "") === "Restore cancelled") {
      setStatus("Restore cancelled", true);
      return;
    }
    setStatus("Restore failed", false);
    toast(
      "Restore failed. Check your account/password or backup availability.",
      "error"
    );
  } finally {
    restoring = false;
    setButtons();
  }
}

async function runBackupFlow() {
  if (!started || disconnected) return;

  const username = normalizeKeepCase($("username").value);
  if (!username) {
    toast("Missing username.", "error");
    return;
  }

  const password = await askBackupPassword();
  if (password == null) return;
  if (!password) {
    toast("Backup failed: password is required.", "error");
    return;
  }

  backingUp = true;
  setButtons();
  setStatus("Saving backup...", true);

  try {
    const passwordOk = await verifyPersistedVaultPassword(username, password);
    if (!passwordOk) {
      throw new Error("Incorrect password");
    }

    const payload = await exportIdentityPayload(username);
    const blob = await encryptIdentityPayload(payload, password);
    await saveCloudBackup(blob);

    setStatus("Ready", true);
    toast("Cloud backup saved.", "success");
  } catch (e) {
    console.error("[Backup error]", e);
    setStatus("Backup failed", false);
    if ((e?.message || "").toLowerCase().includes("incorrect password")) {
      toast("Backup failed: incorrect password.", "error");
    } else {
      toast("Backup failed.", "error");
    }
  } finally {
    backingUp = false;
    setButtons();
  }
}

/* ===================== conversation list ===================== */
function renderPeerList() {
  const listEl = $("peerList");
  const emptyEl = $("peerEmpty");
  if (!listEl || !emptyEl) return;

  listEl.innerHTML = "";

  const list = Array.from(peers).sort((a, b) => a.localeCompare(b));
  if (list.length === 0) {
    emptyEl.style.display = "block";
    return;
  }

  emptyEl.style.display = "none";

  for (const p of list) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "peer-item" + (p === currentPeer ? " active" : "");

    const avatar = document.createElement("span");
    avatar.className = "peer-avatar";
    avatar.textContent = p.slice(0, 1).toUpperCase();

    const name = document.createElement("span");
    name.className = "peer-name";
    name.textContent = p;

    item.appendChild(avatar);
    item.appendChild(name);

    item.addEventListener("click", async () => {
      $("to").value = p;
      await switchPeer(true);
    });

    listEl.appendChild(item);
  }
}

async function syncPeersFromVault() {
  try {
    const fromVault = await listConversationPeers();
    for (const p of fromVault) ensurePeerInDirectory(p);
  } catch {}
  renderPeerList();
}

/* ===================== history ===================== */
async function loadHistory(peer) {
  clearMessages();
  const history = await openConversation(peer);
  history.forEach((m) => {
    appendMsg(m.from === peer ? "peer" : "me", m.text);
  });
  $("messages").scrollTop = $("messages").scrollHeight;

  const loading = document.createElement("div");
  loading.className = "history-loading";
  loading.textContent = "Loading recent messages...";
  $("messages").appendChild(loading);
  $("messages").scrollTop = $("messages").scrollHeight;

  try {
    const recent = await fetchRecentMessages(peer, 50);
    const merged = await mergeRecentMessagesForDisplay(peer, recent);
    if (merged.length > 0) {
      ensurePeerInDirectory(peer);
      renderPeerList();
    }
    clearMessages();
    merged.forEach((m) => {
      appendMsg(m.from === peer ? "peer" : "me", m.text);
    });
    $("messages").scrollTop = $("messages").scrollHeight;
  } catch (err) {
    loading.remove();
    console.warn("[ui] recent history fetch/merge failed:", err);
    toast("Recent history unavailable. Local chat is still usable.", "info");
  }
}

/* ===================== peer datalist (NEW) ===================== */
function ensurePeerDatalist() {
  const input = $("to");
  if (!input) return;

  // Create datalist dynamically; no need to edit HTML.
  let dl = document.getElementById("peerDatalist");
  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = "peerDatalist";
    document.body.appendChild(dl);
  }

  // attach list attribute
  input.setAttribute("list", "peerDatalist");

  // optional placeholder hint
  if (!input.placeholder) input.placeholder = "Chat with (choose from suggestions)";
}

function refreshPeerDatalist() {
  const dl = document.getElementById("peerDatalist");
  if (!dl) return;

  dl.innerHTML = "";

  // Sort for nicer UX
  const list = Array.from(peers).sort((a, b) => a.localeCompare(b));

  for (const p of list) {
    const opt = document.createElement("option");
    opt.value = p;
    dl.appendChild(opt);
  }
}

/* ===================== peer handling ===================== */
async function switchPeer(force = false) {
  if (!started) return;

  const raw = $("to").value;
  const typed = normalizeKeepCase(raw);
  if (!typed) return;

  // Validate and auto-correct case if we have a known peer display name.
  const display = findPeerDisplay(typed);

  if (display) {
    if ($("to").value !== display) $("to").value = display;
  }

  const chosen = display || typed;

  if (force || currentPeer !== chosen) {
    currentPeer = chosen;

    if (!isPeerReady(chosen) && !display) {
      toast(
        `Peer "${chosen}" has no certificate yet. Ask them to click Start.`,
        "info"
      );
    }

    await loadHistory(chosen);
    renderPeerList();
    setButtons();
  }
}

/* ===================== init ===================== */
setStatus("Idle", true);
setButtons();
ensurePeerDatalist();
refreshPeerDatalist();
renderPeerList();

$("username").addEventListener("input", () => setButtons());
$("password").addEventListener("input", () => setButtons());

/* ===================== Start ===================== */
$("startBtn").onclick = async () => {
  let startHadLocalVault = false;
  try {
    const username = normalizeKeepCase($("username").value);
    const password = $("password").value;

    if (!username || !password) {
      toast("Please enter username and password.", "error");
      setStatus("Missing info", false);
      return;
    }

    const hasLocalVault = await hasPersistedVault(username);
    startHadLocalVault = hasLocalVault;
    if (!hasLocalVault && !restoredThisSession && !continueWithoutRestoreFor.has(username)) {
      const choice = await askStartGuard();
      if (choice === "restore") {
        await runRestoreFlow();
        return;
      }
      if (choice === "cancel") {
        return;
      }
      continueWithoutRestoreFor.add(username);
    }

    starting = true;
    setButtons();
    setStatus("Starting...", true);

    await initChat(username, password);

    started = true;
    starting = false;
    disconnected = false;

    peers.clear();
    peerByNorm.clear();
    currentPeer = null;
    refreshPeerDatalist();
    renderPeerList();

    const pwField = $("passwordField");
    if (pwField) {
      pwField.classList.add("is-hidden");
      pwField.style.display = "none";
    }
    $("password").value = "";
    $("password").disabled = true;

    // subscribe peer-ready events (no list updates here; list comes from history)
    unsubPeerReady = onPeerReady((peer) => {
      if (peer === currentPeer) setButtons();
    });

    setButtons();
    setStatus("Ready", true);
    toast("Ready.", "success");

    await syncPeersFromVault();
    // auto load history if peer already typed
    await switchPeer(true);
  } catch (e) {
    console.error("[Start error]", e);
    started = false;
    starting = false;
    disconnected = false;
    setButtons();
    setStatus("Start failed", false);
    if (startHadLocalVault && isIncorrectPasswordError(e)) {
      toast(
        "The password did not unlock the local identity currently stored in this browser. To use a different identity, restore it from cloud first.",
        "error"
      );
    } else {
      toast("Start failed: " + (e?.message || e), "error");
    }
  }
};

/* ===================== Logout ===================== */
$("logoutBtn").onclick = async () => {
  try {
    if (unsubPeerReady) unsubPeerReady();
    unsubPeerReady = null;

    await destroyChat();
    resetUiAfterLogout();
    toast("Logged out.", "success");
  } catch (e) {
    console.error("[Logout error]", e);
    toast("Logout failed", "error");
  }
};

$("restoreBtn").onclick = async () => {
  await runRestoreFlow();
};

$("backupBtn").onclick = async () => {
  await runBackupFlow();
};

$("backupModalCancel").onclick = () => {
  resolveBackupModal(null);
};

$("backupModalConfirm").onclick = () => {
  resolveBackupModal($("backupPassword").value);
};

$("backupPasswordToggle").onclick = () => {
  const input = $("backupPassword");
  const toggle = $("backupPasswordToggle");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  toggle.textContent = showing ? "Show" : "Hide";
  toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  input.focus();
};

$("backupPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    resolveBackupModal($("backupPassword").value);
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    resolveBackupModal(null);
  }
});

$("backupModal").addEventListener("click", (e) => {
  if (e.target === $("backupModal")) {
    resolveBackupModal(null);
  }
});

$("startGuardCancel").onclick = () => {
  resolveStartGuard("cancel");
};

$("startGuardRestore").onclick = () => {
  resolveStartGuard("restore");
};

$("startGuardContinue").onclick = () => {
  resolveStartGuard("continue");
};

$("startGuardModal").addEventListener("click", (e) => {
  if (e.target === $("startGuardModal")) {
    resolveStartGuard("cancel");
  }
});

$("restoreChoiceCancel").onclick = () => {
  resolveRestoreChoice(null);
};

$("restoreChoiceModal").addEventListener("click", (e) => {
  if (e.target === $("restoreChoiceModal")) {
    resolveRestoreChoice(null);
  }
});

window.onForcedLogout = (payload) => {
  if (unsubPeerReady) unsubPeerReady();
  unsubPeerReady = null;
  const details = describeForcedLogout(payload);
  resetUiAfterLogout(
    typeof payload === "string" ? payload : payload?.reason || "logged_in_elsewhere"
  );
  setStatus(details.status, true);
  toast(details.toast, "error");
};

window.onChatDisconnected = () => {
  markDisconnectedForReconnect();
};

/* ===================== Peer input ===================== */
$("to").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    switchPeer(true).catch(() => {});
  }
});

$("to").addEventListener("blur", () => {
  switchPeer().catch(() => {});
});

/* ===================== Send ===================== */
$("sendBtn").onclick = async () => {
  try {
    if (!started) {
      toast("Please click Start first.", "error");
      return;
    }

    const rawTo = $("to").value;
    const typed = normalizeKeepCase(rawTo);
    const msg = $("msg").value.trim();

    if (!typed) {
      toast("Please enter peer username.", "error");
      return;
    }
    if (!msg) return;

    // Validate/auto-correct to known peer display if possible
    const display = findPeerDisplay(typed);
    const to = display || typed;
    if (display && $("to").value !== display) $("to").value = display;

    if (!isPeerReady(to)) {
      toast(`Waiting certificate of ${to} (ask them to click Start).`, "error");
      return;
    }

    if (currentPeer !== to) {
      await switchPeer(true);
    }

    await sendMessage(to, msg);

    $("msg").value = "";
    appendMsg("me", msg);
    ensurePeerInDirectory(to);
    renderPeerList();
  } catch (e) {
    console.error("[Send error]", e);
    toast("Send failed: " + (e?.message || e), "error");
  }
};

$("msg").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("sendBtn").click();
  }
});

/* ===================== Incoming ===================== */
window.onChatMessage = ({ from, text, isCurrentPeer }) => {
  if (!from) return;

  // Learn peer name from incoming too (case preserved)
  ensurePeerInDirectory(from);
  renderPeerList();

  if (isCurrentPeer || from === currentPeer) {
    appendMsg("peer", text);
    return;
  }

  toast(`New message from ${from}`, "info");
};
