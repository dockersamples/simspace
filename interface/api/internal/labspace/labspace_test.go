package labspace

import (
	"reflect"
	"testing"
)

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Getting Started":   "getting-started",
		"Hello, World!":     "hello-world",
		"Build & Run":       "build-run",
		"UPPER Case":        "upper-case",
		"already-a-slug":    "already-a-slug",
		"Multiple   Spaces": "multiple-spaces",
		"Trim me ":          "trim-me-",
		"Números 123":       "nmeros-123",
	}
	for input, want := range cases {
		if got := slugify(input); got != want {
			t.Errorf("slugify(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSubstituteVariables(t *testing.T) {
	vars := map[string]any{
		"name":  "Docker",
		"port":  3000,
		"empty": "",
		"null":  nil,
	}
	cases := []struct {
		in, want string
	}{
		{"Hello $$name$$", "Hello Docker"},
		{"Port is $$port$$", "Port is 3000"},
		{"Value: $$empty$$", "Value: "},
		{"Missing $$unknown$$ here", "Missing unknown here"},
		{"Null $$null$$ value", "Null null value"},       // null → falls back to key name
		{"Trim $$ name $$", "Trim Docker"},               // key is trimmed
		{"Escaped \\$\\$name\\$\\$", "Escaped $$name$$"}, // \$\$ renders literally
	}
	for _, c := range cases {
		if got := substituteVariables(c.in, vars); got != c.want {
			t.Errorf("substituteVariables(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestParseCodeBlock(t *testing.T) {
	content := "Intro text\n" +
		"```bash terminal-id=main\n" +
		"echo hello\n" +
		"echo world\n" +
		"```\n" +
		"Between blocks\n" +
		"```yaml save-as=compose.yaml\n" +
		"  services:\n" +
		"    web:\n" +
		"      image: nginx\n" +
		"```\n"

	first, err := parseCodeBlock(content, 0, "s")
	if err != nil {
		t.Fatalf("index 0: %v", err)
	}
	if first.Language != "bash" {
		t.Errorf("language = %q, want bash", first.Language)
	}
	if first.Meta["terminal-id"] != "main" {
		t.Errorf("meta terminal-id = %q, want main", first.Meta["terminal-id"])
	}
	if first.Code != "echo hello\necho world" {
		t.Errorf("code = %q", first.Code)
	}

	// Second block is indented; dedent should strip the leading 2 spaces of the
	// first line consistently across all lines.
	second, err := parseCodeBlock(content, 1, "s")
	if err != nil {
		t.Fatalf("index 1: %v", err)
	}
	if second.Language != "yaml" {
		t.Errorf("language = %q, want yaml", second.Language)
	}
	if second.Meta["save-as"] != "compose.yaml" {
		t.Errorf("meta save-as = %q, want compose.yaml", second.Meta["save-as"])
	}
	wantCode := "services:\n  web:\n    image: nginx"
	if second.Code != wantCode {
		t.Errorf("code = %q, want %q", second.Code, wantCode)
	}

	if _, err := parseCodeBlock(content, 5, "s"); err == nil {
		t.Error("expected error for out-of-range index")
	}
}

func TestParseCodeBlockMetaWithoutValue(t *testing.T) {
	content := "```sh copy\ndocker ps\n```\n"
	block, err := parseCodeBlock(content, 0, "s")
	if err != nil {
		t.Fatal(err)
	}
	if block.Meta["copy"] != "true" {
		t.Errorf("meta copy = %q, want true", block.Meta["copy"])
	}
	if !reflect.DeepEqual(block.Meta, map[string]string{"copy": "true"}) {
		t.Errorf("meta = %v", block.Meta)
	}
}
