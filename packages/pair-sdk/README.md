# @openclaw/pair-sdk

OpenClaw `v2` pairing/control-plane SDK.

## Includes

- `web`: auth, pairing, presence, signaling, ICE fetch helpers
- `peer`: WebRTC peer transport + `sys.auth.hello` + `sys.capabilities`
- `app`: generic `app.*` module registry / dispatcher
- `runtime`: storage / signal-stream runtime injection hooks

## Scope

This package is business-agnostic:

- discovery
- pairing
- signaling
- peer authentication
- capability negotiation
- generic application message dispatch

Business-specific message modules live in separate SDKs.

## Runtime notes

- Browser usage works out of the box with `localStorage` + `EventSource`
- React Native can inject async storage via `configurePairV2Storage(...)`
- Signal stream creation can be overridden via `configurePairV2SignalStreamFactory(...)`

## Build

```bash
npm --prefix packages/pair-sdk run build
```
