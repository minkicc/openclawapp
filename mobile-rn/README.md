# mobile-rn

Expo + React Native + TypeScript scaffold for the next-generation OpenClaw mobile client.

## Goal

This app is the long-term replacement for the current `mobile` Capacitor client.
It will own:

- conversation list
- QR pairing flow
- chat session UI
- native-safe keyboard and safe-area handling
- future native capabilities such as push notifications and camera access

## Run

```bash
npm run mobile-rn:start
npm run mobile-rn:ios
npm run mobile-rn:android
npm run mobile-rn:web
npm run mobile-rn:typecheck
```

Or directly:

```bash
cd mobile-rn
npm run start
```

## Structure

- `App.tsx`: app bootstrap
- `src/navigation`: stack navigation
- `src/screens`: UI screens
- `src/data`: temporary mock data for UI migration
- `src/theme`: color tokens and visual primitives
- `src/types`: shared view-model types

## Next

1. replace mock sessions with real pairing/session state
2. migrate current mobile networking/state-machine into TypeScript-only RN modules
3. integrate QR scanner
4. connect chat send/receive to the channel service
