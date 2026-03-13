package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

const (
	maxBodyBytes       = 1024 * 1024
	maxSignalQueuePull = 500
	deviceInactiveTTL  = 30 * 24 * time.Hour
)

type codedError struct {
	code    string
	message string
}

func (e *codedError) Error() string {
	return e.message
}

func newError(code string, message string) error {
	return &codedError{code: code, message: message}
}

func errorCode(err error) string {
	var ce *codedError
	if errors.As(err, &ce) {
		return ce.code
	}
	return "INTERNAL_ERROR"
}

func errorStatus(err error) int {
	switch errorCode(err) {
	case "INVALID_JSON", "VALIDATION_ERROR":
		return http.StatusBadRequest
	case "BODY_TOO_LARGE":
		return http.StatusRequestEntityTooLarge
	case "UNAUTHORIZED":
		return http.StatusUnauthorized
	case "FORBIDDEN":
		return http.StatusForbidden
	case "NOT_FOUND":
		return http.StatusNotFound
	case "EXPIRED":
		return http.StatusGone
	case "INVALID_STATE", "ALREADY_CLAIMED":
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

type Device struct {
	DeviceID     string         `json:"deviceId"`
	CreatedAt    int64          `json:"createdAt"`
	DeviceToken  string         `json:"deviceToken"`
	Platform     string         `json:"platform"`
	AppVersion   string         `json:"appVersion"`
	Capabilities map[string]any `json:"capabilities"`
	Status       string         `json:"status"`
	LastSeenAt   int64          `json:"lastSeenAt"`
	UpdatedAt    int64          `json:"updatedAt"`
}

type PairSession struct {
	PairSessionID     string  `json:"pairSessionId"`
	DeviceID          string  `json:"deviceId"`
	PairCode          string  `json:"pairCode"`
	PairToken         string  `json:"pairToken"`
	Status            string  `json:"status"`
	CreatedAt         int64   `json:"createdAt"`
	ExpiresAt         int64   `json:"expiresAt"`
	ClaimedAt         *int64  `json:"claimedAt"`
	ClaimedByUserID   *string `json:"claimedByUserId"`
	ClaimedByMobileID *string `json:"claimedByMobileId"`
}

type Binding struct {
	BindingID   string `json:"bindingId"`
	UserID      string `json:"userId"`
	DeviceID    string `json:"deviceId"`
	MobileID    string `json:"mobileId"`
	MobileToken string `json:"mobileToken,omitempty"`
	Status      string `json:"status"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type SignalParty struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type SignalEvent struct {
	ID      string         `json:"id"`
	Type    string         `json:"type"`
	Ts      int64          `json:"ts"`
	From    *SignalParty   `json:"from,omitempty"`
	To      *SignalParty   `json:"to,omitempty"`
	Payload map[string]any `json:"payload"`
}

type StoreSnapshot struct {
	Version        int                      `json:"version"`
	SavedAt        int64                    `json:"savedAt"`
	Devices        map[string]Device        `json:"devices"`
	PairSessions   map[string]PairSession   `json:"pairSessions"`
	PairTokenIndex map[string]string        `json:"pairTokenIndex"`
	PairCodeIndex  map[string]string        `json:"pairCodeIndex"`
	Bindings       map[string]Binding       `json:"bindings"`
	SignalQueues   map[string][]SignalEvent `json:"signalQueues"`
}

type Store struct {
	mu               sync.RWMutex
	devices          map[string]Device
	deviceTokenIndex map[string]string
	pairSessions     map[string]PairSession
	pairTokenIndex   map[string]string
	pairCodeIndex    map[string]string
	bindings         map[string]Binding
	mobileTokenIndex map[string]string
	signalQueues     map[string][]SignalEvent
	subscribers      map[string]map[chan SignalEvent]struct{}
}

func newStore() *Store {
	return &Store{
		devices:          map[string]Device{},
		deviceTokenIndex: map[string]string{},
		pairSessions:     map[string]PairSession{},
		pairTokenIndex:   map[string]string{},
		pairCodeIndex:    map[string]string{},
		bindings:         map[string]Binding{},
		mobileTokenIndex: map[string]string{},
		signalQueues:     map[string][]SignalEvent{},
		subscribers:      map[string]map[chan SignalEvent]struct{}{},
	}
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

func clientKey(clientType string, clientID string) string {
	return fmt.Sprintf("%s:%s", clientType, clientID)
}

func splitClientKey(key string) (string, string, bool) {
	index := strings.Index(key, ":")
	if index <= 0 || index >= len(key)-1 {
		return "", "", false
	}
	return key[:index], key[index+1:], true
}

func clampInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func deviceInactiveCutoff(now int64) int64 {
	return now - deviceInactiveTTL.Milliseconds()
}

func randomHex(bytesLen int) (string, error) {
	b := make([]byte, bytesLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func makeID(prefix string) (string, error) {
	h, err := randomHex(16)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s_%s", prefix, h), nil
}

func makePairToken() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "pt_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func makePairCode() (string, error) {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	val := (uint32(b[0]) << 24) | (uint32(b[1]) << 16) | (uint32(b[2]) << 8) | uint32(b[3])
	return fmt.Sprintf("%06d", val%1000000), nil
}

func trimRequired(value string, field string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", newError("VALIDATION_ERROR", fmt.Sprintf("%s is required", field))
	}
	return trimmed, nil
}

func copyPayload(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func copySignalEvent(event SignalEvent) SignalEvent {
	cloned := event
	cloned.Payload = copyPayload(event.Payload)
	if event.From != nil {
		from := *event.From
		cloned.From = &from
	}
	if event.To != nil {
		to := *event.To
		cloned.To = &to
	}
	return cloned
}

func (s *Store) snapshot() StoreSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	snap := StoreSnapshot{
		Version:        1,
		SavedAt:        nowMillis(),
		Devices:        map[string]Device{},
		PairSessions:   map[string]PairSession{},
		PairTokenIndex: map[string]string{},
		PairCodeIndex:  map[string]string{},
		Bindings:       map[string]Binding{},
		SignalQueues:   map[string][]SignalEvent{},
	}

	for k, v := range s.devices {
		snap.Devices[k] = v
	}
	for k, v := range s.pairSessions {
		snap.PairSessions[k] = v
	}
	for k, v := range s.pairTokenIndex {
		snap.PairTokenIndex[k] = v
	}
	for k, v := range s.pairCodeIndex {
		snap.PairCodeIndex[k] = v
	}
	for k, v := range s.bindings {
		snap.Bindings[k] = v
	}
	for k, queue := range s.signalQueues {
		copied := make([]SignalEvent, 0, len(queue))
		for _, event := range queue {
			copied = append(copied, copySignalEvent(event))
		}
		snap.SignalQueues[k] = copied
	}

	return snap
}

func (s *Store) applySnapshot(snap StoreSnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.devices = map[string]Device{}
	for k, v := range snap.Devices {
		s.devices[k] = v
	}

	s.pairSessions = map[string]PairSession{}
	for k, v := range snap.PairSessions {
		s.pairSessions[k] = v
	}

	s.pairTokenIndex = map[string]string{}
	for k, v := range snap.PairTokenIndex {
		s.pairTokenIndex[k] = v
	}

	s.pairCodeIndex = map[string]string{}
	for k, v := range snap.PairCodeIndex {
		s.pairCodeIndex[k] = v
	}

	s.bindings = map[string]Binding{}
	for k, v := range snap.Bindings {
		s.bindings[k] = v
	}

	s.signalQueues = map[string][]SignalEvent{}
	for k, queue := range snap.SignalQueues {
		copied := make([]SignalEvent, 0, len(queue))
		for _, event := range queue {
			copied = append(copied, copySignalEvent(event))
		}
		s.signalQueues[k] = copied
	}

	s.rebuildAuthIndexesLocked()
	s.subscribers = map[string]map[chan SignalEvent]struct{}{}
}

func (s *Store) rebuildAuthIndexesLocked() {
	s.deviceTokenIndex = map[string]string{}
	for deviceID, device := range s.devices {
		token := strings.TrimSpace(device.DeviceToken)
		if token == "" {
			continue
		}
		s.deviceTokenIndex[token] = deviceID
	}

	s.mobileTokenIndex = map[string]string{}
	for bindingID, binding := range s.bindings {
		if binding.Status != "active" {
			continue
		}
		token := strings.TrimSpace(binding.MobileToken)
		if token == "" {
			continue
		}
		s.mobileTokenIndex[token] = bindingID
	}
}

func (s *Store) removePairSessionIndexesLocked(session PairSession) {
	if token := strings.TrimSpace(session.PairToken); token != "" {
		delete(s.pairTokenIndex, token)
	}
	if code := strings.TrimSpace(session.PairCode); code != "" {
		delete(s.pairCodeIndex, code)
	}
}

func (s *Store) pruneInactiveDevicesLocked(now int64) int {
	cutoff := deviceInactiveCutoff(now)
	if cutoff <= 0 {
		return 0
	}

	removedDeviceIDs := map[string]struct{}{}
	for deviceID, device := range s.devices {
		if device.LastSeenAt > cutoff {
			continue
		}
		removedDeviceIDs[deviceID] = struct{}{}
		if token := strings.TrimSpace(device.DeviceToken); token != "" {
			delete(s.deviceTokenIndex, token)
		}
		delete(s.devices, deviceID)
	}
	if len(removedDeviceIDs) == 0 {
		return 0
	}

	for sessionID, session := range s.pairSessions {
		if _, remove := removedDeviceIDs[session.DeviceID]; !remove {
			continue
		}
		s.removePairSessionIndexesLocked(session)
		delete(s.pairSessions, sessionID)
	}

	for bindingID, binding := range s.bindings {
		if _, remove := removedDeviceIDs[binding.DeviceID]; !remove {
			continue
		}
		if token := strings.TrimSpace(binding.MobileToken); token != "" {
			delete(s.mobileTokenIndex, token)
		}
		delete(s.bindings, bindingID)
	}

	for key := range s.signalQueues {
		clientType, clientID, ok := splitClientKey(key)
		if !ok || clientType != "desktop" {
			continue
		}
		if _, remove := removedDeviceIDs[clientID]; remove {
			delete(s.signalQueues, key)
		}
	}

	return len(removedDeviceIDs)
}

func (s *Store) pruneInactiveDevices() int {
	now := nowMillis()
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pruneInactiveDevicesLocked(now)
}

type storeStats struct {
	Devices      int `json:"devices"`
	PairSessions int `json:"pairSessions"`
	Bindings     int `json:"bindings"`
}

func (s *Store) stats() storeStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return storeStats{
		Devices:      len(s.devices),
		PairSessions: len(s.pairSessions),
		Bindings:     len(s.bindings),
	}
}

func (s *Store) deviceByToken(token string) (Device, bool) {
	normalized := strings.TrimSpace(token)
	if normalized == "" {
		return Device{}, false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	deviceID, exists := s.deviceTokenIndex[normalized]
	if !exists {
		return Device{}, false
	}
	device, exists := s.devices[deviceID]
	if !exists {
		return Device{}, false
	}
	return device, true
}

func (s *Store) activeBindingByMobileToken(token string) (Binding, bool) {
	normalized := strings.TrimSpace(token)
	if normalized == "" {
		return Binding{}, false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	bindingID, exists := s.mobileTokenIndex[normalized]
	if !exists {
		return Binding{}, false
	}
	binding, exists := s.bindings[bindingID]
	if !exists || binding.Status != "active" {
		return Binding{}, false
	}
	return binding, true
}

func (s *Store) bindingByID(bindingID string) (Binding, bool) {
	normalized := strings.TrimSpace(bindingID)
	if normalized == "" {
		return Binding{}, false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	binding, exists := s.bindings[normalized]
	if !exists {
		return Binding{}, false
	}
	return binding, true
}

func (s *Store) hasActiveBindingBetween(deviceID string, mobileID string) bool {
	normalizedDeviceID := strings.TrimSpace(deviceID)
	normalizedMobileID := strings.TrimSpace(mobileID)
	if normalizedDeviceID == "" || normalizedMobileID == "" {
		return false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, binding := range s.bindings {
		if binding.Status != "active" {
			continue
		}
		if binding.DeviceID == normalizedDeviceID && binding.MobileID == normalizedMobileID {
			return true
		}
	}
	return false
}

type registerDeviceRequest struct {
	DeviceID     string         `json:"deviceId"`
	Platform     string         `json:"platform"`
	AppVersion   string         `json:"appVersion"`
	Capabilities map[string]any `json:"capabilities"`
}

func (s *Store) registerDevice(req registerDeviceRequest, credentialToken string) (Device, error) {
	deviceID, err := trimRequired(req.DeviceID, "deviceId")
	if err != nil {
		return Device{}, err
	}

	now := nowMillis()
	platform := strings.TrimSpace(req.Platform)
	if platform == "" {
		platform = "unknown"
	}
	appVersion := strings.TrimSpace(req.AppVersion)
	if appVersion == "" {
		appVersion = "unknown"
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneInactiveDevicesLocked(now)

	device, exists := s.devices[deviceID]
	if exists {
		presentedToken := strings.TrimSpace(credentialToken)
		if presentedToken == "" || presentedToken != strings.TrimSpace(device.DeviceToken) {
			return Device{}, newError("UNAUTHORIZED", "device token is required to update existing device")
		}
	} else {
		token, tokenErr := makeID("devtok")
		if tokenErr != nil {
			return Device{}, newError("INTERNAL_ERROR", "failed to generate device token")
		}
		device = Device{
			DeviceID:    deviceID,
			CreatedAt:   now,
			DeviceToken: token,
		}
	}

	device.Platform = platform
	device.AppVersion = appVersion
	if req.Capabilities != nil {
		device.Capabilities = req.Capabilities
	} else if device.Capabilities == nil {
		device.Capabilities = map[string]any{}
	}
	device.Status = "online"
	device.LastSeenAt = now
	device.UpdatedAt = now

	s.devices[deviceID] = device
	if strings.TrimSpace(device.DeviceToken) != "" {
		s.deviceTokenIndex[device.DeviceToken] = deviceID
	}
	return device, nil
}

type heartbeatRequest struct {
	DeviceID string `json:"deviceId"`
}

func (s *Store) heartbeatDevice(req heartbeatRequest) (Device, error) {
	deviceID, err := trimRequired(req.DeviceID, "deviceId")
	if err != nil {
		return Device{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneInactiveDevicesLocked(nowMillis())

	device, exists := s.devices[deviceID]
	if !exists {
		return Device{}, newError("NOT_FOUND", "device not found")
	}

	now := nowMillis()
	device.LastSeenAt = now
	device.UpdatedAt = now
	device.Status = "online"
	s.devices[deviceID] = device
	return device, nil
}

type deviceStatus struct {
	DeviceID   string `json:"deviceId"`
	Platform   string `json:"platform"`
	AppVersion string `json:"appVersion"`
	Status     string `json:"status"`
	LastSeenAt int64  `json:"lastSeenAt"`
	UpdatedAt  int64  `json:"updatedAt"`
}

func (s *Store) getDeviceStatus(deviceID string) (deviceStatus, error) {
	normalized, err := trimRequired(deviceID, "deviceId")
	if err != nil {
		return deviceStatus{}, err
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	device, exists := s.devices[normalized]
	if !exists {
		return deviceStatus{}, newError("NOT_FOUND", "device not found")
	}

	online := nowMillis()-device.LastSeenAt <= 90*1000
	status := "offline"
	if online {
		status = "online"
	}

	return deviceStatus{
		DeviceID:   device.DeviceID,
		Platform:   device.Platform,
		AppVersion: device.AppVersion,
		Status:     status,
		LastSeenAt: device.LastSeenAt,
		UpdatedAt:  device.UpdatedAt,
	}, nil
}

type createPairSessionRequest struct {
	DeviceID   string `json:"deviceId"`
	TTLSeconds int    `json:"ttlSeconds"`
}

func (s *Store) createPairSession(req createPairSessionRequest) (PairSession, error) {
	deviceID, err := trimRequired(req.DeviceID, "deviceId")
	if err != nil {
		return PairSession{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneInactiveDevicesLocked(nowMillis())

	if _, exists := s.devices[deviceID]; !exists {
		return PairSession{}, newError("NOT_FOUND", "device not registered")
	}

	ttl := req.TTLSeconds
	if ttl == 0 {
		ttl = 180
	}
	ttl = clampInt(ttl, 60, 600)

	sessionID, idErr := makeID("ps")
	if idErr != nil {
		return PairSession{}, newError("INTERNAL_ERROR", "failed to create pair session id")
	}

	pairToken, tokenErr := makePairToken()
	if tokenErr != nil {
		return PairSession{}, newError("INTERNAL_ERROR", "failed to create pair token")
	}

	pairCode := ""
	for i := 0; i < 10; i++ {
		code, codeErr := makePairCode()
		if codeErr != nil {
			return PairSession{}, newError("INTERNAL_ERROR", "failed to create pair code")
		}
		if _, exists := s.pairCodeIndex[code]; !exists {
			pairCode = code
			break
		}
	}
	if pairCode == "" {
		return PairSession{}, newError("INTERNAL_ERROR", "failed to allocate unique pair code")
	}

	now := nowMillis()
	session := PairSession{
		PairSessionID:     sessionID,
		DeviceID:          deviceID,
		PairCode:          pairCode,
		PairToken:         pairToken,
		Status:            "pending",
		CreatedAt:         now,
		ExpiresAt:         now + int64(ttl)*1000,
		ClaimedAt:         nil,
		ClaimedByUserID:   nil,
		ClaimedByMobileID: nil,
	}

	s.pairSessions[sessionID] = session
	s.pairTokenIndex[pairToken] = sessionID
	s.pairCodeIndex[pairCode] = sessionID
	return session, nil
}

func (s *Store) getActiveBindingLocked(userID string, deviceID string) (Binding, bool) {
	for _, binding := range s.bindings {
		if binding.Status == "active" && binding.UserID == userID && binding.DeviceID == deviceID {
			return binding, true
		}
	}
	return Binding{}, false
}

func (s *Store) claimSessionLocked(session PairSession, userID string, mobileID string) (PairSession, Binding) {
	now := nowMillis()
	mobileToken, _ := makeID("mobtok")
	if strings.TrimSpace(mobileToken) == "" {
		mobileToken = fmt.Sprintf("mobtok_%d", now)
	}

	binding, exists := s.getActiveBindingLocked(userID, session.DeviceID)
	if !exists {
		bindingID, _ := makeID("bind")
		binding = Binding{
			BindingID:   bindingID,
			UserID:      userID,
			DeviceID:    session.DeviceID,
			MobileID:    mobileID,
			MobileToken: mobileToken,
			Status:      "active",
			CreatedAt:   now,
			UpdatedAt:   now,
		}
	} else {
		if binding.MobileToken != "" {
			delete(s.mobileTokenIndex, binding.MobileToken)
		}
		binding.MobileID = mobileID
		binding.MobileToken = mobileToken
		binding.UpdatedAt = now
	}
	if binding.MobileToken != "" {
		s.mobileTokenIndex[binding.MobileToken] = binding.BindingID
	}
	s.bindings[binding.BindingID] = binding

	session.Status = "claimed"
	session.ClaimedAt = &now
	session.ClaimedByUserID = &userID
	session.ClaimedByMobileID = &mobileID
	s.pairSessions[session.PairSessionID] = session

	return session, binding
}

func claimedUserID(session PairSession) string {
	if session.ClaimedByUserID == nil {
		return ""
	}
	return strings.TrimSpace(*session.ClaimedByUserID)
}

type claimByTokenRequest struct {
	PairToken string `json:"pairToken"`
	UserID    string `json:"userId"`
	MobileID  string `json:"mobileId"`
}

func (s *Store) claimByToken(req claimByTokenRequest) (PairSession, Binding, error) {
	pairToken, err := trimRequired(req.PairToken, "pairToken")
	if err != nil {
		return PairSession{}, Binding{}, err
	}
	userID := strings.TrimSpace(req.UserID)
	if userID == "" {
		fallback, idErr := makeID("user")
		if idErr != nil {
			return PairSession{}, Binding{}, idErr
		}
		userID = fallback
	}
	mobileID := strings.TrimSpace(req.MobileID)
	if mobileID == "" {
		fallback, idErr := makeID("mobile")
		if idErr != nil {
			return PairSession{}, Binding{}, idErr
		}
		mobileID = fallback
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	sessionID, exists := s.pairTokenIndex[pairToken]
	if !exists {
		return PairSession{}, Binding{}, newError("NOT_FOUND", "pair session not found")
	}
	session, exists := s.pairSessions[sessionID]
	if !exists {
		return PairSession{}, Binding{}, newError("NOT_FOUND", "pair session not found")
	}
	if session.Status != "pending" {
		if session.Status == "claimed" {
			if claimedUserID(session) == userID {
				session, binding := s.claimSessionLocked(session, userID, mobileID)
				return session, binding, nil
			}
			return PairSession{}, Binding{}, newError("ALREADY_CLAIMED", "pair session already claimed by another user")
		}
		return PairSession{}, Binding{}, newError("INVALID_STATE", "pair session is not claimable")
	}
	if session.ExpiresAt < nowMillis() {
		session.Status = "expired"
		s.pairSessions[sessionID] = session
		return PairSession{}, Binding{}, newError("EXPIRED", "pair session expired")
	}

	session, binding := s.claimSessionLocked(session, userID, mobileID)
	return session, binding, nil
}

type claimByCodeRequest struct {
	PairCode string `json:"pairCode"`
	UserID   string `json:"userId"`
	MobileID string `json:"mobileId"`
}

func (s *Store) claimByCode(req claimByCodeRequest) (PairSession, Binding, error) {
	pairCode, err := trimRequired(req.PairCode, "pairCode")
	if err != nil {
		return PairSession{}, Binding{}, err
	}
	userID := strings.TrimSpace(req.UserID)
	if userID == "" {
		fallback, idErr := makeID("user")
		if idErr != nil {
			return PairSession{}, Binding{}, idErr
		}
		userID = fallback
	}
	mobileID := strings.TrimSpace(req.MobileID)
	if mobileID == "" {
		fallback, idErr := makeID("mobile")
		if idErr != nil {
			return PairSession{}, Binding{}, idErr
		}
		mobileID = fallback
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	sessionID, exists := s.pairCodeIndex[pairCode]
	if !exists {
		return PairSession{}, Binding{}, newError("NOT_FOUND", "pair session not found")
	}
	session, exists := s.pairSessions[sessionID]
	if !exists {
		return PairSession{}, Binding{}, newError("NOT_FOUND", "pair session not found")
	}
	if session.Status != "pending" {
		if session.Status == "claimed" {
			if claimedUserID(session) == userID {
				session, binding := s.claimSessionLocked(session, userID, mobileID)
				return session, binding, nil
			}
			return PairSession{}, Binding{}, newError("ALREADY_CLAIMED", "pair session already claimed by another user")
		}
		return PairSession{}, Binding{}, newError("INVALID_STATE", "pair session is not claimable")
	}
	if session.ExpiresAt < nowMillis() {
		session.Status = "expired"
		s.pairSessions[sessionID] = session
		return PairSession{}, Binding{}, newError("EXPIRED", "pair session expired")
	}

	session, binding := s.claimSessionLocked(session, userID, mobileID)
	return session, binding, nil
}

type revokePairRequest struct {
	BindingID string `json:"bindingId"`
	UserID    string `json:"userId"`
	DeviceID  string `json:"deviceId"`
}

func (s *Store) revokePair(req revokePairRequest) (Binding, error) {
	bindingID := strings.TrimSpace(req.BindingID)
	userID := strings.TrimSpace(req.UserID)
	deviceID := strings.TrimSpace(req.DeviceID)

	s.mu.Lock()
	defer s.mu.Unlock()

	var binding Binding
	found := false
	if bindingID != "" {
		binding, found = s.bindings[bindingID]
	} else if userID != "" && deviceID != "" {
		for _, candidate := range s.bindings {
			if candidate.Status == "active" && candidate.UserID == userID && candidate.DeviceID == deviceID {
				binding = candidate
				found = true
				break
			}
		}
	}
	if !found {
		return Binding{}, newError("NOT_FOUND", "binding not found")
	}

	if binding.MobileToken != "" {
		delete(s.mobileTokenIndex, binding.MobileToken)
	}
	binding.Status = "revoked"
	binding.UpdatedAt = nowMillis()
	s.bindings[binding.BindingID] = binding
	return binding, nil
}

func (s *Store) listBindings(userID string, deviceID string, includeRevoked bool) []Binding {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]Binding, 0)
	for _, binding := range s.bindings {
		if !includeRevoked && binding.Status != "active" {
			continue
		}
		if userID != "" && binding.UserID != userID {
			continue
		}
		if deviceID != "" && binding.DeviceID != deviceID {
			continue
		}
		result = append(result, binding)
	}
	return result
}

func (s *Store) pullSignalInbox(clientType string, clientID string, limit int) []SignalEvent {
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

func (s *Store) addSubscriber(clientType string, clientID string) chan SignalEvent {
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

func (s *Store) removeSubscriber(clientType string, clientID string, ch chan SignalEvent) {
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

func (s *Store) deliverSignalEvent(targetType string, targetID string, event SignalEvent) bool {
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

	if delivered {
		return true
	}
	return false
}

func (s *Store) enqueueSignalToQueue(targetType string, targetID string, event SignalEvent) {
	key := clientKey(targetType, targetID)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.signalQueues[key] = append(s.signalQueues[key], copySignalEvent(event))
}

func (s *Store) enqueueSignalEvent(targetType string, targetID string, event SignalEvent) bool {
	delivered := s.deliverSignalEvent(targetType, targetID, event)
	if delivered {
		return true
	}
	s.enqueueSignalToQueue(targetType, targetID, event)
	return false
}

type sendSignalRequest struct {
	FromType string         `json:"fromType"`
	FromID   string         `json:"fromId"`
	ToType   string         `json:"toType"`
	ToID     string         `json:"toId"`
	Type     string         `json:"type"`
	Payload  map[string]any `json:"payload"`
}

func (s *Store) buildSignalEvent(req sendSignalRequest) (SignalEvent, error) {
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
	eventType := strings.TrimSpace(req.Type)
	if eventType == "" {
		eventType = "signal.message"
	}

	eventID, idErr := makeID("evt")
	if idErr != nil {
		return SignalEvent{}, newError("INTERNAL_ERROR", "failed to create signal event id")
	}

	event := SignalEvent{
		ID:      eventID,
		Type:    eventType,
		Ts:      nowMillis(),
		From:    &SignalParty{Type: fromType, ID: fromID},
		To:      &SignalParty{Type: toType, ID: toID},
		Payload: copyPayload(req.Payload),
	}
	return event, nil
}

func (s *Store) sendSignal(req sendSignalRequest) (SignalEvent, bool, error) {
	event, err := s.buildSignalEvent(req)
	if err != nil {
		return SignalEvent{}, false, err
	}
	delivered := s.enqueueSignalEvent(event.To.Type, event.To.ID, event)
	return event, delivered, nil
}

type persistenceStatus struct {
	Backend   string  `json:"backend"`
	RedisKey  *string `json:"redisKey"`
	Connected bool    `json:"connected"`
}

type persistence interface {
	SchedulePersist()
	Flush(ctx context.Context)
	Close(ctx context.Context)
	Status() persistenceStatus
	UseExternalSignalQueue() bool
	PushSignal(toType string, toID string, event SignalEvent, deliveredLocal bool)
	PullSignalInbox(clientType string, clientID string, limit int) ([]SignalEvent, error)
	SubscribeSignals(clientType string, clientID string) (<-chan SignalEvent, func(), error)
}

type memoryPersistence struct{}

func (m *memoryPersistence) SchedulePersist()        {}
func (m *memoryPersistence) Flush(_ context.Context) {}
func (m *memoryPersistence) Close(_ context.Context) {}
func (m *memoryPersistence) Status() persistenceStatus {
	return persistenceStatus{Backend: "memory", RedisKey: nil, Connected: false}
}
func (m *memoryPersistence) UseExternalSignalQueue() bool {
	return false
}
func (m *memoryPersistence) PushSignal(_ string, _ string, _ SignalEvent, _ bool) {}
func (m *memoryPersistence) PullSignalInbox(_ string, _ string, _ int) ([]SignalEvent, error) {
	return nil, nil
}
func (m *memoryPersistence) SubscribeSignals(_ string, _ string) (<-chan SignalEvent, func(), error) {
	return nil, nil, nil
}

var redisPullQueueScript = redis.NewScript(`
local key = KEYS[1]
local limit = tonumber(ARGV[1])
if limit == nil or limit < 1 then
  limit = 1
end
local stop = limit - 1
local items = redis.call("LRANGE", key, 0, stop)
if #items > 0 then
  redis.call("LTRIM", key, limit, -1)
end
return items
`)

type redisSignalEnvelope struct {
	Origin string      `json:"origin"`
	ToType string      `json:"toType"`
	ToID   string      `json:"toId"`
	Event  SignalEvent `json:"event"`
}

type redisPersistence struct {
	store      *Store
	client     *redis.Client
	keyPrefix  string
	instanceID string
	queueTTL   time.Duration
	channel    string
	timerMu    sync.Mutex
	timer      *time.Timer
	persistMu  sync.Mutex
}

func newRedisPersistence(store *Store, client *redis.Client, keyPrefix string, instanceID string) *redisPersistence {
	return &redisPersistence{
		store:      store,
		client:     client,
		keyPrefix:  strings.TrimSuffix(keyPrefix, ":"),
		instanceID: instanceID,
		queueTTL:   24 * time.Hour,
		channel:    strings.TrimSuffix(keyPrefix, ":") + ":signal:pubsub",
	}
}

func (r *redisPersistence) keyDevices() string {
	return r.keyPrefix + ":devices"
}

func (r *redisPersistence) keyDeviceLeasePrefix() string {
	return r.keyPrefix + ":device:lease:"
}

func (r *redisPersistence) keyDeviceLease(deviceID string) string {
	return r.keyDeviceLeasePrefix() + deviceID
}

func (r *redisPersistence) keyPairSessions() string {
	return r.keyPrefix + ":pair:sessions"
}

func (r *redisPersistence) keyBindings() string {
	return r.keyPrefix + ":pair:bindings"
}

func (r *redisPersistence) keyPairToken(token string) string {
	return r.keyPrefix + ":pair:token:" + token
}

func (r *redisPersistence) keyPairCode(code string) string {
	return r.keyPrefix + ":pair:code:" + code
}

func (r *redisPersistence) keySignalQueuePrefix() string {
	return r.keyPrefix + ":signal:queue:"
}

func (r *redisPersistence) keySignalQueue(clientType string, clientID string) string {
	return r.keySignalQueuePrefix() + clientKey(clientType, clientID)
}

func (r *redisPersistence) clientKeyFromQueueKey(queueKey string) (string, bool) {
	prefix := r.keySignalQueuePrefix()
	if !strings.HasPrefix(queueKey, prefix) {
		return "", false
	}
	rest := strings.TrimPrefix(queueKey, prefix)
	if rest == "" {
		return "", false
	}
	return rest, true
}

func marshalStructMap[T any](values map[string]T) map[string]any {
	result := map[string]any{}
	for key, value := range values {
		encoded, err := json.Marshal(value)
		if err != nil {
			continue
		}
		result[key] = string(encoded)
	}
	return result
}

func decodeStructMap[T any](values map[string]string) map[string]T {
	result := map[string]T{}
	for key, raw := range values {
		var value T
		if err := json.Unmarshal([]byte(raw), &value); err != nil {
			continue
		}
		result[key] = value
	}
	return result
}

func (r *redisPersistence) hydrateFromRedis() error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	devicesRaw, err := r.client.HGetAll(ctx, r.keyDevices()).Result()
	if err != nil {
		return err
	}
	pairSessionsRaw, err := r.client.HGetAll(ctx, r.keyPairSessions()).Result()
	if err != nil {
		return err
	}
	bindingsRaw, err := r.client.HGetAll(ctx, r.keyBindings()).Result()
	if err != nil {
		return err
	}

	queues := map[string][]SignalEvent{}
	queueKeys, err := r.client.Keys(ctx, r.keySignalQueuePrefix()+"*").Result()
	if err != nil {
		log.Printf("[openclaw-server] failed to list redis signal queues: %v", err)
	} else {
		for _, queueKey := range queueKeys {
			clientKeyValue, ok := r.clientKeyFromQueueKey(queueKey)
			if !ok {
				continue
			}
			items, rangeErr := r.client.LRange(ctx, queueKey, 0, -1).Result()
			if rangeErr != nil || len(items) == 0 {
				continue
			}
			events := make([]SignalEvent, 0, len(items))
			for _, raw := range items {
				var event SignalEvent
				if unmarshalErr := json.Unmarshal([]byte(raw), &event); unmarshalErr != nil {
					continue
				}
				events = append(events, event)
			}
			if len(events) > 0 {
				queues[clientKeyValue] = events
			}
		}
	}

	decodedDevices := decodeStructMap[Device](devicesRaw)
	activeDevices := map[string]Device{}
	now := nowMillis()

	if len(decodedDevices) > 0 {
		deviceIDs := make([]string, 0, len(decodedDevices))
		leaseKeys := make([]string, 0, len(decodedDevices))
		for deviceID := range decodedDevices {
			deviceIDs = append(deviceIDs, deviceID)
			leaseKeys = append(leaseKeys, r.keyDeviceLease(deviceID))
		}

		leaseValues, leaseErr := r.client.MGet(ctx, leaseKeys...).Result()
		if leaseErr != nil {
			log.Printf("[openclaw-server] failed to read redis device leases, fallback to lastSeen cutoff: %v", leaseErr)
		}
		cutoff := deviceInactiveCutoff(now)
		for idx, deviceID := range deviceIDs {
			device := decodedDevices[deviceID]
			activeByLease := leaseErr == nil && idx < len(leaseValues) && leaseValues[idx] != nil
			activeByLastSeen := device.LastSeenAt > cutoff
			if activeByLease || activeByLastSeen {
				activeDevices[deviceID] = device
			}
		}
	}

	decodedPairSessions := decodeStructMap[PairSession](pairSessionsRaw)
	filteredPairSessions := map[string]PairSession{}
	for sessionID, session := range decodedPairSessions {
		if _, exists := activeDevices[session.DeviceID]; !exists {
			continue
		}
		filteredPairSessions[sessionID] = session
	}

	decodedBindings := decodeStructMap[Binding](bindingsRaw)
	filteredBindings := map[string]Binding{}
	for bindingID, binding := range decodedBindings {
		if _, exists := activeDevices[binding.DeviceID]; !exists {
			continue
		}
		filteredBindings[bindingID] = binding
	}

	filteredQueues := map[string][]SignalEvent{}
	for key, queue := range queues {
		clientType, clientID, ok := splitClientKey(key)
		if ok && clientType == "desktop" {
			if _, exists := activeDevices[clientID]; !exists {
				continue
			}
		}
		filteredQueues[key] = queue
	}

	snapshot := StoreSnapshot{
		Version:        1,
		SavedAt:        now,
		Devices:        activeDevices,
		PairSessions:   filteredPairSessions,
		PairTokenIndex: map[string]string{},
		PairCodeIndex:  map[string]string{},
		Bindings:       filteredBindings,
		SignalQueues:   filteredQueues,
	}

	for sessionID, session := range snapshot.PairSessions {
		if session.Status != "pending" || session.ExpiresAt <= now {
			continue
		}
		if session.PairToken != "" {
			snapshot.PairTokenIndex[session.PairToken] = sessionID
		}
		if session.PairCode != "" {
			snapshot.PairCodeIndex[session.PairCode] = sessionID
		}
	}

	r.store.applySnapshot(snapshot)
	return nil
}

func (r *redisPersistence) persistWithTimeout(timeout time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	r.persistMu.Lock()
	defer r.persistMu.Unlock()

	snapshot := r.store.snapshot()
	pipe := r.client.TxPipeline()
	now := nowMillis()
	cutoff := deviceInactiveCutoff(now)

	activeDevices := map[string]Device{}
	for deviceID, device := range snapshot.Devices {
		if device.LastSeenAt <= cutoff {
			continue
		}
		activeDevices[deviceID] = device
	}

	filteredPairSessions := map[string]PairSession{}
	for sessionID, session := range snapshot.PairSessions {
		if _, exists := activeDevices[session.DeviceID]; !exists {
			continue
		}
		filteredPairSessions[sessionID] = session
	}

	filteredBindings := map[string]Binding{}
	for bindingID, binding := range snapshot.Bindings {
		if _, exists := activeDevices[binding.DeviceID]; !exists {
			continue
		}
		filteredBindings[bindingID] = binding
	}

	filteredQueues := map[string][]SignalEvent{}
	for key, queue := range snapshot.SignalQueues {
		clientType, clientID, ok := splitClientKey(key)
		if ok && clientType == "desktop" {
			if _, exists := activeDevices[clientID]; !exists {
				continue
			}
		}
		filteredQueues[key] = queue
	}

	pipe.Del(ctx, r.keyDevices(), r.keyPairSessions(), r.keyBindings())

	deviceHash := marshalStructMap(activeDevices)
	if len(deviceHash) > 0 {
		pipe.HSet(ctx, r.keyDevices(), deviceHash)
	}

	pairSessionHash := marshalStructMap(filteredPairSessions)
	if len(pairSessionHash) > 0 {
		pipe.HSet(ctx, r.keyPairSessions(), pairSessionHash)
	}

	bindingHash := marshalStructMap(filteredBindings)
	if len(bindingHash) > 0 {
		pipe.HSet(ctx, r.keyBindings(), bindingHash)
	}

	for _, session := range filteredPairSessions {
		if session.Status != "pending" || session.ExpiresAt <= now {
			continue
		}
		ttl := time.Duration(session.ExpiresAt-now) * time.Millisecond
		if ttl < time.Second {
			ttl = time.Second
		}
		if session.PairToken != "" {
			pipe.Set(ctx, r.keyPairToken(session.PairToken), session.PairSessionID, ttl)
		}
		if session.PairCode != "" {
			pipe.Set(ctx, r.keyPairCode(session.PairCode), session.PairSessionID, ttl)
		}
	}

	existingLeaseKeys, leaseErr := r.client.Keys(ctx, r.keyDeviceLeasePrefix()+"*").Result()
	if leaseErr == nil && len(existingLeaseKeys) > 0 {
		pipe.Del(ctx, existingLeaseKeys...)
	}
	if leaseErr != nil {
		log.Printf("[openclaw-server] failed to list existing device leases: %v", leaseErr)
	}

	for deviceID, device := range activeDevices {
		expiresAt := device.LastSeenAt + deviceInactiveTTL.Milliseconds()
		ttlMillis := expiresAt - now
		if ttlMillis <= 0 {
			continue
		}
		ttl := time.Duration(ttlMillis) * time.Millisecond
		if ttl < time.Second {
			ttl = time.Second
		}
		pipe.Set(ctx, r.keyDeviceLease(deviceID), "1", ttl)
	}

	existingQueueKeys, err := r.client.Keys(ctx, r.keySignalQueuePrefix()+"*").Result()
	if err == nil && len(existingQueueKeys) > 0 {
		pipe.Del(ctx, existingQueueKeys...)
	}
	if err != nil {
		log.Printf("[openclaw-server] failed to list existing signal queues: %v", err)
	}

	for key, queue := range filteredQueues {
		clientType, clientID, ok := splitClientKey(key)
		if !ok || len(queue) == 0 {
			continue
		}
		queueKey := r.keySignalQueue(clientType, clientID)
		items := make([]any, 0, len(queue))
		for _, event := range queue {
			encoded, marshalErr := json.Marshal(event)
			if marshalErr != nil {
				continue
			}
			items = append(items, string(encoded))
		}
		if len(items) == 0 {
			continue
		}
		pipe.RPush(ctx, queueKey, items...)
		pipe.Expire(ctx, queueKey, r.queueTTL)
	}

	if _, execErr := pipe.Exec(ctx); execErr != nil {
		log.Printf("[openclaw-server] failed to persist native redis snapshot: %v", execErr)
	}
}

func (r *redisPersistence) SchedulePersist() {
	r.timerMu.Lock()
	defer r.timerMu.Unlock()

	if r.timer == nil {
		r.timer = time.AfterFunc(200*time.Millisecond, func() {
			r.persistWithTimeout(2 * time.Second)
		})
		return
	}
	r.timer.Reset(200 * time.Millisecond)
}

func (r *redisPersistence) Flush(_ context.Context) {
	r.timerMu.Lock()
	if r.timer != nil {
		r.timer.Stop()
		r.timer = nil
	}
	r.timerMu.Unlock()

	r.persistWithTimeout(2 * time.Second)
}

func (r *redisPersistence) Close(ctx context.Context) {
	r.Flush(ctx)
	if err := r.client.Close(); err != nil {
		log.Printf("[openclaw-server] failed to close redis client: %v", err)
	}
}

func (r *redisPersistence) Status() persistenceStatus {
	redisKey := r.keyPrefix
	return persistenceStatus{Backend: "redis", RedisKey: &redisKey, Connected: true}
}

func (r *redisPersistence) UseExternalSignalQueue() bool {
	return true
}

func (r *redisPersistence) PushSignal(toType string, toID string, event SignalEvent, deliveredLocal bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	eventJSON, err := json.Marshal(event)
	if err != nil {
		log.Printf("[openclaw-server] failed to encode signal event: %v", err)
		return
	}

	queueKey := r.keySignalQueue(toType, toID)
	if !deliveredLocal {
		if err := r.client.RPush(ctx, queueKey, string(eventJSON)).Err(); err != nil {
			log.Printf("[openclaw-server] failed to enqueue redis signal event: %v", err)
		} else {
			_ = r.client.Expire(ctx, queueKey, r.queueTTL).Err()
		}
	}

	envelope := redisSignalEnvelope{
		Origin: r.instanceID,
		ToType: toType,
		ToID:   toID,
		Event:  event,
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		return
	}
	if err := r.client.Publish(ctx, r.channel, string(payload)).Err(); err != nil {
		log.Printf("[openclaw-server] failed to publish redis signal event: %v", err)
	}
}

func (r *redisPersistence) PullSignalInbox(clientType string, clientID string, limit int) ([]SignalEvent, error) {
	safeLimit := clampInt(limit, 1, maxSignalQueuePull)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	queueKey := r.keySignalQueue(clientType, clientID)
	result, err := redisPullQueueScript.Run(ctx, r.client, []string{queueKey}, safeLimit).Result()
	if err != nil {
		return nil, err
	}

	rawItems, ok := result.([]any)
	if !ok || len(rawItems) == 0 {
		return []SignalEvent{}, nil
	}

	events := make([]SignalEvent, 0, len(rawItems))
	for _, item := range rawItems {
		var raw string
		switch value := item.(type) {
		case string:
			raw = value
		case []byte:
			raw = string(value)
		default:
			continue
		}
		var event SignalEvent
		if unmarshalErr := json.Unmarshal([]byte(raw), &event); unmarshalErr != nil {
			continue
		}
		events = append(events, event)
	}
	if len(events) > 0 {
		_ = r.client.Expire(ctx, queueKey, r.queueTTL).Err()
	}
	return events, nil
}

func (r *redisPersistence) SubscribeSignals(clientType string, clientID string) (<-chan SignalEvent, func(), error) {
	ctx, cancel := context.WithCancel(context.Background())
	pubsub := r.client.Subscribe(ctx, r.channel)

	channel := make(chan SignalEvent, 64)
	go func() {
		defer close(channel)
		pubsubChannel := pubsub.Channel()
		for {
			select {
			case <-ctx.Done():
				return
			case message, ok := <-pubsubChannel:
				if !ok {
					return
				}
				var envelope redisSignalEnvelope
				if err := json.Unmarshal([]byte(message.Payload), &envelope); err != nil {
					continue
				}
				if envelope.Origin == r.instanceID {
					continue
				}
				if envelope.ToType != clientType || envelope.ToID != clientID {
					continue
				}
				select {
				case channel <- envelope.Event:
				default:
				}
			}
		}
	}()

	var closeOnce sync.Once
	closeFn := func() {
		closeOnce.Do(func() {
			cancel()
			_ = pubsub.Close()
		})
	}
	return channel, closeFn, nil
}

func newPersistenceFromEnv(store *Store) persistence {
	storeBackend := strings.ToLower(strings.TrimSpace(os.Getenv("STORE_BACKEND")))
	if storeBackend == "" || storeBackend == "memory" {
		log.Printf("[openclaw-server] persistence backend: memory")
		return &memoryPersistence{}
	}

	if storeBackend != "redis" {
		log.Printf("[openclaw-server] unknown STORE_BACKEND=%s, fallback to memory", storeBackend)
		return &memoryPersistence{}
	}

	redisURL := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if redisURL == "" {
		redisURL = "redis://127.0.0.1:6379"
	}
	redisKeyPrefix := strings.TrimSpace(os.Getenv("REDIS_KEY_PREFIX"))
	if redisKeyPrefix == "" {
		redisKeyPrefix = "openclaw:server"
	}

	options, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Printf("[openclaw-server] invalid REDIS_URL, fallback to memory: %v", err)
		return &memoryPersistence{}
	}
	options.DialTimeout = 1 * time.Second
	options.ReadTimeout = 2 * time.Second
	options.WriteTimeout = 2 * time.Second
	options.PoolTimeout = 2 * time.Second

	client := redis.NewClient(options)
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		log.Printf("[openclaw-server] redis init failed, fallback to memory: %v", err)
		_ = client.Close()
		return &memoryPersistence{}
	}

	instanceID, idErr := makeID("instance")
	if idErr != nil {
		instanceID = fmt.Sprintf("instance_%d", time.Now().UnixNano())
	}

	redisBackend := newRedisPersistence(store, client, redisKeyPrefix, instanceID)
	if err := redisBackend.hydrateFromRedis(); err != nil {
		log.Printf("[openclaw-server] failed to restore redis state, start fresh: %v", err)
	} else {
		log.Printf("[openclaw-server] restored native redis state")
	}

	log.Printf("[openclaw-server] persistence backend: redis (%s, prefix=%s)", redisURL, redisKeyPrefix)
	return redisBackend
}

func setCORS(w http.ResponseWriter) {
	header := w.Header()
	header.Set("Access-Control-Allow-Origin", "*")
	header.Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	header.Set("Access-Control-Allow-Headers", "content-type,authorization")
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	setCORS(w)
	body, err := json.Marshal(data)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"ok":false,"code":"INTERNAL_ERROR","message":"internal error"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func writeError(w http.ResponseWriter, err error) {
	status := errorStatus(err)
	code := errorCode(err)
	message := err.Error()
	if status == http.StatusInternalServerError && code == "INTERNAL_ERROR" {
		message = "internal error"
	}
	writeJSON(w, status, map[string]any{
		"ok":      false,
		"code":    code,
		"message": message,
	})
}

func readJSONBody(r *http.Request, dst any) error {
	defer r.Body.Close()
	limited := io.LimitReader(r.Body, maxBodyBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return newError("INVALID_JSON", "Invalid JSON body")
	}
	if len(body) > maxBodyBytes {
		return newError("BODY_TOO_LARGE", "Request body too large")
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return newError("INVALID_JSON", "Invalid JSON body")
	}
	return nil
}

func writeSSE(w http.ResponseWriter, event SignalEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "data: %s\n\n", payload)
	return err
}

func publicBinding(binding Binding) map[string]any {
	return map[string]any{
		"bindingId": binding.BindingID,
		"userId":    binding.UserID,
		"deviceId":  binding.DeviceID,
		"mobileId":  binding.MobileID,
		"status":    binding.Status,
		"createdAt": binding.CreatedAt,
		"updatedAt": binding.UpdatedAt,
	}
}

type authPrincipalKind string

const (
	authPrincipalDevice authPrincipalKind = "device"
	authPrincipalMobile authPrincipalKind = "mobile"
)

type authPrincipal struct {
	Kind    authPrincipalKind
	Device  Device
	Binding Binding
}

type app struct {
	store       *Store
	persistence persistence
}

type wsIncomingFrame struct {
	Action    string          `json:"action"`
	RequestID string          `json:"requestId,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"`
}

type wsSignalSendData struct {
	ToType  string         `json:"toType"`
	ToID    string         `json:"toId"`
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
}

func readBearerToken(r *http.Request) string {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if authHeader != "" {
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) == 2 && strings.EqualFold(strings.TrimSpace(parts[0]), "Bearer") {
			if token := strings.TrimSpace(parts[1]); token != "" {
				return token
			}
		}
	}

	return strings.TrimSpace(r.URL.Query().Get("token"))
}

func (a *app) authenticateRequest(r *http.Request) (authPrincipal, error) {
	token := readBearerToken(r)
	if token == "" {
		return authPrincipal{}, newError("UNAUTHORIZED", "bearer token is required")
	}

	device, ok := a.store.deviceByToken(token)
	if ok {
		return authPrincipal{Kind: authPrincipalDevice, Device: device}, nil
	}

	binding, ok := a.store.activeBindingByMobileToken(token)
	if ok {
		return authPrincipal{Kind: authPrincipalMobile, Binding: binding}, nil
	}

	return authPrincipal{}, newError("UNAUTHORIZED", "invalid bearer token")
}

func (a *app) onMutation() {
	a.persistence.SchedulePersist()
}

func (a *app) cleanupInactiveDevices() {
	removed := a.store.pruneInactiveDevices()
	if removed > 0 {
		log.Printf("[openclaw-server] removed %d inactive devices (ttl=%s)", removed, deviceInactiveTTL.String())
		a.onMutation()
	}
}

func (a *app) emitSignal(targetType string, targetID string, event SignalEvent) bool {
	if a.persistence.UseExternalSignalQueue() {
		deliveredLocal := a.store.deliverSignalEvent(targetType, targetID, event)
		a.persistence.PushSignal(targetType, targetID, event, deliveredLocal)
		return deliveredLocal
	}
	return a.store.enqueueSignalEvent(targetType, targetID, event)
}

func (a *app) pullSignalInbox(clientType string, clientID string, limit int) []SignalEvent {
	if a.persistence.UseExternalSignalQueue() {
		events, err := a.persistence.PullSignalInbox(clientType, clientID, limit)
		if err == nil {
			return events
		}
		log.Printf("[openclaw-server] failed to pull redis signal inbox, fallback to local memory queue: %v", err)
	}
	return a.store.pullSignalInbox(clientType, clientID, limit)
}

func (a *app) canAccessDeviceStatus(principal authPrincipal, deviceID string) bool {
	normalizedDeviceID := strings.TrimSpace(deviceID)
	if normalizedDeviceID == "" {
		return false
	}
	switch principal.Kind {
	case authPrincipalDevice:
		return principal.Device.DeviceID == normalizedDeviceID
	case authPrincipalMobile:
		return principal.Binding.DeviceID == normalizedDeviceID
	default:
		return false
	}
}

func (a *app) authorizeSignalClient(principal authPrincipal, clientType string, clientID string) error {
	normalizedType := strings.TrimSpace(clientType)
	normalizedID := strings.TrimSpace(clientID)
	if normalizedType == "" || normalizedID == "" {
		return newError("VALIDATION_ERROR", "clientType and clientId are required")
	}

	switch principal.Kind {
	case authPrincipalDevice:
		if normalizedType != "desktop" || normalizedID != principal.Device.DeviceID {
			return newError("FORBIDDEN", "desktop token cannot subscribe as another client")
		}
		return nil
	case authPrincipalMobile:
		if normalizedType != "mobile" || normalizedID != principal.Binding.MobileID {
			return newError("FORBIDDEN", "mobile token cannot subscribe as another client")
		}
		return nil
	default:
		return newError("UNAUTHORIZED", "unauthorized client")
	}
}

func (a *app) authorizeSignalSend(principal authPrincipal, req sendSignalRequest) error {
	fromType := strings.TrimSpace(req.FromType)
	fromID := strings.TrimSpace(req.FromID)
	toType := strings.TrimSpace(req.ToType)
	toID := strings.TrimSpace(req.ToID)
	if fromType == "" || fromID == "" || toType == "" || toID == "" {
		return newError("VALIDATION_ERROR", "fromType/fromId/toType/toId are required")
	}

	switch principal.Kind {
	case authPrincipalDevice:
		if fromType != "desktop" || fromID != principal.Device.DeviceID {
			return newError("FORBIDDEN", "desktop token can only send as itself")
		}
		if toType != "mobile" {
			return newError("FORBIDDEN", "desktop token can only send to mobile")
		}
		if !a.store.hasActiveBindingBetween(principal.Device.DeviceID, toID) {
			return newError("FORBIDDEN", "target mobile is not paired with this desktop")
		}
		return nil
	case authPrincipalMobile:
		if fromType != "mobile" || fromID != principal.Binding.MobileID {
			return newError("FORBIDDEN", "mobile token can only send as itself")
		}
		if toType != "desktop" {
			return newError("FORBIDDEN", "mobile token can only send to desktop")
		}
		if principal.Binding.DeviceID != toID {
			return newError("FORBIDDEN", "target desktop is not bound to this mobile")
		}
		return nil
	default:
		return newError("UNAUTHORIZED", "unauthorized sender")
	}
}

func (a *app) handleSignalWS(
	w http.ResponseWriter,
	r *http.Request,
	principal authPrincipal,
	clientType string,
	clientID string,
) {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(_ *http.Request) bool {
			return true
		},
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	conn.SetPongHandler(func(_ string) error {
		return conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	})

	sub := a.store.addSubscriber(clientType, clientID)
	defer a.store.removeSubscriber(clientType, clientID, sub)

	var externalSub <-chan SignalEvent
	var closeExternalSub func()
	if a.persistence.UseExternalSignalQueue() {
		subChannel, closeFn, subscribeErr := a.persistence.SubscribeSignals(clientType, clientID)
		if subscribeErr != nil {
			log.Printf("[openclaw-server] failed to subscribe redis signal pubsub(ws): %v", subscribeErr)
		} else {
			externalSub = subChannel
			closeExternalSub = closeFn
			defer closeExternalSub()
		}
	}

	writeCh := make(chan any, 256)
	writeErr := make(chan error, 1)
	readErr := make(chan error, 1)
	closeWriter := make(chan struct{})

	enqueue := func(message any) bool {
		select {
		case writeCh <- message:
			return true
		default:
			return false
		}
	}

	go func() {
		heartbeat := time.NewTicker(20 * time.Second)
		defer heartbeat.Stop()
		for {
			select {
			case payload := <-writeCh:
				_ = conn.SetWriteDeadline(time.Now().Add(12 * time.Second))
				if err := conn.WriteJSON(payload); err != nil {
					writeErr <- err
					return
				}
			case <-heartbeat.C:
				_ = conn.SetWriteDeadline(time.Now().Add(8 * time.Second))
				if err := conn.WriteControl(websocket.PingMessage, []byte(strconv.FormatInt(nowMillis(), 10)), time.Now().Add(8*time.Second)); err != nil {
					writeErr <- err
					return
				}
			case <-closeWriter:
				return
			}
		}
	}()

	go func() {
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				readErr <- err
				return
			}
			_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))

			var frame wsIncomingFrame
			if err := json.Unmarshal(raw, &frame); err != nil {
				_ = enqueue(map[string]any{
					"kind":      "error",
					"requestId": frame.RequestID,
					"code":      "INVALID_JSON",
					"message":   "invalid ws frame",
				})
				continue
			}

			action := strings.ToLower(strings.TrimSpace(frame.Action))
			switch action {
			case "":
				_ = enqueue(map[string]any{
					"kind":      "error",
					"requestId": frame.RequestID,
					"code":      "VALIDATION_ERROR",
					"message":   "action is required",
				})
			case "ping":
				_ = enqueue(map[string]any{
					"kind":      "pong",
					"requestId": frame.RequestID,
					"ts":        nowMillis(),
				})
			case "signal.send":
				var sendData wsSignalSendData
				if err := json.Unmarshal(frame.Data, &sendData); err != nil {
					_ = enqueue(map[string]any{
						"kind":      "error",
						"requestId": frame.RequestID,
						"code":      "INVALID_JSON",
						"message":   "invalid signal.send data",
					})
					continue
				}

				authErr := a.authorizeSignalSend(principal, sendSignalRequest{
					FromType: clientType,
					FromID:   clientID,
					ToType:   sendData.ToType,
					ToID:     sendData.ToID,
					Type:     sendData.Type,
					Payload:  sendData.Payload,
				})
				if authErr != nil {
					_ = enqueue(map[string]any{
						"kind":      "error",
						"requestId": frame.RequestID,
						"code":      errorCode(authErr),
						"message":   authErr.Error(),
					})
					continue
				}

				event, buildErr := a.store.buildSignalEvent(sendSignalRequest{
					FromType: clientType,
					FromID:   clientID,
					ToType:   sendData.ToType,
					ToID:     sendData.ToID,
					Type:     sendData.Type,
					Payload:  sendData.Payload,
				})
				if buildErr != nil {
					_ = enqueue(map[string]any{
						"kind":      "error",
						"requestId": frame.RequestID,
						"code":      errorCode(buildErr),
						"message":   buildErr.Error(),
					})
					continue
				}

				deliveredRealtime := a.emitSignal(event.To.Type, event.To.ID, event)
				if !a.persistence.UseExternalSignalQueue() {
					a.onMutation()
				}
				_ = enqueue(map[string]any{
					"kind":              "ack",
					"action":            "signal.send",
					"requestId":         frame.RequestID,
					"ok":                true,
					"deliveredRealtime": deliveredRealtime,
					"event":             event,
				})
			default:
				_ = enqueue(map[string]any{
					"kind":      "error",
					"requestId": frame.RequestID,
					"code":      "NOT_FOUND",
					"message":   "unknown ws action",
				})
			}
		}
	}()

	openedID, _ := makeID("evt")
	_ = enqueue(SignalEvent{
		ID:   openedID,
		Type: "stream.opened",
		Ts:   nowMillis(),
		Payload: map[string]any{
			"clientType": clientType,
			"clientId":   clientID,
		},
	})

	queued := a.pullSignalInbox(clientType, clientID, maxSignalQueuePull)
	for _, event := range queued {
		if ok := enqueue(event); !ok {
			break
		}
	}
	if len(queued) > 0 && !a.persistence.UseExternalSignalQueue() {
		a.onMutation()
	}

	for {
		select {
		case event := <-sub:
			if ok := enqueue(event); !ok {
				log.Printf("[openclaw-server] ws enqueue full, closing client=%s:%s", clientType, clientID)
				close(closeWriter)
				return
			}
		case event, ok := <-externalSub:
			if !ok {
				externalSub = nil
				continue
			}
			if wrote := enqueue(event); !wrote {
				log.Printf("[openclaw-server] ws enqueue full(external), closing client=%s:%s", clientType, clientID)
				close(closeWriter)
				return
			}
		case err := <-readErr:
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Printf("[openclaw-server] ws read closed client=%s:%s err=%v", clientType, clientID, err)
			}
			close(closeWriter)
			return
		case err := <-writeErr:
			log.Printf("[openclaw-server] ws write closed client=%s:%s err=%v", clientType, clientID, err)
			return
		case <-r.Context().Done():
			close(closeWriter)
			return
		}
	}
}

func (a *app) serveHTTP(w http.ResponseWriter, r *http.Request) {
	setCORS(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	path := r.URL.Path
	method := r.Method

	if method == http.MethodGet && path == "/healthz" {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":          true,
			"service":     "openclaw-server",
			"now":         nowMillis(),
			"stats":       a.store.stats(),
			"persistence": a.persistence.Status(),
		})
		return
	}

	a.cleanupInactiveDevices()

	if method == http.MethodPost && path == "/v1/devices/register" {
		var req registerDeviceRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return
		}
		device, err := a.store.registerDevice(req, readBearerToken(r))
		if err != nil {
			writeError(w, err)
			return
		}
		a.onMutation()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "device": device})
		return
	}

	if method == http.MethodPost && path == "/v1/devices/heartbeat" {
		principal, authErr := a.authenticateRequest(r)
		if authErr != nil {
			writeError(w, authErr)
			return
		}
		if principal.Kind != authPrincipalDevice {
			writeError(w, newError("FORBIDDEN", "only desktop device token can call heartbeat"))
			return
		}

		var req heartbeatRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return
		}
		if strings.TrimSpace(req.DeviceID) != principal.Device.DeviceID {
			writeError(w, newError("FORBIDDEN", "token deviceId does not match heartbeat deviceId"))
			return
		}
		device, err := a.store.heartbeatDevice(req)
		if err != nil {
			writeError(w, err)
			return
		}
		a.onMutation()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "device": device})
		return
	}

	if method == http.MethodGet && strings.HasPrefix(path, "/v1/devices/") && strings.HasSuffix(path, "/status") {
		devicePart := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/devices/"), "/status")
		if strings.Contains(devicePart, "/") {
			writeError(w, newError("NOT_FOUND", "device not found"))
			return
		}
		decoded, err := url.PathUnescape(devicePart)
		if err != nil {
			writeError(w, newError("VALIDATION_ERROR", "invalid device id"))
			return
		}
		principal, authErr := a.authenticateRequest(r)
		if authErr != nil {
			writeError(w, authErr)
			return
		}
		if !a.canAccessDeviceStatus(principal, decoded) {
			writeError(w, newError("FORBIDDEN", "not allowed to query this device status"))
			return
		}
		status, err := a.store.getDeviceStatus(decoded)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": status})
		return
	}

	if method == http.MethodPost && path == "/v1/pair/sessions" {
		principal, authErr := a.authenticateRequest(r)
		if authErr != nil {
			writeError(w, authErr)
			return
		}
		if principal.Kind != authPrincipalDevice {
			writeError(w, newError("FORBIDDEN", "only desktop device token can create pair session"))
			return
		}

		var req createPairSessionRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return
		}
		if strings.TrimSpace(req.DeviceID) != principal.Device.DeviceID {
			writeError(w, newError("FORBIDDEN", "token deviceId does not match request"))
			return
		}
		session, err := a.store.createPairSession(req)
		if err != nil {
			writeError(w, err)
			return
		}
		a.onMutation()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "session": session})
		return
	}

	if method == http.MethodPost && path == "/v1/pair/claim" {
		var req claimByTokenRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return
		}
		session, binding, err := a.store.claimByToken(req)
		if err != nil {
			writeError(w, err)
			return
		}
		event := SignalEvent{
			ID:   fmt.Sprintf("evt_pair_claim_%d", nowMillis()),
			Type: "pair.claimed",
			Ts:   nowMillis(),
			Payload: map[string]any{
				"pairSessionId": session.PairSessionID,
				"bindingId":     binding.BindingID,
				"userId":        binding.UserID,
				"mobileId":      binding.MobileID,
				"deviceId":      binding.DeviceID,
			},
		}
		a.emitSignal("desktop", binding.DeviceID, event)
		a.onMutation()
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"session":   session,
			"binding":   publicBinding(binding),
			"authToken": binding.MobileToken,
		})
		return
	}

	if method == http.MethodPost && path == "/v1/pair/claim-by-code" {
		var req claimByCodeRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return
		}
		session, binding, err := a.store.claimByCode(req)
		if err != nil {
			writeError(w, err)
			return
		}
		event := SignalEvent{
			ID:   fmt.Sprintf("evt_pair_claim_%d", nowMillis()),
			Type: "pair.claimed",
			Ts:   nowMillis(),
			Payload: map[string]any{
				"pairSessionId": session.PairSessionID,
				"bindingId":     binding.BindingID,
				"userId":        binding.UserID,
				"mobileId":      binding.MobileID,
				"deviceId":      binding.DeviceID,
			},
		}
		a.emitSignal("desktop", binding.DeviceID, event)
		a.onMutation()
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"session":   session,
			"binding":   publicBinding(binding),
			"authToken": binding.MobileToken,
		})
		return
	}

	if method == http.MethodPost && path == "/v1/pair/revoke" {
		principal, authErr := a.authenticateRequest(r)
		if authErr != nil {
			writeError(w, authErr)
			return
		}

		var req revokePairRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return
		}
		req.BindingID = strings.TrimSpace(req.BindingID)
		if req.BindingID == "" {
			writeError(w, newError("VALIDATION_ERROR", "bindingId is required"))
			return
		}
		binding, exists := a.store.bindingByID(req.BindingID)
		if !exists {
			writeError(w, newError("NOT_FOUND", "binding not found"))
			return
		}
		if principal.Kind == authPrincipalDevice && binding.DeviceID != principal.Device.DeviceID {
			writeError(w, newError("FORBIDDEN", "desktop token cannot revoke this binding"))
			return
		}
		if principal.Kind == authPrincipalMobile && binding.BindingID != principal.Binding.BindingID {
			writeError(w, newError("FORBIDDEN", "mobile token cannot revoke this binding"))
			return
		}
		binding, err := a.store.revokePair(req)
		if err != nil {
			writeError(w, err)
			return
		}
		a.onMutation()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "binding": publicBinding(binding)})
		return
	}

	if method == http.MethodGet && path == "/v1/pair/bindings" {
		principal, authErr := a.authenticateRequest(r)
		if authErr != nil {
			writeError(w, authErr)
			return
		}
		query := r.URL.Query()
		includeRevoked := strings.TrimSpace(query.Get("includeRevoked")) == "true"
		var bindings []Binding
		if principal.Kind == authPrincipalDevice {
			bindings = a.store.listBindings("", principal.Device.DeviceID, includeRevoked)
		} else {
			bindings = []Binding{principal.Binding}
			if !includeRevoked && principal.Binding.Status != "active" {
				bindings = []Binding{}
			}
		}
		publicBindings := make([]map[string]any, 0, len(bindings))
		for _, binding := range bindings {
			publicBindings = append(publicBindings, publicBinding(binding))
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "bindings": publicBindings})
		return
	}

	if method == http.MethodPost && path == "/v1/signal/send" {
		principal, authErr := a.authenticateRequest(r)
		if authErr != nil {
			writeError(w, authErr)
			return
		}

		var req sendSignalRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return
		}
		if err := a.authorizeSignalSend(principal, req); err != nil {
			writeError(w, err)
			return
		}
		event, err := a.store.buildSignalEvent(req)
		if err != nil {
			writeError(w, err)
			return
		}
		deliveredRealtime := a.emitSignal(event.To.Type, event.To.ID, event)
		if !a.persistence.UseExternalSignalQueue() {
			a.onMutation()
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deliveredRealtime": deliveredRealtime, "event": event})
		return
	}

	if method == http.MethodGet && path == "/v1/signal/inbox" {
		principal, authErr := a.authenticateRequest(r)
		if authErr != nil {
			writeError(w, authErr)
			return
		}

		query := r.URL.Query()
		clientType, err := trimRequired(query.Get("clientType"), "clientType")
		if err != nil {
			writeError(w, err)
			return
		}
		clientID, err := trimRequired(query.Get("clientId"), "clientId")
		if err != nil {
			writeError(w, err)
			return
		}
		if err := a.authorizeSignalClient(principal, clientType, clientID); err != nil {
			writeError(w, err)
			return
		}
		limit, parseErr := strconv.Atoi(strings.TrimSpace(query.Get("limit")))
		if parseErr != nil || limit == 0 {
			limit = 100
		}
		events := a.pullSignalInbox(clientType, clientID, limit)
		if !a.persistence.UseExternalSignalQueue() {
			a.onMutation()
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "events": events})
		return
	}

	if method == http.MethodGet && path == "/v1/signal/ws" {
		principal, authErr := a.authenticateRequest(r)
		if authErr != nil {
			writeError(w, authErr)
			return
		}

		query := r.URL.Query()
		clientType, err := trimRequired(query.Get("clientType"), "clientType")
		if err != nil {
			writeError(w, err)
			return
		}
		clientID, err := trimRequired(query.Get("clientId"), "clientId")
		if err != nil {
			writeError(w, err)
			return
		}
		if err := a.authorizeSignalClient(principal, clientType, clientID); err != nil {
			writeError(w, err)
			return
		}
		a.handleSignalWS(w, r, principal, clientType, clientID)
		return
	}

	if method == http.MethodGet && path == "/v1/signal/stream" {
		principal, authErr := a.authenticateRequest(r)
		if authErr != nil {
			writeError(w, authErr)
			return
		}

		query := r.URL.Query()
		clientType, err := trimRequired(query.Get("clientType"), "clientType")
		if err != nil {
			writeError(w, err)
			return
		}
		clientID, err := trimRequired(query.Get("clientId"), "clientId")
		if err != nil {
			writeError(w, err)
			return
		}
		if err := a.authorizeSignalClient(principal, clientType, clientID); err != nil {
			writeError(w, err)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)

		flusher, ok := w.(http.Flusher)
		if !ok {
			writeError(w, newError("INTERNAL_ERROR", "streaming is not supported"))
			return
		}

		openedID, _ := makeID("evt")
		opened := SignalEvent{
			ID:   openedID,
			Type: "stream.opened",
			Ts:   nowMillis(),
			Payload: map[string]any{
				"clientType": clientType,
				"clientId":   clientID,
			},
		}
		if err := writeSSE(w, opened); err != nil {
			return
		}
		flusher.Flush()

		queued := a.pullSignalInbox(clientType, clientID, maxSignalQueuePull)
		if len(queued) > 0 {
			for _, event := range queued {
				if err := writeSSE(w, event); err != nil {
					return
				}
			}
			flusher.Flush()
			if !a.persistence.UseExternalSignalQueue() {
				a.onMutation()
			}
		}

		sub := a.store.addSubscriber(clientType, clientID)
		defer a.store.removeSubscriber(clientType, clientID, sub)

		var externalSub <-chan SignalEvent
		var closeExternalSub func()
		if a.persistence.UseExternalSignalQueue() {
			subChannel, closeFn, subscribeErr := a.persistence.SubscribeSignals(clientType, clientID)
			if subscribeErr != nil {
				log.Printf("[openclaw-server] failed to subscribe redis signal pubsub: %v", subscribeErr)
			} else {
				externalSub = subChannel
				closeExternalSub = closeFn
				defer closeExternalSub()
			}
		}

		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case event := <-sub:
				if err := writeSSE(w, event); err != nil {
					return
				}
				flusher.Flush()
			case event, ok := <-externalSub:
				if !ok {
					externalSub = nil
					continue
				}
				if err := writeSSE(w, event); err != nil {
					return
				}
				flusher.Flush()
			case <-ticker.C:
				if _, err := fmt.Fprintf(w, "event: ping\ndata: {\"ts\":%d}\n\n", nowMillis()); err != nil {
					return
				}
				flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	}

	if method == http.MethodGet && (path == "/ws/desktop" || path == "/ws/mobile") {
		writeJSON(w, http.StatusNotImplemented, map[string]any{
			"ok":      false,
			"code":    "WS_NOT_ENABLED",
			"message": "WebSocket endpoint is reserved. Use /v1/signal/stream and /v1/signal/send during scaffold stage.",
		})
		return
	}

	writeJSON(w, http.StatusNotFound, map[string]any{
		"ok":      false,
		"code":    "NOT_FOUND",
		"message": "Route not found",
	})
}

func main() {
	host := strings.TrimSpace(os.Getenv("HOST"))
	if host == "" {
		host = "0.0.0.0"
	}
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8787"
	}

	store := newStore()
	persist := newPersistenceFromEnv(store)
	app := &app{store: store, persistence: persist}

	server := &http.Server{
		Addr:    netJoinHostPort(host, port),
		Handler: http.HandlerFunc(app.serveHTTP),
	}

	go func() {
		log.Printf("[openclaw-server] listening on http://%s:%s", host, port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("[openclaw-server] server error: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Printf("[openclaw-server] received %s, shutting down...", sig.String())

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(ctx)
	persist.Close(ctx)
}

func netJoinHostPort(host string, port string) string {
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		return "[" + host + "]:" + port
	}
	return host + ":" + port
}
