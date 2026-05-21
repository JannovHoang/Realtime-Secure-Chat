import React from "react";

function DisabledField({ label, placeholder, type = "text" }) {
  return (
    <label>
      <span>{label}</span>
      <input type={type} placeholder={placeholder} disabled />
    </label>
  );
}

export default function App() {
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
              <div className="migration-card-title">Checkpoint 2</div>
              <p>
                The old vanilla entry is no longer mounted. This screen is rendered by
                React through Vite.
              </p>
              <p>
                Interactive chat flows are intentionally disabled at this checkpoint so
                the migration can switch UI ownership safely before runtime logic is
                reattached.
              </p>
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
