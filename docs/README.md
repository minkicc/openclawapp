# Docs

- `remote-pairing-mvp.md`: API and WebSocket contract for the MVP server.
- `remote-pairing-v2.md`: replacement architecture for identity-key-based desktop/mobile pairing, presence, and signaling.
- `remote-pairing-v2-protocol.md`: formal `v2` protocol layering, message contracts, and interoperability boundaries.
- Workspace implementation now maps to:
  - `server/`: control plane + protocol landing page
  - `packages/pair-sdk`: reusable transport / pairing SDK
  - `packages/message-sdk`: OpenClaw business message SDK
  - `mobile/`: official React Native mobile app
  - `desktop/`: desktop host app
