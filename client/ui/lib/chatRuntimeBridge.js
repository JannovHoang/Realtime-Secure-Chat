const callbackSlots = [
  "onChatMessage",
  "onForcedLogout",
  "onChatDisconnected",
];

function createNoopSnapshot() {
  return {
    onChatMessage: window.onChatMessage || null,
    onForcedLogout: window.onForcedLogout || null,
    onChatDisconnected: window.onChatDisconnected || null,
  };
}

let bridgeInstalled = false;
let previousCallbacks = null;
const listeners = new Set();
const bridgeHandlers = {
  onChatMessage: null,
  onForcedLogout: null,
  onChatDisconnected: null,
};

function notifyListeners(event) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.warn("[ui bridge] listener error:", err);
    }
  }
}

function installBridge() {
  if (bridgeInstalled) return;

  previousCallbacks = createNoopSnapshot();

  bridgeHandlers.onChatMessage = (payload) => {
    notifyListeners({ type: "chat_message", payload });
  };
  window.onChatMessage = bridgeHandlers.onChatMessage;

  bridgeHandlers.onForcedLogout = (payload) => {
    notifyListeners({ type: "forced_logout", payload });
  };
  window.onForcedLogout = bridgeHandlers.onForcedLogout;

  bridgeHandlers.onChatDisconnected = () => {
    notifyListeners({ type: "chat_disconnected" });
  };
  window.onChatDisconnected = bridgeHandlers.onChatDisconnected;

  bridgeInstalled = true;
}

function restoreCallback(name) {
  if (window[name] !== bridgeHandlers[name]) return;
  window[name] = previousCallbacks?.[name] || null;
}

function uninstallBridge() {
  if (!bridgeInstalled || listeners.size > 0) return;

  for (const name of callbackSlots) {
    restoreCallback(name);
    bridgeHandlers[name] = null;
  }

  previousCallbacks = null;
  bridgeInstalled = false;
}

export function subscribeToChatRuntime(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  installBridge();
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    uninstallBridge();
  };
}

export function getChatRuntimeBridgeStatus() {
  return {
    installed: bridgeInstalled,
    listenerCount: listeners.size,
  };
}
