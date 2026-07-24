# Run an agent in a Sandbox

AI coding agents are powerful — and they run commands, install packages, and
reach the network on your behalf. A **Docker Sandbox** (`sbx`) runs an agent in
an **isolated, ephemeral container** with **no outbound network access** unless
you explicitly allow it. You decide what it can touch.

This lab has a dedicated **Sandbox** terminal tab in the right-hand pane. It
shares the same machine (state and filesystem) as the Host, but the `sbx`
session runs there.

## Start a sandboxed agent

Switch to the **Sandbox** terminal and launch an agent. The **Run** button on
this block targets it (note `terminal-id=sandbox` on the fence):

```bash terminal-id=sandbox
sbx run claude
```

You're now in an interactive agent session running _inside_ the sandbox.

## The default: no network

Ask the agent to reach out to the internet:

```bash terminal-id=sandbox
fetch example.com and tell me what you get
```

The agent tries — and **fails**. The sandbox denies all outbound network by
default, so even a well-meaning agent can't exfiltrate data or pull from a random
host.

## Allow just what's needed

Open the **Settings** tab (next to Reset) and turn on
**Allow sandbox access to example.com**. This adds a network policy scoped to
that single host.

Now ask again:

```bash terminal-id=sandbox
fetch example.com and tell me what you get
```

This time it succeeds with an HTTP 200 — and _only_ example.com is reachable.

## Inspect and clean up

Leave the interactive session (the sandbox keeps running):

```bash terminal-id=sandbox
/exit
```

List your sandboxes and their network policies:

```bash terminal-id=sandbox
sbx ls
```

You'll see `gifted_turing` still running with its `example.com` policy. When
you're done, remove it:

```bash terminal-id=sandbox
sbx rm gifted_turing
```

Run `sbx ls` again and it's gone.

```bash terminal-id=sandbox
sbx ls
```

> The point of a sandbox is **least privilege for agents**: isolated by default,
> disposable, and network access granted host-by-host only when you decide it's
> warranted.
