package terminal

import (
	"os"
	"os/exec"
	"runtime"
)

// detectShell returns the path to the most appropriate shell for the current OS.
func detectShell() string {
	if runtime.GOOS == "windows" {
		for _, candidate := range []string{"pwsh.exe", "powershell.exe", "cmd.exe"} {
			if path, err := exec.LookPath(candidate); err == nil {
				return path
			}
		}
		return "cmd.exe"
	}

	// Unix: prefer $SHELL, then bash, then sh.
	if shell := os.Getenv("SHELL"); shell != "" {
		if path, err := exec.LookPath(shell); err == nil {
			return path
		}
	}
	for _, candidate := range []string{"bash", "sh"} {
		if path, err := exec.LookPath(candidate); err == nil {
			return path
		}
	}
	return "/bin/sh"
}
