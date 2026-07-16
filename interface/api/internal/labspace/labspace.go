// Package labspace loads and serves the content of a Labspace, mirroring the
// behaviour of api/src/services/labspace.js in the Node implementation.
package labspace

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

const instructionsDir = "/home/agent/labspace/instructions"

var (
	// slugStrip removes everything except lowercase letters, digits,
	// whitespace and dashes (matches JS /[^a-z0-9\s-]/g).
	slugStrip = regexp.MustCompile(`[^a-z0-9\s-]`)
	// slugSpaces collapses whitespace runs into a single dash (JS /\s+/g).
	slugSpaces = regexp.MustCompile(`\s+`)
	// varRef matches a $$variable$$ reference (JS /\$\$([^\$]+)\$\$/g).
	varRef = regexp.MustCompile(`\$\$([^$]+)\$\$`)
	// codeBlock matches a fenced code block including its backticks
	// (JS /```(.*?)```/gs).
	codeBlock = regexp.MustCompile("(?s)```(.*?)```")
	// leadingWS captures the leading whitespace of a line (JS /^\s*/).
	leadingWS = regexp.MustCompile(`^\s*`)
)

// Section is a single documentation section of the Labspace.
type Section struct {
	ID          string
	Title       string
	ContentPath string
}

// Service is an auxiliary service surfaced in the interface (e.g. a linked UI).
type Service struct {
	ID    string
	Title string
	Icon  string
	URL   string
}

// Config is the parsed labspace.yaml, post-processed with generated ids.
type Config struct {
	Title       string
	Description string
	Sections    []Section
	Services    []Service
	Variables   map[string]any
}

// SectionSummary is the trimmed section shape returned in the details payload.
type SectionSummary struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// ServiceSummary is the trimmed service shape returned in the details payload.
type ServiceSummary struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Icon  string `json:"icon,omitempty"`
	URL   string `json:"url,omitempty"`
}

// Details is the response body for GET /api/labspace.
type Details struct {
	Title    string           `json:"title"`
	Subtitle string           `json:"subtitle"`
	Sections []SectionSummary `json:"sections"`
	Services []ServiceSummary `json:"services"`
	DevMode  bool             `json:"devMode,omitempty"`
}

// SectionContent is the response body for GET /api/labspace/sections/:id.
type SectionContent struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

// CodeBlock is a parsed fenced code block from a section's markdown.
type CodeBlock struct {
	Language string
	Code     string
	Meta     map[string]string
}

// rawConfig mirrors the YAML document structure.
type rawConfig struct {
	Title       string         `yaml:"title"`
	Description string         `yaml:"description"`
	Sections    []rawSection   `yaml:"sections"`
	Services    []rawService   `yaml:"services"`
	Variables   map[string]any `yaml:"variables"`
}

type rawSection struct {
	Title       string `yaml:"title"`
	ContentPath string `yaml:"contentPath"`
}

type rawService struct {
	ID    string `yaml:"id"`
	Title string `yaml:"title"`
	Icon  string `yaml:"icon"`
	URL   string `yaml:"url"`
}

// Service holds the loaded config and runtime variable overrides. It is safe
// for concurrent use by HTTP handlers.
type LabspaceService struct {
	mu        sync.RWMutex
	config    *Config
	variables map[string]any
}

// New returns an empty LabspaceService; call Bootstrap before use.
func New() *LabspaceService {
	return &LabspaceService{variables: map[string]any{}}
}

// devMode reports whether content should be reloaded on every request.
func devMode() bool { return os.Getenv("CONTENT_DEV_MODE") != "" }

// Bootstrap reads and parses labspace.yaml, generating ids for sections and
// services and merging configured variables under any runtime overrides.
func (s *LabspaceService) Bootstrap() error {
	data, err := os.ReadFile(filepath.Join(instructionsDir, "labspace.yaml"))
	if err != nil {
		return fmt.Errorf("reading labspace.yaml: %w", err)
	}

	var raw rawConfig
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("parsing labspace.yaml: %w", err)
	}

	cfg := &Config{
		Title:       raw.Title,
		Description: raw.Description,
		Sections:    make([]Section, 0, len(raw.Sections)),
		Services:    make([]Service, 0, len(raw.Services)),
		Variables:   raw.Variables,
	}

	for _, svc := range raw.Services {
		id := svc.ID
		if id == "" {
			id = slugify(svc.Title)
		}
		cfg.Services = append(cfg.Services, Service{
			ID:    id,
			Title: svc.Title,
			Icon:  svc.Icon,
			URL:   svc.URL,
		})
	}

	for _, sec := range raw.Sections {
		cfg.Sections = append(cfg.Sections, Section{
			ID:          slugify(sec.Title),
			Title:       sec.Title,
			ContentPath: sec.ContentPath,
		})
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.config = cfg
	// Configured variables are merged UNDER existing runtime overrides so that
	// values set via the API survive a content reload.
	merged := map[string]any{}
	for k, v := range cfg.Variables {
		merged[k] = v
	}
	for k, v := range s.variables {
		merged[k] = v
	}
	s.variables = merged
	return nil
}

// reloadIfDevMode re-reads the config on every request when CONTENT_DEV_MODE is
// set, matching the Node behaviour.
func (s *LabspaceService) reloadIfDevMode() {
	if devMode() {
		if err := s.Bootstrap(); err != nil {
			log.Printf("content reload failed: %v", err)
		}
	}
}

// Config returns the currently loaded configuration.
func (s *LabspaceService) Config() *Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.config
}

// GetLabspaceDetails returns the summary details payload.
func (s *LabspaceService) GetLabspaceDetails() Details {
	s.reloadIfDevMode()

	s.mu.RLock()
	defer s.mu.RUnlock()

	details := Details{
		Title:    s.config.Title,
		Subtitle: s.config.Description,
		Sections: make([]SectionSummary, 0, len(s.config.Sections)),
		Services: make([]ServiceSummary, 0, len(s.config.Services)),
		DevMode:  devMode(),
	}
	for _, sec := range s.config.Sections {
		details.Sections = append(details.Sections, SectionSummary{ID: sec.ID, Title: sec.Title})
	}
	for _, svc := range s.config.Services {
		details.Services = append(details.Services, ServiceSummary{
			ID:    svc.ID,
			Title: svc.Title,
			Icon:  svc.Icon,
			URL:   svc.URL,
		})
	}
	return details
}

// GetSectionDetails returns the rendered content for a section, or (zero, false)
// if the section id is unknown.
func (s *LabspaceService) GetSectionDetails(sectionID string) (SectionContent, bool) {
	s.reloadIfDevMode()

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, sec := range s.config.Sections {
		if sec.ID == sectionID {
			return s.loadSectionContent(sec), true
		}
	}
	log.Printf("Section with id %s not found", sectionID)
	return SectionContent{}, false
}

// GetAllSectionDetails returns rendered content for every section.
func (s *LabspaceService) GetAllSectionDetails() []SectionContent {
	s.reloadIfDevMode()

	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]SectionContent, 0, len(s.config.Sections))
	for _, sec := range s.config.Sections {
		out = append(out, s.loadSectionContent(sec))
	}
	return out
}

// loadSectionContent reads a section's markdown file and applies variable
// substitution. Callers must hold at least the read lock.
func (s *LabspaceService) loadSectionContent(sec Section) SectionContent {
	raw, err := os.ReadFile(filepath.Join(instructionsDir, sec.ContentPath))
	if err != nil {
		log.Printf("reading section content %s: %v", sec.ContentPath, err)
	}

	return SectionContent{ID: sec.ID, Title: sec.Title, Content: substituteVariables(string(raw), s.variables)}
}

// substituteVariables replaces $$name$$ references with their variable value,
// leaving the bare name in place when the variable is unset or null, then
// unescapes \$\$ sequences to literal $$.
func substituteVariables(content string, variables map[string]any) string {
	content = varRef.ReplaceAllStringFunc(content, func(match string) string {
		key := strings.TrimSpace(varRef.FindStringSubmatch(match)[1])
		if val, ok := variables[key]; ok && val != nil {
			return fmt.Sprintf("%v", val)
		}
		return key
	})
	// Allow the usage of \$\$ to render as $$ in the markdown.
	return strings.ReplaceAll(content, `\$\$`, `$$`)
}

// GetSectionIndex returns the index of a section, or -1 when not found.
func (s *LabspaceService) GetSectionIndex(sectionID string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for i, sec := range s.config.Sections {
		if sec.ID == sectionID {
			return i
		}
	}
	return -1
}

// SetVariable stores a runtime variable override.
func (s *LabspaceService) SetVariable(key string, value any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.variables[key] = value
}

// GetVariables returns a copy of the current variable map.
func (s *LabspaceService) GetVariables() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]any, len(s.variables))
	for k, v := range s.variables {
		out[k] = v
	}
	return out
}

// GetCodeBlock parses the code block at the given index within a section.
func (s *LabspaceService) GetCodeBlock(sectionID string, index int) (CodeBlock, error) {
	section, ok := s.GetSectionDetails(sectionID)
	if !ok {
		return CodeBlock{}, fmt.Errorf("section %s not found", sectionID)
	}
	return parseCodeBlock(section.Content, index, sectionID)
}

// parseCodeBlock extracts and parses the fenced code block at the given index,
// mirroring the JS getCodeBlock parsing (header/meta extraction and dedent).
func parseCodeBlock(content string, index int, sectionID string) (CodeBlock, error) {
	blocks := codeBlock.FindAllString(content, -1)
	if index < 0 || index >= len(blocks) {
		return CodeBlock{}, fmt.Errorf("code block at index %d not found in section %s", index, sectionID)
	}

	rows := strings.Split(blocks[index], "\n")
	// Drop the opening fence (```) from the header row; the regex guarantees
	// the matched block begins with three backticks (JS .substring(3)).
	header := rows[0][3:]
	rows = rows[1:]
	// Drop the closing fence line.
	if len(rows) > 0 {
		rows = rows[:len(rows)-1]
	}

	parts := strings.Split(header, " ")
	language := parts[0]
	meta := map[string]string{}
	for _, kv := range parts[1:] {
		pair := strings.SplitN(kv, "=", 2)
		key := strings.TrimSpace(pair[0])
		if len(pair) == 2 && pair[1] != "" {
			meta[key] = pair[1]
		} else {
			meta[key] = "true"
		}
	}

	indentation := 0
	if len(rows) > 0 {
		indentation = len([]rune(leadingWS.FindString(rows[0])))
	}

	trimmed := make([]string, len(rows))
	for i, row := range rows {
		r := []rune(row)
		if indentation <= len(r) {
			trimmed[i] = string(r[indentation:])
		} else {
			trimmed[i] = ""
		}
	}

	return CodeBlock{
		Language: language,
		Code:     strings.Join(trimmed, "\n"),
		Meta:     meta,
	}, nil
}

// slugify converts a title into an id, matching the JS slug generation.
func slugify(title string) string {
	s := strings.ToLower(title)
	s = slugStrip.ReplaceAllString(s, "")
	s = slugSpaces.ReplaceAllString(s, "-")
	return s
}
