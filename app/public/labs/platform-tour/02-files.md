# The virtual filesystem

Each lab ships with an in-memory filesystem seeded by the author. The built-in
`ls` and `cat` commands reflect it automatically — no scenario required.

## Explore it

```bash
ls
```

```bash
ls src
```

```bash
cat README.md
```

## File links

Instead of asking learners to type `cat`, you can drop a **file link** right into
the prose. Click this one to open the file in the terminal:

:fileLink[src/greeting.js]{path="src/greeting.js"}

That's the `:fileLink` directive — handy for pointing at a specific file mid-explanation.

## Saving files

A code block with a `save-as` target shows a **Save** button instead of a Run
button. It writes the block's contents to the virtual filesystem. Edit the
service config — bump the port and switch the style — then press **Save**:

```yaml save-as=config.yaml
service: greeting-service
port: 8080
style: formal
```

Confirm the change landed:

```bash
cat config.yaml
```

Files written this way are real (for the life of the session) — later commands,
other terminals, and the assistant all see them. Pressing **Reset** restores the
original seed files.
