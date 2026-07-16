// Package filesystem applies a scenario's file effects, confining every write
// and delete to the lab root so a lab can never touch files outside the
// learner's project. See docs/scenario-spec.md §7.1 and implementation-plan §4.
package filesystem

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// FS applies file operations rooted at a lab directory.
type FS struct {
	root string
}

// New returns an FS confined to root, which must be an absolute path.
func New(root string) (*FS, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve root: %w", err)
	}
	return &FS{root: abs}, nil
}

// Root returns the absolute lab-root directory the FS is confined to. It is the
// working directory for shell-mode commands run from an agent session.
func (f *FS) Root() string { return f.root }

// resolve turns a lab-relative path into an absolute path guaranteed to be
// inside the root. Absolute inputs and paths escaping the root are rejected.
// Symlinks along an existing prefix are resolved and re-checked so a symlink
// cannot be used to escape.
func (f *FS) resolve(p string) (string, error) {
	if err := CheckPath(p); err != nil {
		return "", err
	}
	full := filepath.Join(f.root, filepath.Clean(p))
	if !withinRoot(f.root, full) {
		return "", fmt.Errorf("path escapes lab root: %q", p)
	}
	// Resolve symlinks on the longest existing ancestor and re-check.
	if resolved := resolveExisting(full); !withinRoot(f.root, resolved) {
		return "", fmt.Errorf("path escapes lab root via symlink: %q", p)
	}
	return full, nil
}

// CheckPath statically validates that p is a legal lab-relative path — not
// empty, not absolute, and not stepping above the root — without touching the
// filesystem. The static validator uses it; resolve layers runtime symlink
// checking on top. Escaping "../" is rejected rather than clamped, which would
// surprise authors.
func CheckPath(p string) error {
	if p == "" {
		return fmt.Errorf("empty path")
	}
	if filepath.IsAbs(p) {
		return fmt.Errorf("absolute paths are not allowed: %q", p)
	}
	cleaned := filepath.Clean(p)
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return fmt.Errorf("path escapes lab root: %q", p)
	}
	return nil
}

// withinRoot reports whether target is root itself or nested under it.
func withinRoot(root, target string) bool {
	if target == root {
		return true
	}
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// resolveExisting evaluates symlinks on the longest existing prefix of full,
// re-appending the non-existent tail. Used only for the escape re-check.
func resolveExisting(full string) string {
	cur := full
	var tail []string
	for {
		if resolved, err := filepath.EvalSymlinks(cur); err == nil {
			return filepath.Join(append([]string{resolved}, reverse(tail)...)...)
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return full
		}
		tail = append(tail, filepath.Base(cur))
		cur = parent
	}
}

func reverse(s []string) []string {
	out := make([]string, len(s))
	for i, v := range s {
		out[len(s)-1-i] = v
	}
	return out
}

// Mkdir creates a directory (and parents) at a lab-relative path.
func (f *FS) Mkdir(p string) error {
	full, err := f.resolve(p)
	if err != nil {
		return err
	}
	return os.MkdirAll(full, 0o755)
}

// Create writes content to a lab-relative path, creating parents and
// overwriting any existing file.
func (f *FS) Create(p, content string) error {
	full, err := f.resolve(p)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	return os.WriteFile(full, []byte(content), 0o644)
}

// Append appends content to a lab-relative path, creating it (and parents) if
// absent.
func (f *FS) Append(p, content string) error {
	full, err := f.resolve(p)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(full, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.WriteString(content)
	return err
}

// Replace substitutes every occurrence of find with with in a lab-relative
// file. It errors if the file is missing or find does not occur, so authoring
// mistakes fail fast rather than silently no-op'ing.
func (f *FS) Replace(p, find, with string) error {
	if find == "" {
		return fmt.Errorf("replace on %q requires a non-empty `find`", p)
	}
	full, err := f.resolve(p)
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		return fmt.Errorf("replace %q: %w", p, err)
	}
	if !strings.Contains(string(raw), find) {
		return fmt.Errorf("replace %q: text not found: %q", p, find)
	}
	out := strings.ReplaceAll(string(raw), find, with)
	return os.WriteFile(full, []byte(out), 0o644)
}

// Delete removes a lab-relative file or directory tree. Removing a
// non-existent path is not an error.
func (f *FS) Delete(p string) error {
	full, err := f.resolve(p)
	if err != nil {
		return err
	}
	return os.RemoveAll(full)
}

// Copy copies a lab-relative source file to a lab-relative destination,
// creating destination parents.
func (f *FS) Copy(src, dst string) error {
	srcFull, err := f.resolve(src)
	if err != nil {
		return err
	}
	dstFull, err := f.resolve(dst)
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(srcFull)
	if err != nil {
		return fmt.Errorf("copy %q: %w", src, err)
	}
	if err := os.MkdirAll(filepath.Dir(dstFull), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dstFull, raw, 0o644)
}
