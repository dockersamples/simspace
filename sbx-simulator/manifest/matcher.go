package manifest

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// CommandPath is the subcommand token path a scenario matches. It accepts
// either a space-joined scalar ("policy allow network") or a YAML sequence
// ([policy, allow, network]); both decode to the same token slice.
type CommandPath []string

// UnmarshalYAML implements the scalar-or-sequence forms documented in §6.1.
func (c *CommandPath) UnmarshalYAML(value *yaml.Node) error {
	switch value.Kind {
	case yaml.ScalarNode:
		*c = splitTokens(value.Value)
		return nil
	case yaml.SequenceNode:
		var tokens []string
		if err := value.Decode(&tokens); err != nil {
			return fmt.Errorf("command sequence: %w", err)
		}
		*c = tokens
		return nil
	default:
		return fmt.Errorf("command must be a string or list, got %v", value.Kind)
	}
}

func splitTokens(s string) []string {
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return nil
	}
	return fields
}

// MatcherKind enumerates how an argument value is tested.
type MatcherKind int

const (
	// MatchEquals: the arg is present and its value equals Value.
	MatchEquals MatcherKind = iota
	// MatchPresent: the flag/arg is present (any value).
	MatchPresent
	// MatchAbsent: the flag/arg is not present.
	MatchAbsent
	// MatchAny: the arg is present with any value (and is captured).
	MatchAny
	// MatchOneOf: the arg is present and its value is one of OneOf.
	MatchOneOf
)

// Matcher tests a single command argument. Its YAML form is one of:
//
//	name: "web"          # MatchEquals
//	publish: true        # MatchPresent
//	detach: false        # MatchAbsent
//	region: {any: true}  # MatchAny
//	count: {oneOf: [1,2]} # MatchOneOf
type Matcher struct {
	Kind  MatcherKind
	Value string
	OneOf []string
}

// matcherObject is the mapping form of a Matcher.
type matcherObject struct {
	Any   *bool    `yaml:"any"`
	OneOf []string `yaml:"oneOf"`
}

// UnmarshalYAML decodes the scalar and mapping forms described above. Command
// arguments are always strings, so scalar values are captured as their literal
// text.
func (m *Matcher) UnmarshalYAML(value *yaml.Node) error {
	switch value.Kind {
	case yaml.ScalarNode:
		if value.Tag == "!!bool" {
			var b bool
			if err := value.Decode(&b); err != nil {
				return err
			}
			if b {
				m.Kind = MatchPresent
			} else {
				m.Kind = MatchAbsent
			}
			return nil
		}
		m.Kind = MatchEquals
		m.Value = value.Value
		return nil
	case yaml.MappingNode:
		var obj matcherObject
		if err := value.Decode(&obj); err != nil {
			return fmt.Errorf("arg matcher: %w", err)
		}
		switch {
		case obj.Any != nil && *obj.Any:
			m.Kind = MatchAny
		case len(obj.OneOf) > 0:
			m.Kind = MatchOneOf
			m.OneOf = obj.OneOf
		default:
			return fmt.Errorf("arg matcher must set `any: true` or a non-empty `oneOf`")
		}
		return nil
	default:
		return fmt.Errorf("arg matcher must be a scalar or mapping, got %v", value.Kind)
	}
}
