package main

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
)

const v2DefaultICETTLSeconds = 600

func defaultV2ICEConfig() v2ICEConfig {
	return v2ICEConfig{
		ICEServers: []v2ICEServer{
			{
				URLs: []string{
					"stun:stun.cloudflare.com:3478",
					"stun:stun.l.google.com:19302",
				},
			},
		},
		TTLSeconds: v2DefaultICETTLSeconds,
	}
}

func normalizeV2ICEServers(raw []v2ICEServer) []v2ICEServer {
	normalized := make([]v2ICEServer, 0, len(raw))
	for _, item := range raw {
		urls := make([]string, 0, len(item.URLs))
		seen := map[string]struct{}{}
		for _, value := range item.URLs {
			trimmed := strings.TrimSpace(value)
			if trimmed == "" {
				continue
			}
			if _, exists := seen[trimmed]; exists {
				continue
			}
			seen[trimmed] = struct{}{}
			urls = append(urls, trimmed)
		}
		if len(urls) == 0 {
			continue
		}
		normalized = append(normalized, v2ICEServer{
			URLs:           urls,
			Username:       strings.TrimSpace(item.Username),
			Credential:     strings.TrimSpace(item.Credential),
			CredentialType: strings.TrimSpace(item.CredentialType),
		})
	}
	return normalized
}

func loadV2ICEConfigFromEnv() v2ICEConfig {
	config := defaultV2ICEConfig()

	if rawTTL := strings.TrimSpace(os.Getenv("V2_ICE_TTL_SECONDS")); rawTTL != "" {
		if parsed, err := strconv.Atoi(rawTTL); err == nil && parsed > 0 {
			config.TTLSeconds = parsed
		}
	}

	rawJSON := strings.TrimSpace(os.Getenv("V2_ICE_SERVERS_JSON"))
	if rawJSON == "" {
		return config
	}

	var parsed []v2ICEServer
	if err := json.Unmarshal([]byte(rawJSON), &parsed); err != nil {
		return config
	}

	normalized := normalizeV2ICEServers(parsed)
	if len(normalized) == 0 {
		return config
	}

	config.ICEServers = normalized
	return config
}
