package main

import "time"

const (
	v2ChallengeTTL          = 5 * time.Minute
	v2AuthSessionTTL        = 24 * time.Hour
	v2PresenceOnlineWindow  = 90 * time.Second
	v2PairSessionMinTTL     = 60
	v2PairSessionMaxTTL     = 600
	v2PairSessionDefaultTTL = 180
)

type v2EntityType string

const (
	v2EntityDesktop v2EntityType = "desktop"
	v2EntityMobile  v2EntityType = "mobile"
)

type v2TrustState string

const (
	v2TrustStatePending v2TrustState = "pending"
	v2TrustStateActive  v2TrustState = "active"
	v2TrustStateRevoked v2TrustState = "revoked"
)

type v2Desktop struct {
	DeviceID      string         `json:"deviceId"`
	PublicKey     string         `json:"publicKey"`
	Platform      string         `json:"platform"`
	AppVersion    string         `json:"appVersion"`
	Capabilities  map[string]any `json:"capabilities"`
	CreatedAt     int64          `json:"createdAt"`
	UpdatedAt     int64          `json:"updatedAt"`
	LastSeenAt    int64          `json:"lastSeenAt"`
	PresenceState string         `json:"presenceState"`
}

type v2Mobile struct {
	MobileID  string `json:"mobileId"`
	PublicKey string `json:"publicKey"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type v2AuthChallenge struct {
	ChallengeID string       `json:"challengeId"`
	EntityType  v2EntityType `json:"entityType"`
	EntityID    string       `json:"entityId"`
	PublicKey   string       `json:"publicKey"`
	Nonce       string       `json:"nonce"`
	CreatedAt   int64        `json:"createdAt"`
	ExpiresAt   int64        `json:"expiresAt"`
}

type v2AuthSession struct {
	SessionID  string       `json:"sessionId"`
	Token      string       `json:"token"`
	EntityType v2EntityType `json:"entityType"`
	EntityID   string       `json:"entityId"`
	PublicKey  string       `json:"publicKey"`
	CreatedAt  int64        `json:"createdAt"`
	UpdatedAt  int64        `json:"updatedAt"`
	ExpiresAt  int64        `json:"expiresAt"`
}

type v2PairSession struct {
	PairSessionID   string  `json:"pairSessionId"`
	DeviceID        string  `json:"deviceId"`
	DevicePublicKey string  `json:"devicePublicKey"`
	ClaimToken      string  `json:"claimToken"`
	SessionNonce    string  `json:"sessionNonce"`
	Status          string  `json:"status"`
	CreatedAt       int64   `json:"createdAt"`
	UpdatedAt       int64   `json:"updatedAt"`
	ExpiresAt       int64   `json:"expiresAt"`
	ClaimedMobileID *string `json:"claimedMobileId,omitempty"`
	BindingID       *string `json:"bindingId,omitempty"`
}

type v2Binding struct {
	BindingID       string       `json:"bindingId"`
	PairSessionID   string       `json:"pairSessionId"`
	DeviceID        string       `json:"deviceId"`
	DevicePublicKey string       `json:"devicePublicKey"`
	MobileID        string       `json:"mobileId"`
	MobilePublicKey string       `json:"mobilePublicKey"`
	TrustState      v2TrustState `json:"trustState"`
	CreatedAt       int64        `json:"createdAt"`
	UpdatedAt       int64        `json:"updatedAt"`
	ApprovedAt      *int64       `json:"approvedAt,omitempty"`
	RevokedAt       *int64       `json:"revokedAt,omitempty"`
}

type v2PresenceStatus struct {
	DeviceID   string `json:"deviceId"`
	Platform   string `json:"platform"`
	AppVersion string `json:"appVersion"`
	Status     string `json:"status"`
	LastSeenAt int64  `json:"lastSeenAt"`
	UpdatedAt  int64  `json:"updatedAt"`
}

type v2Stats struct {
	Desktops     int `json:"desktops"`
	Mobiles      int `json:"mobiles"`
	Challenges   int `json:"challenges"`
	Sessions     int `json:"sessions"`
	PairSessions int `json:"pairSessions"`
	Bindings     int `json:"bindings"`
}

type v2ICEServer struct {
	URLs           []string `json:"urls"`
	Username       string   `json:"username,omitempty"`
	Credential     string   `json:"credential,omitempty"`
	CredentialType string   `json:"credentialType,omitempty"`
}

type v2ICEConfig struct {
	ICEServers []v2ICEServer `json:"iceServers"`
	TTLSeconds int           `json:"ttlSeconds"`
}

type v2ChallengeRequest struct {
	EntityType string `json:"entityType"`
	EntityID   string `json:"entityId"`
	PublicKey  string `json:"publicKey"`
}

type v2LoginRequest struct {
	EntityType  string `json:"entityType"`
	EntityID    string `json:"entityId"`
	PublicKey   string `json:"publicKey"`
	ChallengeID string `json:"challengeId"`
	Signature   string `json:"signature"`
}

type v2PresenceAnnounceRequest struct {
	Platform     string         `json:"platform"`
	AppVersion   string         `json:"appVersion"`
	Capabilities map[string]any `json:"capabilities"`
}

type v2PresenceHeartbeatRequest struct {
	Platform     string         `json:"platform"`
	AppVersion   string         `json:"appVersion"`
	Capabilities map[string]any `json:"capabilities"`
}

type v2PresenceQueryRequest struct {
	DeviceIDs []string `json:"deviceIds"`
}

type v2CreatePairSessionRequest struct {
	TTLSeconds int `json:"ttlSeconds"`
}

type v2PairClaimRequest struct {
	ClaimToken string `json:"claimToken"`
}

type v2PairApproveRequest struct {
	BindingID string `json:"bindingId"`
}

type v2PairRevokeRequest struct {
	BindingID string `json:"bindingId"`
}
