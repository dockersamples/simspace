package terminal

import (
	"log"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aymanbagabas/go-pty"
)

// leadingModeTriggers are the first-character prefixes that Claude Code (and
// other Ink-based TUIs) treat as a mode switch: bash (!), slash-command (/),
// and file-mention (@). These fire only when the character arrives as its own
// single-byte read; a bulk write of the whole command is treated as pasted
// text and inserted literally, so the mode switch never happens.
const leadingModeTriggers = "!/@"

// modeTriggerDelay is how long to wait after writing a lone mode-trigger byte
// so the TUI's event loop can process the mode switch before the rest of the
// command arrives. A single ~tens-of-ms pause is imperceptible to the user.
const modeTriggerDelay = 40 * time.Millisecond

// Session represents a named PTY session that can be shared by multiple WebSocket clients.
type Session struct {
	name   string
	pty    pty.Pty
	cmd    *pty.Cmd
	alive  atomic.Bool
	subsMu sync.Mutex
	subs   map[int]chan []byte
	nextID int
}

// envWithout returns env with any assignment of the named variable removed, so
// a fresh value can be appended without leaving a duplicate (whose precedence is
// platform-dependent).
func envWithout(env []string, key string) []string {
	prefix := key + "="
	out := env[:0:0]
	for _, kv := range env {
		if !strings.HasPrefix(kv, prefix) {
			out = append(out, kv)
		}
	}
	return out
}

func newSession(name, shell, workdir string) (*Session, error) {
	p, err := pty.New()
	if err != nil {
		return nil, err
	}

	c := p.Command(shell)
	c.Dir = workdir
	// Run the shell with its HOME set to the workdir so ~, shell rc files, and
	// tools that resolve paths against $HOME all point at the project directory.
	c.Env = append(envWithout(os.Environ(), "HOME"), "TERM=xterm-256color", "HOME="+workdir)

	if err := c.Start(); err != nil {
		_ = p.Close()
		return nil, err
	}

	// creack/pty's Start() closed the slave in the parent immediately after
	// launching the child (via defer tty.Close()). go-pty does not, so the
	// parent holds the slave open indefinitely. Without this close, the PTY
	// master's Read never returns EIO after the child exits (the kernel only
	// signals EOF on the master when ALL slave fds are gone), so fanOut hangs
	// forever and the session never transitions to dead.
	if unixPty, ok := p.(pty.UnixPty); ok {
		_ = unixPty.Slave().Close()
	}

	s := &Session{
		name: name,
		pty:  p,
		cmd:  c,
		subs: make(map[int]chan []byte),
	}
	s.alive.Store(true)
	go s.fanOut()
	return s, nil
}

// fanOut reads PTY output and broadcasts to all subscribers. It closes all
// subscriber channels when the PTY process exits.
func (s *Session) fanOut() {
	defer func() {
		s.alive.Store(false)
		s.subsMu.Lock()
		for id, ch := range s.subs {
			close(ch)
			delete(s.subs, id)
		}
		s.subsMu.Unlock()
		_ = s.cmd.Wait()
		_ = s.pty.Close()
	}()

	buf := make([]byte, 4096)
	for {
		n, err := s.pty.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])

			s.subsMu.Lock()
			for _, ch := range s.subs {
				select {
				case ch <- chunk:
				default: // drop if subscriber is slow
				}
			}
			s.subsMu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

// Subscribe registers a new WebSocket client and returns an ID (for later
// unsubscription) and a channel that receives PTY output chunks.
func (s *Session) Subscribe() (int, <-chan []byte) {
	ch := make(chan []byte, 64)
	s.subsMu.Lock()
	id := s.nextID
	s.nextID++
	s.subs[id] = ch
	s.subsMu.Unlock()
	return id, ch
}

// Unsubscribe removes and closes the subscriber channel identified by id.
func (s *Session) Unsubscribe(id int) {
	s.subsMu.Lock()
	if ch, ok := s.subs[id]; ok {
		delete(s.subs, id)
		close(ch)
	}
	s.subsMu.Unlock()
}

// WriteInput writes data to the PTY stdin (as if the user typed it).
func (s *Session) WriteInput(data []byte) error {
	_, err := s.pty.Write(data)
	return err
}

// SubmitCommand writes cmd to the PTY as if typed and submits it with a
// carriage return. If cmd starts with a mode-trigger character (see
// leadingModeTriggers), that byte is written on its own — and given a brief
// moment to register — so the TUI switches modes before the remainder arrives.
// Otherwise a real Enter (\r) rather than a line feed (\n) is required to
// submit: cooked-mode shells translate \r to \n via the line discipline, while
// raw-mode TUIs detect submit only on \r and treat a bare \n as a literal
// newline that never sends.
func (s *Session) SubmitCommand(cmd string) error {
	return submitCommand(cmd, s.WriteInput, time.Sleep)
}

// submitCommand holds the sequencing for SubmitCommand with the write and sleep
// side effects injected, so the chunking and ordering can be tested without a
// real PTY.
//
// \r is always written as its own separate call (after a brief pause) rather
// than appended to the command text. Ink only recognises \r as Enter when it
// arrives in its own read(2) event; when it is bundled with the preceding text
// in the same write the whole chunk is treated as pasted content and \r becomes
// a literal carriage return that never submits the prompt. The same modeTriggerDelay
// is reused here: it gives the TUI's event loop time to drain the previous write
// before the \r arrives, ensuring they land in separate read events.
func submitCommand(cmd string, write func([]byte) error, sleep func(time.Duration)) error {
	if cmd != "" && strings.IndexByte(leadingModeTriggers, cmd[0]) >= 0 {
		if err := write([]byte{cmd[0]}); err != nil {
			return err
		}
		sleep(modeTriggerDelay)
		cmd = cmd[1:]
	}
	if cmd != "" {
		if err := write([]byte(cmd)); err != nil {
			return err
		}
		sleep(modeTriggerDelay)
	}
	return write([]byte{'\r'})
}

// Resize updates the PTY window size.
func (s *Session) Resize(cols, rows uint16) {
	_ = s.pty.Resize(int(cols), int(rows))
}

// SessionManager maintains a registry of named PTY sessions.
type SessionManager struct {
	mu       sync.Mutex
	sessions map[string]*Session
	workdir  string
	shell    string
}

// NewSessionManager creates a SessionManager that spawns shells in workdir.
func NewSessionManager(workdir string) *SessionManager {
	return &SessionManager{
		sessions: make(map[string]*Session),
		workdir:  workdir,
		shell:    detectShell(),
	}
}

// GetOrCreate returns the named session, creating it if it doesn't exist or
// has exited.
func (m *SessionManager) GetOrCreate(name string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s, ok := m.sessions[name]; ok && s.alive.Load() {
		return s, nil
	}

	s, err := newSession(name, m.shell, m.workdir)
	if err != nil {
		return nil, err
	}
	m.sessions[name] = s
	log.Printf("session %q created (shell=%s workdir=%s)", name, m.shell, m.workdir)
	return s, nil
}

// Names returns the names of all sessions that are currently alive.
func (m *SessionManager) Names() []string {
	m.mu.Lock()
	defer m.mu.Unlock()

	names := make([]string, 0, len(m.sessions))
	for name, s := range m.sessions {
		if s.alive.Load() {
			names = append(names, name)
		}
	}
	return names
}
