# Welcome to the Labspace Feature Tour

This lab is a bit meta: it's a **working demonstration of the Labspace platform
itself**. Where the _Tour of Docker_ lab is an applied example, this one is
living documentation — every section shows off a different capability you can use
when authoring your own labs.

Everything runs **entirely in your browser**. There's no server, no real shell,
and no network calls. Each command you type on the right is matched to
author-scripted output, so the lab behaves identically for everyone, every time.

## Try it: variables

Labspace can prompt the learner for a value and substitute it anywhere in the
content. Set your name below (type it, then press **Set**):

::variableDefinition[name]{prompt="What should we call you?"}

:::conditionalDisplay{variable="name" hasValue="true"}
Nice to meet you, **$$name$$**! Notice how that value appeared in this sentence
the moment you set it — that's `$$name$$` substitution happening at render time.
:::

:::conditionalDisplay{variable="name" hasNoValue="true"}
Once you set a value above, it will appear right here in the text — this whole
paragraph is hidden until then.
:::

Now run a command that uses it. Press the **Run** button on this block (it types
the command into the terminal and executes it):

```bash
greet $$name$$
```

The name you set is filled into the command _before_ it runs. If you skipped it,
you'll just get a friendly nudge — try setting a name and running it again.

## What's ahead

| Section                | Feature                                        |
| ---------------------- | ---------------------------------------------- |
| Running commands       | Scripted commands, shared state, output pacing |
| The virtual filesystem | `ls` / `cat`, file links, saving files         |
| Interactive content    | Buttons, conditional content, OS detection     |
| Multiple terminals     | Two shells, one shared machine                 |
| Settings and controls  | Toggles that change behavior                   |
| The assistant          | An interactive, scripted agent session         |
| CI pipelines           | A mock GitHub-Actions-style pipeline           |

Head to the next section when you're ready.
