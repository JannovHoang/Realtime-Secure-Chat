import React from "react";
import { useChatApp } from "./hooks/useChatApp.js";
import brandLogo from "./assets/realtime-secure-chat-logo.png";

const COMPOSER_MAX_HEIGHT = 132;

function Field({
  label,
  placeholder,
  type = "text",
  value,
  onChange,
  disabled = false,
  trailing,
}) {
  return (
    <label>
      <span>{label}</span>
      <span className={trailing ? "input-wrap has-trailing" : "input-wrap"}>
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        {trailing}
      </span>
    </label>
  );
}

function formatMessageClass(message, username) {
  return message.from === username ? "msg me" : "msg peer";
}

function shouldSendMessageFromKeyDown(event) {
  if (event.key !== "Enter" || event.shiftKey) return false;
  const isCoarsePointer =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return !isCoarsePointer;
}

function PasswordVisibilityIcon({ visible }) {
  return (
    <svg
      aria-hidden="true"
      className="password-toggle-icon"
      viewBox="0 0 24 24"
      focusable="false"
    >
      <path
        d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      {visible ? (
        <path
          d="M4 20 20 4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
        />
      ) : null}
    </svg>
  );
}

function ToastViewport({ toasts }) {
  if (!Array.isArray(toasts) || toasts.length === 0) return null;
  return (
    <div className="toast-wrap">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-card is-${toast.tone || "info"}`}>
          <span className="toast-dot" aria-hidden="true" />
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  );
}

function AccountIdentityPanel({ info, helpers, backupNeeded = false, detailsOnly = false }) {
  if (!info?.displayName && !info?.identityId) return null;

  const accountShort = helpers.formatIdentityShort(info.accountId);
  const identityShort = helpers.formatIdentityShort(info.identityId);
  const backupTime = helpers.formatDateTimeShort(info.backupServerSavedAt);
  const backupOwnership = helpers.formatBackupOwnership(info);
  const backupChipClass = info.backupServerSavedAt
    ? backupOwnership.chipClass
    : "is-local";
  const backupStatusText = backupNeeded
    ? "Backup pending"
    : info.backupServerSavedAt
      ? backupOwnership.chipText
      : "Local only";
  const backupStatusClass = backupNeeded ? "is-pending" : backupChipClass;

  const detailsGrid = (
    <dl className="account-technical-grid">
      <div>
        <dt>Display name</dt>
        <dd>{info.displayName || "unknown"}</dd>
      </div>
      <div>
        <dt>Account ID</dt>
        <dd title={info.accountId || ""}>{accountShort}</dd>
      </div>
      <div>
        <dt>Identity ID</dt>
        <dd title={info.identityId || ""}>{identityShort}</dd>
      </div>
      <div>
        <dt>Backup time</dt>
        <dd>{backupTime || "not saved yet"}</dd>
      </div>
      <div>
        <dt>Backup</dt>
        <dd>{info.backupServerSavedAt ? backupOwnership.label : "Not backed up"}</dd>
      </div>
      <div>
        <dt>Account scheme</dt>
        <dd>{info.accountIdScheme || "legacy/local"}</dd>
      </div>
      <div>
        <dt>Backup owner</dt>
        <dd>{backupOwnership.detail}</dd>
      </div>
      <div>
        <dt>Auth mode</dt>
        <dd>{info.authMode || "legacy/local"}</dd>
      </div>
    </dl>
  );

  if (detailsOnly) {
    return detailsGrid;
  }

  return (
    <div className="account-panel">
      <div className="account-panel-main">
        <div className="account-panel-copy">
          <div className="account-panel-title">
            <span>{info.displayName || "unknown"}</span>
            <span aria-hidden="true">.</span>
            <span>Unlocked</span>
          </div>
        </div>
        <span className={`account-panel-chip ${backupStatusClass}`}>
          {backupStatusText}
        </span>
      </div>
    </div>
  );
}

function maskEmailAddress(email) {
  const value = typeof email === "string" ? email.trim() : "";
  const [local, domain] = value.split("@");
  if (!local || !domain) return "";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function formatFirebaseAccountLabel(user) {
  if (!user?.uid) return "Google account";
  const displayName = typeof user.displayName === "string" ? user.displayName.trim() : "";
  const maskedEmail = maskEmailAddress(user.email);
  return displayName || maskedEmail || "Google account";
}

function FirebaseAuthPanel({ state, actions }) {
  const availability = state.authAvailability || {};
  const enabled = !!availability.enabled;
  const signedIn = !!state.authUser?.uid;
  const maskedEmail = maskEmailAddress(state.authUser?.email);
  const label = signedIn
    ? formatFirebaseAccountLabel(state.authUser)
    : enabled
      ? state.authReady
        ? "Google sign-in available"
        : "Checking Google sign-in"
      : availability.authMode === "legacy"
        ? "Legacy account mode"
        : "Firebase not configured";
  const detail = signedIn
    ? `Signed in${maskedEmail ? ` as ${maskedEmail}` : ""}. Sign out closes the encrypted chat session but keeps local vault data.`
    : enabled
      ? "Sign-in proves account ownership only; it does not unlock E2EE keys."
      : "Current local display-name flow remains active.";

  return (
    <div className="firebase-auth-card">
      <div className="firebase-auth-copy">
        <div className="firebase-auth-eyebrow">Account auth</div>
        <div className="firebase-auth-title">{label}</div>
        <div className="firebase-auth-detail">{detail}</div>
        {state.authError ? (
          <div className="firebase-auth-error">{state.authError}</div>
        ) : null}
      </div>
      <div className="firebase-auth-actions">
        {signedIn ? (
          <button
            className="secondary compact"
            type="button"
            disabled={state.authBusy}
            onClick={() => {
              void actions.handleFirebaseSignOut();
            }}
          >
            {state.authBusy ? "Signing out..." : "Sign out"}
          </button>
        ) : (
          <span className={enabled ? "auth-mode-chip is-google" : "auth-mode-chip"}>
            {enabled ? "Google first" : "Local only"}
          </span>
        )}
      </div>
    </div>
  );
}

function ModalNote({ tone = "info", children }) {
  return <div className={`modal-note is-${tone}`}>{children}</div>;
}

function ModalFrame({ title, subtitle, children, actions, eyebrow = "Secure action" }) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-mark" aria-hidden="true">
            RS
          </div>
          <div className="modal-head-copy">
            <div className="modal-eyebrow">{eyebrow}</div>
            <div className="modal-title">{title}</div>
            {subtitle ? <div className="modal-sub">{subtitle}</div> : null}
          </div>
        </div>
        {children}
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}

export default function App() {
  const { state, actions, helpers } = useChatApp();
  const composerInputRef = React.useRef(null);
  const messagesViewportRef = React.useRef(null);
  const messagesEndRef = React.useRef(null);
  const shouldStickToBottomRef = React.useRef(true);
  const lastActivePeerRef = React.useRef("");
  const [showTopbarPassword, setShowTopbarPassword] = React.useState(false);
  const [showBackupPassword, setShowBackupPassword] = React.useState(false);
  const [showChangeCurrentPassword, setShowChangeCurrentPassword] = React.useState(false);
  const [showChangeNextPassword, setShowChangeNextPassword] = React.useState(false);
  const [showChangeConfirmPassword, setShowChangeConfirmPassword] = React.useState(false);
  const [showRecoveryKey, setShowRecoveryKey] = React.useState(false);
  const [showRecoveryNextPassword, setShowRecoveryNextPassword] = React.useState(false);
  const [showRecoveryConfirmPassword, setShowRecoveryConfirmPassword] = React.useState(false);
  const [firebaseVaultFallbackMode, setFirebaseVaultFallbackMode] = React.useState("");
  const [mobileChatOpen, setMobileChatOpen] = React.useState(false);
  const showPasswordField = !state.started || state.disconnected;
  const signedInWithGoogle = !!state.authUser?.uid;
  const googleAuthEnabled = !!state.authAvailability?.enabled;
  const firebaseDefaultVault = signedInWithGoogle ? state.defaultVaultPointer : null;
  const useDefaultVaultUnlock = !!firebaseDefaultVault && showPasswordField;
  const firebaseVaultLabel =
    firebaseDefaultVault?.displayName || firebaseDefaultVault?.legacyVaultLabel || "";
  const loadingFirebaseDefaultVault =
    signedInWithGoogle && showPasswordField && !state.defaultVaultPointerLoaded;
  const needsFirebaseVaultChoice =
    signedInWithGoogle &&
    showPasswordField &&
    state.defaultVaultPointerLoaded &&
    !firebaseDefaultVault &&
    !firebaseVaultFallbackMode;
  const usingFirebaseFallbackForm =
    signedInWithGoogle &&
    showPasswordField &&
    state.defaultVaultPointerLoaded &&
    !firebaseDefaultVault &&
    !!firebaseVaultFallbackMode;

  React.useEffect(() => {
    if (state.started || !signedInWithGoogle) {
      setFirebaseVaultFallbackMode("");
    }
  }, [signedInWithGoogle, state.started]);
  const startLabel = state.disconnected
    ? "Reconnect"
    : signedInWithGoogle
      ? "Unlock vault"
      : "Start";
  const busy =
    state.starting ||
    state.restoring ||
    state.backingUp ||
    state.changingVaultPassword ||
    state.recoveringVaultPassword ||
    state.resettingEncryptedIdentity ||
    state.settingUpRecoveryKey ||
    state.sending;
  const chatSyncing = state.messageLoading || state.recentLoading;
  const activeConversation = Array.isArray(state.conversations)
    ? state.conversations.find((item) => item.peer === state.activePeer)
    : null;
  const activeConversationLooksBlank =
    !!state.activePeer &&
    !!activeConversation &&
    (!!String(activeConversation.lastMessagePreview || "").trim() ||
      Number(activeConversation.lastMessageAt) > 0) &&
    !chatSyncing &&
    Array.isArray(state.messages) &&
    state.messages.length === 0;
  const startDisabled = busy || (state.started && !state.disconnected);
  const logoutDisabled = busy || !state.started;
  const backupDisabled =
    busy || chatSyncing || activeConversationLooksBlank || !state.started || state.disconnected;
  const peerInputValue = state.peerDraft || "";
  const sendDisabled =
    !state.started ||
    state.disconnected ||
    !state.activePeer ||
    !state.activePeerReady ||
    busy ||
    !String(state.messageDraft || "").trim();
  const showComposer =
    state.started && !state.disconnected && !!state.activePeer && state.activePeerReady;
  const showSignedOutGoogleEntry =
    !signedInWithGoogle && !state.started && !state.disconnected;
  const showUnlockedActions = state.started && !state.disconnected;
  const showMobileChatDetail =
    state.started && !!state.activePeer && mobileChatOpen;
  const mobileContentMode =
    showMobileChatDetail
      ? " is-mobile-chat-open"
      : " is-mobile-conversation-open";
  const workspaceInfo = state.identityPanel || {};
  const workspaceBackupOwnership = helpers.formatBackupOwnership(workspaceInfo);
  const workspaceBackupStatusClass = state.backupNeeded
    ? "is-pending"
    : workspaceInfo.backupServerSavedAt
      ? workspaceBackupOwnership.chipClass
      : "is-local";
  const workspaceBackupStatusText = state.backupNeeded
    ? "Backup pending"
    : workspaceInfo.backupServerSavedAt
      ? workspaceBackupOwnership.chipText
      : "Local only";
  const workspaceDisplayName =
    workspaceInfo.displayName || state.displayName || state.username || "Unlocked vault";
  const workspaceSignOutDisabled = signedInWithGoogle ? state.authBusy : logoutDisabled;
  const restoreLatestDisabled =
    busy || !state.started || state.disconnected || !state.username || !state.password;

  React.useEffect(() => {
    const textarea = composerInputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, COMPOSER_MAX_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  }, [state.messageDraft]);

  React.useEffect(() => {
    if (!showPasswordField) {
      setShowTopbarPassword(false);
    }
  }, [showPasswordField]);

  React.useEffect(() => {
    if (state.modal?.type !== "backup_password") {
      setShowBackupPassword(false);
    }
  }, [state.modal?.type]);

  React.useEffect(() => {
    if (state.modal?.type !== "change_vault_password") {
      setShowChangeCurrentPassword(false);
      setShowChangeNextPassword(false);
      setShowChangeConfirmPassword(false);
    }
  }, [state.modal?.type]);

  React.useEffect(() => {
    if (state.modal?.type !== "recovery_password_reset") {
      setShowRecoveryKey(false);
      setShowRecoveryNextPassword(false);
      setShowRecoveryConfirmPassword(false);
    }
  }, [state.modal?.type]);

  React.useEffect(() => {
    if (!signedInWithGoogle || firebaseDefaultVault || state.started) {
      setFirebaseVaultFallbackMode("");
    }
  }, [signedInWithGoogle, firebaseDefaultVault, state.started]);

  React.useEffect(() => {
    if (!state.started || !state.activePeer) {
      setMobileChatOpen(false);
    }
  }, [state.started, state.activePeer]);

  React.useEffect(() => {
    const activePeerChanged = lastActivePeerRef.current !== state.activePeer;
    if (activePeerChanged) {
      lastActivePeerRef.current = state.activePeer;
      shouldStickToBottomRef.current = true;
    }

    if (!state.activePeer) return;
    if (!activePeerChanged && !shouldStickToBottomRef.current) return;

    window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        block: "end",
        behavior: activePeerChanged ? "auto" : "smooth",
      });
    });
  }, [state.activePeer, state.messages.length, state.messageLoading, state.recentLoading]);

  const handleMessagesScroll = React.useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 96;
  }, []);

  const openMobilePeer = React.useCallback(
    (peer) => {
      actions.selectPeer(peer);
      setMobileChatOpen(true);
    },
    [actions]
  );

  const commitMobilePeerDraft = React.useCallback(() => {
    actions.commitPeerDraft();
    if (state.started && String(peerInputValue || "").trim()) {
      setMobileChatOpen(true);
    }
  }, [actions, peerInputValue, state.started]);

  const shellModeClass = [
    showUnlockedActions ? "is-unlocked-shell" : "is-account-shell",
    showMobileChatDetail ? "is-mobile-chat-detail" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`shell ${shellModeClass}`}>
      <div className="topbar">
        {showUnlockedActions ? (
          <div className="workspace-topbar">
            <div className="workspace-brand">
              <img
                className="workspace-logo"
                src={brandLogo}
                alt="Realtime Secure Chat"
              />
            </div>
            <div className="workspace-summary">
              <div className="workspace-title-row">
                <span className="workspace-name">{workspaceDisplayName}</span>
                <span aria-hidden="true">.</span>
                <span>Vault unlocked</span>
              </div>
            </div>
            <span className={`workspace-backup-chip ${workspaceBackupStatusClass}`}>
              {workspaceBackupStatusText}
            </span>
            <div className="workspace-actions">
              <button
                className="secondary"
                type="button"
                disabled={backupDisabled}
                onClick={() => {
                  actions.openBackupModal();
                }}
              >
                Backup to Cloud
              </button>
              <details className="workspace-settings-menu">
                <summary>Settings</summary>
                <div className="workspace-settings-panel">
                  <div className="workspace-settings-section">Profile / Identity</div>
                  <div className="workspace-settings-copy">
                    <strong>{workspaceDisplayName}</strong>
                  </div>
                  <div className="workspace-settings-section">Vault</div>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || !state.started || state.disconnected}
                    onClick={() => {
                      actions.openChangeVaultPasswordModal();
                    }}
                  >
                    Change vault password
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || !state.started || state.disconnected}
                    onClick={() => {
                      actions.openRecoveryKeyModal();
                    }}
                  >
                    Create recovery key
                  </button>
                  <div className="workspace-settings-section">Backup</div>
                  <button
                    className="secondary"
                    type="button"
                    disabled={backupDisabled}
                    onClick={() => {
                      actions.openBackupModal();
                    }}
                  >
                    Backup to Cloud
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={restoreLatestDisabled}
                    onClick={() => {
                      void actions.handleRestoreRequest();
                    }}
                  >
                    Restore latest backup
                  </button>
                  <div className="workspace-settings-section">Advanced</div>
                  <details className="workspace-technical-details">
                    <summary>Technical details</summary>
                    <AccountIdentityPanel
                      info={state.identityPanel}
                      helpers={helpers}
                      backupNeeded={state.backupNeeded}
                      detailsOnly
                    />
                  </details>
                  <div className="workspace-settings-section danger">Danger zone</div>
                  <button
                    className="secondary danger"
                    type="button"
                    disabled={busy || !state.started || state.disconnected}
                    onClick={() => {
                      void actions.openResetEncryptedIdentityModal();
                    }}
                  >
                    Start over with a new encrypted identity
                  </button>
                </div>
              </details>
              <button
                className="secondary"
                type="button"
                disabled={workspaceSignOutDisabled}
                onClick={() => {
                  if (signedInWithGoogle) {
                    void actions.handleFirebaseSignOut();
                  } else {
                    void actions.handleLogout();
                  }
                }}
              >
                {signedInWithGoogle && state.authBusy ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="brand">
              <img
                className="brand-logo"
                src={brandLogo}
                alt="Realtime Secure Chat"
              />
            </div>

            <div className="login">
          {showSignedOutGoogleEntry ? (
            <div className="signed-out-entry">
              <div className="google-entry-card">
                <div className="google-entry-copy">
                  <div className="google-entry-eyebrow">Secure account</div>
                  <div className="google-entry-title">Sign in with Google</div>
                  <div className="google-entry-detail">
                    Google identifies your account. The vault password still
                    unlocks E2EE keys on this browser.
                  </div>
                </div>
                <button
                  className="primary"
                  type="button"
                  disabled={state.authBusy || !googleAuthEnabled}
                  onClick={() => {
                    void actions.handleGoogleSignIn();
                  }}
                >
                  {state.authBusy ? "Signing in..." : "Sign in with Google"}
                </button>
              </div>

              <details className="legacy-entry">
                <summary>Use legacy local mode</summary>
                <div className="legacy-entry-body">
                  <div className="auth-fields">
                    <Field
                      label="Display name"
                      placeholder="Enter your display name"
                      value={state.username}
                      onChange={(value) => actions.setField("username", value)}
                      disabled={busy}
                    />
                    <Field
                      label="Vault password"
                      placeholder="Enter your vault password"
                      type={showTopbarPassword ? "text" : "password"}
                      value={state.password}
                      onChange={(value) => actions.setField("password", value)}
                      disabled={busy}
                      trailing={
                        <button
                          className="password-toggle"
                          type="button"
                          aria-label={
                            showTopbarPassword
                              ? "Hide vault password"
                              : "Show vault password"
                          }
                          aria-pressed={showTopbarPassword}
                          disabled={busy}
                          onClick={() => setShowTopbarPassword((value) => !value)}
                        >
                          <PasswordVisibilityIcon visible={showTopbarPassword} />
                        </button>
                      }
                    />
                  </div>
                  <div className="topbar-actions legacy-entry-actions">
                    <button
                      className="secondary"
                      type="button"
                      disabled={startDisabled}
                      onClick={() => {
                        void actions.handleStart();
                      }}
                    >
                      Start local session
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy || state.started || !state.username || !state.password}
                      onClick={() => {
                        void actions.handleRestoreRequest();
                      }}
                    >
                      Restore from Cloud
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy || state.started || !state.username}
                      onClick={() => {
                        void actions.openRecoveryPasswordResetModal();
                      }}
                    >
                      Use recovery key
                    </button>
                  </div>
                </div>
              </details>
            </div>
          ) : loadingFirebaseDefaultVault ? (
            <div className="auth-fields">
              <div className="firebase-vault-choice">
                <div className="firebase-vault-choice-title">Checking encrypted identity</div>
                <div className="firebase-vault-choice-detail">
                  Looking for this Google account's local vault on this browser.
                </div>
              </div>
            </div>
          ) : needsFirebaseVaultChoice ? (
            <div className="firebase-vault-choice">
              <div className="firebase-vault-choice-title">
                No encrypted identity found on this browser
              </div>
              <div className="firebase-vault-choice-detail">
                Restore a cloud backup, create a new encrypted identity, or
                migrate an existing legacy local vault.
              </div>
              <div className="firebase-vault-choice-actions">
                <button
                  className="primary"
                  type="button"
                  disabled={busy || state.started}
                  onClick={() => setFirebaseVaultFallbackMode("restore")}
                >
                  Restore from Cloud
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={busy || state.started}
                  onClick={() => setFirebaseVaultFallbackMode("create")}
                >
                  Create new encrypted identity
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={busy || state.started}
                  onClick={() => setFirebaseVaultFallbackMode("legacy")}
                >
                  Use legacy local identity
                </button>
              </div>
            </div>
          ) : useDefaultVaultUnlock ? (
            <div className="vault-unlock-card">
              <div className="vault-unlock-head">
                <div className="vault-unlock-copy">
                  <div className="vault-unlock-eyebrow">Encrypted vault</div>
                  <div className="vault-unlock-title">
                    {state.disconnected ? "Reconnect secure session" : "Unlock encrypted vault"}
                  </div>
                  {firebaseVaultLabel ? (
                    <div className="vault-unlock-detail">
                      <span>
                        <strong>Vault label</strong>
                        {firebaseVaultLabel}
                      </span>
                    </div>
                  ) : null}
                </div>
                <span className="vault-unlock-chip">Local vault</span>
              </div>

              <div className="vault-unlock-controls">
                <Field
                  label="Vault password"
                  placeholder="Enter your vault password"
                  type={showTopbarPassword ? "text" : "password"}
                  value={state.password}
                  onChange={(value) => actions.setField("password", value)}
                  disabled={busy}
                  trailing={
                    <button
                      className="password-toggle"
                      type="button"
                      aria-label={
                        showTopbarPassword ? "Hide vault password" : "Show vault password"
                      }
                      aria-pressed={showTopbarPassword}
                      disabled={busy}
                      onClick={() => setShowTopbarPassword((value) => !value)}
                    >
                      <PasswordVisibilityIcon visible={showTopbarPassword} />
                    </button>
                  }
                />
                <div className="vault-unlock-actions">
                  <button
                    className="primary"
                    type="button"
                    disabled={startDisabled}
                    onClick={() => {
                      void actions.handleStart();
                    }}
                  >
                    {startLabel}
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || state.started || !state.username || !state.password}
                    onClick={() => {
                      void actions.handleRestoreRequest();
                    }}
                  >
                    Restore Latest Backup
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || state.started || !state.username}
                    onClick={() => {
                      void actions.openRecoveryPasswordResetModal();
                    }}
                  >
                    Use recovery key
                  </button>
                </div>
              </div>
              <div className="vault-unlock-note">
                The vault password unlocks E2EE keys stored on this browser.
              </div>
              <details className="vault-unlock-danger">
                <summary>Can't unlock?</summary>
                <button
                  className="secondary danger"
                  type="button"
                  disabled={busy || state.started}
                  onClick={() => {
                    void actions.openResetEncryptedIdentityModal();
                  }}
                >
                  Start over with a new encrypted identity
                </button>
              </details>
            </div>
          ) : (
            <>
              <div className="auth-fields">
                {useDefaultVaultUnlock ? (
                  <div className="auth-context-note">
                    <strong>Display name:</strong>{" "}
                    {firebaseDefaultVault.displayName ||
                      firebaseDefaultVault.legacyVaultLabel}
                  </div>
                ) : (
                  <Field
                    label={
                      usingFirebaseFallbackForm
                        ? firebaseVaultFallbackMode === "restore"
                          ? "Vault label"
                          : "Display name"
                        : "Display name"
                    }
                    placeholder={
                      signedInWithGoogle
                        ? firebaseVaultFallbackMode === "restore"
                          ? "Backup display name"
                          : firebaseVaultFallbackMode === "legacy"
                            ? "Existing local display name"
                            : "Display name for this vault"
                        : "Enter your display name"
                    }
                    value={state.username}
                    onChange={(value) => actions.setField("username", value)}
                    disabled={busy}
                  />
                )}
                {showPasswordField ? (
                  <Field
                    label="Vault password"
                    placeholder={
                      firebaseVaultFallbackMode === "create"
                        ? "Create a vault password"
                        : "Enter your vault password"
                    }
                    type={showTopbarPassword ? "text" : "password"}
                    value={state.password}
                    onChange={(value) => actions.setField("password", value)}
                    disabled={busy}
                    trailing={
                      <button
                        className="password-toggle"
                        type="button"
                        aria-label={showTopbarPassword ? "Hide vault password" : "Show vault password"}
                        aria-pressed={showTopbarPassword}
                        disabled={busy}
                        onClick={() => setShowTopbarPassword((value) => !value)}
                      >
                        <PasswordVisibilityIcon visible={showTopbarPassword} />
                      </button>
                    }
                  />
                ) : null}
                {signedInWithGoogle ? (
                  <div className="auth-context-note">
                    {useDefaultVaultUnlock
                      ? "Google identifies your account. Enter the vault password to unlock E2EE keys."
                      : firebaseVaultFallbackMode === "restore"
                        ? "Restore currently needs the backup display name plus vault password."
                        : firebaseVaultFallbackMode === "legacy"
                          ? "Unlock once to bind this local vault to the signed-in Google account."
                          : firebaseVaultFallbackMode === "create"
                            ? "This creates a new encrypted identity for this Google account."
                            : "Google identifies your account. Display name labels this chat identity."}
                  </div>
                ) : null}
              </div>

              <div className="topbar-actions">
                {usingFirebaseFallbackForm ? (
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setFirebaseVaultFallbackMode("")}
                  >
                    Back
                  </button>
                ) : null}
                {firebaseVaultFallbackMode === "restore" ? (
                  <button
                    className="primary"
                    type="button"
                    disabled={busy || state.started || !state.username || !state.password}
                    onClick={() => {
                      void actions.handleRestoreRequest();
                    }}
                  >
                    Restore from Cloud
                  </button>
                ) : firebaseVaultFallbackMode === "create" ? (
                    <button
                      className="primary"
                      type="button"
                      disabled={busy || state.started || !state.username || !state.password}
                      onClick={() => {
                      void actions.openResetEncryptedIdentityModal();
                      }}
                    >
                      Create identity
                  </button>
                ) : firebaseVaultFallbackMode === "legacy" ? (
                  <button
                    className="primary"
                    type="button"
                    disabled={startDisabled}
                    onClick={() => {
                      void actions.handleStart();
                    }}
                  >
                    Use legacy identity
                  </button>
                ) : !showUnlockedActions ? (
                  <>
                    <button
                      className="primary"
                      type="button"
                      disabled={startDisabled}
                      onClick={() => {
                        void actions.handleStart();
                      }}
                    >
                      {startLabel}
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy || state.started || !state.username || !state.password}
                      onClick={() => {
                        void actions.handleRestoreRequest();
                      }}
                    >
                      Restore from Cloud
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy || state.started || !state.username}
                      onClick={() => {
                        void actions.openRecoveryPasswordResetModal();
                      }}
                    >
                      Use recovery key
                    </button>
                  </>
                ) : null}
              </div>
            </>
          )}

          <div className="topbar-status">
            <div className="status-label">Session status</div>
            <div className={`status migration-status is-${state.statusTone}`}>
              {state.statusText}
            </div>
          </div>

          {showSignedOutGoogleEntry ? null : (
            <FirebaseAuthPanel state={state} actions={actions} />
          )}
            </div>
          </>
        )}
      </div>

      <div
        className={`content${state.started ? " is-started" : " is-prestart"}${mobileContentMode}`}
      >
        <aside className="sidebar">
          <form
            className="peer-target-card"
            onSubmit={(e) => {
              e.preventDefault();
              commitMobilePeerDraft();
            }}
          >
            <div className="field">
              <label>Chat with</label>
              <input
                placeholder={
                  state.started
                    ? "Type a peer display name and press Enter"
                    : "Start a session to load local conversations"
                }
                value={peerInputValue}
                onChange={(e) => actions.setPeerDraft(e.target.value)}
                disabled={!state.started}
                enterKeyHint="go"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitMobilePeerDraft();
                  }
                }}
              />
            </div>
            <div className="peer-target-hint">
              {state.started
                ? "Open an existing chat or type a peer display name to start one."
                : "Start or restore a session before choosing a peer."}
            </div>
          </form>

          <div className="peer-list">
            <div className="peer-list-title-row">
              <div className="peer-list-head">Conversations</div>
              {state.started ? (
                <div className="peer-count">
                  {state.conversations.length}
                </div>
              ) : null}
            </div>
            {state.started && state.conversations.length > 0 ? (
              <div className="peer-items">
                {state.conversations.map((item) => (
                  <button
                    key={item.peer}
                    type="button"
                    className={
                      "peer-item" + (item.peer === state.activePeer ? " active" : "")
                    }
                    aria-current={item.peer === state.activePeer ? "true" : undefined}
                    onClick={() => openMobilePeer(item.peer)}
                  >
                    <span className="peer-avatar">
                      {item.peer.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="peer-copy">
                      <span className="peer-name">{item.peer}</span>
                      {item.lastMessagePreview ? (
                        <span className="peer-preview" title={item.lastMessagePreview}>
                          {item.lastMessagePreview}
                        </span>
                      ) : (
                        <span className="peer-preview is-empty">No messages yet</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="peer-empty">
                {state.started
                  ? "No local conversations were found in this vault yet."
                  : "Start a local session to load conversations from the current vault."}
              </div>
            )}
          </div>

          <AccountIdentityPanel
            info={state.identityPanel}
            helpers={helpers}
            backupNeeded={state.backupNeeded}
          />
        </aside>

        <main className="chat">
          {state.started && state.activePeer ? (
            <div className="chat-pane-head">
              <button
                className="mobile-back-button"
                type="button"
                onClick={() => setMobileChatOpen(false)}
              >
                <span aria-hidden="true">{"<"}</span>
                <span>Back to conversations</span>
              </button>
              <div className="chat-pane-identity">
                <div className="chat-pane-title">{state.activePeer}</div>
                <div className="chat-pane-sub">
                  {state.activePeerReady
                    ? "Peer certificate is ready"
                    : "Waiting for peer certificate"}
                </div>
              </div>
              <div
                className={
                  "chat-pane-badge" +
                  (state.activePeerReady ? " is-ready" : " is-waiting")
                }
              >
                {state.activePeerReady ? "Ready" : "Syncing"}
              </div>
            </div>
          ) : null}
          <div
            className="messages"
            ref={messagesViewportRef}
            onScroll={handleMessagesScroll}
          >
            {state.started && state.activePeer ? (
              <div className="chat-pane">
                {state.messageLoading ? (
                  <div className="history-loading">Loading local history...</div>
                ) : null}
                {state.recentLoading ? (
                  <div className="history-loading">Loading recent messages...</div>
                ) : null}

                {state.messages.length > 0 ? (
                  state.messages.map((message, index) => (
                    <div
                      key={`${message.from}-${message.ts || 0}-${index}`}
                      className={formatMessageClass(message, state.username)}
                    >
                      {message.text}
                    </div>
                  ))
                ) : (
                  <div className="peer-empty chat-empty">
                    No local messages loaded for this conversation yet.
                  </div>
                )}
                <div className="message-scroll-anchor" ref={messagesEndRef} />
              </div>
            ) : (
              <div className="migration-messages">
                <div className="migration-card chat-empty-card">
                  <div className="migration-card-title">Secure conversations</div>
                  <p>
                    {state.started
                      ? "Choose a conversation from the sidebar to load local history and continue chatting."
                      : "Restore an existing identity or start a secure session to load local conversations on this device."}
                  </p>
                  {!state.started ? (
                    <p>
                      Use the top bar to restore a cloud backup or create a new local
                      identity for this browser.
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {state.started && !state.disconnected && state.backupNeeded ? (
            <div className="backup-needed-banner">
              <div className="backup-needed-copy">
                <strong>Local changes are not backed up yet.</strong>
                <span>Back up before switching devices.</span>
              </div>
              <button
                className="secondary compact"
                type="button"
                disabled={backupDisabled}
                onClick={() => {
                  actions.openBackupModal();
                }}
              >
                Backup to Cloud
              </button>
            </div>
          ) : null}

          {state.started && state.activePeer && !state.activePeerReady ? (
            <div className="peer-waiting-note">Waiting for peer certificate...</div>
          ) : null}

          {showComposer ? (
            <div className="composer">
              <textarea
                ref={composerInputRef}
                rows={1}
                aria-label="Message"
                placeholder="Type a message..."
                value={state.messageDraft}
                onChange={(e) => actions.setMessageDraft(e.target.value)}
                disabled={state.sending}
                onKeyDown={(e) => {
                  if (shouldSendMessageFromKeyDown(e)) {
                    e.preventDefault();
                    void actions.handleSend();
                  }
                }}
              />
              <button
                type="button"
                disabled={sendDisabled}
                onClick={() => {
                  void actions.handleSend();
                }}
              >
                Send
              </button>
            </div>
          ) : null}
        </main>
      </div>
      {state.modal?.type === "backup_password" ? (
        <ModalFrame
          title="Backup to Cloud"
          subtitle="Enter your vault password to encrypt and save this account label's current local identity."
          eyebrow="Encrypted backup"
          actions={
            <>
              <button className="secondary" type="button" onClick={actions.closeModal}>
                Cancel
              </button>
              <button className="primary" type="button" onClick={() => void actions.confirmBackup()}>
                Save Backup
              </button>
            </>
          }
        >
          <label className="modal-field">
            <span>Vault password</span>
            <input
              type={showBackupPassword ? "text" : "password"}
              placeholder="Enter your vault password"
              value={state.backupPasswordInput}
              onChange={(e) => actions.setBackupPasswordInput(e.target.value)}
            />
            <button
              className="password-toggle modal-password-toggle"
              type="button"
              aria-label={showBackupPassword ? "Hide backup vault password" : "Show backup vault password"}
              aria-pressed={showBackupPassword}
              onClick={() => setShowBackupPassword((value) => !value)}
            >
              <PasswordVisibilityIcon visible={showBackupPassword} />
            </button>
          </label>
          <ModalNote>
            Save a backup after important chats and before switching devices. The
            server stores an encrypted backup only; it cannot read your messages
            or keys.
          </ModalNote>
        </ModalFrame>
      ) : null}

      {state.modal?.type === "change_vault_password" ? (
        <ModalFrame
          title="Change Vault Password"
          subtitle="Re-encrypt this browser's local vault with a new password. This does not save a cloud backup automatically."
          eyebrow="Vault recovery"
          actions={
            <>
              <button className="secondary" type="button" onClick={actions.closeModal}>
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                disabled={state.changingVaultPassword}
                onClick={() => void actions.confirmChangeVaultPassword()}
              >
                Change Password
              </button>
            </>
          }
        >
          <label className="modal-field">
            <span>Current vault password</span>
            <input
              type={showChangeCurrentPassword ? "text" : "password"}
              placeholder="Enter current vault password"
              value={state.changeVaultPasswordInput.current}
              onChange={(e) =>
                actions.setChangeVaultPasswordInput("current", e.target.value)
              }
            />
            <button
              className="password-toggle modal-password-toggle"
              type="button"
              aria-label={
                showChangeCurrentPassword
                  ? "Hide current vault password"
                  : "Show current vault password"
              }
              aria-pressed={showChangeCurrentPassword}
              onClick={() => setShowChangeCurrentPassword((value) => !value)}
            >
              <PasswordVisibilityIcon visible={showChangeCurrentPassword} />
            </button>
          </label>
          <label className="modal-field">
            <span>New vault password</span>
            <input
              type={showChangeNextPassword ? "text" : "password"}
              placeholder="Enter new vault password"
              value={state.changeVaultPasswordInput.next}
              onChange={(e) =>
                actions.setChangeVaultPasswordInput("next", e.target.value)
              }
            />
            <button
              className="password-toggle modal-password-toggle"
              type="button"
              aria-label={
                showChangeNextPassword ? "Hide new vault password" : "Show new vault password"
              }
              aria-pressed={showChangeNextPassword}
              onClick={() => setShowChangeNextPassword((value) => !value)}
            >
              <PasswordVisibilityIcon visible={showChangeNextPassword} />
            </button>
          </label>
          <label className="modal-field">
            <span>Confirm new vault password</span>
            <input
              type={showChangeConfirmPassword ? "text" : "password"}
              placeholder="Re-enter new vault password"
              value={state.changeVaultPasswordInput.confirm}
              onChange={(e) =>
                actions.setChangeVaultPasswordInput("confirm", e.target.value)
              }
            />
            <button
              className="password-toggle modal-password-toggle"
              type="button"
              aria-label={
                showChangeConfirmPassword
                  ? "Hide confirmed vault password"
                  : "Show confirmed vault password"
              }
              aria-pressed={showChangeConfirmPassword}
              onClick={() => setShowChangeConfirmPassword((value) => !value)}
            >
              <PasswordVisibilityIcon visible={showChangeConfirmPassword} />
            </button>
          </label>
          <ModalNote>
            Existing cloud backups keep their previous password until you manually
            save a new backup. After changing the local vault password, use Backup
            to Cloud before switching devices.
          </ModalNote>
        </ModalFrame>
      ) : null}

      {state.modal?.type === "recovery_key_setup" ? (
        <ModalFrame
          title="Create Recovery Key"
          subtitle="Create a recovery key for this unlocked vault. The key can be used in a later recovery flow if you forget the vault password."
          eyebrow="Vault recovery"
          actions={
            <>
              <button className="secondary" type="button" onClick={actions.closeModal}>
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                disabled={state.settingUpRecoveryKey}
                onClick={() => void actions.confirmSetupRecoveryKey()}
              >
                Create Recovery Key
              </button>
            </>
          }
        >
          <ModalNote tone="warning">
            The recovery key will be shown once. Save it somewhere private. Anyone
            with this key and access to the encrypted backup may be able to recover
            this vault in a future recovery flow.
          </ModalNote>
          <ModalNote>
            After creating the key, run Backup to Cloud so the encrypted recovery
            wrapper is included in cloud backup. If you chat again before switching
            devices, save another fresh backup from the newest working device.
          </ModalNote>
        </ModalFrame>
      ) : null}

      {state.modal?.type === "recovery_key_created" ? (
        <ModalFrame
          title="Save Your Recovery Key"
          subtitle="This is the only time the full recovery key is shown. Store it outside this browser before closing this dialog."
          eyebrow="Vault recovery"
          actions={
            <button className="primary" type="button" onClick={actions.closeModal}>
              I saved this recovery key
            </button>
          }
        >
          <div className="recovery-key-box" role="group" aria-label="Recovery key">
            {state.modal.recoveryKey}
          </div>
          <ModalNote tone="warning">
            Do not share this key or include it in screenshots. The app stores only
            an encrypted recovery wrapper, not this plain recovery key.
          </ModalNote>
        </ModalFrame>
      ) : null}

      {state.modal?.type === "recovery_password_reset" ? (
        <ModalFrame
          title="Use Recovery Key"
          subtitle={`Recover ${state.modal.username}'s encrypted vault and set a new local vault password.`}
          eyebrow="Vault recovery"
          actions={
            <>
              <button className="secondary" type="button" onClick={actions.closeModal}>
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                disabled={state.recoveringVaultPassword}
                onClick={() => void actions.confirmRecoveryPasswordReset()}
              >
                Recover Vault
              </button>
            </>
          }
        >
          <label className="modal-field">
            <span>Recovery key</span>
            <input
              type={showRecoveryKey ? "text" : "password"}
              placeholder="RSC-RECOVERY-..."
              value={state.recoveryPasswordInput.recoveryKey}
              onChange={(e) =>
                actions.setRecoveryPasswordInput("recoveryKey", e.target.value)
              }
            />
            <button
              className="password-toggle modal-password-toggle"
              type="button"
              aria-label={showRecoveryKey ? "Hide recovery key" : "Show recovery key"}
              aria-pressed={showRecoveryKey}
              onClick={() => setShowRecoveryKey((value) => !value)}
            >
              <PasswordVisibilityIcon visible={showRecoveryKey} />
            </button>
          </label>
          <label className="modal-field">
            <span>New vault password</span>
            <input
              type={showRecoveryNextPassword ? "text" : "password"}
              placeholder="Enter new vault password"
              value={state.recoveryPasswordInput.next}
              onChange={(e) =>
                actions.setRecoveryPasswordInput("next", e.target.value)
              }
            />
            <button
              className="password-toggle modal-password-toggle"
              type="button"
              aria-label={
                showRecoveryNextPassword ? "Hide new vault password" : "Show new vault password"
              }
              aria-pressed={showRecoveryNextPassword}
              onClick={() => setShowRecoveryNextPassword((value) => !value)}
            >
              <PasswordVisibilityIcon visible={showRecoveryNextPassword} />
            </button>
          </label>
          <label className="modal-field">
            <span>Confirm new vault password</span>
            <input
              type={showRecoveryConfirmPassword ? "text" : "password"}
              placeholder="Re-enter new vault password"
              value={state.recoveryPasswordInput.confirm}
              onChange={(e) =>
                actions.setRecoveryPasswordInput("confirm", e.target.value)
              }
            />
            <button
              className="password-toggle modal-password-toggle"
              type="button"
              aria-label={
                showRecoveryConfirmPassword
                  ? "Hide confirmed vault password"
                  : "Show confirmed vault password"
              }
              aria-pressed={showRecoveryConfirmPassword}
              onClick={() => setShowRecoveryConfirmPassword((value) => !value)}
            >
              <PasswordVisibilityIcon visible={showRecoveryConfirmPassword} />
            </button>
          </label>
          <ModalNote tone="warning">
            Recovery uses the encrypted recovery wrapper from the selected backup
            or this browser. Recovery updates this browser first; the cloud backup
            may still require the old vault password until you unlock with the new
            password and use Backup to Cloud.
          </ModalNote>
        </ModalFrame>
      ) : null}

      {state.modal?.type === "reset_encrypted_identity" ? (
        <ModalFrame
          title={state.modal.mode === "create" ? "Create Identity" : "Start Over"}
          subtitle={`Create a new encrypted identity for ${state.modal.username} with the password currently entered above.`}
          eyebrow={state.modal.mode === "create" ? "Encrypted identity" : "Vault recovery"}
          actions={
            <>
              <button className="secondary" type="button" onClick={actions.closeModal}>
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                disabled={state.resettingEncryptedIdentity}
                onClick={() => void actions.confirmResetEncryptedIdentity()}
              >
                {state.modal.mode === "create" ? "Create Identity" : "Start Over"}
              </button>
            </>
          }
        >
          {state.modal.mode === "create" ? (
            <ModalNote>
              This creates the first encrypted identity for this signed-in
              Google account on this browser. Save a recovery key and run Backup
              to Cloud after the vault opens.
            </ModalNote>
          ) : (
            <ModalNote tone="warning">
              Use this only when you cannot unlock or recover the old vault.
              This creates a new encrypted identity and removes the old local
              chat history from this browser. Old encrypted messages may be
              unreadable without the old password or recovery key.
            </ModalNote>
          )}
          <label className="modal-field">
            <span>Type display name to confirm</span>
            <input
              type="text"
              placeholder={state.modal.username}
              value={state.resetIdentityInput}
              onChange={(e) => actions.setResetIdentityInput(e.target.value)}
            />
          </label>
          <ModalNote>
            {state.modal.mode === "create"
              ? "After creation, this browser will use the new identity as the default for the signed-in Google account. Save a recovery key and run Backup to Cloud when ready."
              : "After starting over, this browser will use the new identity as the default for the signed-in Google account. Save a recovery key and run Backup to Cloud when ready."}
          </ModalNote>
        </ModalFrame>
      ) : null}

      {state.modal?.type === "start_guard" ? (
        <ModalFrame
          title="Start Confirmation"
          subtitle="No local identity was found for this display name in this browser. Continue only for a new local identity, or restore a cloud backup first."
          eyebrow="Identity guard"
          actions={
            <>
              <button
                className="secondary"
                type="button"
                onClick={() => actions.handleStartGuard("cancel")}
              >
                Cancel
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => actions.handleStartGuard("restore")}
              >
                Restore from Cloud
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => actions.handleStartGuard("continue")}
              >
                Continue
              </button>
            </>
          }
        >
          <ModalNote tone="warning">
            Choose Continue only when you want to create a new local identity for
            this display name on this browser.
          </ModalNote>
        </ModalFrame>
      ) : null}

      {state.modal?.type === "inactive_identity_warning" ? (
        <ModalFrame
          title="This Local Identity Is No Longer Active"
          subtitle={`The signed-in Google account has a different active encrypted identity than this browser's local vault for ${state.modal.username}.`}
          eyebrow="Identity safety"
          actions={
            <>
              <button
                className="secondary"
                type="button"
                onClick={() => actions.handleInactiveIdentityWarning("cancel")}
              >
                Cancel
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => actions.handleInactiveIdentityWarning("start_over")}
              >
                Start over here
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => actions.handleInactiveIdentityWarning("restore")}
              >
                Restore from Cloud
              </button>
            </>
          }
        >
          <div className="identity-compare">
            <div>
              <span>Local identity</span>
              <strong>{helpers.formatIdentityShort(state.modal.localIdentityId)}</strong>
            </div>
            <div>
              <span>Account active identity</span>
              <strong>{helpers.formatIdentityShort(state.modal.activeIdentityId)}</strong>
            </div>
          </div>
          <ModalNote tone="warning">
            This local vault is still stored on this browser, but it is not the
            active identity for the signed-in Google account. Restore the latest
            active backup to continue the account state, or start over here to
            replace the account's active identity with a new local vault.
          </ModalNote>
          <ModalNote>
            {state.modal.deviceLabel || state.modal.serverUpdatedAt
              ? `Current active identity was recorded${
                  state.modal.deviceLabel ? ` from ${state.modal.deviceLabel}` : ""
                }${
                  state.modal.serverUpdatedAt
                    ? ` at ${helpers.formatDateTimeShort(state.modal.serverUpdatedAt)}`
                    : ""
                }.`
              : "The active identity is tracked by the server for this Google account."}
            {state.modal.activeRevision
              ? ` Revision ${state.modal.activeRevision}.`
              : ""}
          </ModalNote>
        </ModalFrame>
      ) : null}

      {state.modal?.type === "inactive_identity_check_failed" ? (
        <ModalFrame
          title="Could Not Check Active Identity"
          subtitle="The app could not verify whether this browser's local identity is still active for the signed-in Google account."
          eyebrow="Identity safety"
          actions={
            <>
              <button
                className="secondary"
                type="button"
                onClick={() => actions.handleInactiveIdentityWarning("cancel")}
              >
                Cancel
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => actions.handleInactiveIdentityWarning("retry")}
              >
                Try again
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => actions.handleInactiveIdentityWarning("restore")}
              >
                Restore from Cloud
              </button>
            </>
          }
        >
          <ModalNote tone="warning">
            If you recently used this account on another browser or phone,
            restore from cloud before chatting here.
          </ModalNote>
        </ModalFrame>
      ) : null}

      {state.modal?.type === "backup_freshness_warning" ? (
        <ModalFrame
          title={state.modal.modalTitle || "Cloud Backup Available"}
          subtitle={
            state.modal.modalSubtitle ||
            "Restore first if this account was used on another device."
          }
          eyebrow="Backup safety"
          actions={
            <>
              <button
                className="secondary"
                type="button"
                onClick={() => actions.handleBackupFreshnessWarning("cancel")}
              >
                Cancel
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => actions.handleBackupFreshnessWarning("continue")}
              >
                {state.modal.recoveryPasswordReset
                  ? signedInWithGoogle
                    ? "Unlock vault"
                    : "Start"
                  : signedInWithGoogle
                    ? "Unlock anyway"
                    : "Start anyway"}
              </button>
              {state.modal.recoveryPasswordReset ? null : (
                <button
                  className="primary"
                  type="button"
                  onClick={() => actions.handleBackupFreshnessWarning("restore")}
                >
                  Restore Latest Backup
                </button>
              )}
            </>
          }
        >
          {state.modal.recoveryPasswordReset ? (
            <ModalNote tone="warning">
              The cloud backup may still use the old vault password until you
              save a new backup. Unlock this recovered vault with the new
              password, then use Backup to Cloud.
            </ModalNote>
          ) : (
            <ModalNote tone="warning">
              Starting from an older local vault can desynchronize secure chat
              state. Restore the latest active backup first if you recently
              used this account on another browser or phone.
            </ModalNote>
          )}
        </ModalFrame>
      ) : null}

      {state.modal?.type === "restore_overwrite_confirm" ? (
        (() => {
          const isLatestActiveRestore = state.modal.restoreMode === "latest_active";
          const isSameLatestActive =
            isLatestActiveRestore && state.modal.sameIdentity;
          return (
            <ModalFrame
              title={
                isSameLatestActive
                  ? "Refresh From Latest Backup?"
                  : "Replace Local Identity?"
              }
              subtitle={
                isSameLatestActive
                  ? `Restore will refresh ${state.modal.username} on this browser from the latest active backup.`
                  : `Restore will replace the local identity stored for ${state.modal.username}.`
              }
              eyebrow="Restore safety"
              actions={
                <>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => actions.handleRestoreOverwriteConfirm("cancel")}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary"
                    type="button"
                    onClick={() => void actions.handleRestoreOverwriteConfirm("continue")}
                  >
                    {isSameLatestActive ? "Restore Latest Backup" : "Restore and Replace"}
                  </button>
                </>
              }
            >
              <div className="identity-compare">
                <div>
                  <span>Current local identity</span>
                  <strong>{state.modal.localIdentityShort || "unknown"}</strong>
                </div>
                <div>
                  <span>Cloud backup identity</span>
                  <strong>{state.modal.targetIdentityShort || "unknown"}</strong>
                </div>
              </div>
              <ModalNote
                tone={
                  state.modal.sameIdentity || state.modal.localIdentityUnknown
                    ? "info"
                    : "warning"
                }
              >
                {isSameLatestActive
                  ? "This is the same encrypted identity. Restore will refresh this browser with the latest active backup state."
                  : state.modal.sameIdentity
                    ? "This appears to be the same identity. Restore will refresh this browser with the selected cloud backup state."
                    : state.modal.localIdentityUnknown
                      ? "The current local identity could not be verified with this vault password. This can happen when this browser still has an older local vault encrypted with a previous password. Restore will replace that local copy with the selected cloud backup."
                      : "This browser currently has a different identity for the same display name. Continue only if you intend to replace the local vault identity."}
              </ModalNote>
            </ModalFrame>
          );
        })()
      ) : null}

      {state.modal?.type === "legacy_restore_confirm" ? (
        <ModalFrame
          title="Try Legacy Restore?"
          subtitle={`No Firebase-owned backup was found for ${state.modal.username}. You can still try the older display-name restore path.`}
          eyebrow="Legacy backup"
          actions={
            <>
              <button
                className="secondary"
                type="button"
                onClick={() => actions.handleLegacyRestoreConfirm("cancel")}
              >
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => void actions.handleLegacyRestoreConfirm("continue")}
              >
                Try Legacy Restore
              </button>
            </>
          }
        >
          <ModalNote tone="warning">
            Legacy restore searches encrypted backups by display name. Continue
            only if this is your old backup. After restoring, unlock the vault
            and save a new cloud backup to associate the identity with your
            signed-in account.
          </ModalNote>
        </ModalFrame>
      ) : null}

      {state.modal?.type === "restore_stale_confirm" ? (
        <ModalFrame
          title="Selected Backup May Be Older"
          subtitle={`This browser appears to have newer local encrypted chat state for ${state.modal.username} than the selected cloud backup.`}
          eyebrow="Restore safety"
          actions={
            <>
              <button
                className="secondary"
                type="button"
                onClick={() => actions.handleRestoreStaleConfirm("cancel")}
              >
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => void actions.handleRestoreStaleConfirm("continue")}
              >
                Restore Anyway
              </button>
            </>
          }
        >
          <ModalNote tone="warning">
            Restoring an older backup can roll back Double Ratchet state and
            make later messages fail to decrypt. Cancel if this browser was used
            for newer chats; save a fresh backup from the newest working device
            instead.
          </ModalNote>
        </ModalFrame>
      ) : null}

      {state.modal?.type === "restore_choice" ? (
        <ModalFrame
          title="Restore Latest Backup"
          subtitle={
            state.modal.legacyRestore
              ? "This display name has multiple legacy cloud backups. The latest backup is the normal restore path."
              : "This display name has multiple cloud backups. Restore the latest encrypted state unless you are doing advanced recovery."
          }
          eyebrow={state.modal.legacyRestore ? "Legacy restore" : "Cloud restore"}
          actions={
            <>
              <button className="secondary" type="button" onClick={actions.cancelRestoreChoice}>
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                disabled={!state.modal.items?.[0]?.identityId}
                onClick={() =>
                  void actions.confirmRestoreChoice(state.modal.items[0].identityId)
                }
              >
                Restore Latest Backup
              </button>
            </>
          }
        >
          {state.modal.legacyRestore ? (
            <ModalNote tone="warning">
              Legacy restore is a compatibility path for older backups. It does not prove
              ownership of the signed-in Google account. Restore only backups you recognize,
              then unlock the vault and save a new cloud backup to move this identity to
              Google account ownership.
            </ModalNote>
          ) : null}
          {state.modal.items?.[0] ? (
            <div className="restore-latest-card">
              {(() => {
                const item = state.modal.items[0];
                const ownership = helpers.formatBackupOwnership(item);
                return (
                  <>
                    <span className="restore-choice-label">Latest backup</span>
                    <strong>{helpers.formatIdentityShort(item.identityId)}</strong>
                    <span className={`restore-choice-owner ${ownership.chipClass}`}>
                      {ownership.chipText}
                    </span>
                    <span className="restore-choice-time">
                      display name {item.displayName || "unknown"}
                    </span>
                    <span className="restore-choice-time">
                      updated {helpers.formatRestoreUpdatedAt(item.serverSavedAt || item.updatedAt)}
                    </span>
                  </>
                );
              })()}
            </div>
          ) : null}
          {state.modal.items?.length > 1 ? (
            <details className="restore-advanced">
              <summary>Advanced: show older backups</summary>
              <ModalNote tone="warning">
                Older backups can roll back Double Ratchet state and make recent
                messages unreadable. They are recovery material, not the normal
                continuation path. Use an older backup only if the latest one
                cannot be restored.
              </ModalNote>
              <div className="restore-choice-list">
                {state.modal.items.slice(1).map((item) => {
                  const ownership = helpers.formatBackupOwnership(item);
                  return (
                    <button
                      key={item.identityId}
                      type="button"
                      className="restore-choice-item"
                      onClick={() =>
                        void actions.confirmRestoreChoice(item.identityId, {
                          olderBackup: true,
                        })
                      }
                    >
                      <span className="restore-choice-label">Older identity</span>
                      <span className="restore-choice-id">
                        {helpers.formatIdentityShort(item.identityId)}
                      </span>
                      <span className={`restore-choice-owner ${ownership.chipClass}`}>
                        {ownership.chipText}
                      </span>
                      {item.displayName ? (
                        <span className="restore-choice-time">
                          display name {item.displayName}
                        </span>
                      ) : null}
                      <span className="restore-choice-time">
                        updated {helpers.formatRestoreUpdatedAt(item.serverSavedAt || item.updatedAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </details>
          ) : null}
        </ModalFrame>
      ) : null}

      {state.modal?.type === "restore_older_confirm" ? (
        <ModalFrame
          title="Restore Older Backup?"
          subtitle={`This backup is older than the latest encrypted state for ${state.modal.username}.`}
          eyebrow="Advanced restore"
          actions={
            <>
              <button
                className="secondary"
                type="button"
                onClick={() => actions.handleRestoreOlderConfirm("cancel")}
              >
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => void actions.handleRestoreOlderConfirm("continue")}
              >
                Restore Older Backup
              </button>
            </>
          }
        >
          <ModalNote tone="warning">
            Restoring an older backup may cause Double Ratchet state mismatch or
            make recent messages unreadable. Older backups are recovery
            material, not the normal continuation path. Use this only if the
            latest backup cannot be restored.
          </ModalNote>
        </ModalFrame>
      ) : null}

      {state.modal?.type === "recovery_choice" ? (
        <ModalFrame
          title="Choose Recovery Identity"
          subtitle="This display name has multiple cloud backups with recovery keys. Choose the identity you want to recover."
          eyebrow="Vault recovery"
          actions={
            <button className="secondary" type="button" onClick={actions.cancelRecoveryResetChoice}>
              Cancel
            </button>
          }
        >
          <div className="restore-choice-list">
            {state.modal.items.map((item) => {
              const ownership = helpers.formatBackupOwnership(item);
              return (
                <button
                  key={item.identityId}
                  type="button"
                  className="restore-choice-item"
                  onClick={() => void actions.confirmRecoveryResetChoice(item.identityId)}
                >
                  <span className="restore-choice-label">Identity</span>
                  <span className="restore-choice-id">
                    {helpers.formatIdentityShort(item.identityId)}
                  </span>
                  <span className={`restore-choice-owner ${ownership.chipClass}`}>
                    {ownership.chipText}
                  </span>
                  {item.displayName ? (
                    <span className="restore-choice-time">
                      display name {item.displayName}
                    </span>
                  ) : null}
                  <span className="restore-choice-time">
                    updated {helpers.formatRestoreUpdatedAt(item.updatedAt)}
                  </span>
                </button>
              );
            })}
          </div>
        </ModalFrame>
      ) : null}

      <ToastViewport toasts={state.toasts} />
    </div>
  );
}
