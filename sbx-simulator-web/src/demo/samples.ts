// Sample labs for the demo app, adapted from the CLI's testdata/labs.

export interface Sample {
  name: string;
  spec: string;
  files?: Record<string, string>;
}

const interactiveAgent = `version: "1.1"

metadata:
  id: interactive-agent
  title: "Working with the Agent"
  summary: "Start a sandbox, drop into an agent session, and ask the agent to build features."
  authors: ["Michael Irwin"]

state:
  sandbox:
    running: false
  app:
    hasHealth: false
    hasTests: false
  phase: start

defaults:
  unmatchedAgent:
    output:
      - "Agent: I can add a /health endpoint or add tests. Try asking for one of those."

scenarios:
  - id: run
    when:
      command: run
      state: { sandbox.running: false }
    then:
      output:
        - "Starting sandbox..."
        - "Sandbox is running. Launching agent..."
      state:
        sandbox.running: true
        phase: session
      session:
        prompt: "agent> "
        intro:
          - "Agent ready. Ask me to build something into app/server.js."
          - 'Try: "add a health endpoint" or "add tests". Type /exit to quit.'
        outro:
          - "Agent session ended. The sandbox is still running."

  - id: agent-add-health
    when:
      agent: true
      promptContains: [health]
      state: { app.hasHealth: false }
    then:
      output:
        - "Agent: Adding a GET /health endpoint that returns 200..."
      files:
        - append: "app/server.js"
          content: "app.get('/health', (_, res) => res.sendStatus(200));\\n"
      state:
        app.hasHealth: true

  - id: agent-health-exists
    when:
      agent: true
      promptContains: [health]
      state: { app.hasHealth: true }
    then:
      output:
        - "Agent: The /health endpoint is already in app/server.js."

  - id: agent-add-tests
    when:
      agent: true
      promptContains: [test]
      state: { app.hasTests: false }
    then:
      output:
        - "Agent: Adding a test file at app/server.test.js..."
      files:
        - create: "app/server.test.js"
          content: |
            const request = require('supertest');
            // TODO: import the app and assert on routes
      state:
        app.hasTests: true

  - id: agent-tests-exist
    when:
      agent: true
      promptContains: [test]
      state: { app.hasTests: true }
    then:
      output:
        - "Agent: Tests already exist at app/server.test.js."

  # Shell-mode (!cmd) scenarios: scripted output for shell escapes typed in the
  # session. Exact match on the command after the "!".
  - id: shell-cat-server
    when:
      shell: true
      prompt: "cat app/server.js"
    then:
      output:
        - "const express = require('express');"
        - "const app = express();"
        - "app.get('/', (_, res) => res.send('hello'));"
        - "app.listen(3000);"

  - id: shell-ls
    when:
      shell: true
      promptContains: [ls]
    then:
      output:
        - "server.js"
`;

const sandboxLifecycle = `version: "1.1"

metadata:
  id: sandbox-lifecycle
  title: "Sandbox Lifecycle"
  summary: "Start, inspect, and stop a Docker Sandbox."
  authors: ["Michael Irwin"]

state:
  sandbox:
    running: false
  phase: start

defaults:
  unmatched:
    stderr: ["Error: that command isn't part of this lab yet."]
    exit: 1

scenarios:
  - id: run-start
    when:
      command: run
      state: { sandbox.running: false }
    then:
      state:
        sandbox.running: true
        phase: running
      output:
        - "Starting sandbox..."
        - "Sandbox is running. View logs with: sbx logs"

  - id: run-already
    when:
      command: run
      state: { sandbox.running: true }
    then:
      stderr: ["Error: a sandbox is already running."]
      exit: 1

  - id: status-running
    when:
      command: status
      state: { sandbox.running: true }
    then:
      output:
        - "NAME    STATE     UPTIME"
        - "web     running   0m2s"

  - id: status-stopped
    when:
      command: status
      state: { sandbox.running: false }
    then:
      output: ["No sandbox is running."]

  - id: logs
    when:
      command: logs
      state: { sandbox.running: true }
    then:
      output: ["[sim] sandbox started"]

  - id: stop
    when:
      command: stop
      state: { sandbox.running: true }
    then:
      state:
        sandbox.running: false
        phase: done
      output: ["Sandbox stopped."]
`;

export const SAMPLES: Sample[] = [
  {
    name: "Interactive Agent",
    spec: interactiveAgent,
    files: {
      "app/server.js": `const express = require('express');
const app = express();
app.get('/', (_, res) => res.send('hello'));
app.listen(3000);
`,
    },
  },
  {
    name: "Sandbox Lifecycle",
    spec: sandboxLifecycle,
  },
];
