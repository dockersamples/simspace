// Package workspace executes commands and saves files against the environment
// backing a Labspace. The environment is the in-process web terminal (see
// internal/terminal): commands are submitted to PTY sessions and files are
// written to the terminal's working directory.
package workspace

import (
	"github.com/dockersamples/sbxlab/interface/api/internal/labspace"
	"github.com/dockersamples/sbxlab/interface/api/internal/terminal"
)

// Service performs actions against the developer's workspace.
type Service interface {
	ExecuteCommand(sectionID string, codeBlockIndex int) error
	SaveFile(sectionID string, codeBlockIndex int) (string, error)
	OpenFileInIDE(filePath string, line any) error
}

// SaveError wraps a save failure while carrying the target file name so the
// analytics layer can report it (matches the Node error.fileName convention).
type SaveError struct {
	FileName string
	Err      error
}

func (e *SaveError) Error() string { return e.Err.Error() }
func (e *SaveError) Unwrap() error { return e.Err }

// New builds the workspace service backed by the embedded terminal.
func New(lab *labspace.LabspaceService, term *terminal.Handler) Service {
	return NewTerminalService(lab, term)
}
