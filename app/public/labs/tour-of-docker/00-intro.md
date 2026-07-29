# Introduction

Welcome! This is a **fully simulated** tour of the Docker toolchain. Every
command you type in the terminal on the right is scripted by the lab author and
runs entirely in your browser — there is no real Docker daemon, registry, agent,
or network behind it.

That means the lab works the same way for everyone, every time, with nothing to
install and no accounts to create.

Over four short sections you'll walk through the workflows Docker developers use
every day:

1. **The Docker CLI** — run a container, inspect it, read its logs, and clean it
   up (plus a quick Compose start/stop).
2. **Docker Scout** — build an image, discover a CVE in a dependency, fix it, and
   confirm the fix.
3. **Docker Sandboxes (`sbx`)** — run an AI agent in an isolated sandbox and
   control exactly what network it can reach.
4. **CI** — build, push, and sign an image from a pipeline, and see what happens
   when credentials are (and aren't) configured.

You'll reuse the same small Node/Express project throughout. To name the
container you'll start in the next section:

::variableDefinition[containerName]{prompt="What should we name the container?"}

Your container will be named **$$containerName$$**.

When you're ready, head to the next section.
