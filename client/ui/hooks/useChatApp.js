import { useEffect, useReducer } from "react";
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
  loadIdentityMetadata,
  verifyPersistedVaultPassword,
} from "../../storage.js";
import {
  getChatRuntimeBridgeStatus,
  subscribeToChatRuntime,
} from "../lib/chatRuntimeBridge.js";

const initialState = {
  username: "",
  password: "",
  started: false,
  starting: false,
  restoring: false,
  backingUp: false,
  restoredThisSession: false,
  continueWithoutRestoreFor: {},
  activePeer: "",
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

function reducer(state, action) {
  switch (action.type) {
    case "field_change":
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
      const hasActivePeer = normalized.some((item) => item.peer === state.activePeer);
      return {
        ...state,
        conversations: normalized,
        conversationsLoaded: true,
        activePeer: hasActivePeer ? state.activePeer : normalized[0]?.peer || "",
      };
    }
    case "set_active_peer":
      return {
        ...state,
        activePeer: normalizePeer(action.peer),
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
        disconnected: false,
        password: "",
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
        password: "",
        activePeer: "",
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
    case "restore_success":
      return {
        ...state,
        restoredThisSession: true,
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
      if (
        event.type === "chat_message" &&
        normalizePeer(event.payload?.from) === state.activePeer
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
        normalizePeer(event.payload?.from) !== state.activePeer
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
  }, [state.activePeer]);

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

  async function performStart(options = {}) {
    const username = String(state.username || "").trim();
    const password = String(state.password || "");

    if (!username || !password) {
      dispatch({
        type: "start_failure",
        message: "Username and password are required",
      });
      return;
    }

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

    dispatch({ type: "start_begin" });
    try {
      await initChat(username, password);
      dispatch({ type: "start_success" });
      pushToast("Ready.", "success");
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
      const passwordOk = await verifyPersistedVaultPassword(username, password);
      if (!passwordOk) throw new Error("Incorrect password");
      const payload = await exportIdentityPayload(username);
      const blob = await encryptIdentityPayload(payload, password);
      await saveCloudBackup(blob);
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
      pushToast("Please enter username and password.", "error");
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
      pushToast("Restore failed. Check your account/password or backup availability.", "error");
    }
  }

  async function completeRestore(identityId, usernameArg = null, passwordArg = null) {
    const username = String(usernameArg || state.username || "").trim();
    const password = String(passwordArg || state.password || "");

    try {
      const blob = await fetchCloudBackup(username, identityId);
      const payload = await decryptIdentityPayload(blob, password, username, identityId);
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

      await importIdentityPayload(payload, username, identityId);
      dispatch({ type: "restore_success" });
      dispatch({ type: "restore_end" });
      dispatch({ type: "close_modal" });
      dispatch({ type: "set_pending_restore", value: null });
      pushToast("Backup restored. Enter password and press Start.", "success");
    } catch (err) {
      dispatch({ type: "set_status", message: "Restore failed", tone: "error" });
      dispatch({ type: "restore_end" });
      dispatch({ type: "close_modal" });
      dispatch({ type: "set_pending_restore", value: null });
      pushToast("Restore failed. Check your account/password or backup availability.", "error");
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

  return {
    state,
    helpers: {
      formatIdentityShort,
      formatRestoreUpdatedAt,
    },
    actions: {
      setField,
      setMessageDraft: (value) => dispatch({ type: "message_draft", value }),
      setBackupPasswordInput: (value) =>
        dispatch({ type: "set_backup_password_input", value }),
      closeModal: () => dispatch({ type: "close_modal" }),
      selectPeer,
      handleStart,
      handleLogout,
      handleSend,
      openBackupModal,
      confirmBackup,
      handleRestoreRequest,
      confirmRestoreChoice,
      cancelRestoreChoice,
      handleStartGuard,
    },
  };
}
