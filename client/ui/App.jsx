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

export default function App() {
  const { state, actions } = useChatApp();
  const showPasswordField = !state.started || state.disconnected;
  const startLabel = state.disconnected ? "Reconnect" : "Start";
  const startDisabled = state.starting || (state.started && !state.disconnected);
  const logoutDisabled = state.starting || !state.started;

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
              placeholder="Conversation picker will be connected in a later checkpoint"
              disabled
            />
          </div>

          <div className="peer-list">
            <div className="peer-list-head">Conversations</div>
            <div className="peer-empty">
              React now owns this layout. Sidebar data wiring is scheduled for the next
              migration steps.
            </div>
          </div>
        </aside>

        <main className="chat">
          <div className="messages migration-messages">
            <div className="migration-card">
              <div className="migration-card-title">Checkpoint 4 Auth Shell</div>
              <p>
                Start, logout, and manual reconnect now run through the React reducer and
                runtime bridge instead of the old DOM-imperative entry.
              </p>
              <p>
                Sidebar data, local history loading, send flow, backup, and restore are
                still intentionally deferred to later checkpoints.
              </p>
              <div className="runtime-event-card">
                <div className="runtime-event-title">Latest runtime snapshot</div>
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
              </div>
            </div>
          </div>

          <div className="composer">
            <input
              placeholder="Message composer returns after runtime bridge is added"
              disabled
            />
            <button type="button" disabled>
              Send
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
