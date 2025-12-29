import {
  initChat,
  sendMessage,
  openConversation,
  destroyChat,
  isPeerReady,
  onPeerReady,
} from "../chat.js";

const $ = (id) => document.getElementById(id);

let currentPeer = null;
let started = false;
let starting = false;
let unsubPeerReady = null;

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
  $("startBtn").disabled = starting || started;
  $("logoutBtn").disabled = !started;

  $("to").disabled = !started;
  $("msg").disabled = !started;
  $("sendBtn").disabled = !started || starting || !isCurrentPeerReady();
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

/* ===================== history ===================== */
async function loadHistory(peer) {
  clearMessages();
  const history = await openConversation(peer);
  history.forEach((m) => {
    appendMsg(m.from === peer ? "peer" : "me", m.text);
  });
  $("messages").scrollTop = $("messages").scrollHeight;
}

/* ===================== peer datalist (NEW) ===================== */
function ensurePeerDatalist() {
  const input = $("to");
  if (!input) return;

  // Create datalist dynamically; no need to edit HTML.
  let dl = document.getElementById("peerList");
  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = "peerList";
    document.body.appendChild(dl);
  }

  // attach list attribute
  input.setAttribute("list", "peerList");

  // optional placeholder hint
  if (!input.placeholder) input.placeholder = "Chat with (choose from suggestions)";
}

function refreshPeerDatalist() {
  const dl = document.getElementById("peerList");
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

  // ✅ validate / auto-correct:
  // If user typed something that matches a known peer EXACTLY after normalization,
  // replace the input with the canonical display (correct case/spaces).
  const display = findPeerDisplay(typed);

  if (display) {
    if ($("to").value !== display) $("to").value = display; // normalize shown text
  }

  const chosen = display || typed;

  if (force || currentPeer !== chosen) {
    currentPeer = chosen;

    // If peer not ready, show friendly hint but still allow switching (history may exist)
    if (!isPeerReady(chosen) && !display) {
      toast(
        `Peer "${chosen}" chưa có certificate. Hãy mở tab người kia và Start trước.`,
        "info"
      );
    }

    await loadHistory(chosen);
    setButtons();
  }
}

/* ===================== init ===================== */
setStatus("Idle", true);
setButtons();
ensurePeerDatalist();
refreshPeerDatalist();

/* ===================== Start ===================== */
$("startBtn").onclick = async () => {
  try {
    const username = normalizeKeepCase($("username").value);
    const password = $("password").value;

    if (!username || !password) {
      toast("Please enter username and password.", "error");
      setStatus("Missing info", false);
      return;
    }

    starting = true;
    setButtons();
    setStatus("Starting…", true);

    await initChat(username, password);

    started = true;
    starting = false;

    // subscribe peer-ready events
    unsubPeerReady = onPeerReady((peer) => {
      // store peer into directory (case preserved from cert)
      ensurePeerInDirectory(peer);

      if (peer === currentPeer) setButtons();
    });

    setButtons();
    setStatus("Ready", true);
    toast("Ready.", "success");

    // auto load history if peer already typed
    await switchPeer(true);
  } catch (e) {
    console.error("[Start error]", e);
    started = false;
    starting = false;
    setButtons();
    setStatus("Start failed", false);
    toast("Start failed: " + (e?.message || e), "error");
  }
};

/* ===================== Logout ===================== */
$("logoutBtn").onclick = async () => {
  try {
    if (unsubPeerReady) unsubPeerReady();
    unsubPeerReady = null;

    await destroyChat();

    started = false;
    starting = false;
    currentPeer = null;

    $("to").value = "";
    $("msg").value = "";
    clearMessages();

    // Do NOT clear peers directory automatically (optional).
    // If you want it empty on logout, uncomment:
    // peers.clear(); peerByNorm.clear(); refreshPeerDatalist();

    setStatus("Logged out", true);
    setButtons();
    toast("Logged out.", "success");
  } catch (e) {
    console.error("[Logout error]", e);
    toast("Logout failed", "error");
  }
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
      toast(`Waiting certificate of ${to}… (mở tab người kia và Start)`, "error");
      return;
    }

    if (currentPeer !== to) {
      await switchPeer(true);
    }

    await sendMessage(to, msg);

    $("msg").value = "";
    appendMsg("me", msg);
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
window.onChatMessage = ({ from, text }) => {
  if (!from) return;

  // Learn peer name from incoming too (case preserved)
  ensurePeerInDirectory(from);

  if (from === currentPeer) {
    appendMsg("peer", text);
    return;
  }

  toast(`New message from ${from}`, "info");
};
