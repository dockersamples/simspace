# Settings and controls

Sometimes you want the learner to change the _environment_ rather than run a
command — enable a feature flag, grant a permission, configure a credential.
**Controls** are toggles that flip a piece of state directly.

## A command gated on a control

Try to deploy the project:

```bash
deploy
```

It's blocked — there's no deploy target configured. The `deploy` scenario is
gated on the `deploy.configured` state value, which is `false` by default.

## Flip the toggle

Open the **Settings** tab (top-right of the right-hand pane, next to the tabs)
and turn on **Configure a deploy target**. That single switch writes
`deploy.configured = true` — no command required.

Now deploy again:

```bash
deploy
```

This time it succeeds. The toggle changed the lab's behavior instantly, and
pressing **Reset** would put it back to its default (off) position.

Controls are perfect for "what changes when this setting is on?" moments — and,
as you'll see in the CI section, the very same toggle can decide whether a
pipeline step passes.
