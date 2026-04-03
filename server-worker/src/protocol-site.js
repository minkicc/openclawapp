export const protocolSiteCss = `:root {
  color-scheme: dark;
  --bg: #07111f;
  --panel: rgba(12, 26, 45, 0.88);
  --panel-border: rgba(128, 163, 255, 0.18);
  --text: #ebf2ff;
  --muted: #a7b7d6;
  --accent: #6aa8ff;
  --accent-strong: #8f7cff;
  --button-text: #06111f;
  --shadow: 0 18px 60px rgba(0, 0, 0, 0.28);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at top, rgba(106, 168, 255, 0.18), transparent 26rem),
    linear-gradient(180deg, #08111d 0%, #0b1627 100%);
  color: var(--text);
}

code,
pre {
  font-family: "SFMono-Regular", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.page {
  width: min(1120px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 40px 0 72px;
}

.hero,
.card {
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: 24px;
  box-shadow: var(--shadow);
}

.hero {
  padding: 40px;
}

.eyebrow {
  color: var(--accent);
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1,
h2,
p,
ul {
  margin: 0;
}

h1 {
  margin-top: 12px;
  font-size: clamp(2rem, 4vw, 3.5rem);
  line-height: 1.08;
}

h2 {
  font-size: 1.15rem;
}

.lead {
  margin-top: 18px;
  max-width: 50rem;
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1.65;
}

.hero-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 24px;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: var(--text);
  text-decoration: none;
  font-weight: 600;
}

.button.primary {
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  border-color: transparent;
  color: var(--button-text);
}

.section {
  margin-top: 28px;
}

.section-title {
  margin-bottom: 14px;
  color: #c0d3f4;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.grid {
  display: grid;
  gap: 16px;
}

.grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.card {
  padding: 22px;
}

.card p,
.card li {
  color: var(--muted);
  line-height: 1.7;
}

.card p + p,
.card p + pre,
.card p + ul,
.card ul + p,
.card h2 + p,
.card h2 + ul {
  margin-top: 12px;
}

.card ul {
  padding-left: 18px;
}

.stack {
  display: grid;
  gap: 16px;
}

.stack-card {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border-radius: 16px;
  background: rgba(106, 168, 255, 0.12);
  color: var(--accent);
  font-weight: 700;
}

pre {
  overflow-x: auto;
  padding: 14px;
  border-radius: 16px;
  background: rgba(2, 8, 16, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #d7e5ff;
  line-height: 1.55;
}

.muted {
  color: var(--muted);
}

@media (max-width: 860px) {
  .grid.two,
  .grid.three {
    grid-template-columns: 1fr;
  }

  .stack-card {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .page {
    width: min(100vw - 20px, 1120px);
    padding-top: 20px;
    padding-bottom: 36px;
  }

  .hero,
  .card {
    border-radius: 20px;
  }

  .hero,
  .card {
    padding: 18px;
  }
}`;

export function renderProtocolSite(origin) {
  const healthHref = `${origin.replace(/\/+$/, '')}/healthz`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenClaw Pair Protocol</title>
    <meta
      name="description"
      content="OpenClaw pair protocol overview, control-plane layering, interoperability boundary, and SDK entry points."
    />
    <link rel="stylesheet" href="/assets/protocol.css" />
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div class="eyebrow">OpenClaw Protocol</div>
        <h1>Server-assisted discovery. Verified peer channels. App-level interoperability.</h1>
        <p class="lead">
          This Cloudflare Worker hosts the OpenClaw v2 control plane for identity login, pairing,
          signaling relay, and ICE bootstrap.
        </p>
        <div class="hero-actions">
          <a class="button primary" href="${healthHref}">View health</a>
          <a class="button" href="#sdks">Jump to SDKs</a>
        </div>
      </section>

      <section class="section">
        <div class="section-title">What this protocol does</div>
        <div class="grid three">
          <article class="card">
            <h2>Discovery</h2>
            <p>Desktop announces presence. Mobile queries bound desktop state by trusted device ID.</p>
          </article>
          <article class="card">
            <h2>Trust establishment</h2>
            <p>QR pairing carries the desktop identity. Mobile submits its public key. Desktop verifies a shared safety code before activating the binding.</p>
          </article>
          <article class="card">
            <h2>Transport bootstrap</h2>
            <p>The server relays signaling and ICE bootstrap data. Business traffic moves over an authenticated peer channel.</p>
          </article>
        </div>
      </section>

      <section class="section">
        <div class="section-title">Layer model</div>
        <div class="stack">
          <article class="card stack-card">
            <div class="tag">L1</div>
            <div>
              <h2>Control plane</h2>
              <p><code>/v2/auth/*</code>, <code>/v2/presence/*</code>, <code>/v2/pair/*</code>, <code>/v2/signal/*</code>, <code>/v2/ice-servers</code></p>
              <p>HTTP JSON + SSE. Handles login, presence, pairing, relay, and ICE delivery.</p>
            </div>
          </article>
          <article class="card stack-card">
            <div class="tag">L2</div>
            <div>
              <h2>Peer authentication plane</h2>
              <p><code>sys.auth.hello</code> and <code>sys.capabilities</code> run on the peer channel.</p>
              <p>Only verified peers can exchange app messages.</p>
            </div>
          </article>
          <article class="card stack-card">
            <div class="tag">L3</div>
            <div>
              <h2>Application plane</h2>
              <p>Namespaced <code>app.*</code> messages carry business payloads after L2 succeeds.</p>
              <p>OpenClaw chat is one module; other apps can define their own message namespaces.</p>
            </div>
          </article>
        </div>
      </section>

      <section class="section">
        <div class="section-title">Interoperability boundary</div>
        <div class="card">
          <p>Any application that implements the same <strong>L1 control plane</strong> and <strong>L2 peer-auth rules</strong> can pair and establish a trusted connection with OpenClaw-compatible clients.</p>
          <p>Useful business interoperability still depends on sharing the same <strong>L3 app message contract</strong>. For example, OpenClaw chat uses <code>app.openclaw.chat.message</code>.</p>
        </div>
      </section>

      <section class="section" id="sdks">
        <div class="section-title">SDKs</div>
        <div class="grid two">
          <article class="card">
            <h2><code>@openclaw/pair-sdk</code></h2>
            <p>Business-agnostic pairing transport SDK used by both desktop and mobile projects.</p>
            <pre><code>import {
  loginPairV2Entity,
  openPairV2SignalStream,
  PairV2PeerChannel,
  createPairV2AppRegistry
} from "@openclaw/pair-sdk"</code></pre>
            <p class="muted">Workspace path: <code>packages/pair-sdk</code></p>
          </article>
          <article class="card">
            <h2><code>@openclaw/message-sdk</code></h2>
            <p>Business message modules layered on top of the pair transport.</p>
            <pre><code>import {
  createOpenClawPairChatModule,
  buildOpenClawPairChatPayload
} from "@openclaw/message-sdk"</code></pre>
            <p class="muted">Workspace path: <code>packages/message-sdk</code></p>
          </article>
        </div>
      </section>

      <section class="section">
        <div class="section-title">Cloudflare layout</div>
        <div class="grid three">
          <article class="card">
            <h2>server-worker/</h2>
            <p>Cloudflare Worker + Durable Object implementation of the OpenClaw v2 control plane.</p>
          </article>
          <article class="card">
            <h2>mobile/</h2>
            <p>Standalone React Native mobile app consuming the pair SDK and the OpenClaw message SDK.</p>
          </article>
          <article class="card">
            <h2>desktop/</h2>
            <p>Standalone desktop host app consuming the same SDKs to establish trusted peer channels.</p>
          </article>
        </div>
      </section>
    </main>
  </body>
</html>`;
}
