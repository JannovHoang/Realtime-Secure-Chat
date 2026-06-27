import { useEffect, useReducer, useRef } from "react";
import { buildLocalAccountProfile } from "../../account.js";
import {
  getFirebaseAuthAvailability,
  onAuthStateChanged,
  signInWithGoogle,
  signOut as signOutFirebase,
} from "../../auth/firebaseClient.js";
import {
  changeLocalVaultPassword,
  destroyChat,
  fetchCloudBackup,
  fetchCloudBackupIdentities,
  fetchRecentMessages,
  flushChatState,
  initChat,
  isPeerReady,
  mergeRecentMessagesForDisplay,
  onPeerReady,
  openConversation,
  saveCloudBackup,
  sendMessage,
  setupLocalRecoveryKey,
} from "../../chat.js";
import {
  initVault,
  decryptIdentityPayload,
  encryptIdentityPayload,
  exportIdentityPayload,
  getPersistedVaultMetadata,
  hasPersistedVault,
  importIdentityPayload,
  listConversationMetadata,
  loadBackupMetadata,
  saveBackupMetadata,
  loadIdentityMetadata,
  resetVaultPasswordWithRecoveryKey,
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
  changingVaultPassword: false,
  recoveringVaultPassword: false,
  settingUpRecoveryKey: false,
  restoredThisSession: false,
  restoredUsername: "",
  recoveredPasswordThisSession: false,
  recoveredPasswordUsername: "",
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
  changeVaultPasswordInput: {
    current: "",
    next: "",
    confirm: "",
  },
  recoveryPasswordInput: {
    recoveryKey: "",
    next: "",
    confirm: "",
  },
  pendingRecoveryReset: null,
  pendingRestore: null,
  pendingRestoreOverwrite: null,
  pendingRestoreStale: null,
  pendingLegacyRestore: null,
  pendingStartWarning: null,
  authAvailability: getFirebaseAuthAvailability(),
  authReady: false,
  authBusy: false,
  authUser: null,
  authError: "",
  toasts: [],
};

const STALE_SESSION_PREFIX = "securechat:stale-session:";

function trimPreview(text, max = 72) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + "...";
}

function normalizePeer(value) {
  return String(value || "").trim();
}

function staleSessionKey(username) {
  const normalized = normalizePeer(username);
  return normalized ? `${STALE_SESSION_PREFIX}${normalized}` : "";
}

function markLocalSessionStale(username, reason = "logged_in_elsewhere") {
  const key = staleSessionKey(username);
  if (!key) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        reason: String(reason || "logged_in_elsewhere"),
        at: new Date().toISOString(),
      })
    );
  } catch {}
}

function clearLocalSessionStale(username) {
  const key = staleSessionKey(username);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {}
}

function readLocalSessionStale(username) {
  const key = staleSessionKey(username);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
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

function formatBackupOwnership(info = {}) {
  const authMode = String(info.authMode || "").trim();
  const accountIdScheme = String(info.accountIdScheme || "").trim();
  const accountId = String(info.accountId || "").trim();

  if (authMode === "firebase" || accountIdScheme === "firebase" || accountId.startsWith("firebase:")) {
    return {
      label: "Google account backup",
      chipText: "Google backup",
      chipClass: "is-google",
      detail: "Owned by signed-in Google account",
    };
  }

  if (authMode === "legacy" || accountIdScheme || accountId.startsWith("local:")) {
    return {
      label: "Legacy display-name backup",
      chipText: "Legacy backup",
      chipClass: "is-legacy",
      detail: "Legacy backup scoped by display name",
    };
  }

  return {
    label: "Backup owner unknown",
    chipText: "Unknown backup",
    chipClass: "is-unknown",
    detail: "Backup ownership metadata unavailable",
  };
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

function getAccountCloudBackups(items, account) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    if (!item?.identityId) return false;
    if (item?.accountId && account?.accountId && item.accountId !== account.accountId) {
      return false;
    }
    return true;
  });
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

function getPreStartCloudBackupSignal(cloudItems, identityMeta, localBackupMeta, account) {
  const matchingCloudBackup = findMatchingCloudBackup(cloudItems, identityMeta, account);
  const freshnessSignal = getBackupFreshnessSignal(matchingCloudBackup, localBackupMeta);
  if (freshnessSignal) return freshnessSignal;

  const accountBackups = getAccountCloudBackups(cloudItems, account);
  if (!matchingCloudBackup && accountBackups.length > 0) {
    return {
      status: "Cloud backup identity differs",
      toast:
        "Cloud backup exists, but it does not match this browser's local identity. Restore first if this account was used elsewhere.",
      modalTitle: "Cloud Backup Identity Differs",
      modalSubtitle:
        "This display name has a cloud backup, but this browser is holding a different local identity. Restore from Cloud before chatting unless you intentionally want to continue with this local identity.",
    };
  }

  return null;
}

function normalizeFirebaseUser(user) {
  if (!user) return null;
  return {
    uid: String(user.uid || ""),
    displayName: String(user.displayName || ""),
    email: String(user.email || ""),
    photoURL: String(user.photoURL || ""),
  };
}

function getFirebaseDisplayNameSuggestion(user) {
  const normalizedUser = normalizeFirebaseUser(user);
  if (!normalizedUser?.uid) return "";
  const profileName = normalizePeer(normalizedUser.displayName);
  if (profileName) return profileName;
  const emailLocalPart = String(normalizedUser.email || "").split("@")[0];
  return normalizePeer(emailLocalPart);
}

function findConversationByPeer(conversations, peer) {
  const normalizedPeer = normalizePeer(peer);
  if (!normalizedPeer || !Array.isArray(conversations)) return null;
  return conversations.find((item) => normalizePeer(item?.peer) === normalizedPeer) || null;
}

function hasConversationEvidence(item) {
  return !!(
    item &&
    (String(item.lastMessagePreview || "").trim() || Number(item.lastMessageAt) > 0)
  );
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

function parseTimeMs(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const dt = new Date(value);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function getBackupBlobTimeMs(blob, payload = null) {
  return (
    parseTimeMs(blob?.serverSavedAt) ||
    parseTimeMs(blob?.clientSavedAt) ||
    parseTimeMs(payload?.clientSavedAt) ||
    parseTimeMs(payload?.exportedAt)
  );
}

function getLocalBackupCloudTimeMs(meta) {
  return (
    parseTimeMs(meta?.localLastBackupServerSavedAt) ||
    parseTimeMs(meta?.serverSavedAt) ||
    parseTimeMs(meta?.clientSavedAt)
  );
}

function getStaleRestoreWarning(localVaultMeta, localBackupMeta, localIdentityMeta, payload, blob) {
  if (!localVaultMeta?.savedAt || !localIdentityMeta?.identityId || !payload?.identityId) {
    return null;
  }
  if (localIdentityMeta.identityId !== payload.identityId) return null;

  const cloudBackupAt = getBackupBlobTimeMs(blob, payload);
  const localVaultSavedAt = parseTimeMs(localVaultMeta.savedAt);
  const localBackupRecordSavedAt = parseTimeMs(localBackupMeta?.savedAt);
  const localBackupCloudAt = getLocalBackupCloudTimeMs(localBackupMeta);
  const toleranceMs = 30_000;

  if (
    localBackupMeta?.identityId === payload.identityId &&
    localBackupCloudAt &&
    cloudBackupAt &&
    cloudBackupAt < localBackupCloudAt - toleranceMs
  ) {
    return {
      reason: "selected_backup_older_than_local_backup_record",
      cloudBackupAt,
      localVaultSavedAt,
      localBackupRecordSavedAt,
      localBackupCloudAt,
    };
  }

  if (
    localBackupMeta?.identityId === payload.identityId &&
    localBackupRecordSavedAt &&
    localVaultSavedAt > localBackupRecordSavedAt + toleranceMs &&
    (!cloudBackupAt || !localBackupCloudAt || cloudBackupAt <= localBackupCloudAt + toleranceMs)
  ) {
    return {
      reason: "local_state_changed_after_backup",
      cloudBackupAt,
      localVaultSavedAt,
      localBackupRecordSavedAt,
      localBackupCloudAt,
    };
  }

  if (!localBackupMeta?.identityId && cloudBackupAt && localVaultSavedAt > cloudBackupAt + toleranceMs) {
    return {
      reason: "local_state_newer_than_cloud_backup",
      cloudBackupAt,
      localVaultSavedAt,
      localBackupRecordSavedAt,
      localBackupCloudAt,
    };
  }

  return null;
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
      if (normalizePeer(action.peer) === state.activePeer) {
        return {
          ...state,
          peerDraft: normalizePeer(action.peer),
          activePeerReady: isPeerReady(action.peer),
        };
      }
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
      if (
        Array.isArray(action.items) &&
        action.items.length === 0 &&
        state.messages.length > 0
      ) {
        return {
          ...state,
          messageLoading: false,
        };
      }
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
      if (
        Array.isArray(action.items) &&
        action.items.length === 0 &&
        state.messages.length > 0
      ) {
        return {
          ...state,
          recentLoading: false,
        };
      }
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
        restoredThisSession: false,
        restoredUsername: "",
        recoveredPasswordThisSession: false,
        recoveredPasswordUsername: "",
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
    case "change_vault_password_begin":
      return {
        ...state,
        changingVaultPassword: true,
        statusText: "Changing vault password...",
        statusTone: "info",
      };
    case "change_vault_password_end":
      return { ...state, changingVaultPassword: false };
    case "recover_vault_password_begin":
      return {
        ...state,
        recoveringVaultPassword: true,
        statusText: "Recovering vault...",
        statusTone: "info",
      };
    case "recover_vault_password_end":
      return { ...state, recoveringVaultPassword: false };
    case "setup_recovery_key_begin":
      return {
        ...state,
        settingUpRecoveryKey: true,
        statusText: "Creating recovery key...",
        statusTone: "info",
      };
    case "setup_recovery_key_end":
      return { ...state, settingUpRecoveryKey: false };
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
      return {
        ...state,
        modal: null,
        backupPasswordInput: "",
        changeVaultPasswordInput: {
          current: "",
          next: "",
          confirm: "",
        },
        recoveryPasswordInput: {
          recoveryKey: "",
          next: "",
          confirm: "",
        },
      };
    case "set_backup_password_input":
      return { ...state, backupPasswordInput: action.value };
    case "set_change_vault_password_input":
      return {
        ...state,
        changeVaultPasswordInput: {
          ...state.changeVaultPasswordInput,
          [action.field]: action.value,
        },
      };
    case "set_recovery_password_input":
      return {
        ...state,
        recoveryPasswordInput: {
          ...state.recoveryPasswordInput,
          [action.field]: action.value,
        },
      };
    case "set_pending_recovery_reset":
      return { ...state, pendingRecoveryReset: action.value };
    case "set_pending_restore":
      return { ...state, pendingRestore: action.value };
    case "set_pending_restore_overwrite":
      return { ...state, pendingRestoreOverwrite: action.value };
    case "set_pending_restore_stale":
      return { ...state, pendingRestoreStale: action.value };
    case "set_pending_legacy_restore":
      return { ...state, pendingLegacyRestore: action.value };
    case "set_pending_start_warning":
      return { ...state, pendingStartWarning: action.value };
    case "auth_state": {
      const authUser = normalizeFirebaseUser(action.user);
      const suggestedDisplayName = getFirebaseDisplayNameSuggestion(action.user);
      const shouldPrefillDisplayName =
        !!authUser?.uid && !normalizePeer(state.username) && !!suggestedDisplayName;
      return {
        ...state,
        authReady: true,
        authBusy: false,
        authError: "",
        authUser,
        username: shouldPrefillDisplayName ? suggestedDisplayName : state.username,
      };
    }
    case "auth_begin":
      return {
        ...state,
        authBusy: true,
        authError: "",
      };
    case "auth_error":
      return {
        ...state,
        authBusy: false,
        authError: String(action.message || "Authentication failed"),
      };
    case "auth_availability":
      return {
        ...state,
        authAvailability: action.value || state.authAvailability,
      };
    case "restore_success":
      return {
        ...state,
        restoredThisSession: true,
        restoredUsername: normalizePeer(action.username),
        recoveredPasswordThisSession: !!action.recoveredPassword,
        recoveredPasswordUsername: action.recoveredPassword
          ? normalizePeer(action.username)
          : state.recoveredPasswordUsername,
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
  const usernameRef = useRef(initialState.username);

  useEffect(() => {
    activePeerRef.current = state.activePeer;
  }, [state.activePeer]);

  useEffect(() => {
    usernameRef.current = state.username;
  }, [state.username]);

  useEffect(() => {
    const availability = getFirebaseAuthAvailability();
    dispatch({ type: "auth_availability", value: availability });

    if (!availability.enabled) {
      dispatch({ type: "auth_state", user: null });
      return () => {};
    }

    return onAuthStateChanged((user) => {
      dispatch({ type: "auth_state", user });
    });
  }, []);

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
      if (event.type === "forced_logout") {
        markLocalSessionStale(
          usernameRef.current,
          event.payload?.reason || "logged_in_elsewhere"
        );
      }
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
    const activePeer = state.activePeer;
    void (async () => {
      dispatch({ type: "history_load_begin" });
      try {
        const localHistory = await openConversation(activePeer);
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
        const recent = await fetchRecentMessages(activePeer, 50);
        const merged = await mergeRecentMessagesForDisplay(activePeer, recent);
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
          authMode: backupMeta?.authMode || account?.authMode || "",
          firebaseUid: backupMeta?.firebaseUid || "",
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
      accountId: blob?.accountId || account?.accountId || payload?.accountId || "",
      accountIdScheme:
        blob?.accountIdScheme || account?.accountIdScheme || payload?.accountIdScheme || "",
      authMode: blob?.authMode || account?.authMode || "",
      firebaseUid: blob?.firebaseUid || "",
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
      const signal = getPreStartCloudBackupSignal(
        cloudItems,
        identityMeta,
        localBackupMeta,
        account
      );
      if (!signal) return null;
      return {
        ...signal,
        username,
      };
    } catch (err) {
      console.warn("[backup] pre-start freshness check skipped:", err);
      return {
        username,
        status: "Cloud backup check unavailable",
        toast:
          "Could not check cloud backup freshness. Restore may be temporarily rate limited or unavailable.",
        modalTitle: "Could Not Check Cloud Backup",
        modalSubtitle:
          "The app could not verify whether this browser has the latest encrypted state. If you recently used this account on another device, wait a few minutes and restore before chatting.",
      };
    }
  }

  async function performStart(options = {}) {
    const username = String(state.username || "").trim();
    const password = String(state.password || "");

    if (!username || !password) {
      dispatch({
        type: "start_failure",
        message: "Display name and vault password are required",
      });
      return;
    }

    const account = await buildLocalAccountProfile(username);
    const restoredThisUsername =
      state.restoredThisSession && normalizePeer(state.restoredUsername) === username;
    const recoveredPasswordThisUsername =
      state.recoveredPasswordThisSession &&
      normalizePeer(state.recoveredPasswordUsername) === username;
    const hasLocalVault = await hasPersistedVault(username);
    let localIdentityMeta = null;
    if (hasLocalVault) {
      const passwordOk = await verifyPersistedVaultPassword(username, password);
      if (!passwordOk) {
        dispatch({
          type: "start_failure",
          message:
            "The vault password did not unlock the local identity currently stored in this browser. Restore from Cloud first if this is a different identity.",
        });
        pushToast(
          "Start failed: incorrect vault password for this browser's local identity.",
          "error"
        );
        return;
      }

      localIdentityMeta = await inspectPersistedLocalIdentity(username, password);
    }

    const hasUsableLocalIdentity = hasLocalVault && !!localIdentityMeta?.identityId;
    const shouldGuard =
      !options.skipGuard &&
      !hasUsableLocalIdentity &&
      !restoredThisUsername &&
      !state.continueWithoutRestoreFor[username];

    if (shouldGuard) {
      dispatch({
        type: "open_modal",
        modal: { type: "start_guard", username },
      });
      return;
    }

    const staleSession = readLocalSessionStale(username);
    if (
      !options.skipBackupWarning &&
      hasUsableLocalIdentity &&
      staleSession &&
      !restoredThisUsername &&
      !state.continueWithoutRestoreFor[username]
    ) {
      dispatch({ type: "set_pending_start_warning", value: { username } });
      dispatch({
        type: "open_modal",
        modal: {
          type: "backup_freshness_warning",
          username,
          status: "Local session may be stale",
          toast:
            "This browser was logged out because the account started elsewhere. Restore before chatting unless you intentionally want to continue.",
          modalTitle: "Local Session May Be Stale",
          modalSubtitle:
            "This browser was replaced by another active device. If you used the account on that phone/browser, restore the latest cloud backup before chatting here.",
        },
      });
      return;
    }

    if (
      !options.skipBackupWarning &&
      hasUsableLocalIdentity &&
      !restoredThisUsername
    ) {
      const warning = await getPreStartBackupWarning(username, password, account);
      if (warning) {
        dispatch({ type: "set_pending_start_warning", value: { username } });
        dispatch({
          type: "open_modal",
          modal: recoveredPasswordThisUsername
            ? {
                type: "backup_freshness_warning",
                ...warning,
                recoveryPasswordReset: true,
                modalTitle: "Vault Password Recovered",
                modalSubtitle:
                  "This browser has a recovered local vault. Unlock it with the new password, then save a fresh cloud backup.",
              }
            : { type: "backup_freshness_warning", ...warning },
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
      if (!restoredThisUsername && !options.skipBackupWarning) {
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

  async function handleGoogleSignIn() {
    const availability = getFirebaseAuthAvailability();
    dispatch({ type: "auth_availability", value: availability });

    if (!availability.enabled) {
      const message =
        availability.authMode === "legacy"
          ? "Firebase Auth is disabled in legacy mode."
          : "Firebase Auth is not configured yet.";
      dispatch({ type: "auth_error", message });
      pushToast(message, "info");
      return;
    }

    dispatch({ type: "auth_begin" });
    try {
      await signInWithGoogle();
      pushToast(
        "Signed in with Google. Check the display name, then unlock or restore your vault.",
        "success"
      );
    } catch (err) {
      const message = String(err?.message || err || "Google sign-in failed");
      dispatch({ type: "auth_error", message });
      pushToast(message, "error");
    }
  }

  async function handleFirebaseSignOut() {
    dispatch({ type: "auth_begin" });
    try {
      if (state.started || state.disconnected) {
        await destroyChat();
        dispatch({ type: "logout_success" });
      }
      await signOutFirebase();
      dispatch({ type: "auth_state", user: null });
      pushToast("Signed out. Local vault data was not deleted.", "success");
    } catch (err) {
      const message = String(err?.message || err || "Sign out failed");
      dispatch({ type: "auth_error", message });
      pushToast(message, "error");
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
    const knownConversation = !!findConversationByPeer(state.conversations, peer);
    if (!knownConversation && !isPeerReady(peer)) {
      dispatch({ type: "set_peer_draft", value: state.activePeer || "" });
      pushToast(
        `No ready certificate or local conversation found for ${peer}. Check the display name or ask the peer to start first.`,
        "warning"
      );
      return;
    }
    dispatch({ type: "set_active_peer", peer });
  }

  function isActiveConversationDisplaySuspicious() {
    const activeConversation = findConversationByPeer(state.conversations, state.activePeer);
    return (
      !!state.activePeer &&
      hasConversationEvidence(activeConversation) &&
      !state.messageLoading &&
      !state.recentLoading &&
      Array.isArray(state.messages) &&
      state.messages.length === 0
    );
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
    if (state.messageLoading || state.recentLoading || state.sending) {
      pushToast("Wait for chat sync to finish before backup.", "warning");
      return;
    }
    if (isActiveConversationDisplaySuspicious()) {
      pushToast(
        "Backup blocked because the active conversation did not load correctly. Reload or reselect the conversation first.",
        "warning"
      );
      return;
    }
    dispatch({ type: "set_backup_password_input", value: "" });
    dispatch({ type: "open_modal", modal: { type: "backup_password" } });
  }

  async function confirmBackup() {
    const username = String(state.username || "").trim();
    const password = String(state.backupPasswordInput || "");
    if (!username || !password) {
      pushToast("Backup failed: vault password is required.", "error");
      return;
    }
    if (state.messageLoading || state.recentLoading || state.sending) {
      pushToast("Backup paused: wait for chat sync to finish.", "warning");
      return;
    }
    if (isActiveConversationDisplaySuspicious()) {
      pushToast(
        "Backup blocked because the active conversation did not load correctly.",
        "warning"
      );
      return;
    }

    dispatch({ type: "close_modal" });
    dispatch({ type: "backup_begin" });
    try {
      const account = await buildLocalAccountProfile(username);
      const passwordOk = await verifyPersistedVaultPassword(username, password);
      if (!passwordOk) throw new Error("Incorrect password");
      await flushChatState();
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
          accountId: backupReceipt?.accountId || account.accountId,
          displayName: account.displayName,
          accountIdScheme: backupReceipt?.accountIdScheme || account.accountIdScheme,
          authMode: backupReceipt?.authMode || account.authMode,
          firebaseUid: backupReceipt?.firebaseUid || null,
          identityId: payload.identityId,
          backupVersion: blob.version,
          clientSavedAt,
          serverSavedAt: backupReceipt?.serverSavedAt || blob.serverSavedAt || null,
        });
      } catch (metadataErr) {
        console.warn("[backup] failed to save local metadata:", metadataErr);
      }
      clearLocalSessionStale(username);
      dispatch({
        type: "identity_panel_set",
        value: {
          displayName: account.displayName,
          accountId: backupReceipt?.accountId || account.accountId,
          accountIdScheme: backupReceipt?.accountIdScheme || account.accountIdScheme,
          authMode: backupReceipt?.authMode || account.authMode,
          firebaseUid: backupReceipt?.firebaseUid || "",
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
          ? "Backup failed: incorrect vault password."
          : "Backup failed.",
        "error"
      );
    } finally {
      dispatch({ type: "backup_end" });
    }
  }

  function openChangeVaultPasswordModal() {
    if (!state.started || state.disconnected) {
      pushToast("Unlock the vault before changing its password.", "warning");
      return;
    }
    if (state.messageLoading || state.recentLoading || state.sending) {
      pushToast("Wait for chat sync to finish before changing the vault password.", "warning");
      return;
    }
    if (isActiveConversationDisplaySuspicious()) {
      pushToast(
        "Password change blocked because the active conversation did not load correctly.",
        "warning"
      );
      return;
    }
    dispatch({ type: "open_modal", modal: { type: "change_vault_password" } });
  }

  async function confirmChangeVaultPassword() {
    const current = String(state.changeVaultPasswordInput.current || "");
    const next = String(state.changeVaultPasswordInput.next || "");
    const confirm = String(state.changeVaultPasswordInput.confirm || "");

    if (!state.started || state.disconnected) {
      pushToast("Unlock the vault before changing its password.", "warning");
      return;
    }
    if (!current || !next || !confirm) {
      pushToast("Fill in the current and new vault passwords.", "warning");
      return;
    }
    if (next !== confirm) {
      pushToast("New vault password confirmation does not match.", "error");
      return;
    }
    if (current === next) {
      pushToast("New vault password must be different.", "warning");
      return;
    }
    if (state.messageLoading || state.recentLoading || state.sending) {
      pushToast("Wait for chat sync to finish before changing the vault password.", "warning");
      return;
    }

    dispatch({ type: "change_vault_password_begin" });
    try {
      await changeLocalVaultPassword(current, next);
      dispatch({ type: "close_modal" });
      dispatch({
        type: "set_status",
        message: "Vault password changed",
        tone: "success",
      });
      pushToast(
        "Vault password changed locally. Save a new cloud backup before switching devices.",
        "success"
      );
    } catch (err) {
      dispatch({
        type: "set_status",
        message: "Password change failed",
        tone: "error",
      });
      pushToast(String(err?.message || err || "Password change failed"), "error");
    } finally {
      dispatch({ type: "change_vault_password_end" });
    }
  }

  function openRecoveryKeyModal() {
    if (!state.started || state.disconnected) {
      pushToast("Unlock the vault before creating a recovery key.", "warning");
      return;
    }
    if (state.messageLoading || state.recentLoading || state.sending) {
      pushToast("Wait for chat sync to finish before creating a recovery key.", "warning");
      return;
    }
    if (isActiveConversationDisplaySuspicious()) {
      pushToast(
        "Recovery setup blocked because the active conversation did not load correctly.",
        "warning"
      );
      return;
    }
    dispatch({ type: "open_modal", modal: { type: "recovery_key_setup" } });
  }

  async function confirmSetupRecoveryKey() {
    if (!state.started || state.disconnected) {
      pushToast("Unlock the vault before creating a recovery key.", "warning");
      return;
    }

    dispatch({ type: "setup_recovery_key_begin" });
    try {
      const result = await setupLocalRecoveryKey();
      dispatch({
        type: "open_modal",
        modal: {
          type: "recovery_key_created",
          recoveryKey: result.recoveryKey,
          createdAt: result.createdAt,
          identityId: result.identityId,
        },
      });
      dispatch({
        type: "set_status",
        message: "Recovery key created",
        tone: "success",
      });
      pushToast(
        "Recovery key created. Save it now, then save a fresh cloud backup before switching devices.",
        "success"
      );
    } catch (err) {
      dispatch({
        type: "set_status",
        message: "Recovery setup failed",
        tone: "error",
      });
      pushToast(String(err?.message || err || "Recovery setup failed"), "error");
    } finally {
      dispatch({ type: "setup_recovery_key_end" });
    }
  }

  async function openRecoveryPasswordResetModal() {
    const username = String(state.username || "").trim();
    if (state.started && !state.disconnected) {
      pushToast("This vault is already unlocked. Use Change vault password instead.", "info");
      return;
    }
    if (!username) {
      pushToast("Enter the display name for the vault you want to recover.", "warning");
      return;
    }

    dispatch({ type: "recover_vault_password_begin" });
    try {
      const items = await fetchCloudBackupIdentities(username);
      const recoverable = Array.isArray(items)
        ? items.filter((item) => item?.hasRecoveryKey)
        : [];
      if (recoverable.length === 1) {
        dispatch({
          type: "set_pending_recovery_reset",
          value: {
            username,
            identityId: recoverable[0].identityId,
            includeAuth: true,
            source: "cloud",
          },
        });
        dispatch({
          type: "open_modal",
          modal: {
            type: "recovery_password_reset",
            username,
            identityId: recoverable[0].identityId,
            source: "cloud",
          },
        });
        return;
      }
      if (recoverable.length > 1) {
        dispatch({
          type: "set_pending_recovery_reset",
          value: { username, items: recoverable, includeAuth: true, source: "cloud" },
        });
        dispatch({
          type: "open_modal",
          modal: { type: "recovery_choice", items: recoverable },
        });
        return;
      }

      dispatch({
        type: "set_pending_recovery_reset",
        value: { username, identityId: null, includeAuth: false, source: "local" },
      });
      dispatch({
        type: "open_modal",
        modal: { type: "recovery_password_reset", username, source: "local" },
      });
      pushToast(
        "No cloud backup with a recovery key was found. Trying local recovery wrapper for this browser.",
        "info"
      );
    } catch (err) {
      console.warn("[recovery] cloud recovery lookup failed:", err);
      dispatch({
        type: "set_pending_recovery_reset",
        value: { username, identityId: null, includeAuth: false, source: "local" },
      });
      dispatch({
        type: "open_modal",
        modal: { type: "recovery_password_reset", username, source: "local" },
      });
      pushToast(
        "Cloud recovery lookup unavailable. You can still try the local recovery wrapper on this browser.",
        "info"
      );
    } finally {
      dispatch({ type: "recover_vault_password_end" });
    }
  }

  function confirmRecoveryResetChoice(identityId) {
    const pending = state.pendingRecoveryReset;
    if (!pending?.username || !identityId) return;
    dispatch({
      type: "set_pending_recovery_reset",
      value: {
        username: pending.username,
        identityId,
        includeAuth: pending.includeAuth !== false,
        source: "cloud",
      },
    });
    dispatch({
      type: "open_modal",
      modal: {
        type: "recovery_password_reset",
        username: pending.username,
        identityId,
        source: "cloud",
      },
    });
  }

  function cancelRecoveryResetChoice() {
    dispatch({ type: "set_pending_recovery_reset", value: null });
    dispatch({ type: "close_modal" });
    dispatch({ type: "set_status", message: "Recovery cancelled", tone: "info" });
  }

  async function confirmRecoveryPasswordReset() {
    const pending = state.pendingRecoveryReset || {};
    const username = String(pending.username || state.username || "").trim();
    const recoveryKey = String(state.recoveryPasswordInput.recoveryKey || "").trim();
    const next = String(state.recoveryPasswordInput.next || "");
    const confirm = String(state.recoveryPasswordInput.confirm || "");

    if (!username) {
      pushToast("Display name is required for recovery.", "warning");
      return;
    }
    if (!recoveryKey || !next || !confirm) {
      pushToast("Fill in the recovery key and new vault password.", "warning");
      return;
    }
    if (next !== confirm) {
      pushToast("New vault password confirmation does not match.", "error");
      return;
    }

    dispatch({ type: "recover_vault_password_begin" });
    try {
      let wrapper = null;
      let blob = null;
      if (pending.source === "cloud" && pending.identityId) {
        blob = await fetchCloudBackup(username, pending.identityId, {
          includeAuth: pending.includeAuth !== false,
        });
        wrapper = blob?.recoveryWrapper || null;
        if (!wrapper) {
          throw new Error("This cloud backup does not include a recovery key wrapper");
        }
      }

      const result = await resetVaultPasswordWithRecoveryKey(
        username,
        recoveryKey,
        next,
        wrapper
      );
      clearLocalSessionStale(username);
      const account = await buildLocalAccountProfile(username);
      if (blob) {
        try {
          await saveBackupMetadata({
            username,
            accountId: blob.accountId || result.accountId || account.accountId,
            displayName: result.displayName || account.displayName || username,
            accountIdScheme: blob.accountIdScheme || account.accountIdScheme,
            authMode: blob.authMode || account.authMode,
            firebaseUid: blob.firebaseUid || null,
            identityId: result.identityId,
            backupVersion: blob.version || 2,
            clientSavedAt: blob.clientSavedAt || null,
            serverSavedAt: blob.serverSavedAt || null,
          });
        } catch (metadataErr) {
          console.warn("[recovery] failed to save local backup metadata:", metadataErr);
        }
      }
      dispatch({
        type: "restore_success",
        username,
        account,
        recoveredPassword: true,
        identityPanel: {
          displayName: result.displayName || account.displayName || username,
          accountId: result.accountId || blob?.accountId || account.accountId || "",
          accountIdScheme: blob?.accountIdScheme || account.accountIdScheme || "",
          authMode: blob?.authMode || account.authMode || "",
          firebaseUid: blob?.firebaseUid || "",
          identityId: result.identityId || "",
          backupServerSavedAt: blob?.serverSavedAt || "",
          backupClientSavedAt: blob?.clientSavedAt || "",
        },
      });
      dispatch({ type: "close_modal" });
      dispatch({ type: "set_pending_recovery_reset", value: null });
      dispatch({
        type: "set_status",
        message: "Vault recovered",
        tone: "success",
      });
      pushToast(
        "Vault recovered locally. Unlock with the new password, then Backup to Cloud so future restores use the new password.",
        "success"
      );
    } catch (err) {
      dispatch({
        type: "set_status",
        message: "Recovery failed",
        tone: "error",
      });
      pushToast(String(err?.message || err || "Recovery failed"), "error");
    } finally {
      dispatch({ type: "recover_vault_password_end" });
    }
  }

  async function handleRestoreRequest() {
    const username = String(state.username || "").trim();
    const password = String(state.password || "");
    if (!username || !password) {
      pushToast("Please enter display name and vault password.", "error");
      return;
    }

    dispatch({ type: "restore_begin" });
    try {
      const items = await fetchCloudBackupIdentities(username);
      if (!Array.isArray(items) || items.length === 0) {
        if (state.authUser?.uid) {
          dispatch({
            type: "set_pending_legacy_restore",
            value: { username, password },
          });
          dispatch({ type: "restore_end" });
          dispatch({
            type: "open_modal",
            modal: { type: "legacy_restore_confirm", username },
          });
          return;
        }
        throw new Error("Restore unavailable");
      }
      if (items.length === 1) {
        await completeRestore(items[0].identityId, username, password);
        return;
      }
      dispatch({
        type: "set_pending_restore",
        value: { username, password, items, includeAuth: true, legacyRestore: false },
      });
      dispatch({
        type: "open_modal",
        modal: { type: "restore_choice", items },
      });
    } catch (err) {
      dispatch({ type: "set_status", message: "Restore failed", tone: "error" });
      dispatch({ type: "restore_end" });
      pushToast(
        String(err?.message || "Restore failed. Check your display name, password, or backup availability."),
        "error"
      );
    }
  }

  async function completeRestore(
    identityId,
    usernameArg = null,
    passwordArg = null,
    options = {}
  ) {
    const username = String(usernameArg || state.username || "").trim();
    const password = String(passwordArg || state.password || "");

    try {
      const account = await buildLocalAccountProfile(username);
      const isFirebaseRestore = !!state.authUser?.uid && options.includeAuth !== false;
      const selectedAccountId = state.pendingRestore?.items?.find(
        (item) => item?.identityId === identityId
      )?.accountId;
      if (!isFirebaseRestore && selectedAccountId && selectedAccountId !== account.accountId) {
        throw new Error("Backup account mismatch");
      }
      const blob = await fetchCloudBackup(username, identityId, {
        includeAuth: options.includeAuth !== false,
      });
      const payload = await decryptIdentityPayload(
        blob,
        password,
        username,
        identityId,
        isFirebaseRestore ? null : account.accountId
      );
      const hasLocalVault = await hasPersistedVault(username);
      const localVaultMeta = hasLocalVault
        ? await getPersistedVaultMetadata(username).catch(() => null)
        : null;
      let localIdentityMeta = null;
      let localBackupMeta = null;
      if (hasLocalVault) {
        localIdentityMeta = await inspectPersistedLocalIdentity(username, password);
        localBackupMeta = await loadBackupMetadata().catch(() => null);
      }
      if (hasLocalVault && !options.skipStaleRestoreConfirm) {
        const staleWarning = getStaleRestoreWarning(
          localVaultMeta,
          localBackupMeta,
          localIdentityMeta,
          payload,
          blob
        );
        if (staleWarning) {
          dispatch({
            type: "set_pending_restore_stale",
            value: {
              username,
              password,
              identityId,
              includeAuth: options.includeAuth !== false,
              legacyRestore: !!options.legacyRestore,
              staleWarning,
            },
          });
          dispatch({ type: "restore_end" });
          dispatch({ type: "close_modal" });
          dispatch({
            type: "open_modal",
            modal: {
              type: "restore_stale_confirm",
              username,
              reason: staleWarning.reason,
            },
          });
          return;
        }
      }

      if (hasLocalVault && !options.skipOverwriteConfirm) {
        dispatch({
          type: "set_pending_restore_overwrite",
          value: {
            username,
            password,
            identityId,
            includeAuth: options.includeAuth !== false,
            legacyRestore: !!options.legacyRestore,
            localIdentityShort: formatIdentityShort(localIdentityMeta?.identityId),
            targetIdentityShort: formatIdentityShort(payload.identityId),
            sameIdentity:
              !!localIdentityMeta?.identityId &&
              localIdentityMeta.identityId === payload.identityId,
            localIdentityUnknown: !localIdentityMeta?.identityId,
          },
        });
        dispatch({ type: "restore_end" });
        dispatch({ type: "close_modal" });
        dispatch({
          type: "open_modal",
          modal: {
            type: "restore_overwrite_confirm",
            username,
            localIdentityShort: formatIdentityShort(localIdentityMeta?.identityId),
            targetIdentityShort: formatIdentityShort(payload.identityId),
            sameIdentity:
              !!localIdentityMeta?.identityId &&
              localIdentityMeta.identityId === payload.identityId,
            localIdentityUnknown: !localIdentityMeta?.identityId,
          },
        });
        return;
      }

      await importIdentityPayload(
        payload,
        username,
        identityId,
        isFirebaseRestore ? null : account.accountId
      );
      clearLocalSessionStale(username);
      try {
        await initVault(password, username);
        await saveBackupMetadata({
          username,
          accountId: blob.accountId || account.accountId,
          displayName: account.displayName,
          accountIdScheme: blob.accountIdScheme || account.accountIdScheme,
          authMode: blob.authMode || account.authMode,
          firebaseUid: blob.firebaseUid || null,
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
        username,
        account,
        identityPanel: buildIdentityPanelFromRestore(account, payload, blob),
      });
      dispatch({ type: "restore_end" });
      dispatch({ type: "close_modal" });
      dispatch({ type: "set_pending_restore", value: null });
      dispatch({ type: "set_pending_restore_overwrite", value: null });
      dispatch({ type: "set_pending_restore_stale", value: null });
      pushToast(
        options.legacyRestore
          ? "Legacy backup restored. Start, then save a new cloud backup to associate it with your signed-in account."
          : "Backup restored. Enter vault password and press Start or Unlock vault.",
        "success"
      );
    } catch (err) {
      dispatch({ type: "set_status", message: "Restore failed", tone: "error" });
      dispatch({ type: "restore_end" });
      dispatch({ type: "close_modal" });
      dispatch({ type: "set_pending_restore", value: null });
      dispatch({ type: "set_pending_restore_overwrite", value: null });
      dispatch({ type: "set_pending_restore_stale", value: null });
      pushToast(
        String(err?.message || "Restore failed. Check your display name, vault password, or backup availability."),
        "error"
      );
    }
  }

  async function handleRestoreOverwriteConfirm(choice) {
    const pending = state.pendingRestoreOverwrite;
    if (choice !== "continue") {
      dispatch({ type: "set_pending_restore_overwrite", value: null });
      dispatch({ type: "close_modal" });
      dispatch({ type: "set_status", message: "Restore cancelled", tone: "info" });
      return;
    }

    if (!pending?.username || !pending?.password || !pending?.identityId) {
      dispatch({ type: "set_pending_restore_overwrite", value: null });
      dispatch({ type: "close_modal" });
      dispatch({ type: "set_status", message: "Restore failed", tone: "error" });
      pushToast("Restore failed. Please try again.", "error");
      return;
    }

    dispatch({ type: "close_modal" });
    dispatch({ type: "restore_begin" });
    await completeRestore(pending.identityId, pending.username, pending.password, {
      skipOverwriteConfirm: true,
      includeAuth: pending.includeAuth !== false,
      legacyRestore: !!pending.legacyRestore,
    });
  }

  async function handleRestoreStaleConfirm(choice) {
    const pending = state.pendingRestoreStale;
    if (choice !== "continue") {
      dispatch({ type: "set_pending_restore_stale", value: null });
      dispatch({ type: "close_modal" });
      dispatch({ type: "set_status", message: "Restore cancelled", tone: "info" });
      return;
    }

    if (!pending?.username || !pending?.password || !pending?.identityId) {
      dispatch({ type: "set_pending_restore_stale", value: null });
      dispatch({ type: "close_modal" });
      dispatch({ type: "set_status", message: "Restore failed", tone: "error" });
      pushToast("Restore failed. Please try again.", "error");
      return;
    }

    dispatch({ type: "close_modal" });
    dispatch({ type: "restore_begin" });
    await completeRestore(pending.identityId, pending.username, pending.password, {
      skipOverwriteConfirm: true,
      skipStaleRestoreConfirm: true,
      includeAuth: pending.includeAuth !== false,
      legacyRestore: !!pending.legacyRestore,
    });
  }

  async function confirmRestoreChoice(identityId) {
    const pending = state.pendingRestore;
    if (!pending?.username || !pending?.password) return;
    await completeRestore(identityId, pending.username, pending.password, {
      includeAuth: pending.includeAuth !== false,
      legacyRestore: !!pending.legacyRestore,
    });
  }

  function cancelRestoreChoice() {
    dispatch({ type: "set_pending_restore", value: null });
    dispatch({ type: "restore_end" });
    dispatch({ type: "close_modal" });
    dispatch({ type: "set_status", message: "Restore cancelled", tone: "info" });
  }

  async function handleLegacyRestoreConfirm(choice) {
    const pending = state.pendingLegacyRestore;
    dispatch({ type: "close_modal" });

    if (choice !== "continue") {
      dispatch({ type: "set_pending_legacy_restore", value: null });
      dispatch({ type: "set_status", message: "Restore cancelled", tone: "info" });
      return;
    }

    if (!pending?.username || !pending?.password) {
      dispatch({ type: "set_pending_legacy_restore", value: null });
      dispatch({ type: "set_status", message: "Restore failed", tone: "error" });
      pushToast("Restore failed. Please try again.", "error");
      return;
    }

    dispatch({ type: "restore_begin" });
    try {
      const items = await fetchCloudBackupIdentities(pending.username, {
        includeAuth: false,
      });
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Restore unavailable");
      }

      if (items.length === 1) {
        dispatch({ type: "set_pending_legacy_restore", value: null });
        await completeRestore(items[0].identityId, pending.username, pending.password, {
          includeAuth: false,
          legacyRestore: true,
        });
        return;
      }

      dispatch({
        type: "set_pending_restore",
        value: {
          username: pending.username,
          password: pending.password,
          items,
          includeAuth: false,
          legacyRestore: true,
        },
      });
      dispatch({ type: "set_pending_legacy_restore", value: null });
      dispatch({
        type: "open_modal",
        modal: { type: "restore_choice", items, legacyRestore: true },
      });
    } catch (err) {
      dispatch({ type: "set_pending_legacy_restore", value: null });
      dispatch({ type: "set_status", message: "Restore failed", tone: "error" });
      dispatch({ type: "restore_end" });
      pushToast(
        String(err?.message || "Restore failed. Check your display name, password, or backup availability."),
        "error"
      );
    }
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
    const isRecoveryPasswordReset = !!state.modal?.recoveryPasswordReset;
    dispatch({ type: "close_modal" });
    dispatch({ type: "set_pending_start_warning", value: null });
    if (choice === "restore" && !isRecoveryPasswordReset) {
      void handleRestoreRequest();
      return;
    }
    if (choice === "continue" || (choice === "restore" && isRecoveryPasswordReset)) {
      void performStart({ skipGuard: true, skipBackupWarning: true });
    }
  }

  return {
    state,
    helpers: {
      formatIdentityShort,
      formatRestoreUpdatedAt,
      formatDateTimeShort,
      formatBackupOwnership,
    },
    actions: {
      setField,
      setMessageDraft: (value) => dispatch({ type: "message_draft", value }),
      setBackupPasswordInput: (value) =>
        dispatch({ type: "set_backup_password_input", value }),
      setChangeVaultPasswordInput: (field, value) =>
        dispatch({ type: "set_change_vault_password_input", field, value }),
      setRecoveryPasswordInput: (field, value) =>
        dispatch({ type: "set_recovery_password_input", field, value }),
      setPeerDraft,
      closeModal: () => dispatch({ type: "close_modal" }),
      selectPeer,
      commitPeerDraft,
      handleStart,
      handleLogout,
      handleGoogleSignIn,
      handleFirebaseSignOut,
      handleSend,
      openBackupModal,
      confirmBackup,
      openChangeVaultPasswordModal,
      confirmChangeVaultPassword,
      openRecoveryKeyModal,
      confirmSetupRecoveryKey,
      openRecoveryPasswordResetModal,
      confirmRecoveryPasswordReset,
      confirmRecoveryResetChoice,
      cancelRecoveryResetChoice,
      handleRestoreRequest,
      confirmRestoreChoice,
      cancelRestoreChoice,
      handleLegacyRestoreConfirm,
      handleRestoreStaleConfirm,
      handleStartGuard,
      handleBackupFreshnessWarning,
      handleRestoreOverwriteConfirm,
    },
  };
}
