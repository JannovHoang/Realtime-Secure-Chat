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
  const showPasswordField = !state.started || state.disconnected;
  const startLabel = state.disconnected ? "Reconnect" : "Start";
  const busy = state.starting || state.restoring || state.backingUp || state.sending;
  const startDisabled = busy || (state.started && !state.disconnected);
  const logoutDisabled = busy || !state.started;
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
              placeholder="Enter your display name"
              value={state.username}
              onChange={(value) => actions.setField("username", value)}
              disabled={busy}
            />
            {showPasswordField ? (
              <Field
                label="Password"
                placeholder="Enter your password"
                type={showTopbarPassword ? "text" : "password"}
                value={state.password}
                onChange={(value) => actions.setField("password", value)}
                disabled={busy}
                trailing={
                  <button
                    className="password-toggle"
                    type="button"
                    aria-label={showTopbarPassword ? "Hide password" : "Show password"}
                    aria-pressed={showTopbarPassword}
                    disabled={busy}
                    onClick={() => setShowTopbarPassword((value) => !value)}
                  >
                    <PasswordVisibilityIcon visible={showTopbarPassword} />
                  </button>
                }
              />
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
              disabled={busy || !state.started || state.disconnected}
              onClick={() => {
                actions.openBackupModal();
              }}
            >
              Backup to Cloud
            </button>
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
          </div>

          <div className="topbar-status">
            <div className="status-label">Session status</div>
            <div className={`status migration-status is-${state.statusTone}`}>
              {state.statusText}
            </div>
          </div>
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
          subtitle="Enter your password to encrypt and save this account label's current local identity."
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
            <span>Password</span>
            <input
              type={showBackupPassword ? "text" : "password"}
              placeholder="Enter your password"
              value={state.backupPasswordInput}
              onChange={(e) => actions.setBackupPasswordInput(e.target.value)}
            />
            <button
              className="password-toggle modal-password-toggle"
              type="button"
              aria-label={showBackupPassword ? "Hide backup password" : "Show backup password"}
              aria-pressed={showBackupPassword}
              onClick={() => setShowBackupPassword((value) => !value)}
            >
              <PasswordVisibilityIcon visible={showBackupPassword} />
            </button>
          </label>
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
        />
      ) : null}

      {state.modal?.type === "restore_choice" ? (
        <ModalFrame
          title="Choose Backup Identity"
          subtitle="This display name has multiple cloud backups. Choose the device identity you want to restore."
          eyebrow="Cloud restore"
          actions={
            <button className="secondary" type="button" onClick={actions.cancelRestoreChoice}>
              Cancel
            </button>
          }
        >
          <div className="restore-choice-list">
            {state.modal.items.map((item) => (
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
                {item.displayName ? (
                  <span className="restore-choice-time">
                    display name {item.displayName}
                  </span>
                ) : null}
                <span className="restore-choice-time">
                  updated {helpers.formatRestoreUpdatedAt(item.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        </ModalFrame>
      ) : null}

      <ToastViewport toasts={state.toasts} />
    </div>
  );
}
