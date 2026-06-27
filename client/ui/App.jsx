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

function AccountIdentityPanel({ info, helpers }) {
  if (!info?.displayName && !info?.identityId) return null;

  const accountShort = helpers.formatIdentityShort(info.accountId);
  const identityShort = helpers.formatIdentityShort(info.identityId);
  const backupTime = helpers.formatDateTimeShort(info.backupServerSavedAt);
  const backupOwnership = helpers.formatBackupOwnership(info);
  const backupChipClass = info.backupServerSavedAt
    ? backupOwnership.chipClass
    : "is-local";

  return (
    <div className="account-panel">
      <div className="account-panel-head">
        <span>Encrypted identity</span>
        <span className={`account-panel-chip ${backupChipClass}`}>
          {info.backupServerSavedAt ? backupOwnership.chipText : "Local only"}
        </span>
      </div>
      <dl className="account-panel-grid">
        <div>
          <dt>Display name</dt>
          <dd>{info.displayName || "unknown"}</dd>
        </div>
        <div>
          <dt>Vault</dt>
          <dd>Unlocked</dd>
        </div>
        <div>
          <dt>Identity</dt>
          <dd title={info.identityId || ""}>{identityShort}</dd>
        </div>
        <div>
          <dt>Backup</dt>
          <dd>{info.backupServerSavedAt ? backupOwnership.label : "Not backed up"}</dd>
        </div>
      </dl>
      <details className="account-technical-details">
        <summary>Show technical details</summary>
        <dl className="account-technical-grid">
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
      </details>
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
          <button
            className="secondary compact"
            type="button"
            disabled={state.authBusy || !enabled}
            onClick={() => {
              void actions.handleGoogleSignIn();
            }}
          >
            {state.authBusy ? "Signing in..." : "Sign in with Google"}
          </button>
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
  const showPasswordField = !state.started || state.disconnected;
  const signedInWithGoogle = !!state.authUser?.uid;
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

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <img
            className="brand-logo"
            src={brandLogo}
            alt="Realtime Secure Chat"
          />
        </div>

        <div className="login">
          <div className="auth-fields">
            <Field
              label="Display name"
              placeholder={
                signedInWithGoogle
                  ? "Display name for this vault"
                  : "Enter your display name"
              }
              value={state.username}
              onChange={(value) => actions.setField("username", value)}
              disabled={busy}
            />
            {showPasswordField ? (
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
                Google identifies your account. Display name labels this chat identity.
              </div>
            ) : null}
          </div>

          <div className="topbar-actions">
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
            <button
              className="secondary"
              type="button"
              disabled={busy || state.started || !state.username || !state.password}
              onClick={() => {
                actions.openResetEncryptedIdentityModal();
              }}
            >
              Create new identity
            </button>
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
            {!signedInWithGoogle ? (
              <button
                className="secondary"
                type="button"
                disabled={logoutDisabled}
                onClick={() => {
                  void actions.handleLogout();
                }}
              >
                Logout
              </button>
            ) : null}
          </div>

          <div className="topbar-status">
            <div className="status-label">Session status</div>
            <div className={`status migration-status is-${state.statusTone}`}>
              {state.statusText}
            </div>
          </div>

          <FirebaseAuthPanel state={state} actions={actions} />
        </div>
      </div>

      <div className="content">
        <aside className="sidebar">
          <div className="peer-target-card">
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    actions.commitPeerDraft();
                  }
                }}
              />
            </div>
            <div className="peer-target-hint">
              {state.started
                ? "Open an existing chat or type a peer display name to start one."
                : "Start or restore a session before choosing a peer."}
            </div>
          </div>

          <AccountIdentityPanel info={state.identityPanel} helpers={helpers} />

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
                    onClick={() => actions.selectPeer(item.peer)}
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
        </aside>

        <main className="chat">
          <div
            className="messages"
            ref={messagesViewportRef}
            onScroll={handleMessagesScroll}
          >
            {state.started && state.activePeer ? (
              <div className="chat-pane">
                <div className="chat-pane-head">
                  <div>
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

          <div className="composer">
            <textarea
              ref={composerInputRef}
              rows={1}
              aria-label="Message"
              placeholder={
                state.activePeerReady
                  ? "Type a message..."
                  : "Send is enabled after the peer certificate is ready"
              }
              value={state.messageDraft}
              onChange={(e) => actions.setMessageDraft(e.target.value)}
              disabled={!state.started || state.disconnected || !state.activePeer || state.sending}
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
          title="Create New Identity"
          subtitle={`Create a new encrypted identity for ${state.modal.username} using the password field as the new vault password.`}
          eyebrow="Vault recovery"
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
                Create Identity
              </button>
            </>
          }
        >
          <ModalNote tone="warning">
            Use this only when the vault password and recovery key are lost. This
            replaces the local encrypted identity in this browser. Old backups and
            encrypted messages may remain unreadable without the old password or
            recovery key.
          </ModalNote>
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
            After creating the new identity, create a recovery key and run Backup
            to Cloud before switching devices.
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
                  Restore from Cloud
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
              state. Restore first if you recently used this account on another
              browser or phone.
            </ModalNote>
          )}
        </ModalFrame>
      ) : null}

      {state.modal?.type === "restore_overwrite_confirm" ? (
        <ModalFrame
          title="Replace Local Identity?"
          subtitle={`Restore will replace the local identity stored for ${state.modal.username}.`}
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
                Restore and Replace
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
            {state.modal.sameIdentity
              ? "This appears to be the same identity. Restore will refresh this browser with the cloud backup state."
              : state.modal.localIdentityUnknown
                ? "The current local identity could not be verified with this vault password. This can happen when this browser still has an older local vault encrypted with a previous password. Restore will replace that local copy with the selected cloud backup."
                : "This browser currently has a different identity for the same display name. Continue only if you intend to replace the local vault identity."}
          </ModalNote>
        </ModalFrame>
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
          title="Choose Backup Identity"
          subtitle={
            state.modal.legacyRestore
              ? "This display name has multiple legacy cloud backups. Choose the identity you own and want to restore."
              : "This display name has multiple cloud backups. Choose the device identity you want to restore."
          }
          eyebrow={state.modal.legacyRestore ? "Legacy restore" : "Cloud restore"}
          actions={
            <button className="secondary" type="button" onClick={actions.cancelRestoreChoice}>
              Cancel
            </button>
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
          <div className="restore-choice-list">
            {state.modal.items.map((item) => {
              const ownership = helpers.formatBackupOwnership(item);
              return (
                <button
                  key={item.identityId}
                  type="button"
                  className="restore-choice-item"
                  onClick={() => void actions.confirmRestoreChoice(item.identityId)}
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
