// Package server wires the HTTP routes and static file serving that make up the
// Labspace interface, mirroring api/src/index.js and api/src/routes/*.
package server

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/dockersamples/sbxlab/interface/api/internal/analytics"
	"github.com/dockersamples/sbxlab/interface/api/internal/labspace"
	"github.com/dockersamples/sbxlab/interface/api/internal/terminal"
	"github.com/dockersamples/sbxlab/interface/api/internal/workspace"
)

const instructionsDir = "/home/agent/labspace/instructions"

// Server holds the dependencies shared by all HTTP handlers.
type Server struct {
	lab       *labspace.LabspaceService
	workspace workspace.Service
	analytics *analytics.Publisher
	terminal  *terminal.Handler
	publicDir string
}

// New constructs a Server. publicDir is the directory containing the built
// client assets (the Node app serves the "public" directory). term is the
// embedded web terminal, mounted under /terminal/.
func New(lab *labspace.LabspaceService, ws workspace.Service, an *analytics.Publisher, term *terminal.Handler, publicDir string) *Server {
	return &Server{lab: lab, workspace: ws, analytics: an, terminal: term, publicDir: publicDir}
}

// Handler returns the root http.Handler for the application.
func (s *Server) Handler() http.Handler {
	api := http.NewServeMux()
	api.HandleFunc("GET /api/labspace", s.handleLabspaceDetails)
	api.HandleFunc("GET /api/labspace/export", s.handleExport)
	api.HandleFunc("POST /api/labspace/open-file", s.handleOpenFile)
	api.HandleFunc("GET /api/labspace/sections/{sectionId}", s.handleSection)
	api.HandleFunc("POST /api/labspace/sections/{sectionId}/command", s.handleCommand)
	api.HandleFunc("POST /api/labspace/sections/{sectionId}/save-file", s.handleSaveFile)
	api.HandleFunc("GET /api/variables", s.handleGetVariables)
	api.HandleFunc("POST /api/variables", s.handleSetVariable)

	root := http.NewServeMux()
	root.Handle("/api/", api)
	// The embedded terminal is served under /terminal/; StripPrefix maps
	// /terminal/ws → /ws, /terminal/static/... → /static/..., etc.
	root.Handle("/terminal/", http.StripPrefix("/terminal", s.terminal.Handler()))
	root.HandleFunc("/", s.handleStaticOrIndex)
	return root
}

// handleStaticOrIndex serves built client assets and content resources, falling
// back to the SPA index.html for unknown GET routes.
func (s *Server) handleStaticOrIndex(w http.ResponseWriter, r *http.Request) {
	// Interface assets (public/) take priority, then content resources served
	// from the instructions directory (which permits dotfiles).
	if s.serveFile(w, r, s.publicDir, false) {
		return
	}
	if s.serveFile(w, r, instructionsDir, true) {
		return
	}
	// Send all unknown routes to the frontend to handle.
	if r.Method == http.MethodGet {
		http.ServeFile(w, r, filepath.Join(s.publicDir, "index.html"))
		return
	}
	http.NotFound(w, r)
}

// serveFile serves an existing regular file from base, returning true if it did.
// When allowDotfiles is false, files whose name begins with "." are skipped.
func (s *Server) serveFile(w http.ResponseWriter, r *http.Request, base string, allowDotfiles bool) bool {
	// Clean against a leading slash so ".." cannot escape the base directory.
	clean := filepath.Clean("/" + r.URL.Path)
	if !allowDotfiles && dotfileInPath(clean) {
		return false
	}
	full := filepath.Join(base, clean)
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		return false
	}
	http.ServeFile(w, r, full)
	return true
}

func dotfileInPath(p string) bool {
	for _, part := range strings.Split(p, "/") {
		if strings.HasPrefix(part, ".") && part != "." && part != ".." {
			return true
		}
	}
	return false
}

func (s *Server) handleLabspaceDetails(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.lab.GetLabspaceDetails())
}

func (s *Server) handleExport(w http.ResponseWriter, _ *http.Request) {
	details := s.lab.GetLabspaceDetails()
	writeJSON(w, http.StatusOK, map[string]any{
		"title":    details.Title,
		"subtitle": details.Subtitle,
		"sections": s.lab.GetAllSectionDetails(),
	})
}

func (s *Server) handleSection(w http.ResponseWriter, r *http.Request) {
	sectionID := r.PathValue("sectionId")
	content, ok := s.lab.GetSectionDetails(sectionID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Section not found"})
		return
	}
	s.analytics.PublishSectionChangeEvent(sectionID)
	writeJSON(w, http.StatusOK, content)
}

func (s *Server) handleOpenFile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FilePath  string  `json:"filePath"`
		Line      any     `json:"line"`
		SectionID *string `json:"sectionId"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid request body"})
		return
	}

	// Match the JS `sectionId || null`: empty string becomes null.
	section := body.SectionID
	if section != nil && *section == "" {
		section = nil
	}

	if err := s.workspace.OpenFileInIDE(body.FilePath, body.Line); err != nil {
		log.Printf("Error opening file: %v", err)
		s.analytics.PublishUserActionEvent("open_file", section, nil, false, &body.FilePath)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Failed to open file"})
		return
	}
	s.analytics.PublishUserActionEvent("open_file", section, nil, true, &body.FilePath)
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleCommand(w http.ResponseWriter, r *http.Request) {
	sectionID := r.PathValue("sectionId")
	var body struct {
		CodeBlockIndex *int `json:"codeBlockIndex"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid request body"})
		return
	}
	idx := indexValue(body.CodeBlockIndex)

	if err := s.workspace.ExecuteCommand(sectionID, idx); err != nil {
		log.Printf("Error executing command: %v", err)
		s.analytics.PublishUserActionEvent("run_command", &sectionID, body.CodeBlockIndex, false, nil)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Failed to execute command"})
		return
	}
	s.analytics.PublishUserActionEvent("run_command", &sectionID, body.CodeBlockIndex, true, nil)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Command executed"})
}

func (s *Server) handleSaveFile(w http.ResponseWriter, r *http.Request) {
	sectionID := r.PathValue("sectionId")
	var body struct {
		CodeBlockIndex *int `json:"codeBlockIndex"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid request body"})
		return
	}
	idx := indexValue(body.CodeBlockIndex)

	_, err := s.workspace.SaveFile(sectionID, idx)
	if err != nil {
		log.Printf("Error saving file: %v", err)
		var fileName *string
		if se, ok := err.(*workspace.SaveError); ok && se.FileName != "" {
			fileName = &se.FileName
		}
		s.analytics.PublishUserActionEvent("save_file", &sectionID, body.CodeBlockIndex, false, fileName)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Failed to save file"})
		return
	}
	s.analytics.PublishUserActionEvent("save_file", &sectionID, body.CodeBlockIndex, true, nil)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "File saved"})
}

func (s *Server) handleGetVariables(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.lab.GetVariables())
}

func (s *Server) handleSetVariable(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Key   string `json:"key"`
		Value any    `json:"value"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid request body"})
		return
	}
	s.lab.SetVariable(body.Key, body.Value)
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// indexValue dereferences a code block index pointer, using -1 (an always-out-of
// -range index) when absent so downstream lookups report "not found".
func indexValue(p *int) int {
	if p == nil {
		return -1
	}
	return *p
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("error writing JSON response: %v", err)
	}
}
