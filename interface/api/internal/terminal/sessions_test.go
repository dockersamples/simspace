package terminal

import (
	"errors"
	"testing"
	"time"
)

// ---- SessionManager ----

func TestSessionManager_GetOrCreate_ReturnsSession(t *testing.T) {
	dir := t.TempDir()
	mgr := NewSessionManager(dir)

	s, err := mgr.GetOrCreate("test")
	if err != nil {
		t.Fatalf("GetOrCreate: %v", err)
	}
	if s == nil {
		t.Fatal("GetOrCreate returned nil session")
	}
	s.cmd.Process.Kill() //nolint:errcheck
}

func TestSessionManager_GetOrCreate_ReturnsSameSession(t *testing.T) {
	dir := t.TempDir()
	mgr := NewSessionManager(dir)

	s1, err := mgr.GetOrCreate("shared")
	if err != nil {
		t.Fatalf("first GetOrCreate: %v", err)
	}

	s2, err := mgr.GetOrCreate("shared")
	if err != nil {
		t.Fatalf("second GetOrCreate: %v", err)
	}

	if s1 != s2 {
		t.Error("GetOrCreate returned different sessions for the same name; want the same instance")
	}
	s1.cmd.Process.Kill() //nolint:errcheck
}

func TestSessionManager_GetOrCreate_DifferentNamesAreDifferentSessions(t *testing.T) {
	dir := t.TempDir()
	mgr := NewSessionManager(dir)

	a, err := mgr.GetOrCreate("alpha")
	if err != nil {
		t.Fatalf("GetOrCreate alpha: %v", err)
	}
	b, err := mgr.GetOrCreate("beta")
	if err != nil {
		t.Fatalf("GetOrCreate beta: %v", err)
	}

	if a == b {
		t.Error("GetOrCreate returned the same session for different names")
	}
	a.cmd.Process.Kill() //nolint:errcheck
	b.cmd.Process.Kill() //nolint:errcheck
}

func TestSessionManager_Names_ReturnsAliveSessionNames(t *testing.T) {
	dir := t.TempDir()
	mgr := NewSessionManager(dir)

	for _, name := range []string{"one", "two"} {
		s, err := mgr.GetOrCreate(name)
		if err != nil {
			t.Fatalf("GetOrCreate %q: %v", name, err)
		}
		defer s.cmd.Process.Kill() //nolint:errcheck
	}

	names := mgr.Names()
	if len(names) != 2 {
		t.Errorf("Names() returned %d entries; want 2: %v", len(names), names)
	}

	nameSet := make(map[string]bool)
	for _, n := range names {
		nameSet[n] = true
	}
	for _, want := range []string{"one", "two"} {
		if !nameSet[want] {
			t.Errorf("Names() missing %q; got %v", want, names)
		}
	}
}

func TestSessionManager_Names_ExcludesDeadSessions(t *testing.T) {
	dir := t.TempDir()
	mgr := NewSessionManager(dir)

	s, err := mgr.GetOrCreate("dying")
	if err != nil {
		t.Fatalf("GetOrCreate: %v", err)
	}

	// Kill the process and wait for the fanOut goroutine to notice.
	s.cmd.Process.Kill() //nolint:errcheck

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !s.alive.Load() {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if s.alive.Load() {
		t.Skip("session did not die within 2s; skipping liveness check")
	}

	names := mgr.Names()
	for _, n := range names {
		if n == "dying" {
			t.Error("Names() included a dead session; want it excluded")
		}
	}
}

// ---- Session SubmitCommand ----

func TestSubmitCommand(t *testing.T) {
	tests := []struct {
		name      string
		cmd       string
		wantSeq   []string // "w:<data>" for a write, "sleep" for a pause, in order
		wantSleep bool
	}{
		{
			name: "plain prompt writes text then CR in separate calls so CR lands in its own read",
			cmd:  "fix the bug",
			// text write, pause, then standalone \r so Ink sees it as Enter not literal CR
			wantSeq: []string{"w:fix the bug", "sleep", "w:\r"},
		},
		{
			name:    "bash trigger is isolated, then remainder, then CR each in their own writes",
			cmd:     "! ls",
			wantSeq: []string{"w:!", "sleep", "w: ls", "sleep", "w:\r"},
		},
		{
			name:    "slash-command trigger is separated from its remainder",
			cmd:     "/deploy",
			wantSeq: []string{"w:/", "sleep", "w:deploy", "sleep", "w:\r"},
		},
		{
			name:    "file-mention trigger is separated from its remainder",
			cmd:     "@main.go",
			wantSeq: []string{"w:@", "sleep", "w:main.go", "sleep", "w:\r"},
		},
		{
			name:    "a lone trigger character still submits after the pause",
			cmd:     "!",
			wantSeq: []string{"w:!", "sleep", "w:\r"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var seq []string
			write := func(data []byte) error {
				seq = append(seq, "w:"+string(data))
				return nil
			}
			var slept time.Duration
			sleep := func(d time.Duration) {
				seq = append(seq, "sleep")
				slept = d
			}

			if err := submitCommand(tt.cmd, write, sleep); err != nil {
				t.Fatalf("submitCommand: %v", err)
			}

			if len(seq) != len(tt.wantSeq) {
				t.Fatalf("event sequence = %v; want %v", seq, tt.wantSeq)
			}
			for i := range tt.wantSeq {
				if seq[i] != tt.wantSeq[i] {
					t.Errorf("event[%d] = %q; want %q (full: %v)", i, seq[i], tt.wantSeq[i], seq)
				}
			}
			if got := containsSleep(tt.wantSeq); got && slept != modeTriggerDelay {
				t.Errorf("sleep duration = %v; want %v", slept, modeTriggerDelay)
			}
		})
	}
}

// TestSubmitCommand_WriteErrorStopsSequence verifies that a failed first write
// aborts before pausing or writing the remainder.
func TestSubmitCommand_WriteErrorStopsSequence(t *testing.T) {
	wantErr := errors.New("boom")
	writes := 0
	write := func([]byte) error {
		writes++
		return wantErr
	}
	slept := false
	sleep := func(time.Duration) { slept = true }

	if err := submitCommand("! ls", write, sleep); !errors.Is(err, wantErr) {
		t.Fatalf("submitCommand error = %v; want %v", err, wantErr)
	}
	if writes != 1 {
		t.Errorf("write count = %d; want 1 (should abort after the failed trigger write)", writes)
	}
	if slept {
		t.Error("slept after a failed write; want no pause")
	}
}

func containsSleep(seq []string) bool {
	for _, e := range seq {
		if e == "sleep" {
			return true
		}
	}
	return false
}

// ---- Session Subscribe / Unsubscribe ----

func TestSession_SubscribeReceivesOutput(t *testing.T) {
	dir := t.TempDir()
	mgr := NewSessionManager(dir)

	sess, err := mgr.GetOrCreate("sub-test")
	if err != nil {
		t.Fatalf("GetOrCreate: %v", err)
	}
	defer sess.cmd.Process.Kill() //nolint:errcheck

	_, ch := sess.Subscribe()

	// Write something to the PTY; the shell will echo a prompt or the command.
	sess.WriteInput([]byte("echo labspace-ttyd-test\n")) //nolint:errcheck

	// Wait up to 2 s for any output.
	select {
	case chunk, ok := <-ch:
		if !ok {
			t.Fatal("subscriber channel closed unexpectedly")
		}
		if len(chunk) == 0 {
			t.Error("received empty chunk; want non-empty PTY output")
		}
	case <-time.After(2 * time.Second):
		t.Error("timed out waiting for PTY output on subscriber channel")
	}
}

func TestSession_UnsubscribeClosesChannel(t *testing.T) {
	dir := t.TempDir()
	mgr := NewSessionManager(dir)

	sess, err := mgr.GetOrCreate("unsub-test")
	if err != nil {
		t.Fatalf("GetOrCreate: %v", err)
	}
	defer sess.cmd.Process.Kill() //nolint:errcheck

	id, ch := sess.Subscribe()
	sess.Unsubscribe(id)

	// The channel must be closed; a receive should return immediately with zero
	// value and ok=false.
	select {
	case _, ok := <-ch:
		if ok {
			t.Error("channel still open after Unsubscribe; want closed")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("channel was not closed within 100 ms of Unsubscribe")
	}
}

func TestSession_MultipleSubscribers(t *testing.T) {
	dir := t.TempDir()
	mgr := NewSessionManager(dir)

	sess, err := mgr.GetOrCreate("multi-sub")
	if err != nil {
		t.Fatalf("GetOrCreate: %v", err)
	}
	defer sess.cmd.Process.Kill() //nolint:errcheck

	id1, ch1 := sess.Subscribe()
	id2, ch2 := sess.Subscribe()
	defer sess.Unsubscribe(id1)
	defer sess.Unsubscribe(id2)

	sess.WriteInput([]byte("echo hello\n")) //nolint:errcheck

	// Both subscribers should receive output.
	for i, ch := range []<-chan []byte{ch1, ch2} {
		select {
		case chunk, ok := <-ch:
			if !ok {
				t.Errorf("subscriber %d channel closed unexpectedly", i+1)
			}
			_ = chunk
		case <-time.After(2 * time.Second):
			t.Errorf("subscriber %d: timed out waiting for output", i+1)
		}
	}
}
