import { useEffect, useReducer } from "react";
import { destroyChat, initChat } from "../../chat.js";
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
        statusText: "Ready",
        statusTone: "success",
      };
    case "start_failure":
      return {
        ...state,
        started: false,
        starting: false,
        disconnected: false,
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
    default:
      return state;
  }
}

export function useChatApp() {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    dispatch({ type: "bridge_status", payload: runtimeSnapshotState() });

    const unsubscribe = subscribeToChatRuntime((event) => {
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

  return {
    state,
    actions: {
      setField,
      selectPeer,
      handleStart,
      handleLogout,
    },
  };
}
