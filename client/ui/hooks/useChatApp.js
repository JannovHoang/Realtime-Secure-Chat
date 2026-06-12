import { useEffect, useReducer, useRef } from "react";
import { buildLocalAccountProfile } from "../../account.js";
import {
  destroyChat,
  fetchCloudBackup,
  fetchCloudBackupIdentities,
  fetchRecentMessages,
  initChat,
  isPeerReady,
  mergeRecentMessagesForDisplay,
  onPeerReady,
  openConversation,
  saveCloudBackup,
  sendMessage,
} from "../../chat.js";
import {
  initVault,
  decryptIdentityPayload,
  encryptIdentityPayload,
  exportIdentityPayload,
  hasPersistedVault,
  importIdentityPayload,
  listConversationMetadata,
  loadBackupMetadata,
  saveBackupMetadata,
  loadIdentityMetadata,
  verifyPersistedVaultPassword,
} from "../../storage.js";
import {
  getChatRuntimeBridgeStatus,
  subscribeToChatRuntime,
} from "../lib/chatRuntimeBridge.js";

const initialState = {
  username: "",
  accountId: "",
  displayName: "",
  password: "",
  started: false,
  starting: false,
  restoring: false,
  backingUp: false,
  restoredThisSession: false,
  continueWithoutRestoreFor: {},
  identityPanel: null,
  activePeer: "",
  peerDraft: "",
  conversations: [],
  conversationsLoaded: false,
  messages: [],
  messageDraft: "",
  messageLoading: false,
  recentLoading: false,
  sending: false,
  activePeerReady: false,
  bridgeInstalled: false,
  bridgeListenerCount: 0,
  runtimeEventCount: 0,
  lastRuntimeEventType: null,
  lastMessageFrom: "",
  lastMessagePreview: "",
  lastForcedLogoutReason: "",
  disconnected: false,
  statusText: "React Shell Only",
  statusTone: "info",
  modal: null,
  backupPasswordInput: "",
  pendingRestore: null,
  pendingStartWarning: null,
  toasts: [],
};

function trimPreview(text, max = 72) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + "...";
}

function normalizePeer(value) {
  return String(value || "").trim();
}

function normalizeConversationItem(item) {
  const peer = normalizePeer(item?.peer);
  if (!peer) return null;
  return {
    peer,
    lastMessageAt: Number(item?.lastMessageAt) || 0,
    lastMessagePreview: trimPreview(item?.lastMessagePreview || "", 56),
  };
}

function sortConversations(items) {
  return [...items].sort((a, b) => {
    if (a.lastMessageAt !== b.lastMessageAt) {
      return b.lastMessageAt - a.lastMessageAt;
    }
    return a.peer.localeCompare(b.peer);
  });
}

function normalizeMessageItem(item) {
  if (!item || typeof item !== "object") return null;
  const from = normalizePeer(item.from);
  const text = String(item.text || "");
  if (!from && !text) return null;
  return {
    from,
    text,
    ts: Number(item.ts) || 0,
  };
}

function runtimeSnapshotState() {
  const status = getChatRuntimeBridgeStatus();
  return {
    installed: status.installed,
    listenerCount: status.listenerCount,
  };
}

function nextToastId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatIdentityShort(identityId) {
  const normalized = String(identityId || "").trim();
  if (!normalized) return "unknown";
  return normalized.slice(0, 8);
}

function formatDateTimeShort(value) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("vi-VN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function getTimeMs(value) {
  if (!value) return 0;
  const dt = new Date(value);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function findMatchingCloudBackup(items, identityMeta, account) {
  if (!Array.isArray(items) || !identityMeta?.identityId) return null;
  return (
    items.find((item) => {
      if (item?.identityId !== identityMeta.identityId) return false;
      if (item?.accountId && account?.accountId && item.accountId !== account.accountId) {
        return false;
      }
      return true;
    }) || null
  );
}

function getBackupFreshnessSignal(cloudBackup, localBackupMeta) {
  if (!cloudBackup?.serverSavedAt) return null;
  const cloudServerMs = getTimeMs(cloudBackup.serverSavedAt);
  if (!cloudServerMs) return null;

  const localKnownMs = getTimeMs(
    localBackupMeta?.localLastBackupServerSavedAt || localBackupMeta?.serverSavedAt
  );
  if (!localKnownMs) {
    return {
      status: "Cloud backup available",
      toast:
        "Cloud backup available. Restore first if this account was used on another device.",
      modalTitle: "Cloud Backup Available",
      modalSubtitle:
        "A cloud backup exists for this identity. If this account was used on another device, restore before chatting.",
    };
  }

  if (cloudServerMs <= localKnownMs) return null;
  return {
    status: "Cloud backup may be newer",
    toast:
      "A newer cloud backup may exist for this identity. Restore first if this browser may be using an older local state.",
    modalTitle: "Cloud Backup May Be Newer",
    modalSubtitle:
      "The cloud backup appears newer than this browser's local backup record. Restore first if you recently used another device.",
  };
}

function buildRestoreOverwriteMessage(username, localIdentityMeta, payload) {
  const sameLocalIdentity =
    localIdentityMeta?.identityId &&
    localIdentityMeta.identityId === payload.identityId;
  const targetIdentityShort = formatIdentityShort(payload.identityId);

  if (!localIdentityMeta?.identityId || sameLocalIdentity) {
    return `Restore will overwrite the current local identity for display name ${username} in this browser. Continue?`;
  }

  return `This browser currently stores a different local identity for display name ${username}. Restoring this backup will replace the current identity with identity ${targetIdentityShort}. Continue?`;
}

function reducer(state, action) {
  switch (action.type) {
    case "field_change":
      if (action.field === "username") {
        return {
          ...state,
          username: action.value,
          accountId: "",
          displayName: "",
        };
      }
      return { ...state, [action.field]: action.value };
    case "set_status":
      return {
        ...state,
        statusText: action.message || state.statusText,
        statusTone: action.tone || state.statusTone,
      };
    case "message_draft":
      return { ...state, messageDraft: action.value };
    case "set_conversations": {
      const normalized = Array.isArray(action.items)
        ? sortConversations(action.items.map(normalizeConversationItem).filter(Boolean))
        : [];
      const nextActivePeer = state.activePeer || normalized[0]?.peer || "";
      return {
        ...state,
        conversations: normalized,
        conversationsLoaded: true,
        activePeer: nextActivePeer,
        peerDraft: nextActivePeer || state.peerDraft,
      };
    }
    case "set_peer_draft":
      return { ...state, peerDraft: action.value };
    case "set_active_peer":
      return {
        ...state,
        activePeer: normalizePeer(action.peer),
        peerDraft: normalizePeer(action.peer),
        messages: [],
        messageLoading: false,
        recentLoading: false,
        activePeerReady: isPeerReady(action.peer),
      };
    case "set_active_peer_ready":
      return { ...state, activePeerReady: !!action.value };
    case "history_load_begin":
      return { ...state, messageLoading: true };
    case "history_load_success":
      return {
        ...state,
        messageLoading: false,
        messages: Array.isArray(action.items) ? action.items : [],
      };
    case "history_load_failure":
      return { ...state, messageLoading: false };
    case "recent_begin":
      return { ...state, recentLoading: true };
    case "recent_success":
      return {
        ...state,
        recentLoading: false,
        messages: Array.isArray(action.items) ? action.items : state.messages,
      };
    case "recent_failure":
      return { ...state, recentLoading: false };
    case "send_begin":
      return { ...state, sending: true };
    case "send_success":
      return {
        ...state,
        sending: false,
        messageDraft: "",
        messages: Array.isArray(action.items) ? action.items : state.messages,
      };
    case "send_failure":
      return { ...state, sending: false };
    case "start_begin":
      return {
        ...state,
        starting: true,
        statusText: "Starting...",
        statusTone: "info",
      };
    case "start_success":
      return {
        ...state,
        started: true,
        starting: false,
        accountId: action.account?.accountId || state.accountId,
        displayName: action.account?.displayName || state.displayName,
        disconnected: false,
        password: "",
        peerDraft: "",
        conversationsLoaded: false,
        messages: [],
        messageDraft: "",
        messageLoading: false,
        recentLoading: false,
        sending: false,
        activePeerReady: false,
        statusText: "Ready",
        statusTone: "success",
      };
    case "identity_panel_set":
      return { ...state, identityPanel: action.value || null };
    case "start_failure":
      return {
        ...state,
        started: false,
        starting: false,
        disconnected: false,
        messageLoading: false,
        recentLoading: false,
        sending: false,
        statusText: action.message || "Start failed",
        statusTone: "error",
      };
    case "logout_success":
      return {
        ...state,
        started: false,
        starting: false,
        disconnected: false,
        accountId: "",
        displayName: "",
        identityPanel: null,
        password: "",
        activePeer: "",
        peerDraft: "",
        conversations: [],
        conversationsLoaded: false,
        messages: [],
        messageDraft: "",
        messageLoading: false,
        recentLoading: false,
        sending: false,
        activePeerReady: false,
        statusText: "Logged out",
        statusTone: "success",
      };
    case "restore_begin":
      return {
        ...state,
        restoring: true,
        statusText: "Restoring...",
        statusTone: "info",
      };
    case "restore_end":
      return { ...state, restoring: false };
    case "backup_begin":
      return {
        ...state,
        backingUp: true,
        statusText: "Saving backup...",
        statusTone: "info",
      };
    case "backup_end":
      return { ...state, backingUp: false };
    case "bridge_status":
      return {
        ...state,
        bridgeInstalled: !!action.payload?.installed,
        bridgeListenerCount: Number(action.payload?.listenerCount || 0),
      };
    case "runtime_event": {
      const eventType = String(action.payload?.type || "");
      const payload = action.payload?.payload || null;
      if (eventType === "chat_message") {
        return {
          ...state,
          runtimeEventCount: state.runtimeEventCount + 1,
          lastRuntimeEventType: eventType,
          lastMessageFrom: String(payload?.from || "").trim(),
          lastMessagePreview: trimPreview(payload?.text || ""),
        };
      }
      if (eventType === "forced_logout") {
        return {
          ...state,
          started: false,
          starting: false,
          disconnected: false,
          password: "",
          activePeer: "",
          peerDraft: "",
          conversations: [],
          conversationsLoaded: false,
          messages: [],
          messageDraft: "",
          messageLoading: false,
          recentLoading: false,
          sending: false,
          activePeerReady: false,
          runtimeEventCount: state.runtimeEventCount + 1,
          lastRuntimeEventType: eventType,
          lastForcedLogoutReason: String(payload?.reason || "logged_in_elsewhere"),
          statusText: "Logged out (other login)",
          statusTone: "error",
        };
      }
      if (eventType === "chat_disconnected") {
        return {
          ...state,
          password: "",
          sending: false,
          runtimeEventCount: state.runtimeEventCount + 1,
          lastRuntimeEventType: eventType,
          disconnected: state.started ? true : state.disconnected,
          statusText: state.started ? "Disconnected" : state.statusText,
          statusTone: state.started ? "error" : state.statusTone,
        };
      }
      return {
        ...state,
        runtimeEventCount: state.runtimeEventCount + 1,
        lastRuntimeEventType: eventType || null,
      };
    }
    case "append_incoming_message": {
      const item = normalizeMessageItem(action.item);
      if (!item) return state;
      const isDuplicate = state.messages.some(
        (msg) =>
          msg.from === item.from &&
          msg.text === item.text &&
          Number(msg.ts || 0) === Number(item.ts || 0)
      );
      return {
        ...state,
        messages: isDuplicate ? state.messages : [...state.messages, item],
      };
    }
    case "open_modal":
      return { ...state, modal: action.modal };
    case "close_modal":
      return { ...state, modal: null, backupPasswordInput: "" };
    case "set_backup_password_input":
      return { ...state, backupPasswordInput: action.value };
    case "set_pending_restore":
      return { ...state, pendingRestore: action.value };
    case "set_pending_start_warning":
      return { ...state, pendingStartWarning: action.value };
    case "restore_success":
      return {
        ...state,
        restoredThisSession: true,
        accountId: action.account?.accountId || state.accountId,
        displayName: action.account?.displayName || state.displayName,
        identityPanel: action.identityPanel || state.identityPanel,
        password: "",
        statusText: "Restore ready",
        statusTone: "success",
      };
    case "allow_continue_without_restore":
      return {
        ...state,
        continueWithoutRestoreFor: {
          ...state.continueWithoutRestoreFor,
          [action.username]: true,
        },
      };
    case "toast_push":
      return {
        ...state,
        toasts: [...state.toasts, action.toast],
      };
    case "toast_remove":
      return {
        ...state,
        toasts: state.toasts.filter((item) => item.id !== action.id),
      };
    default:
      return state;
  }
}

export function useChatApp() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const activePeerRef = useRef(initialState.activePeer);

  useEffect(() => {
    activePeerRef.current = state.activePeer;
  }, [state.activePeer]);

  function pushToast(text, tone = "info") {
    const id = nextToastId();
    dispatch({
      type: "toast_push",
      toast: { id, text: String(text || ""), tone },
    });
    window.setTimeout(() => {
      dispatch({ type: "toast_remove", id });
    }, 2400);
  }

  useEffect(() => {
    dispatch({ type: "bridge_status", payload: runtimeSnapshotState() });

    const unsubscribe = subscribeToChatRuntime((event) => {
      const activePeer = activePeerRef.current;
      if (
        event.type === "chat_message" &&
        normalizePeer(event.payload?.from) === activePeer
      ) {
        dispatch({
          type: "append_incoming_message",
          item: {
            from: event.payload?.from,
            text: event.payload?.text,
            ts: event.payload?.ts,
          },
        });
      }
      if (
        event.type === "chat_message" &&
        normalizePeer(event.payload?.from) !== activePeer
      ) {
        pushToast(`New message from ${event.payload?.from || "peer"}`, "info");
      }
      dispatch({ type: "runtime_event", payload: event });
      dispatch({ type: "bridge_status", payload: runtimeSnapshotState() });
    });

    dispatch({ type: "bridge_status", payload: runtimeSnapshotState() });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!state.started) return;

    let cancelled = false;
    void (async () => {
      try {
        const metadata = await listConversationMetadata();
        if (cancelled) return;
        dispatch({ type: "set_conversations", items: metadata });
      } catch (err) {
        console.warn("[ui] failed to load conversation metadata:", err);
        if (cancelled) return;
        dispatch({ type: "set_conversations", items: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.started, state.runtimeEventCount]);

  useEffect(() => {
    if (!state.started) return;

    const unsubscribe = onPeerReady((peer) => {
      if (normalizePeer(peer) === state.activePeer) {
        dispatch({ type: "set_active_peer_ready", value: true });
      }
    });

    dispatch({
      type: "set_active_peer_ready",
      value: state.activePeer ? isPeerReady(state.activePeer) : false,
    });

    return () => {
      unsubscribe();
    };
  }, [state.started, state.activePeer]);

  useEffect(() => {
    if (!state.started || !state.activePeer) return;

    let cancelled = false;
    void (async () => {
      dispatch({ type: "history_load_begin" });
      try {
        const localHistory = await openConversation(state.activePeer);
        const localItems = Array.isArray(localHistory)
          ? localHistory.map(normalizeMessageItem).filter(Boolean)
          : [];
        if (cancelled) return;
        dispatch({ type: "history_load_success", items: localItems });
      } catch (err) {
        console.warn("[ui] openConversation failed:", err);
        if (cancelled) return;
        dispatch({ type: "history_load_failure" });
      }

      dispatch({ type: "recent_begin" });
      try {
        const recent = await fetchRecentMessages(state.activePeer, 50);
        const merged = await mergeRecentMessagesForDisplay(state.activePeer, recent);
        const mergedItems = Array.isArray(merged)
          ? merged.map(normalizeMessageItem).filter(Boolean)
          : [];
        if (cancelled) return;
        dispatch({ type: "recent_success", items: mergedItems });
        const metadata = await listConversationMetadata();
        if (cancelled) return;
        dispatch({ type: "set_conversations", items: metadata });
      } catch (err) {
        console.warn("[ui] recent history failed:", err);
        if (cancelled) return;
        dispatch({ type: "recent_failure" });
        pushToast("Recent history unavailable. Local chat is still usable.", "info");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.started, state.activePeer]);

  async function inspectPersistedLocalIdentity(username, password) {
    if (!(await hasPersistedVault(username))) return null;
    try {
      await initVault(password, username);
      return await loadIdentityMetadata();
    } catch {
      return null;
    }
  }

  async function checkBackupFreshness(username, account) {
    try {
      const [identityMeta, localBackupMeta, cloudItems] = await Promise.all([
        loadIdentityMetadata(),
        loadBackupMetadata().catch(() => null),
        fetchCloudBackupIdentities(username),
      ]);
      const cloudBackup = findMatchingCloudBackup(cloudItems, identityMeta, account);
      const signal = getBackupFreshnessSignal(cloudBackup, localBackupMeta);
      if (!signal) return;

      dispatch({
        type: "set_status",
        message: signal.status,
        tone: "warning",
      });
      pushToast(signal.toast, "warning");
    } catch (err) {
      console.warn("[backup] freshness check skipped:", err);
    }
  }

  async function refreshIdentityPanel(account) {
    try {
      const [identityMeta, backupMeta] = await Promise.all([
        loadIdentityMetadata().catch(() => null),
        loadBackupMetadata().catch(() => null),
      ]);
      dispatch({
        type: "identity_panel_set",
        value: {
          displayName:
            account?.displayName ||
            identityMeta?.displayName ||
            identityMeta?.username ||
            "",
          accountId: account?.accountId || identityMeta?.accountId || "",
          accountIdScheme: account?.accountIdScheme || "",
          identityId: identityMeta?.identityId || "",
          backupServerSavedAt:
            backupMeta?.localLastBackupServerSavedAt || backupMeta?.serverSavedAt || "",
          backupClientSavedAt: backupMeta?.clientSavedAt || "",
        },
      });
    } catch (err) {
      console.warn("[identity] panel refresh skipped:", err);
    }
  }

  function buildIdentityPanelFromRestore(account, payload, blob) {
    return {
      displayName: account?.displayName || payload?.displayName || payload?.username || "",
      accountId: account?.accountId || payload?.accountId || "",
      accountIdScheme: account?.accountIdScheme || payload?.accountIdScheme || "",
      identityId: payload?.identityId || "",
      backupServerSavedAt: blob?.serverSavedAt || "",
      backupClientSavedAt: blob?.clientSavedAt || payload?.clientSavedAt || "",
    };
  }

  async function getPreStartBackupWarning(username, password, account) {
    try {
      await initVault(password, username);
      const [identityMeta, localBackupMeta, cloudItems] = await Promise.all([
        loadIdentityMetadata(),
        loadBackupMetadata().catch(() => null),
        fetchCloudBackupIdentities(username),
      ]);
      const cloudBackup = findMatchingCloudBackup(cloudItems, identityMeta, account);
      const signal = getBackupFreshnessSignal(cloudBackup, localBackupMeta);
      if (!signal) return null;
      return {
        ...signal,
        username,
      };
    } catch (err) {
      console.warn("[backup] pre-start freshness check skipped:", err);
      return null;
    }
  }

  async function performStart(options = {}) {
    const username = String(state.username || "").trim();
    const password = String(state.password || "");

    if (!username || !password) {
      dispatch({
        type: "start_failure",
        message: "Display name and password are required",
      });
      return;
    }

    const account = await buildLocalAccountProfile(username);
    const hasLocalVault = await hasPersistedVault(username);
    const shouldGuard =
      !options.skipGuard &&
      !hasLocalVault &&
      !state.restoredThisSession &&
      !state.continueWithoutRestoreFor[username];

    if (shouldGuard) {
      dispatch({
        type: "open_modal",
        modal: { type: "start_guard", username },
      });
      return;
    }

    if (!options.skipBackupWarning && hasLocalVault && !state.restoredThisSession) {
      const warning = await getPreStartBackupWarning(username, password, account);
      if (warning) {
        dispatch({ type: "set_pending_start_warning", value: { username } });
        dispatch({
          type: "open_modal",
          modal: { type: "backup_freshness_warning", ...warning },
        });
        return;
      }
    }

    dispatch({ type: "start_begin" });
    try {
      await initChat(username, password, account);
      dispatch({ type: "start_success", account });
      void refreshIdentityPanel(account);
      pushToast("Ready.", "success");
      if (!state.restoredThisSession && !options.skipBackupWarning) {
        void checkBackupFreshness(username, account);
      }
    } catch (err) {
      dispatch({
        type: "start_failure",
        message: String(err?.message || err || "Start failed"),
      });
      pushToast(String(err?.message || err || "Start failed"), "error");
    }
  }

  async function handleStart() {
    await performStart();
  }

  async function handleLogout() {
    try {
      await destroyChat();
      dispatch({ type: "logout_success" });
      pushToast("Logged out.", "success");
    } catch (err) {
      dispatch({
        type: "set_status",
        message: String(err?.message || err || "Logout failed"),
        tone: "error",
      });
      pushToast("Logout failed.", "error");
    }
  }

  function setField(field, value) {
    dispatch({ type: "field_change", field, value });
  }

  function selectPeer(peer) {
    dispatch({ type: "set_active_peer", peer });
  }

  function setPeerDraft(value) {
    dispatch({ type: "set_peer_draft", value });
  }

  function commitPeerDraft() {
    const peer = normalizePeer(state.peerDraft);
    if (!state.started || state.disconnected || !peer) return;
    dispatch({ type: "set_active_peer", peer });
  }

  async function handleSend() {
    const peer = normalizePeer(state.activePeer);
    const draft = String(state.messageDraft || "");

    if (!state.started || state.disconnected) return;
    if (!peer || !draft.trim()) return;

    dispatch({ type: "send_begin" });
    try {
      await sendMessage(peer, draft);
      const localHistory = await openConversation(peer);
      const items = Array.isArray(localHistory)
        ? localHistory.map(normalizeMessageItem).filter(Boolean)
        : [];
      dispatch({ type: "send_success", items });
      const metadata = await listConversationMetadata();
      dispatch({ type: "set_conversations", items: metadata });
    } catch (err) {
      dispatch({ type: "send_failure" });
      dispatch({
        type: "set_status",
        message: String(err?.message || err || "Send failed"),
        tone: "error",
      });
      pushToast(String(err?.message || err || "Send failed"), "error");
    }
  }

  function openBackupModal() {
    if (!state.started || state.disconnected) return;
    dispatch({ type: "set_backup_password_input", value: "" });
    dispatch({ type: "open_modal", modal: { type: "backup_password" } });
  }

  async function confirmBackup() {
    const username = String(state.username || "").trim();
    const password = String(state.backupPasswordInput || "");
    if (!username || !password) {
      pushToast("Backup failed: password is required.", "error");
      return;
    }

    dispatch({ type: "close_modal" });
    dispatch({ type: "backup_begin" });
    try {
      const account = await buildLocalAccountProfile(username);
      const passwordOk = await verifyPersistedVaultPassword(username, password);
      if (!passwordOk) throw new Error("Incorrect password");
      const clientSavedAt = new Date().toISOString();
      const payload = await exportIdentityPayload(username);
      const blob = await encryptIdentityPayload(
        {
          ...payload,
          accountId: account.accountId,
          displayName: account.displayName,
          accountIdScheme: account.accountIdScheme,
          clientSavedAt,
        },
        password
      );
      const backupReceipt = await saveCloudBackup(blob);
      try {
        await saveBackupMetadata({
          username,
          accountId: account.accountId,
          displayName: account.displayName,
          accountIdScheme: account.accountIdScheme,
          identityId: payload.identityId,
          backupVersion: blob.version,
          clientSavedAt,
          serverSavedAt: backupReceipt?.serverSavedAt || blob.serverSavedAt || null,
        });
      } catch (metadataErr) {
        console.warn("[backup] failed to save local metadata:", metadataErr);
      }
      dispatch({
        type: "identity_panel_set",
        value: {
          displayName: account.displayName,
          accountId: account.accountId,
          accountIdScheme: account.accountIdScheme,
          identityId: payload.identityId,
          backupServerSavedAt: backupReceipt?.serverSavedAt || blob.serverSavedAt || "",
          backupClientSavedAt: clientSavedAt,
        },
      });
      dispatch({ type: "set_status", message: "Ready", tone: "success" });
      pushToast("Cloud backup saved.", "success");
    } catch (err) {
      dispatch({ type: "set_status", message: "Backup failed", tone: "error" });
      pushToast(
        String(err?.message || "").toLowerCase().includes("incorrect password")
          ? "Backup failed: incorrect password."
          : "Backup failed.",
        "error"
      );
    } finally {
      dispatch({ type: "backup_end" });
    }
  }

  async function handleRestoreRequest() {
    const username = String(state.username || "").trim();
    const password = String(state.password || "");
    if (!username || !password) {
      pushToast("Please enter display name and password.", "error");
      return;
    }

    dispatch({ type: "restore_begin" });
    try {
      const items = await fetchCloudBackupIdentities(username);
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Restore unavailable");
      }
      if (items.length === 1) {
        await completeRestore(items[0].identityId, username, password);
        return;
      }
      dispatch({
        type: "set_pending_restore",
        value: { username, password, items },
      });
      dispatch({
        type: "open_modal",
        modal: { type: "restore_choice", items },
      });
    } catch (err) {
      dispatch({ type: "set_status", message: "Restore failed", tone: "error" });
      dispatch({ type: "restore_end" });
      pushToast("Restore failed. Check your display name, password, or backup availability.", "error");
    }
  }

  async function completeRestore(identityId, usernameArg = null, passwordArg = null) {
    const username = String(usernameArg || state.username || "").trim();
    const password = String(passwordArg || state.password || "");

    try {
      const account = await buildLocalAccountProfile(username);
      const selectedAccountId = state.pendingRestore?.items?.find(
        (item) => item?.identityId === identityId
      )?.accountId;
      if (selectedAccountId && selectedAccountId !== account.accountId) {
        throw new Error("Backup account mismatch");
      }
      const blob = await fetchCloudBackup(username, identityId);
      const payload = await decryptIdentityPayload(
        blob,
        password,
        username,
        identityId,
        account.accountId
      );
      const hasLocalVault = await hasPersistedVault(username);
      let localIdentityMeta = null;
      if (hasLocalVault) {
        localIdentityMeta = await inspectPersistedLocalIdentity(username, password);
      }
      if (hasLocalVault) {
        const confirmMessage = buildRestoreOverwriteMessage(
          username,
          localIdentityMeta,
          payload
        );
        const confirmed = window.confirm(confirmMessage);
        if (!confirmed) {
          dispatch({ type: "set_status", message: "Restore cancelled", tone: "info" });
          dispatch({ type: "restore_end" });
          dispatch({ type: "close_modal" });
          dispatch({ type: "set_pending_restore", value: null });
          return;
        }
      }

      await importIdentityPayload(payload, username, identityId, account.accountId);
      try {
        await initVault(password, username);
        await saveBackupMetadata({
          username,
          accountId: account.accountId,
          displayName: account.displayName,
          accountIdScheme: account.accountIdScheme,
          identityId: payload.identityId,
          backupVersion: blob.version || payload.version || 2,
          clientSavedAt: blob.clientSavedAt || payload.clientSavedAt || null,
          serverSavedAt: blob.serverSavedAt || null,
        });
      } catch (metadataErr) {
        console.warn("[restore] failed to save local backup metadata:", metadataErr);
      }
      dispatch({
        type: "restore_success",
        account,
        identityPanel: buildIdentityPanelFromRestore(account, payload, blob),
      });
      dispatch({ type: "restore_end" });
      dispatch({ type: "close_modal" });
      dispatch({ type: "set_pending_restore", value: null });
      pushToast("Backup restored. Enter password and press Start.", "success");
    } catch (err) {
      dispatch({ type: "set_status", message: "Restore failed", tone: "error" });
      dispatch({ type: "restore_end" });
      dispatch({ type: "close_modal" });
      dispatch({ type: "set_pending_restore", value: null });
      pushToast("Restore failed. Check your display name, password, or backup availability.", "error");
    }
  }

  async function confirmRestoreChoice(identityId) {
    const pending = state.pendingRestore;
    if (!pending?.username || !pending?.password) return;
    await completeRestore(identityId, pending.username, pending.password);
  }

  function cancelRestoreChoice() {
    dispatch({ type: "set_pending_restore", value: null });
    dispatch({ type: "restore_end" });
    dispatch({ type: "close_modal" });
    dispatch({ type: "set_status", message: "Restore cancelled", tone: "info" });
  }

  function handleStartGuard(choice) {
    const username = String(state.username || "").trim();
    dispatch({ type: "close_modal" });
    if (choice === "cancel") return;
    if (choice === "restore") {
      void handleRestoreRequest();
      return;
    }
    if (choice === "continue") {
      dispatch({ type: "allow_continue_without_restore", username });
      void performStart({ skipGuard: true });
    }
  }

  function handleBackupFreshnessWarning(choice) {
    dispatch({ type: "close_modal" });
    dispatch({ type: "set_pending_start_warning", value: null });
    if (choice === "restore") {
      void handleRestoreRequest();
      return;
    }
    if (choice === "continue") {
      void performStart({ skipGuard: true, skipBackupWarning: true });
    }
  }

  return {
    state,
    helpers: {
      formatIdentityShort,
      formatRestoreUpdatedAt,
      formatDateTimeShort,
    },
    actions: {
      setField,
      setMessageDraft: (value) => dispatch({ type: "message_draft", value }),
      setBackupPasswordInput: (value) =>
        dispatch({ type: "set_backup_password_input", value }),
      setPeerDraft,
      closeModal: () => dispatch({ type: "close_modal" }),
      selectPeer,
      commitPeerDraft,
      handleStart,
      handleLogout,
      handleSend,
      openBackupModal,
      confirmBackup,
      handleRestoreRequest,
      confirmRestoreChoice,
      cancelRestoreChoice,
      handleStartGuard,
      handleBackupFreshnessWarning,
    },
  };
}
