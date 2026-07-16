// Package analytics publishes lifecycle and user-action events to the Marlin
// endpoint, mirroring api/src/services/analytics.js.
package analytics

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/dockersamples/sbxlab/interface/api/internal/labspace"
)

const metadataPath = "/home/agent/labspace/metadata/metadata.json"

type metadata struct {
	AnalyticsEnabled bool `json:"analytics_enabled"`
	LabspaceID       any  `json:"labspace_id"`
	LabspaceMode     any  `json:"labspace_mode"`
	UUIDs            struct {
		Hub any `json:"hub"`
		DD  any `json:"dd"`
	} `json:"uuids"`
	InfraVersion   any `json:"infra_version"`
	SourceRepo     any `json:"source_repo"`
	ContentVersion any `json:"content_version"`
}

// Publisher sends analytics events, honouring the opt-in flag in the metadata.
type Publisher struct {
	lab      *labspace.LabspaceService
	meta     metadata
	optIn    bool
	endpoint string
	apiKey   string
	client   *http.Client

	startTimestamp int64

	mu                sync.Mutex
	previousSectionID string
	hasPrevious       bool
	sectionsVisited   map[string]struct{}
}

// New reads the metadata file and constructs a Publisher.
func New(lab *labspace.LabspaceService) (*Publisher, error) {
	data, err := os.ReadFile(metadataPath)
	if err != nil {
		return nil, fmt.Errorf("reading metadata: %w", err)
	}
	var meta metadata
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, fmt.Errorf("parsing metadata: %w", err)
	}

	p := &Publisher{
		lab:             lab,
		meta:            meta,
		optIn:           meta.AnalyticsEnabled,
		endpoint:        os.Getenv("MARLIN_ENDPOINT"),
		apiKey:          os.Getenv("MARLIN_API_KEY"),
		client:          http.DefaultClient,
		startTimestamp:  time.Now().UnixMilli(),
		sectionsVisited: map[string]struct{}{},
	}

	if p.optIn {
		log.Println("AnalyticsPublisher initialized. Analytics enabled")
	} else {
		log.Println("AnalyticsPublisher initialized. Analytics disabled")
	}
	return p, nil
}

// PublishStartEvent records that the Labspace has launched.
func (p *Publisher) PublishStartEvent() {
	p.sendEvent("lifecycle", map[string]any{
		"action":             "start",
		"launched_at":        p.startTimestamp,
		"num_sections_total": p.numSectionsTotal(),
	})
}

// PublishStopEvent records that the Labspace is shutting down.
func (p *Publisher) PublishStopEvent() {
	p.mu.Lock()
	visited := len(p.sectionsVisited)
	p.mu.Unlock()

	p.sendEvent("lifecycle", map[string]any{
		"action":               "stop",
		"launched_at":          p.startTimestamp,
		"stopped_at":           time.Now().UnixMilli(),
		"num_sections_total":   p.numSectionsTotal(),
		"num_sections_visited": visited,
	})
}

// PublishUserActionEvent records a user-initiated action. sectionID and
// codeBlockIndex are pointers so a nil value is serialised as JSON null, while
// filename is omitted entirely when nil (matching JS undefined semantics).
func (p *Publisher) PublishUserActionEvent(action string, sectionID *string, codeBlockIndex *int, isSuccess bool, filename *string) {
	var sid string
	if sectionID != nil {
		sid = *sectionID
	}

	props := map[string]any{
		"action":           action,
		"section_id":       sectionID,
		"section_index":    p.lab.GetSectionIndex(sid),
		"code_block_index": codeBlockIndex,
		"is_success":       isSuccess,
	}
	if filename != nil {
		props["filename"] = *filename
	}
	p.sendEvent("user_action", props)
}

// PublishSectionChangeEvent records navigation to a new section, deduplicating
// repeated visits to the same section.
func (p *Publisher) PublishSectionChangeEvent(sectionID string) {
	p.mu.Lock()
	if p.hasPrevious && sectionID == p.previousSectionID {
		p.mu.Unlock()
		return
	}
	prev := p.previousSectionID
	hadPrev := p.hasPrevious
	p.previousSectionID = sectionID
	p.hasPrevious = true
	p.sectionsVisited[sectionID] = struct{}{}
	p.mu.Unlock()

	var prevSection any
	var prevIndex any
	if hadPrev {
		prevSection = prev
		prevIndex = p.lab.GetSectionIndex(prev)
	}

	p.sendEvent("user_action", map[string]any{
		"action":             "section_change",
		"section_id":         sectionID,
		"section_index":      p.lab.GetSectionIndex(sectionID),
		"prev_section":       prevSection,
		"prev_section_index": prevIndex,
	})
}

func (p *Publisher) numSectionsTotal() int {
	if cfg := p.lab.Config(); cfg != nil {
		return len(cfg.Sections)
	}
	return 0
}

// sendEvent enriches and POSTs a single event. It is a no-op when analytics are
// disabled; transport errors are logged rather than propagated.
func (p *Publisher) sendEvent(event string, properties map[string]any) {
	if !p.optIn {
		return
	}

	properties["labspace_id"] = p.meta.LabspaceID
	properties["labspace_source_repo"] = p.meta.SourceRepo
	properties["labspace_content_version"] = p.meta.ContentVersion
	properties["labspace_mode"] = p.meta.LabspaceMode
	properties["labspace_infra_version"] = p.meta.InfraVersion
	properties["hub_user_uuid"] = p.meta.UUIDs.Hub
	properties["desktop_instance_uuid"] = p.meta.UUIDs.DD

	enhanced := map[string]any{
		"event":           event,
		"source":          "labspace",
		"event_timestamp": time.Now().UnixMilli(),
		"properties":      properties,
	}

	body, err := json.Marshal(map[string]any{"records": []any{enhanced}})
	if err != nil {
		log.Printf("Failed to send analytics event: %v", err)
		return
	}

	req, err := http.NewRequest(http.MethodPost, p.endpoint, bytes.NewReader(body))
	if err != nil {
		log.Printf("Failed to send analytics event: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if p.apiKey != "" {
		req.Header.Set("x-api-key", p.apiKey)
	}

	res, err := p.client.Do(req)
	if err != nil {
		log.Printf("Failed to send analytics event: %v", err)
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		text, _ := io.ReadAll(res.Body)
		log.Printf("Failed to send analytics event: Non-200 response from analytics endpoint: %d - %s", res.StatusCode, string(text))
	}
}
