# mobile

Expo + React Native + TypeScript app for the official OpenClaw mobile client.

## Goal

This app now owns the primary `mobile/` workspace name.
It will own:

- conversation list
- QR pairing flow
- chat session UI
- native-safe keyboard and safe-area handling
- future native capabilities such as push notifications and camera access

## Current protocol boundary

- Depends on `@openclaw/pair-sdk` for `v2` login / pairing / binding / presence discovery
- Depends on `@openclaw/message-sdk` for OpenClaw business message contract
- RN runtime injects AsyncStorage / SSE / WebRTC adapters into `@openclaw/pair-sdk`
- Pair approval, signaling, WebRTC peer channel, and chat message dispatch are now wired end-to-end
- The protocol layer remains business-agnostic; OpenClaw chat stays in `@openclaw/message-sdk`

## Run

```bash
npm run mobile:start
npm run mobile:ios
npm run mobile:android
npm run mobile:web
npm run mobile:typecheck
```

- `npm run mobile:start` now starts Metro on LAN, so physical devices can load the JS bundle
- If you only want loopback access on this Mac, use `npm --prefix mobile run start:localhost`

Or directly:

```bash
cd mobile
npm run start
```

## Native build note

- `react-native-webrtc` requires a native runtime; use `npm run ios` / `npm run android`
- `Expo Go` is not sufficient for the current peer transport implementation
- Physical iPhone debugging requires Metro to be reachable over LAN, not `localhost`
- If CocoaPods is slow in mainland China, set `OPENCLAW_IOS_WEBRTC_URL` to a faster mirror before `npm run ios`
- Example mirror: `export OPENCLAW_IOS_WEBRTC_URL='https://gh-proxy.com/https://github.com/jitsi/webrtc/releases/download/v124.0.2/WebRTC.xcframework.zip'`
- If `ZXingObjC` clone is unstable, set `OPENCLAW_IOS_ZXING_URL` to an archive mirror before `npm run ios`
- Example mirror: `export OPENCLAW_IOS_ZXING_URL='https://gh-proxy.com/https://github.com/zxingify/zxingify-objc/archive/refs/tags/3.6.8.tar.gz'`

## iPhone deployment checklist

- Sign in to Xcode with your Apple Developer account: `Xcode > Settings > Accounts`
- Wait until an `Apple Development` signing certificate is created in your login keychain
- Open `/Users/zhangruiqiang/dev/setupclaw/mobile/ios/OpenClawMobile.xcworkspace` and select your team for target `OpenClawMobile`
- Keep `bundleIdentifier` aligned with a valid development App ID, currently `dev.openclawapp.mobile`
- On the iPhone, enable Developer Mode and trust the developer certificate if prompted
- Then rerun `npm run mobile:ios -- --device "RQ.Z IPhone" --no-bundler`

## Structure

- `App.tsx`: app bootstrap
- `src/navigation`: stack navigation
- `src/screens`: UI screens
- `src/services/pairingV2.ts`: `v2` pairing / binding / presence service
- `src/services/reactNativePairRuntime.ts`: RN storage / SSE / WebRTC runtime bridge
- `src/state/SessionsContext.tsx`: session state + signaling + peer lifecycle
- `src/theme`: color tokens and visual primitives
- `src/types`: shared view-model types

## Next

1. add native-device manual verification pass on iOS / Android
2. improve reconnect / background restore strategy
3. expose message modules so more mobile apps can reuse the same channel
4. add protocol compatibility tests across desktop / mobile / server
