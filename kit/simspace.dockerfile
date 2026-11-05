# syntax=docker/dockerfile:1
# The kit's content: the three authoring skills, and nothing else. A mixin is an
# overlay, so this is FROM scratch and lands on whatever base the sandbox runs.
#
# The skills sit under a kit-specific prefix, deliberately NOT under
# ~/.claude/skills. The runtime assembles the agent's discovery directories from
# the agent-skill@1 entries in simspace.yaml, and a skill already present at the
# destination is a conflict rather than something to overwrite. v2 dropped these
# straight into /home/agent/.claude/skills via files/home/; v3 declares them.
FROM scratch
COPY skills/authoring-lab /usr/share/simspace-authoring/skills/authoring-lab
COPY skills/authoring-slidedeck /usr/share/simspace-authoring/skills/authoring-slidedeck
COPY skills/importing-slidedeck /usr/share/simspace-authoring/skills/importing-slidedeck
