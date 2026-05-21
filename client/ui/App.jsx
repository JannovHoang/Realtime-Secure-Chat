import React from "react";
import { useChatApp } from "./hooks/useChatApp.js";

function DisabledField({ label, placeholder, type = "text" }) {
  return (
    <label>
      <span>{label}</span>
      <input type={type} placeholder={placeholder} disabled />
    </label>
  );
}

export default function App() {
  const { state } = useChatApp();

  return (
    <div className="shell">
      <div className="migration-banner" role="status" aria-live="polite">
        React UI shell is now mounted. Chat/runtime wiring will be reconnected in the
        next checkpoints.
      </div>

      <div className="topbar">
        <div className="brand">
          <div className="brand-title">Realtime Secure Messenger</div>
          <div className="brand-sub">E2EE - Double Ratchet - Real-time DM</div>
        </div>

        <div className="login">
          <DisabledField label="Username" placeholder="React migration checkpoint" />
          <DisabledField label="Password" placeholder="Interactive auth returns next" type="password" />
          <button className="primary" type="button" disabled>
            Start
          </button>
          <button className="secondary" type="button" disabled>
            Restore from Cloud
          </button>
          <button className="secondary" type="button" disabled>
            Backup to Cloud
          </button>
          <button className="secondary" type="button" disabled>
            Logout
          </button>
          <div className="status migration-status">React Shell Only</div>
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
              <div className="migration-card-title">Checkpoint 3 Foundation</div>
              <p>
                The old vanilla entry is no longer mounted. This screen is rendered by
                React, and runtime callbacks are now routed through a dedicated bridge.
              </p>
              <p>
                Interactive auth and chat flows are still intentionally paused at this
                stage. The next checkpoints will reconnect them using the reducer-based
                state model already mounted here.
              </p>
              <div className="runtime-event-card">
                <div className="runtime-event-title">Latest runtime snapshot</div>
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
