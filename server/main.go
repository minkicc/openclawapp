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

	"github.com/redis/go-redis/v9"
)

const (
	maxBodyBytes       = 1024 * 1024
	maxSignalQueuePull = 500
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
	case "NOT_FOUND":
		return http.StatusNotFound
	case "EXPIRED":
		return http.StatusGone
	case "INVALID_STATE":
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
	BindingID string `json:"bindingId"`
	UserID    string `json:"userId"`
	DeviceID  string `json:"deviceId"`
	MobileID  string `json:"mobileId"`
	Status    string `json:"status"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
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
	mu             sync.RWMutex
	devices        map[string]Device
	pairSessions   map[string]PairSession
	pairTokenIndex map[string]string
	pairCodeIndex  map[string]string
	bindings       map[string]Binding
	signalQueues   map[string][]SignalEvent
	subscribers    map[string]map[chan SignalEvent]struct{}
}

func newStore() *Store {
	return &Store{
		devices:        map[string]Device{},
		pairSessions:   map[string]PairSession{},
		pairTokenIndex: map[string]string{},
		pairCodeIndex:  map[string]string{},
		bindings:       map[string]Binding{},
		signalQueues:   map[string][]SignalEvent{},
		subscribers:    map[string]map[chan SignalEvent]struct{}{},
	}
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

func clientKey(clientType string, clientID string) string {
	return fmt.Sprintf("%s:%s", clientType, clientID)
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

func decodeEntryMap[T any](raw json.RawMessage) (map[string]T, error) {
	if len(raw) == 0 {
		return map[string]T{}, nil
	}

	var asMap map[string]T
	if err := json.Unmarshal(raw, &asMap); err == nil {
		if asMap == nil {
			asMap = map[string]T{}
		}
		return asMap, nil
	}

	var entries []json.RawMessage
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	out := map[string]T{}
	for _, entry := range entries {
		var pair []json.RawMessage
		if err := json.Unmarshal(entry, &pair); err != nil || len(pair) != 2 {
			continue
		}
		var key string
		if err := json.Unmarshal(pair[0], &key); err != nil {
			continue
		}
		var value T
		if err := json.Unmarshal(pair[1], &value); err != nil {
			continue
		}
		out[key] = value
	}
	return out, nil
}

func parseSnapshot(raw string) (StoreSnapshot, error) {
	var snap StoreSnapshot
	if err := json.Unmarshal([]byte(raw), &snap); err == nil {
		if snap.Devices == nil {
			snap.Devices = map[string]Device{}
		}
		if snap.PairSessions == nil {
			snap.PairSessions = map[string]PairSession{}
		}
		if snap.PairTokenIndex == nil {
			snap.PairTokenIndex = map[string]string{}
		}
		if snap.PairCodeIndex == nil {
			snap.PairCodeIndex = map[string]string{}
		}
		if snap.Bindings == nil {
			snap.Bindings = map[string]Binding{}
		}
		if snap.SignalQueues == nil {
			snap.SignalQueues = map[string][]SignalEvent{}
		}
		return snap, nil
	}

	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		return StoreSnapshot{}, err
	}

	snap = StoreSnapshot{Version: 1, SavedAt: nowMillis()}
	var err error
	if snap.Devices, err = decodeEntryMap[Device](root["devices"]); err != nil {
		return StoreSnapshot{}, err
	}
	if snap.PairSessions, err = decodeEntryMap[PairSession](root["pairSessions"]); err != nil {
		return StoreSnapshot{}, err
	}
	if snap.PairTokenIndex, err = decodeEntryMap[string](root["pairTokenIndex"]); err != nil {
		return StoreSnapshot{}, err
	}
	if snap.PairCodeIndex, err = decodeEntryMap[string](root["pairCodeIndex"]); err != nil {
		return StoreSnapshot{}, err
	}
	if snap.Bindings, err = decodeEntryMap[Binding](root["bindings"]); err != nil {
		return StoreSnapshot{}, err
	}
	if snap.SignalQueues, err = decodeEntryMap[[]SignalEvent](root["signalQueues"]); err != nil {
		return StoreSnapshot{}, err
	}

	return snap, nil
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

	s.subscribers = map[string]map[chan SignalEvent]struct{}{}
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

type registerDeviceRequest struct {
	DeviceID     string         `json:"deviceId"`
	Platform     string         `json:"platform"`
	AppVersion   string         `json:"appVersion"`
	Capabilities map[string]any `json:"capabilities"`
}

func (s *Store) registerDevice(req registerDeviceRequest) (Device, error) {
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

	device, exists := s.devices[deviceID]
	if !exists {
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

	binding, exists := s.getActiveBindingLocked(userID, session.DeviceID)
	if !exists {
		bindingID, _ := makeID("bind")
		binding = Binding{
			BindingID: bindingID,
			UserID:    userID,
			DeviceID:  session.DeviceID,
			MobileID:  mobileID,
			Status:    "active",
			CreatedAt: now,
			UpdatedAt: now,
		}
	} else {
		binding.MobileID = mobileID
		binding.UpdatedAt = now
	}
	s.bindings[binding.BindingID] = binding

	session.Status = "claimed"
	session.ClaimedAt = &now
	session.ClaimedByUserID = &userID
	session.ClaimedByMobileID = &mobileID
	s.pairSessions[session.PairSessionID] = session

	return session, binding
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
	userID, err := trimRequired(req.UserID, "userId")
	if err != nil {
		return PairSession{}, Binding{}, err
	}
	mobileID := strings.TrimSpace(req.MobileID)
	if mobileID == "" {
		mobileID = "mobile_unknown"
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
	userID, err := trimRequired(req.UserID, "userId")
	if err != nil {
		return PairSession{}, Binding{}, err
	}
	mobileID := strings.TrimSpace(req.MobileID)
	if mobileID == "" {
		mobileID = "mobile_unknown"
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

func (s *Store) enqueueSignalEvent(targetType string, targetID string, event SignalEvent) bool {
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

	s.mu.Lock()
	defer s.mu.Unlock()
	s.signalQueues[key] = append(s.signalQueues[key], copySignalEvent(event))
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

func (s *Store) sendSignal(req sendSignalRequest) (SignalEvent, bool, error) {
	fromType, err := trimRequired(req.FromType, "fromType")
	if err != nil {
		return SignalEvent{}, false, err
	}
	fromID, err := trimRequired(req.FromID, "fromId")
	if err != nil {
		return SignalEvent{}, false, err
	}
	toType, err := trimRequired(req.ToType, "toType")
	if err != nil {
		return SignalEvent{}, false, err
	}
	toID, err := trimRequired(req.ToID, "toId")
	if err != nil {
		return SignalEvent{}, false, err
	}
	eventType := strings.TrimSpace(req.Type)
	if eventType == "" {
		eventType = "signal.message"
	}

	eventID, idErr := makeID("evt")
	if idErr != nil {
		return SignalEvent{}, false, newError("INTERNAL_ERROR", "failed to create signal event id")
	}

	event := SignalEvent{
		ID:      eventID,
		Type:    eventType,
		Ts:      nowMillis(),
		From:    &SignalParty{Type: fromType, ID: fromID},
		To:      &SignalParty{Type: toType, ID: toID},
		Payload: copyPayload(req.Payload),
	}

	delivered := s.enqueueSignalEvent(toType, toID, event)
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
}

type memoryPersistence struct{}

func (m *memoryPersistence) SchedulePersist()        {}
func (m *memoryPersistence) Flush(_ context.Context) {}
func (m *memoryPersistence) Close(_ context.Context) {}
func (m *memoryPersistence) Status() persistenceStatus {
	return persistenceStatus{Backend: "memory", RedisKey: nil, Connected: false}
}

type redisPersistence struct {
	store     *Store
	client    *redis.Client
	redisKey  string
	timerMu   sync.Mutex
	timer     *time.Timer
	persistMu sync.Mutex
}

func newRedisPersistence(store *Store, client *redis.Client, redisKey string) *redisPersistence {
	return &redisPersistence{store: store, client: client, redisKey: redisKey}
}

func (r *redisPersistence) persistWithTimeout(timeout time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	r.persistMu.Lock()
	defer r.persistMu.Unlock()

	snapshot := r.store.snapshot()
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		log.Printf("[openclaw-server] failed to encode snapshot: %v", err)
		return
	}
	if err := r.client.Set(ctx, r.redisKey, encoded, 0).Err(); err != nil {
		log.Printf("[openclaw-server] failed to persist snapshot to redis: %v", err)
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
	redisKey := r.redisKey
	return persistenceStatus{Backend: "redis", RedisKey: &redisKey, Connected: true}
}

func newPersistenceFromEnv(store *Store) persistence {
	backend := strings.ToLower(strings.TrimSpace(os.Getenv("STORE_BACKEND")))
	if backend == "" || backend == "memory" {
		log.Printf("[openclaw-server] persistence backend: memory")
		return &memoryPersistence{}
	}

	if backend != "redis" {
		log.Printf("[openclaw-server] unknown STORE_BACKEND=%s, fallback to memory", backend)
		return &memoryPersistence{}
	}

	redisURL := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if redisURL == "" {
		redisURL = "redis://127.0.0.1:6379"
	}
	redisKey := strings.TrimSpace(os.Getenv("REDIS_SNAPSHOT_KEY"))
	if redisKey == "" {
		redisKey = "openclaw:server:store-snapshot:v1"
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

	raw, err := client.Get(ctx, redisKey).Result()
	if err == nil && raw != "" {
		snapshot, parseErr := parseSnapshot(raw)
		if parseErr != nil {
			log.Printf("[openclaw-server] failed to parse redis snapshot, start fresh: %v", parseErr)
		} else {
			store.applySnapshot(snapshot)
			log.Printf("[openclaw-server] restored store snapshot from redis")
		}
	}
	if err != nil && err != redis.Nil {
		log.Printf("[openclaw-server] failed to read redis snapshot: %v", err)
	}

	log.Printf("[openclaw-server] persistence backend: redis (%s)", redisURL)
	return newRedisPersistence(store, client, redisKey)
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

type app struct {
	store       *Store
	persistence persistence
}

func (a *app) onMutation() {
	a.persistence.SchedulePersist()
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

	if method == http.MethodPost && path == "/v1/devices/register" {
		var req registerDeviceRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return
		}
		device, err := a.store.registerDevice(req)
		if err != nil {
			writeError(w, err)
			return
		}
		a.onMutation()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "device": device})
		return
	}

	if method == http.MethodPost && path == "/v1/devices/heartbeat" {
		var req heartbeatRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
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
		status, err := a.store.getDeviceStatus(decoded)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": status})
		return
	}

	if method == http.MethodPost && path == "/v1/pair/sessions" {
		var req createPairSessionRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
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
				"bindingId": binding.BindingID,
				"userId":    binding.UserID,
				"mobileId":  binding.MobileID,
			},
		}
		a.store.enqueueSignalEvent("desktop", binding.DeviceID, event)
		a.onMutation()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "session": session, "binding": binding})
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
				"bindingId": binding.BindingID,
				"userId":    binding.UserID,
				"mobileId":  binding.MobileID,
			},
		}
		a.store.enqueueSignalEvent("desktop", binding.DeviceID, event)
		a.onMutation()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "session": session, "binding": binding})
		return
	}

	if method == http.MethodPost && path == "/v1/pair/revoke" {
		var req revokePairRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return
		}
		binding, err := a.store.revokePair(req)
		if err != nil {
			writeError(w, err)
			return
		}
		a.onMutation()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "binding": binding})
		return
	}

	if method == http.MethodGet && path == "/v1/pair/bindings" {
		query := r.URL.Query()
		bindings := a.store.listBindings(
			strings.TrimSpace(query.Get("userId")),
			strings.TrimSpace(query.Get("deviceId")),
			strings.TrimSpace(query.Get("includeRevoked")) == "true",
		)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "bindings": bindings})
		return
	}

	if method == http.MethodPost && path == "/v1/signal/send" {
		var req sendSignalRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return
		}
		event, deliveredRealtime, err := a.store.sendSignal(req)
		if err != nil {
			writeError(w, err)
			return
		}
		a.onMutation()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deliveredRealtime": deliveredRealtime, "event": event})
		return
	}

	if method == http.MethodGet && path == "/v1/signal/inbox" {
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
		limit, parseErr := strconv.Atoi(strings.TrimSpace(query.Get("limit")))
		if parseErr != nil || limit == 0 {
			limit = 100
		}
		events := a.store.pullSignalInbox(clientType, clientID, limit)
		a.onMutation()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "events": events})
		return
	}

	if method == http.MethodGet && path == "/v1/signal/stream" {
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

		queued := a.store.pullSignalInbox(clientType, clientID, maxSignalQueuePull)
		if len(queued) > 0 {
			for _, event := range queued {
				if err := writeSSE(w, event); err != nil {
					return
				}
			}
			flusher.Flush()
			a.onMutation()
		}

		sub := a.store.addSubscriber(clientType, clientID)
		defer a.store.removeSubscriber(clientType, clientID, sub)

		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case event := <-sub:
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
