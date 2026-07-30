# Multiple terminals

A lab can show more than one terminal tab. This one has **Terminal** and
**Worker** tabs in the right-hand pane. They're backed by the _same_ simulator —
one shared state tree and one shared filesystem — so they behave like two shells
on a single machine.

## Shared state across tabs

Reset the lab first (right-click the logo → _Reset lab_) so we start clean. Then
build the project from the **Terminal** tab:

```bash terminal-id=main
build
```

Now switch to the **Worker** tab and ask for status — the Run button on this
block targets the Worker for you (note `terminal-id=worker` on the fence):

```bash terminal-id=worker
status
```

The Worker sees `build: ✓ complete` even though you built in the other tab.
State is shared, so what happens in one terminal is visible in all of them.

## Scoping a command to one terminal

Scenarios can also restrict themselves to a specific terminal with
`when.terminal`. The `logs` command only works in the Worker:

```bash terminal-id=worker
logs
```

Try the same command back in the Terminal tab and it's politely turned away:

```bash terminal-id=main
logs
```

This is how you give different tabs different roles (a host shell vs. an agent
session, an app vs. its worker) while still sharing one underlying machine.
