import React from "react";
import { useChatApp } from "./hooks/useChatApp.js";

function Field({
  label,
  placeholder,
  type = "text",
  value,
  onChange,
  disabled = false,
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

function formatMessageClass(message, username) {
  return message.from === username ? "msg me" : "msg peer";
}

export default function App() {
  const { state, actions } = useChatApp();
  const showPasswordField = !state.started || state.disconnected;
  const startLabel = state.disconnected ? "Reconnect" : "Start";
  const startDisabled = state.starting || (state.started && !state.disconnected);
  const logoutDisabled = state.starting || !state.started;
  const peerInputValue = state.activePeer || "";
  const sendDisabled =
    !state.started ||
    state.disconnected ||
    !state.activePeer ||
    !state.activePeerReady ||
    state.sending ||
    !String(state.messageDraft || "").trim();

  return (
    <div className="shell">
      <div className="migration-banner" role="status" aria-live="polite">
        React now owns the auth shell. Start, logout, and reconnect are back for
        browsers that already have a local vault.
      </div>

      <div className="topbar">
        <div className="brand">
          <div className="brand-title">Realtime Secure Messenger</div>
          <div className="brand-sub">E2EE - Double Ratchet - Real-time DM</div>
        </div>

        <div className="login">
          <Field
            label="Username"
            placeholder="Enter your username"
            value={state.username}
            onChange={(value) => actions.setField("username", value)}
            disabled={state.starting}
          />
          {showPasswordField ? (
            <Field
              label="Password"
              placeholder="Enter your password"
              type="password"
              value={state.password}
              onChange={(value) => actions.setField("password", value)}
              disabled={state.starting}
            />
          ) : null}
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
          <button className="secondary" type="button" disabled>
            Restore from Cloud
          </button>
          <button className="secondary" type="button" disabled>
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
          <div className={`status migration-status is-${state.statusTone}`}>
            {state.statusText}
          </div>
        </div>
      </div>

      <div className="content">
        <aside className="sidebar">
          <div className="bridge-panel">
            <div className="bridge-panel-title">Runtime Bridge</div>
            <div className="bridge-row">
              <span>Installed</span>
              <strong>{state.bridgeInstalled ? "Yes" : "No"}</strong>
            </div>
            <div className="bridge-row">
              <span>Listeners</span>
              <strong>{state.bridgeListenerCount}</strong>
            </div>
            <div className="bridge-row">
              <span>Last event</span>
              <strong>{state.lastRuntimeEventType || "none"}</strong>
            </div>
            <div className="bridge-row">
              <span>Event count</span>
              <strong>{state.runtimeEventCount}</strong>
            </div>
          </div>

          <div className="field">
            <label>Chat with</label>
            <input
              placeholder={
                state.started
                  ? "Choose a conversation from the local sidebar"
                  : "Start a session to load local conversations"
              }
              value={peerInputValue}
              readOnly
              disabled={!state.started}
            />
          </div>

          <div className="peer-list">
            <div className="peer-list-head">Conversations</div>
            {state.started && state.conversations.length > 0 ? (
              <div className="peer-items">
                {state.conversations.map((item) => (
                  <button
                    key={item.peer}
                    type="button"
                    className={
                      "peer-item" + (item.peer === state.activePeer ? " active" : "")
                    }
                    onClick={() => actions.selectPeer(item.peer)}
                  >
                    <span className="peer-avatar">
                      {item.peer.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="peer-copy">
                      <span className="peer-name">{item.peer}</span>
                      {item.lastMessagePreview ? (
                        <span className="peer-preview">{item.lastMessagePreview}</span>
                      ) : null}
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
          <div className="messages">
            {state.started && state.activePeer ? (
              <div className="chat-pane">
                <div className="chat-pane-head">
                  <div className="chat-pane-title">{state.activePeer}</div>
                  <div className="chat-pane-sub">
                    {state.activePeerReady
                      ? "Peer certificate is ready"
                      : "Waiting for peer certificate"}
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
              </div>
            ) : (
              <div className="migration-messages">
                <div className="migration-card">
                  <div className="migration-card-title">Checkpoint 6 Chat Pane</div>
                  <p>
                    React now owns local history loading, recent merge, and the send
                    composer for the active conversation.
                  </p>
                  <p>
                    Start a local session and choose a conversation to render the timeline
                    from the current vault.
                  </p>
                </div>
              </div>
            )}

            <div className="migration-card migration-diagnostics">
              <div className="runtime-event-card">
                <div className="runtime-event-title">Latest runtime snapshot</div>
                <div className="runtime-event-line">
                  <span>Conversations loaded:</span>
                  <strong>{state.conversationsLoaded ? "true" : "false"}</strong>
                </div>
                <div className="runtime-event-line">
                  <span>Conversation count:</span>
                  <strong>{state.conversations.length}</strong>
                </div>
                <div className="runtime-event-line">
                  <span>Active peer:</span>
                  <strong>{state.activePeer || "none"}</strong>
                </div>
                <div className="runtime-event-line">
                  <span>Active peer ready:</span>
                  <strong>{state.activePeerReady ? "true" : "false"}</strong>
                </div>
                <div className="runtime-event-line">
                  <span>Started:</span>
                  <strong>{state.started ? "true" : "false"}</strong>
                </div>
                <div className="runtime-event-line">
                  <span>Disconnected flag:</span>
                  <strong>{state.disconnected ? "true" : "false"}</strong>
                </div>
                <div className="runtime-event-line">
                  <span>Last message from:</span>
                  <strong>{state.lastMessageFrom || "none"}</strong>
                </div>
                <div className="runtime-event-line">
                  <span>Last preview:</span>
                  <strong>{state.lastMessagePreview || "none"}</strong>
                </div>
                <div className="runtime-event-line">
                  <span>Last forced logout:</span>
                  <strong>{state.lastForcedLogoutReason || "none"}</strong>
                </div>
                <div className="runtime-event-line">
                  <span>Messages loaded:</span>
                  <strong>{state.messages.length}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="composer">
            <input
              placeholder={
                state.activePeerReady
                  ? "Type a message..."
                  : "Send is enabled after the peer certificate is ready"
              }
              value={state.messageDraft}
              onChange={(e) => actions.setMessageDraft(e.target.value)}
              disabled={!state.started || state.disconnected || !state.activePeer || state.sending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
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
    </div>
  );
}
