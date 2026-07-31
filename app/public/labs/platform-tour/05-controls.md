# Settings, controls, and secrets

Sometimes you want the learner to change the _environment_ rather than run a
command — enable a feature flag, grant a permission, configure a credential.
**Controls** are toggles that flip a piece of state directly. When the learner
needs to _provide_ a value instead, a command can **prompt for input**.

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

## Prompting for a secret

A control flips state without typing. Sometimes, though, the learner has to
_supply_ a value — a password, a token, an API key. A command declares
`then.input` in its scenario to pause and ask for one. Configure the deploy
target the other way, by command:

```bash
sbx secret set deploy-token
```

The terminal drops into an input prompt. Because the step sets `mask: true`, your
keystrokes render as dots and the value never lands in the saved transcript — so
secrets don't leak into a shared or reloaded session. Type anything and press
**Enter**; the command stores the secret and flips `deploy.configured` on, just
like the toggle did.

Prompts can be multi-step too — ask for a username _and_ a password in sequence —
and the collected values are readable in the response as `{{ input.<key> }}`. To
back out of a prompt without setting anything, type `/cancel`.
