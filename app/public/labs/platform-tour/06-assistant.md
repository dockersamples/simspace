# The assistant

Labs can drop the learner into an **interactive agent session** — a REPL where
each thing they type is matched against agent scenarios. It's fully scripted (no
real model), so it's deterministic like everything else.

## Start a session

```bash terminal-id=main
assistant
```

You're now at an `assistant>` prompt. The banner and intro lines are defined by
the author. The session ends on `/exit`.

## Ask it to do something

Each prompt is matched by keyword. Ask the assistant to add a health check —
type this into the `assistant>` prompt (or use the Run button):

```text terminal-id=main
add a health check to the greeting service
```

It reports what it's doing and actually edits `src/greeting.js` in the shared
filesystem. You can run a normal command _without leaving the session_ by
prefixing it with `!`. Verify the edit:

```text terminal-id=main
!cat src/greeting.js
```

There's a new `health()` function, exported alongside `greet()`. Ask again and
it'll notice the work is already done.

## It has some personality, too

```text terminal-id=main
tell me a joke
```

Anything the author didn't script falls through to a friendly "I don't know how
to help with that" reply. When you're finished, leave the session:

```text terminal-id=main
/exit
```

> Tip: authors can also run a **one-shot** turn without entering the REPL by
> passing `-p "<prompt>"` to the command that starts the session.
