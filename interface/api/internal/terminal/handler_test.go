package terminal

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveFile_WritesWithinWorkdir(t *testing.T) {
	dir := t.TempDir()
	h := New(dir)

	if err := h.SaveFile("nested/hello.txt", "hi"); err != nil {
		t.Fatalf("SaveFile: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(dir, "nested", "hello.txt"))
	if err != nil {
		t.Fatalf("reading saved file: %v", err)
	}
	if string(got) != "hi" {
		t.Fatalf("contents = %q, want %q", got, "hi")
	}
}

func TestSaveFile_RejectsTraversal(t *testing.T) {
	dir := t.TempDir()
	h := New(dir)

	if err := h.SaveFile("../escape.txt", "nope"); err == nil {
		t.Fatal("expected error for path escaping workdir, got nil")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "escape.txt")); !os.IsNotExist(err) {
		t.Fatal("traversal write should not have created a file outside workdir")
	}
}

func TestSaveFile_EmptyPath(t *testing.T) {
	h := New(t.TempDir())
	if err := h.SaveFile("", "x"); err == nil {
		t.Fatal("expected error for empty filePath, got nil")
	}
}

func TestHandleSessions_ReportsActivationOnce(t *testing.T) {
	h := New(t.TempDir())

	// No sessions yet: empty list, no activation.
	if resp := getSessions(t, h); len(resp.Sessions) != 0 || resp.ActivateSession != "" {
		t.Fatalf("initial state = %+v, want empty", resp)
	}

	// Mark a session pending activation (without spawning a real PTY, which
	// SubmitCommand would do). handleSessions must surface it exactly once.
	h.activateMu.Lock()
	h.pendingActivation = "build"
	h.activateMu.Unlock()

	if resp := getSessions(t, h); resp.ActivateSession != "build" {
		t.Fatalf("activateSession = %q, want %q", resp.ActivateSession, "build")
	}
	if resp := getSessions(t, h); resp.ActivateSession != "" {
		t.Fatalf("activateSession should be cleared after first read, got %q", resp.ActivateSession)
	}
}

type sessionsResp struct {
	Sessions        []string `json:"sessions"`
	ActivateSession string   `json:"activateSession"`
}

func getSessions(t *testing.T, h *Handler) sessionsResp {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	rec := httptest.NewRecorder()
	h.handleSessions(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp sessionsResp
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	return resp
}
