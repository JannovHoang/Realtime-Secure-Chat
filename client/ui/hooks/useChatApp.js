import { useEffect, useReducer } from "react";
import {
  destroyChat,
  fetchRecentMessages,
  initChat,
  isPeerReady,
  mergeRecentMessagesForDisplay,
  onPeerReady,
  openConversation,
  sendMessage,
} from "../../chat.js";
import {
  getChatRuntimeBridgeStatus,
  subscribeToChatRuntime,
} from "../lib/chatRuntimeBridge.js";
import {
  hasPersistedVault,
  listConversationMetadata,
} from "../../storage.js";

const initialState = {
  username: "",
  password: "",
  started: false,
  starting: false,
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

function reducer(state, action) {
  switch (action.type) {
    case "field_change":
      return {
        ...state,
        [action.field]: action.value,
      };
    case "set_status":
      return {
        ...state,
        statusText: action.message || state.statusText,
        statusTone: action.tone || state.statusTone,
      };
    case "message_draft":
      return {
        ...state,
        messageDraft: action.value,
      };
    case "set_conversations": {
      const normalized = Array.isArray(action.items)
        ? sortConversations(
            action.items.map(normalizeConversationItem).filter(Boolean)
          )
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
      return {
        ...state,
        activePeerReady: !!action.value,
      };
    case "history_load_begin":
      return {
        ...state,
        messageLoading: true,
      };
    case "history_load_success":
      return {
        ...state,
        messageLoading: false,
        messages: Array.isArray(action.items) ? action.items : [],
      };
    case "history_load_failure":
      return {
        ...state,
        messageLoading: false,
      };
    case "recent_begin":
      return {
        ...state,
        recentLoading: true,
      };
    case "recent_success":
      return {
        ...state,
        recentLoading: false,
        messages: Array.isArray(action.items) ? action.items : state.messages,
      };
    case "recent_failure":
      return {
        ...state,
        recentLoading: false,
      };
    case "send_begin":
      return {
        ...state,
        sending: true,
      };
    case "send_success":
      return {
        ...state,
        sending: false,
        messageDraft: "",
        messages: Array.isArray(action.items) ? action.items : state.messages,
      };
    case "send_failure":
      return {
        ...state,
        sending: false,
      };
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
    default:
      return state;
  }
}

export function useChatApp() {
  const [state, dispatch] = useReducer(reducer, initialState);

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
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.started, state.activePeer]);

  async function handleStart() {
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
    if (!hasLocalVault) {
      dispatch({
        type: "start_failure",
        message: "Checkpoint 4 only supports existing local identities. Restore/new account flow returns later.",
      });
      return;
    }

    dispatch({ type: "start_begin" });

    try {
      await initChat(username, password);
      dispatch({ type: "start_success" });
    } catch (err) {
      dispatch({
        type: "start_failure",
        message: String(err?.message || err || "Start failed"),
      });
    }
  }

  async function handleLogout() {
    try {
      await destroyChat();
      dispatch({ type: "logout_success" });
    } catch (err) {
      dispatch({
        type: "start_failure",
        message: String(err?.message || err || "Logout failed"),
      });
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
    }
  }

  return {
    state,
    actions: {
      setField,
      setMessageDraft: (value) => dispatch({ type: "message_draft", value }),
      selectPeer,
      handleStart,
      handleLogout,
      handleSend,
    },
  };
}
