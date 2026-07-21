# Work with the agent

This lab has **two terminals** in the right-hand pane: a **Host** shell and an
**Agent** session. They share one machine — the same state and the same
filesystem — so anything one terminal does, the other sees. That lets an
agentic session and host commands run side by side.

Start the agent session. The **Run** button on this block targets the **Agent**
terminal (note the `terminal-id=agent` on the fence). The `claude` command is
scoped to the Agent terminal in the scenario file, so it only starts a session
there:

```bash terminal-id=agent
claude
```

Now ask the agent to scaffold the app. This runs in the **Agent** session and
writes `app/server.js` into the shared filesystem:

```bash terminal-id=agent
scaffold the app
```

Switch over to the **Host** and read the file the agent just wrote. This block
has no `terminal-id`, so it targets the default (Host) terminal — yet it sees
the agent's changes, because the filesystem is shared:

```bash
cat app/server.js
```

State is shared too. Open the **Settings** panel on either terminal and enable
*network access*, then run `curl` from the **Host** — the toggle you flipped in
one terminal unblocks it everywhere:

```bash
curl http://localhost:8080
```

When you're done with the agent, leave the session:

```bash terminal-id=agent
/exit
```
