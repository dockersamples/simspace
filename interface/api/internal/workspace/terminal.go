package workspace

import (
	"fmt"

	"github.com/dockersamples/sbxlab/interface/api/internal/labspace"
	"github.com/dockersamples/sbxlab/interface/api/internal/terminal"
)

// TerminalService drives the in-process web terminal directly (no HTTP hop):
// it submits code-block commands to PTY sessions and writes code-block files to
// the terminal's working directory.
type TerminalService struct {
	lab      *labspace.LabspaceService
	terminal *terminal.Handler
}

// NewTerminalService builds a workspace service backed by the embedded terminal.
func NewTerminalService(lab *labspace.LabspaceService, term *terminal.Handler) *TerminalService {
	return &TerminalService{lab: lab, terminal: term}
}

// ExecuteCommand submits the code block's command to the target terminal session.
func (s *TerminalService) ExecuteCommand(sectionID string, codeBlockIndex int) error {
	block, err := s.lab.GetCodeBlock(sectionID, codeBlockIndex)
	if err != nil {
		return err
	}
	if err := s.terminal.SubmitCommand(block.Meta["terminal-id"], block.Code); err != nil {
		return fmt.Errorf("failed to execute command: %w", err)
	}
	return nil
}

// SaveFile writes the code block's contents to the file named in its metadata.
func (s *TerminalService) SaveFile(sectionID string, codeBlockIndex int) (string, error) {
	block, err := s.lab.GetCodeBlock(sectionID, codeBlockIndex)
	if err != nil {
		return "", err
	}
	fileName := block.Meta["save-as"]
	if fileName == "" {
		return "", fmt.Errorf("code block is missing 'save-as' metadata")
	}
	if err := s.terminal.SaveFile(fileName, block.Code); err != nil {
		return "", &SaveError{FileName: fileName, Err: fmt.Errorf("failed to save file: %w", err)}
	}
	return fileName, nil
}

// OpenFileInIDE has no meaningful equivalent in a raw terminal; succeed silently.
func (s *TerminalService) OpenFileInIDE(_ string, _ any) error { return nil }
