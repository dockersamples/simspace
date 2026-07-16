// Package terminal embeds a PTY-backed web terminal into the interface server.
// It is extracted from the standalone labspace-ttyd terminal server so the
// interface and the terminal run in a single process, served under a shared
// path prefix (see server.go, which mounts it at /terminal/).
package terminal

import (
	"embed"
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"text/template"
)

//go:embed web/static web/templates
var assetsFS embed.FS

// Handler is a self-contained, mountable web terminal. It serves the xterm
// front-end, a WebSocket PTY bridge, and a session-listing endpoint, and it
// exposes in-process methods (SubmitCommand, SaveFile) so the interface backend
// can drive the terminal without an HTTP round-trip.
type Handler struct {
	workdir  string
	sessions *SessionManager

	activateMu        sync.Mutex
	pendingActivation string
}

// New creates a Handler whose shell sessions run in workdir.
func New(workdir string) *Handler {
	return &Handler{
		workdir:  workdir,
		sessions: NewSessionManager(workdir),
	}
}

// Handler returns the http.Handler for the terminal. It is designed to be
// mounted under a path prefix with http.StripPrefix (e.g. "/terminal"), so all
// routes below are relative to that prefix.
func (h *Handler) Handler() http.Handler {
	staticSub, err := fs.Sub(assetsFS, "web/static")
	if err != nil {
		// The embed is compiled in, so this only fails on a packaging mistake.
		panic("terminal: embedded static assets missing: " + err.Error())
	}

	mux := http.NewServeMux()
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticSub))))
	mux.HandleFunc("/api/sessions", h.handleSessions)
	mux.HandleFunc("/ws", h.handleWS)
	mux.HandleFunc("/", h.handleIndex)
	return mux
}

func (h *Handler) handleIndex(w http.ResponseWriter, r *http.Request) {
	tmplBytes, err := assetsFS.ReadFile("web/templates/index.html")
	if err != nil {
		http.Error(w, "template not found", http.StatusInternalServerError)
		return
	}
	tmpl, err := template.New("index").Parse(string(tmplBytes))
	if err != nil {
		http.Error(w, "template error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = tmpl.Execute(w, nil)
}

// handleSessions returns the currently active session names and, if a command
// was recently submitted to a session, the name of the session that the UI
// should switch to (cleared after being read once).
func (h *Handler) handleSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	names := h.sessions.Names()
	if names == nil {
		names = []string{}
	}

	h.activateMu.Lock()
	activate := h.pendingActivation
	h.pendingActivation = ""
	h.activateMu.Unlock()

	resp := map[string]any{"sessions": names}
	if activate != "" {
		resp["activateSession"] = activate
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

// SubmitCommand writes cmd to the named terminal session (creating it if
// needed) as if the user had typed it, and marks that session to be activated
// in the UI on the next /api/sessions poll. An empty terminalID targets the
// "default" session.
func (h *Handler) SubmitCommand(terminalID, cmd string) error {
	name := terminalID
	if name == "" {
		name = "default"
	}

	session, err := h.sessions.GetOrCreate(name)
	if err != nil {
		return err
	}
	if err := session.SubmitCommand(cmd); err != nil {
		return err
	}

	h.activateMu.Lock()
	h.pendingActivation = name
	h.activateMu.Unlock()
	return nil
}

// SaveFile writes body to filePath, resolved relative to the terminal workdir
// and constrained to stay within it. Parent directories are created as needed.
func (h *Handler) SaveFile(filePath, body string) error {
	absPath, err := h.resolveSafeFilePath(filePath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		return err
	}
	return os.WriteFile(absPath, []byte(body), 0644)
}

// resolveSafeFilePath converts a user-provided path to an absolute path
// constrained to the terminal working directory.
func (h *Handler) resolveSafeFilePath(filePath string) (string, error) {
	if filePath == "" {
		return "", os.ErrInvalid
	}

	baseAbs, err := filepath.Abs(h.workdir)
	if err != nil {
		return "", err
	}

	var candidate string
	if filepath.IsAbs(filePath) {
		candidate = filepath.Clean(filePath)
	} else {
		candidate = filepath.Join(baseAbs, filePath)
	}

	candidateAbs, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}

	rel, err := filepath.Rel(baseAbs, candidateAbs)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", os.ErrPermission
	}

	return candidateAbs, nil
}
