package commands

import (
	"reflect"
	"testing"
)

func TestParse(t *testing.T) {
	tests := []struct {
		name       string
		args       []string
		wantTokens []string
		wantFlags  map[string]string
		wantLine   string
	}{
		{
			name:       "bare subcommand",
			args:       []string{"run"},
			wantTokens: []string{"run"},
			wantFlags:  map[string]string{},
			wantLine:   "sbx run",
		},
		{
			name:       "subcommand with positional",
			args:       []string{"run", "web"},
			wantTokens: []string{"run", "web"},
			wantFlags:  map[string]string{},
			wantLine:   "sbx run web",
		},
		{
			name:       "flag with value via next token",
			args:       []string{"ports", "web", "--publish", "8080:8080/tcp"},
			wantTokens: []string{"ports", "web"},
			wantFlags:  map[string]string{"publish": "8080:8080/tcp"},
		},
		{
			name:       "flag with value via equals",
			args:       []string{"run", "--name=web"},
			wantTokens: []string{"run"},
			wantFlags:  map[string]string{"name": "web"},
		},
		{
			name:       "boolean flag at end",
			args:       []string{"run", "web", "--detach"},
			wantTokens: []string{"run", "web"},
			wantFlags:  map[string]string{"detach": ""},
		},
		{
			name:       "short boolean flag before another flag",
			args:       []string{"run", "-d", "--name=web"},
			wantTokens: []string{"run"},
			wantFlags:  map[string]string{"d": "", "name": "web"},
		},
		{
			name:       "nested subcommand path with positional",
			args:       []string{"policy", "allow", "network", "example.com"},
			wantTokens: []string{"policy", "allow", "network", "example.com"},
			wantFlags:  map[string]string{},
		},
		{
			name:       "agent prompt as single quoted arg",
			args:       []string{"agent", "run", "Add a /health endpoint"},
			wantTokens: []string{"agent", "run", "Add a /health endpoint"},
			wantFlags:  map[string]string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Parse(tt.args)
			if !reflect.DeepEqual(got.Tokens, tt.wantTokens) {
				t.Errorf("Tokens = %#v; want %#v", got.Tokens, tt.wantTokens)
			}
			if !reflect.DeepEqual(got.Flags, tt.wantFlags) {
				t.Errorf("Flags = %#v; want %#v", got.Flags, tt.wantFlags)
			}
			if tt.wantLine != "" && got.Line != tt.wantLine {
				t.Errorf("Line = %q; want %q", got.Line, tt.wantLine)
			}
		})
	}
}
