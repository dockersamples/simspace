# Running commands

Every command is matched against a list of **scenarios** the author wrote. The
first scenario whose conditions match the command _and_ the current state wins,
and its scripted output is printed. No real programs run.

## State makes commands feel real

Scenarios read and write a shared **state tree**, so the lab can respond
differently depending on what you've already done. Build the project:

```bash
build
```

Notice the output arrives with small pauses — authors can **pace** output so a
build or a test _feels_ like work is happening. It's cosmetic only; the text is
always the same.

Now that a build exists, tests will run. Try it:

```bash
test
```

## Order matters

Scenarios are gated on state, so the lab can enforce a sensible order. Press
**Reset** (right-click the logo in the top-left → _Reset lab_), then try to test
_before_ building:

```bash
test
```

You'll get an error and a non-zero exit code, because the "test before build"
scenario matched first. Build, then test, and it passes again.

## Inspecting state

The `status` command reports what the lab currently knows:

```bash
status
```

Run it before and after a `build` to watch the state change. In the next
sections you'll see this same state shared across files, terminals, and even a CI
pipeline.
