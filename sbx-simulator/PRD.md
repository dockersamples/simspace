# Product Requirements Document
# SBX Simulator

**Status:** Draft  
**Author:** Michael Irwin  
**Audience:** Product Leadership, Engineering, Developer Relations, Solutions Engineering

---

# Executive Summary

Docker Sandboxes is becoming an increasingly important part of Docker's developer experience. As adoption grows, so does the need for high-quality educational content that is reliable, repeatable, and easy to author.

Today, interactive Sandboxes labs are difficult to build because they depend on production infrastructure including AI providers, API keys, Docker Hub organizations, governance settings, and specific versions of the SBX CLI.

This proposal introduces the **SBX Simulator**, a drop-in replacement for the `sbx` CLI designed specifically for educational environments.

Rather than interacting with production infrastructure, the simulator provides deterministic responses that teach Docker Sandboxes workflows while integrating seamlessly with the existing Labspaces platform.

This approach allows Docker to build high-quality interactive labs without requiring learners to configure AI providers, enterprise organizations, or production Sandboxes.

---

# Problem Statement

Current Docker Sandboxes labs face several challenges.

## External AI Dependencies

Many workflows require:

- AI API keys
- Provider accounts
- Available usage quota
- Corporate approval

These dependencies prevent many learners from completing labs.

---

## Environment Variability

Production SBX depends on the learner's local environment.

Examples include:

- Different SBX versions
- Missing dependencies
- Operating system differences
- Network availability

These variables create inconsistent educational experiences.

---

## Organizational Requirements

Many governance features require:

- Docker Hub organizations
- Administrative permissions
- Organization configuration

These requirements make important product workflows inaccessible to many learners.

---

## Non-Deterministic AI Behavior

AI responses vary.

Prompts take different amounts of time.

Results differ.

Provider outages occur.

These characteristics are appropriate for production but reduce the quality of guided learning experiences.

---

## Authoring Complexity

Authors currently spend significant effort working around infrastructure rather than creating educational content.

---

# Vision

Provide a simulated implementation of the Docker Sandboxes CLI that enables deterministic educational experiences while integrating with the existing Labspaces platform.

The simulator should teach workflows rather than production infrastructure.

---

# Goals

## Deterministic Learning

Every learner should receive the same experience.

---

## Remove Infrastructure Requirements

Learners should not require:

- AI providers
- API keys
- Docker Hub organizations
- Administrative permissions

---

## Reuse Existing Infrastructure

Leverage Labspaces for:

- Browser UI
- Split-pane interface
- Terminal
- Authoring workflow
- Hot reload

The simulator should focus exclusively on SBX behavior.

---

## Simple Authoring

Authors should describe workflows rather than simulator implementation.

---

## Educational First

Teach:

- SBX CLI usage
- Agent workflows
- Governance
- MCP
- AI-assisted development

rather than production implementation details.

---

# Non-Goals

The SBX Simulator is not intended to:

- Replace Docker Sandboxes
- Execute real AI models
- Communicate with Docker Hub
- Benchmark AI providers
- Perfectly emulate production behavior
- Replace Labspaces

---

# Proposed Solution

The project delivers a simulated `sbx` binary.

The binary:

- Parses SBX commands
- Maintains runtime state
- Simulates Sandbox behavior
- Simulates governance
- Simulates MCP interactions
- Simulates interactive agent sessions
- Modifies project files
- Produces realistic CLI output

Labspaces provides the surrounding educational experience.

## Agentic Workloads

Because Docker Sandboxes is fundamentally a wrapper that launches agentic
workloads, the simulator reproduces that experience. Starting a sandbox with
`sbx run` also starts an agent and can drop the learner into an interactive
session where they converse with a simulated agent: typing prompts, watching
responses stream back, and seeing the agent modify project files and call MCP
tools — all deterministically scripted, with no real LLM.

The same scripted prompts also work non-interactively (`sbx run -p "..."`) so
labs can run a single agent turn when a full session is not needed. This lets
labs teach the core Sandboxes value proposition — AI-assisted development
inside a governed sandbox — without any AI dependency.

---

# Success Metrics

- Reduced setup failures
- Faster lab creation
- Increased number of published labs
- Improved learner completion rates
- Increased enablement content

---

# Risks

## Product Drift

Simulator workflows may become outdated.

**Mitigation**

Version the simulator independently and update workflows alongside significant SBX releases.

---

## Incorrect Expectations

Learners may confuse simulated behavior with production.

**Mitigation**

Clearly identify all labs as running within a simulated environment.

---

# Future Opportunities

Potential future uses include:

- Interactive documentation
- Embedded tutorials
- Certification environments
- Sales demonstrations

These opportunities are intentionally outside the scope of the initial implementation.
