package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
)

type v2Principal struct {
	Session v2AuthSession
	Desktop *v2Desktop
	Mobile  *v2Mobile
}

type v2Store struct {
	mu                  sync.RWMutex
	desktops            map[string]v2Desktop
	mobiles             map[string]v2Mobile
	challenges          map[string]v2AuthChallenge
	authSessions        map[string]v2AuthSession
	pairSessions        map[string]v2PairSession
	pairClaimTokenIndex map[string]string
	bindings            map[string]v2Binding
	signalQueues        map[string][]SignalEvent
	subscribers         map[string]map[chan SignalEvent]struct{}
}

type v2StoreSnapshot struct {
	Version             int                      `json:"version"`
	SavedAt             int64                    `json:"savedAt"`
	Desktops            map[string]v2Desktop     `json:"desktops"`
	Mobiles             map[string]v2Mobile      `json:"mobiles"`
	AuthSessions        map[string]v2AuthSession `json:"authSessions"`
	PairSessions        map[string]v2PairSession `json:"pairSessions"`
	PairClaimTokenIndex map[string]string        `json:"pairClaimTokenIndex"`
	Bindings            map[string]v2Binding     `json:"bindings"`
	SignalQueues        map[string][]SignalEvent `json:"signalQueues"`
}

func normalizeV2DisplayName(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func v2EntityLastActiveAt(lastSeenAt int64, updatedAt int64) int64 {
	if lastSeenAt > updatedAt {
		return lastSeenAt
	}
	return updatedAt
}

func v2EntityInactiveCutoff(now int64) int64 {
	return now - v2ActiveEntityTTL.Milliseconds()
}

func newV2Store() *v2Store {
	return &v2Store{
		desktops:            map[string]v2Desktop{},
		mobiles:             map[string]v2Mobile{},
		challenges:          map[string]v2AuthChallenge{},
		authSessions:        map[string]v2AuthSession{},
		pairSessions:        map[string]v2PairSession{},
		pairClaimTokenIndex: map[string]string{},
		bindings:            map[string]v2Binding{},
		signalQueues:        map[string][]SignalEvent{},
		subscribers:         map[string]map[chan SignalEvent]struct{}{},
	}
}

func (s *v2Store) snapshot() v2StoreSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	snap := v2StoreSnapshot{
		Version:             1,
		SavedAt:             nowMillis(),
		Desktops:            map[string]v2Desktop{},
		Mobiles:             map[string]v2Mobile{},
		AuthSessions:        map[string]v2AuthSession{},
		PairSessions:        map[string]v2PairSession{},
		PairClaimTokenIndex: map[string]string{},
		Bindings:            map[string]v2Binding{},
		SignalQueues:        map[string][]SignalEvent{},
	}

	for key, value := range s.desktops {
		snap.Desktops[key] = value
	}
	for key, value := range s.mobiles {
		snap.Mobiles[key] = value
	}
	for key, value := range s.authSessions {
		snap.AuthSessions[key] = value
	}
	for key, value := range s.pairSessions {
		snap.PairSessions[key] = value
	}
	for key, value := range s.pairClaimTokenIndex {
		snap.PairClaimTokenIndex[key] = value
	}
	for key, value := range s.bindings {
		snap.Bindings[key] = value
	}
	for key, queue := range s.signalQueues {
		copied := make([]SignalEvent, 0, len(queue))
		for _, event := range queue {
			copied = append(copied, copySignalEvent(event))
		}
		snap.SignalQueues[key] = copied
	}

	return snap
}

func (s *v2Store) applySnapshot(snap v2StoreSnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.desktops = map[string]v2Desktop{}
	for key, value := range snap.Desktops {
		s.desktops[key] = value
	}

	s.mobiles = map[string]v2Mobile{}
	for key, value := range snap.Mobiles {
		s.mobiles[key] = value
	}

	s.authSessions = map[string]v2AuthSession{}
	for key, value := range snap.AuthSessions {
		s.authSessions[key] = value
	}

	s.pairSessions = map[string]v2PairSession{}
	for key, value := range snap.PairSessions {
		s.pairSessions[key] = value
	}

	s.pairClaimTokenIndex = map[string]string{}
	for claimToken, pairSessionID := range snap.PairClaimTokenIndex {
		s.pairClaimTokenIndex[claimToken] = pairSessionID
	}
	if len(s.pairClaimTokenIndex) == 0 {
		for pairSessionID, session := range s.pairSessions {
			if session.ClaimToken == "" {
				continue
			}
			if session.Status != "pending" && session.Status != "claimed" {
				continue
			}
			s.pairClaimTokenIndex[session.ClaimToken] = pairSessionID
		}
	}

	s.bindings = map[string]v2Binding{}
	for key, value := range snap.Bindings {
		s.bindings[key] = value
	}

	s.signalQueues = map[string][]SignalEvent{}
	for key, queue := range snap.SignalQueues {
		copied := make([]SignalEvent, 0, len(queue))
		for _, event := range queue {
			copied = append(copied, copySignalEvent(event))
		}
		s.signalQueues[key] = copied
	}

	s.challenges = map[string]v2AuthChallenge{}
	s.subscribers = map[string]map[chan SignalEvent]struct{}{}
}

func parseV2EntityType(value string) (v2EntityType, error) {
	switch v2EntityType(strings.TrimSpace(value)) {
	case v2EntityDesktop:
		return v2EntityDesktop, nil
	case v2EntityMobile:
		return v2EntityMobile, nil
	default:
		return "", newError("VALIDATION_ERROR", "entityType must be desktop or mobile")
	}
}

func makeV2OpaqueToken(prefix string, size int) (string, error) {
	if size < 8 {
		size = 8
	}
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(buf), nil
}

func decodeBase64Flexible(value string) ([]byte, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, errors.New("empty")
	}
	encodings := []*base64.Encoding{
		base64.RawURLEncoding,
		base64.URLEncoding,
		base64.RawStdEncoding,
		base64.StdEncoding,
	}
	var lastErr error
	for _, enc := range encodings {
		decoded, err := enc.DecodeString(trimmed)
		if err == nil {
			return decoded, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func normalizeEd25519PublicKey(value string) (string, ed25519.PublicKey, error) {
	decoded, err := decodeBase64Flexible(value)
	if err != nil {
		return "", nil, newError("VALIDATION_ERROR", "publicKey must be valid base64")
	}
	if len(decoded) != ed25519.PublicKeySize {
		return "", nil, newError("VALIDATION_ERROR", "publicKey must be an Ed25519 public key")
	}
	return base64.RawURLEncoding.EncodeToString(decoded), ed25519.PublicKey(decoded), nil
}

func normalizeEd25519Signature(value string) ([]byte, error) {
	decoded, err := decodeBase64Flexible(value)
	if err != nil {
		return nil, newError("VALIDATION_ERROR", "signature must be valid base64")
	}
	if len(decoded) != ed25519.SignatureSize {
		return nil, newError("VALIDATION_ERROR", "signature must be an Ed25519 signature")
	}
	return decoded, nil
}

func buildV2LoginMessage(challenge v2AuthChallenge) []byte {
	return []byte(fmt.Sprintf(
		"openclaw-v2-auth-login\n%s\n%s\n%s\n%s\n%s",
		challenge.ChallengeID,
		challenge.Nonce,
		challenge.EntityType,
		challenge.EntityID,
		challenge.PublicKey,
	))
}

func (s *v2Store) pruneExpiredLocked(now int64) bool {
	changed := false

	for challengeID, challenge := range s.challenges {
		if challenge.ExpiresAt <= now {
			delete(s.challenges, challengeID)
			changed = true
		}
	}

	for token, session := range s.authSessions {
		if session.ExpiresAt <= now {
			delete(s.authSessions, token)
			changed = true
		}
	}

	for pairSessionID, session := range s.pairSessions {
		if session.ExpiresAt > now {
			continue
		}
		if session.Status == "pending" || session.Status == "claimed" {
			session.Status = "expired"
			session.UpdatedAt = now
			s.pairSessions[pairSessionID] = session
			delete(s.pairClaimTokenIndex, session.ClaimToken)
			changed = true
		}
	}

	cutoff := v2EntityInactiveCutoff(now)
	removedEntityKeys := map[string]struct{}{}

	for deviceID, desktop := range s.desktops {
		if v2EntityLastActiveAt(desktop.LastSeenAt, desktop.UpdatedAt) > cutoff {
			continue
		}
		delete(s.desktops, deviceID)
		removedEntityKeys[clientKey(string(v2EntityDesktop), deviceID)] = struct{}{}
		changed = true
	}

	for mobileID, mobile := range s.mobiles {
		if v2EntityLastActiveAt(mobile.LastSeenAt, mobile.UpdatedAt) > cutoff {
			continue
		}
		delete(s.mobiles, mobileID)
		removedEntityKeys[clientKey(string(v2EntityMobile), mobileID)] = struct{}{}
		changed = true
	}

	for token, session := range s.authSessions {
		entityKey := clientKey(string(session.EntityType), session.EntityID)
		if _, removed := removedEntityKeys[entityKey]; removed {
			delete(s.authSessions, token)
			changed = true
		}
	}

	for queueKey := range s.signalQueues {
		if _, removed := removedEntityKeys[queueKey]; removed {
			delete(s.signalQueues, queueKey)
			changed = true
		}
	}

	return changed
}

func (s *v2Store) stats() v2Stats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return v2Stats{
		Desktops:     len(s.desktops),
		Mobiles:      len(s.mobiles),
		Challenges:   len(s.challenges),
		Sessions:     len(s.authSessions),
		PairSessions: len(s.pairSessions),
		Bindings:     len(s.bindings),
	}
}

func (s *v2Store) createChallenge(req v2ChallengeRequest) (v2AuthChallenge, error) {
	entityType, err := parseV2EntityType(req.EntityType)
	if err != nil {
		return v2AuthChallenge{}, err
	}
	entityID, err := trimRequired(req.EntityID, "entityId")
	if err != nil {
		return v2AuthChallenge{}, err
	}
	normalizedKey, _, err := normalizeEd25519PublicKey(req.PublicKey)
	if err != nil {
		return v2AuthChallenge{}, err
	}

	challengeID, err := makeID("v2chl")
	if err != nil {
		return v2AuthChallenge{}, newError("INTERNAL_ERROR", "failed to create challenge")
	}
	nonce, err := makeV2OpaqueToken("nonce", 18)
	if err != nil {
		return v2AuthChallenge{}, newError("INTERNAL_ERROR", "failed to create challenge")
	}

	now := nowMillis()
	challenge := v2AuthChallenge{
		ChallengeID: challengeID,
		EntityType:  entityType,
		EntityID:    entityID,
		PublicKey:   normalizedKey,
		Nonce:       nonce,
		CreatedAt:   now,
		ExpiresAt:   now + v2ChallengeTTL.Milliseconds(),
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked(now)
	s.challenges[challenge.ChallengeID] = challenge
	return challenge, nil
}

func (s *v2Store) login(req v2LoginRequest) (v2AuthSession, error) {
	entityType, err := parseV2EntityType(req.EntityType)
	if err != nil {
		return v2AuthSession{}, err
	}
	entityID, err := trimRequired(req.EntityID, "entityId")
	if err != nil {
		return v2AuthSession{}, err
	}
	challengeID, err := trimRequired(req.ChallengeID, "challengeId")
	if err != nil {
		return v2AuthSession{}, err
	}
	normalizedKey, publicKey, err := normalizeEd25519PublicKey(req.PublicKey)
	if err != nil {
		return v2AuthSession{}, err
	}
	signature, err := normalizeEd25519Signature(req.Signature)
	if err != nil {
		return v2AuthSession{}, err
	}

	now := nowMillis()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked(now)

	challenge, exists := s.challenges[challengeID]
	if !exists {
		return v2AuthSession{}, newError("NOT_FOUND", "challenge not found")
	}
	if challenge.ExpiresAt <= now {
		delete(s.challenges, challengeID)
		return v2AuthSession{}, newError("EXPIRED", "challenge expired")
	}
	if challenge.EntityType != entityType || challenge.EntityID != entityID || challenge.PublicKey != normalizedKey {
		return v2AuthSession{}, newError("FORBIDDEN", "challenge does not match login payload")
	}
	if !ed25519.Verify(publicKey, buildV2LoginMessage(challenge), signature) {
		return v2AuthSession{}, newError("UNAUTHORIZED", "signature verification failed")
	}

	switch entityType {
	case v2EntityDesktop:
		desktop, exists := s.desktops[entityID]
		if exists && desktop.PublicKey != normalizedKey {
			return v2AuthSession{}, newError("FORBIDDEN", "desktop id already exists with another public key")
		}
		if !exists {
			desktop = v2Desktop{
				DeviceID:      entityID,
				PublicKey:     normalizedKey,
				Capabilities:  map[string]any{},
				CreatedAt:     now,
				UpdatedAt:     now,
				LastSeenAt:    now,
				PresenceState: "offline",
			}
		} else {
			desktop.UpdatedAt = now
			if desktop.LastSeenAt <= 0 {
				desktop.LastSeenAt = now
			}
		}
		s.desktops[entityID] = desktop
	case v2EntityMobile:
		mobile, exists := s.mobiles[entityID]
		if exists && mobile.PublicKey != normalizedKey {
			return v2AuthSession{}, newError("FORBIDDEN", "mobile id already exists with another public key")
		}
		if !exists {
			mobile = v2Mobile{
				MobileID:      entityID,
				PublicKey:     normalizedKey,
				Capabilities:  map[string]any{},
				CreatedAt:     now,
				UpdatedAt:     now,
				LastSeenAt:    now,
				PresenceState: "online",
			}
		} else {
			mobile.UpdatedAt = now
			mobile.LastSeenAt = now
			mobile.PresenceState = "online"
		}
		s.mobiles[entityID] = mobile
	}

	delete(s.challenges, challengeID)

	sessionID, err := makeID("v2sess")
	if err != nil {
		return v2AuthSession{}, newError("INTERNAL_ERROR", "failed to create auth session")
	}
	token, err := makeV2OpaqueToken("v2tok", 24)
	if err != nil {
		return v2AuthSession{}, newError("INTERNAL_ERROR", "failed to create auth session")
	}
	session := v2AuthSession{
		SessionID:  sessionID,
		Token:      token,
		EntityType: entityType,
		EntityID:   entityID,
		PublicKey:  normalizedKey,
		CreatedAt:  now,
		UpdatedAt:  now,
		ExpiresAt:  now + v2AuthSessionTTL.Milliseconds(),
	}
	s.authSessions[session.Token] = session
	return session, nil
}

func (s *v2Store) authenticate(token string) (v2Principal, error) {
	normalized := strings.TrimSpace(token)
	if normalized == "" {
		return v2Principal{}, newError("UNAUTHORIZED", "bearer token is required")
	}

	now := nowMillis()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked(now)

	session, exists := s.authSessions[normalized]
	if !exists {
		return v2Principal{}, newError("UNAUTHORIZED", "invalid bearer token")
	}
	if session.ExpiresAt <= now {
		delete(s.authSessions, normalized)
		return v2Principal{}, newError("UNAUTHORIZED", "session expired")
	}
	session.UpdatedAt = now
	session.ExpiresAt = now + v2AuthSessionTTL.Milliseconds()
	s.authSessions[normalized] = session

	principal := v2Principal{Session: session}
	switch session.EntityType {
	case v2EntityDesktop:
		desktop, exists := s.desktops[session.EntityID]
		if !exists {
			desktop = v2Desktop{
				DeviceID:      session.EntityID,
				PublicKey:     session.PublicKey,
				Capabilities:  map[string]any{},
				CreatedAt:     session.CreatedAt,
				UpdatedAt:     now,
				LastSeenAt:    now,
				PresenceState: "offline",
			}
			s.desktops[session.EntityID] = desktop
		}
		principal.Desktop = &desktop
	case v2EntityMobile:
		mobile, exists := s.mobiles[session.EntityID]
		if !exists {
			mobile = v2Mobile{
				MobileID:      session.EntityID,
				PublicKey:     session.PublicKey,
				Capabilities:  map[string]any{},
				CreatedAt:     session.CreatedAt,
				UpdatedAt:     now,
				LastSeenAt:    now,
				PresenceState: "online",
			}
			s.mobiles[session.EntityID] = mobile
		}
		principal.Mobile = &mobile
	default:
		return v2Principal{}, newError("UNAUTHORIZED", "unknown session type")
	}
	return principal, nil
}

func (s *v2Store) announcePresence(principal v2Principal, req v2PresenceAnnounceRequest) (*v2Desktop, *v2Mobile, error) {
	now := nowMillis()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked(now)

	switch principal.Session.EntityType {
	case v2EntityDesktop:
		desktop, exists := s.desktops[principal.Session.EntityID]
		if !exists {
			return nil, nil, newError("NOT_FOUND", "desktop not found")
		}
		desktop.Platform = strings.TrimSpace(req.Platform)
		desktop.AppVersion = strings.TrimSpace(req.AppVersion)
		if req.Capabilities != nil {
			desktop.Capabilities = req.Capabilities
		} else if desktop.Capabilities == nil {
			desktop.Capabilities = map[string]any{}
		}
		desktop.LastSeenAt = now
		desktop.UpdatedAt = now
		desktop.PresenceState = "online"
		s.desktops[desktop.DeviceID] = desktop
		return &desktop, nil, nil
	case v2EntityMobile:
		mobile, exists := s.mobiles[principal.Session.EntityID]
		if !exists {
			return nil, nil, newError("NOT_FOUND", "mobile not found")
		}
		if platform := strings.TrimSpace(req.Platform); platform != "" {
			mobile.Platform = platform
		}
		if appVersion := strings.TrimSpace(req.AppVersion); appVersion != "" {
			mobile.AppVersion = appVersion
		}
		if req.Capabilities != nil {
			mobile.Capabilities = req.Capabilities
		} else if mobile.Capabilities == nil {
			mobile.Capabilities = map[string]any{}
		}
		mobile.LastSeenAt = now
		mobile.UpdatedAt = now
		mobile.PresenceState = "online"
		s.mobiles[mobile.MobileID] = mobile
		return nil, &mobile, nil
	default:
		return nil, nil, newError("FORBIDDEN", "unsupported presence principal")
	}
}

func (s *v2Store) heartbeatPresence(principal v2Principal, req v2PresenceHeartbeatRequest) (*v2Desktop, *v2Mobile, error) {
	now := nowMillis()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked(now)

	switch principal.Session.EntityType {
	case v2EntityDesktop:
		desktop, exists := s.desktops[principal.Session.EntityID]
		if !exists {
			return nil, nil, newError("NOT_FOUND", "desktop not found")
		}
		if platform := strings.TrimSpace(req.Platform); platform != "" {
			desktop.Platform = platform
		}
		if appVersion := strings.TrimSpace(req.AppVersion); appVersion != "" {
			desktop.AppVersion = appVersion
		}
		if req.Capabilities != nil {
			desktop.Capabilities = req.Capabilities
		}
		desktop.LastSeenAt = now
		desktop.UpdatedAt = now
		desktop.PresenceState = "online"
		s.desktops[desktop.DeviceID] = desktop
		return &desktop, nil, nil
	case v2EntityMobile:
		mobile, exists := s.mobiles[principal.Session.EntityID]
		if !exists {
			return nil, nil, newError("NOT_FOUND", "mobile not found")
		}
		if platform := strings.TrimSpace(req.Platform); platform != "" {
			mobile.Platform = platform
		}
		if appVersion := strings.TrimSpace(req.AppVersion); appVersion != "" {
			mobile.AppVersion = appVersion
		}
		if req.Capabilities != nil {
			mobile.Capabilities = req.Capabilities
		}
		mobile.LastSeenAt = now
		mobile.UpdatedAt = now
		mobile.PresenceState = "online"
		s.mobiles[mobile.MobileID] = mobile
		return nil, &mobile, nil
	default:
		return nil, nil, newError("FORBIDDEN", "unsupported heartbeat principal")
	}
}

func (s *v2Store) createPairSession(principal v2Principal, req v2CreatePairSessionRequest) (v2PairSession, error) {
	if principal.Session.EntityType != v2EntityDesktop {
		return v2PairSession{}, newError("FORBIDDEN", "only desktop can create pair sessions")
	}

	now := nowMillis()
	ttl := req.TTLSeconds
	if ttl == 0 {
		ttl = v2PairSessionDefaultTTL
	}
	ttl = clampInt(ttl, v2PairSessionMinTTL, v2PairSessionMaxTTL)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked(now)

	desktop, exists := s.desktops[principal.Session.EntityID]
	if !exists {
		return v2PairSession{}, newError("NOT_FOUND", "desktop not found")
	}

	pairSessionID, err := makeID("v2pair")
	if err != nil {
		return v2PairSession{}, newError("INTERNAL_ERROR", "failed to create pair session")
	}
	claimToken, err := makeV2OpaqueToken("v2claim", 24)
	if err != nil {
		return v2PairSession{}, newError("INTERNAL_ERROR", "failed to create pair session")
	}
	sessionNonce, err := makeV2OpaqueToken("v2nonce", 18)
	if err != nil {
		return v2PairSession{}, newError("INTERNAL_ERROR", "failed to create pair session")
	}

	session := v2PairSession{
		PairSessionID:   pairSessionID,
		DeviceID:        desktop.DeviceID,
		DevicePublicKey: desktop.PublicKey,
		ClaimToken:      claimToken,
		SessionNonce:    sessionNonce,
		Status:          "pending",
		CreatedAt:       now,
		UpdatedAt:       now,
		ExpiresAt:       now + int64(ttl)*1000,
	}
	s.pairSessions[session.PairSessionID] = session
	s.pairClaimTokenIndex[session.ClaimToken] = session.PairSessionID
	return session, nil
}

func (s *v2Store) deletePairSession(principal v2Principal, req v2PairSessionDeleteRequest) (v2PairSession, error) {
	if principal.Session.EntityType != v2EntityDesktop {
		return v2PairSession{}, newError("FORBIDDEN", "only desktop can delete pair sessions")
	}
	pairSessionID, err := trimRequired(req.PairSessionID, "pairSessionId")
	if err != nil {
		return v2PairSession{}, err
	}

	now := nowMillis()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked(now)

	session, exists := s.pairSessions[pairSessionID]
	if !exists {
		return v2PairSession{}, newError("NOT_FOUND", "pair session not found")
	}
	if session.DeviceID != principal.Session.EntityID {
		return v2PairSession{}, newError("FORBIDDEN", "desktop cannot delete another device pair session")
	}
	if session.BindingID != nil || session.Status != "pending" {
		return v2PairSession{}, newError("INVALID_STATE", "pair session can no longer be deleted")
	}

	delete(s.pairSessions, pairSessionID)
	delete(s.pairClaimTokenIndex, session.ClaimToken)
	return session, nil
}

func (s *v2Store) findBindingLocked(deviceID string, mobileID string) (v2Binding, bool) {
	for _, binding := range s.bindings {
		if binding.DeviceID == deviceID && binding.MobileID == mobileID && binding.TrustState != v2TrustStateRevoked {
			return binding, true
		}
	}
	return v2Binding{}, false
}

func (s *v2Store) claimPair(principal v2Principal, req v2PairClaimRequest) (v2PairSession, v2Binding, error) {
	if principal.Session.EntityType != v2EntityMobile {
		return v2PairSession{}, v2Binding{}, newError("FORBIDDEN", "only mobile can claim pair sessions")
	}
	claimToken, err := trimRequired(req.ClaimToken, "claimToken")
	if err != nil {
		return v2PairSession{}, v2Binding{}, err
	}

	now := nowMillis()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked(now)

	pairSessionID, exists := s.pairClaimTokenIndex[claimToken]
	if !exists {
		return v2PairSession{}, v2Binding{}, newError("NOT_FOUND", "pair session not found")
	}
	session, exists := s.pairSessions[pairSessionID]
	if !exists {
		return v2PairSession{}, v2Binding{}, newError("NOT_FOUND", "pair session not found")
	}
	if session.ExpiresAt <= now {
		session.Status = "expired"
		session.UpdatedAt = now
		s.pairSessions[pairSessionID] = session
		delete(s.pairClaimTokenIndex, claimToken)
		return v2PairSession{}, v2Binding{}, newError("EXPIRED", "pair session expired")
	}
	if session.Status != "pending" && session.Status != "claimed" {
		return v2PairSession{}, v2Binding{}, newError("INVALID_STATE", "pair session is not claimable")
	}
	if session.Status == "claimed" && session.ClaimedMobileID != nil && *session.ClaimedMobileID != principal.Session.EntityID {
		return v2PairSession{}, v2Binding{}, newError("ALREADY_CLAIMED", "pair session already claimed by another mobile")
	}

	mobile, exists := s.mobiles[principal.Session.EntityID]
	if !exists {
		return v2PairSession{}, v2Binding{}, newError("NOT_FOUND", "mobile not found")
	}
	mobileName := normalizeV2DisplayName(req.MobileName)
	if mobileName != "" {
		mobile.MobileName = mobileName
		mobile.UpdatedAt = now
		s.mobiles[mobile.MobileID] = mobile
	}

	existingBinding, hasBinding := s.findBindingLocked(session.DeviceID, mobile.MobileID)
	if hasBinding && existingBinding.TrustState == v2TrustStateActive {
		return v2PairSession{}, v2Binding{}, newError("INVALID_STATE", "binding already active")
	}

	var binding v2Binding
	if hasBinding && existingBinding.TrustState == v2TrustStatePending {
		binding = existingBinding
		binding.PairSessionID = session.PairSessionID
		binding.MobilePublicKey = mobile.PublicKey
		binding.MobileName = mobile.MobileName
		binding.DevicePublicKey = session.DevicePublicKey
		binding.UpdatedAt = now
	} else {
		bindingID, idErr := makeID("v2bind")
		if idErr != nil {
			return v2PairSession{}, v2Binding{}, newError("INTERNAL_ERROR", "failed to create binding")
		}
		binding = v2Binding{
			BindingID:       bindingID,
			PairSessionID:   session.PairSessionID,
			DeviceID:        session.DeviceID,
			DevicePublicKey: session.DevicePublicKey,
			MobileID:        mobile.MobileID,
			MobileName:      mobile.MobileName,
			MobilePublicKey: mobile.PublicKey,
			TrustState:      v2TrustStatePending,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
	}

	claimedMobileID := mobile.MobileID
	session.Status = "claimed"
	session.UpdatedAt = now
	session.ClaimedMobileID = &claimedMobileID
	session.BindingID = &binding.BindingID

	s.bindings[binding.BindingID] = binding
	s.pairSessions[session.PairSessionID] = session

	return session, binding, nil
}

func (s *v2Store) approveBinding(principal v2Principal, req v2PairApproveRequest) (v2Binding, error) {
	if principal.Session.EntityType != v2EntityDesktop {
		return v2Binding{}, newError("FORBIDDEN", "only desktop can approve bindings")
	}
	bindingID, err := trimRequired(req.BindingID, "bindingId")
	if err != nil {
		return v2Binding{}, err
	}

	now := nowMillis()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked(now)

	binding, exists := s.bindings[bindingID]
	if !exists {
		return v2Binding{}, newError("NOT_FOUND", "binding not found")
	}
	if binding.DeviceID != principal.Session.EntityID {
		return v2Binding{}, newError("FORBIDDEN", "desktop cannot approve another device binding")
	}
	if binding.TrustState != v2TrustStatePending {
		return v2Binding{}, newError("INVALID_STATE", "binding is not pending")
	}

	approvedAt := now
	binding.TrustState = v2TrustStateActive
	binding.ApprovedAt = &approvedAt
	binding.UpdatedAt = now
	s.bindings[binding.BindingID] = binding

	if pairSession, exists := s.pairSessions[binding.PairSessionID]; exists {
		pairSession.Status = "approved"
		pairSession.UpdatedAt = now
		s.pairSessions[pairSession.PairSessionID] = pairSession
		delete(s.pairClaimTokenIndex, pairSession.ClaimToken)
	}

	return binding, nil
}

func buildV2PresenceStatus(desktop v2Desktop) v2PresenceStatus {
	status := "offline"
	if nowMillis()-desktop.LastSeenAt <= v2PresenceOnlineWindow.Milliseconds() {
		status = "online"
	}
	return v2PresenceStatus{
		DeviceID:   desktop.DeviceID,
		Platform:   desktop.Platform,
		AppVersion: desktop.AppVersion,
		Status:     status,
		LastSeenAt: desktop.LastSeenAt,
		UpdatedAt:  desktop.UpdatedAt,
	}
}

func (s *v2Store) queryPresence(principal v2Principal, req v2PresenceQueryRequest) ([]v2PresenceStatus, error) {
	now := nowMillis()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked(now)

	switch principal.Session.EntityType {
	case v2EntityDesktop:
		desktop, exists := s.desktops[principal.Session.EntityID]
		if !exists {
			return nil, newError("NOT_FOUND", "desktop not found")
		}
		if len(req.DeviceIDs) > 0 {
			requested := map[string]struct{}{}
			for _, deviceID := range req.DeviceIDs {
				normalized := strings.TrimSpace(deviceID)
				if normalized != "" {
					requested[normalized] = struct{}{}
				}
			}
			if len(requested) != 1 {
				return nil, newError("FORBIDDEN", "desktop can only query itself")
			}
			if _, ok := requested[desktop.DeviceID]; !ok {
				return nil, newError("FORBIDDEN", "desktop can only query itself")
			}
		}
		return []v2PresenceStatus{buildV2PresenceStatus(desktop)}, nil
	case v2EntityMobile:
		allowed := map[string]struct{}{}
		for _, binding := range s.bindings {
			if binding.MobileID == principal.Session.EntityID && binding.TrustState == v2TrustStateActive {
				allowed[binding.DeviceID] = struct{}{}
			}
		}
		targets := make([]string, 0, len(allowed))
		if len(req.DeviceIDs) == 0 {
			for deviceID := range allowed {
				targets = append(targets, deviceID)
			}
		} else {
			for _, deviceID := range req.DeviceIDs {
				normalized := strings.TrimSpace(deviceID)
				if normalized == "" {
					continue
				}
				if _, ok := allowed[normalized]; !ok {
					return nil, newError("FORBIDDEN", "mobile can only query bound desktops")
				}
				targets = append(targets, normalized)
			}
		}

		result := make([]v2PresenceStatus, 0, len(targets))
		for _, deviceID := range targets {
			desktop, exists := s.desktops[deviceID]
			if !exists {
				continue
			}
			result = append(result, buildV2PresenceStatus(desktop))
		}
		return result, nil
	default:
		return nil, newError("UNAUTHORIZED", "unauthorized principal")
	}
}

func (s *v2Store) authorizeSignalClient(principal v2Principal, clientType string, clientID string) error {
	normalizedType := strings.TrimSpace(clientType)
	normalizedID := strings.TrimSpace(clientID)
	if normalizedType == "" || normalizedID == "" {
		return newError("VALIDATION_ERROR", "clientType and clientId are required")
	}

	switch principal.Session.EntityType {
	case v2EntityDesktop:
		if normalizedType != string(v2EntityDesktop) || normalizedID != principal.Session.EntityID {
			return newError("FORBIDDEN", "desktop can only subscribe as itself")
		}
		return nil
	case v2EntityMobile:
		if normalizedType != string(v2EntityMobile) || normalizedID != principal.Session.EntityID {
			return newError("FORBIDDEN", "mobile can only subscribe as itself")
		}
		return nil
	default:
		return newError("UNAUTHORIZED", "unauthorized client")
	}
}

func (s *v2Store) hasActiveBindingLocked(deviceID string, mobileID string) bool {
	for _, binding := range s.bindings {
		if binding.DeviceID == deviceID && binding.MobileID == mobileID && binding.TrustState == v2TrustStateActive {
			return true
		}
	}
	return false
}

func (s *v2Store) authorizeSignalSend(principal v2Principal, req sendSignalRequest) error {
	fromType := strings.TrimSpace(req.FromType)
	fromID := strings.TrimSpace(req.FromID)
	toType := strings.TrimSpace(req.ToType)
	toID := strings.TrimSpace(req.ToID)
	if fromType == "" || fromID == "" || toType == "" || toID == "" {
		return newError("VALIDATION_ERROR", "fromType/fromId/toType/toId are required")
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	switch principal.Session.EntityType {
	case v2EntityDesktop:
		if fromType != string(v2EntityDesktop) || fromID != principal.Session.EntityID {
			return newError("FORBIDDEN", "desktop can only send as itself")
		}
		if toType != string(v2EntityMobile) {
			return newError("FORBIDDEN", "desktop can only send to mobile")
		}
		if !s.hasActiveBindingLocked(principal.Session.EntityID, toID) {
			return newError("FORBIDDEN", "target mobile is not actively bound to this desktop")
		}
		return nil
	case v2EntityMobile:
		if fromType != string(v2EntityMobile) || fromID != principal.Session.EntityID {
			return newError("FORBIDDEN", "mobile can only send as itself")
		}
		if toType != string(v2EntityDesktop) {
			return newError("FORBIDDEN", "mobile can only send to desktop")
		}
		if !s.hasActiveBindingLocked(toID, principal.Session.EntityID) {
			return newError("FORBIDDEN", "target desktop is not actively bound to this mobile")
		}
		return nil
	default:
		return newError("UNAUTHORIZED", "unauthorized sender")
	}
}

func (s *v2Store) buildSignalEvent(req sendSignalRequest) (SignalEvent, error) {
	fromType, err := trimRequired(req.FromType, "fromType")
	if err != nil {
		return SignalEvent{}, err
	}
	fromID, err := trimRequired(req.FromID, "fromId")
	if err != nil {
		return SignalEvent{}, err
	}
	toType, err := trimRequired(req.ToType, "toType")
	if err != nil {
		return SignalEvent{}, err
	}
	toID, err := trimRequired(req.ToID, "toId")
	if err != nil {
		return SignalEvent{}, err
	}
	eventType, err := trimRequired(req.Type, "type")
	if err != nil {
		return SignalEvent{}, err
	}
	eventID, err := makeID("v2evt")
	if err != nil {
		return SignalEvent{}, newError("INTERNAL_ERROR", "failed to create signal event")
	}
	return SignalEvent{
		ID:      eventID,
		Type:    eventType,
		Ts:      nowMillis(),
		From:    &SignalParty{Type: fromType, ID: fromID},
		To:      &SignalParty{Type: toType, ID: toID},
		Payload: copyPayload(req.Payload),
	}, nil
}

func (s *v2Store) pullSignalInbox(clientType string, clientID string, limit int) []SignalEvent {
	safeLimit := clampInt(limit, 1, maxSignalQueuePull)
	key := clientKey(clientType, clientID)

	s.mu.Lock()
	defer s.mu.Unlock()

	queue := s.signalQueues[key]
	if len(queue) == 0 {
		return []SignalEvent{}
	}

	take := int(math.Min(float64(safeLimit), float64(len(queue))))
	events := make([]SignalEvent, 0, take)
	for i := 0; i < take; i++ {
		events = append(events, copySignalEvent(queue[i]))
	}

	if take >= len(queue) {
		delete(s.signalQueues, key)
	} else {
		rest := make([]SignalEvent, 0, len(queue)-take)
		rest = append(rest, queue[take:]...)
		s.signalQueues[key] = rest
	}

	return events
}

func (s *v2Store) addSubscriber(clientType string, clientID string) chan SignalEvent {
	key := clientKey(clientType, clientID)
	ch := make(chan SignalEvent, 64)

	s.mu.Lock()
	defer s.mu.Unlock()

	set, exists := s.subscribers[key]
	if !exists {
		set = map[chan SignalEvent]struct{}{}
		s.subscribers[key] = set
	}
	set[ch] = struct{}{}
	return ch
}

func (s *v2Store) removeSubscriber(clientType string, clientID string, ch chan SignalEvent) {
	key := clientKey(clientType, clientID)

	s.mu.Lock()
	defer s.mu.Unlock()

	set, exists := s.subscribers[key]
	if !exists {
		return
	}
	delete(set, ch)
	if len(set) == 0 {
		delete(s.subscribers, key)
	}
}

func (s *v2Store) deliverSignalEvent(targetType string, targetID string, event SignalEvent) bool {
	key := clientKey(targetType, targetID)

	s.mu.RLock()
	set := s.subscribers[key]
	channels := make([]chan SignalEvent, 0, len(set))
	for ch := range set {
		channels = append(channels, ch)
	}
	s.mu.RUnlock()

	delivered := false
	for _, ch := range channels {
		select {
		case ch <- copySignalEvent(event):
			delivered = true
		default:
		}
	}
	return delivered
}

func (s *v2Store) enqueueSignalToQueue(targetType string, targetID string, event SignalEvent) {
	key := clientKey(targetType, targetID)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.signalQueues[key] = append(s.signalQueues[key], copySignalEvent(event))
}

func (s *v2Store) enqueueSignalEvent(targetType string, targetID string, event SignalEvent) bool {
	delivered := s.deliverSignalEvent(targetType, targetID, event)
	if delivered {
		return true
	}
	s.enqueueSignalToQueue(targetType, targetID, event)
	return false
}
