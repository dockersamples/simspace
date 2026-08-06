<!--
layout: section
eyebrow: ""
theme: dark
logo: assets/docker-logo-white.svg
-->

# Let's actually run one

Every command on the next three slides is scripted — and real enough to teach from

Note: Switch to demo mode here. If you're on a projector, hit the pop-out button
on the terminal so it lands on your laptop screen — the deck stays on the big
screen. The reset button next to it re-seeds the demo if you rehearsed earlier.

---

<!--
layout: split
eyebrow: The Docker CLI
-->

# Start a container

<!-- region -->

One command pulls the image, creates the container, and publishes the port.

```bash terminal-id=demo
docker run -d --name $$containerName$$ -p 8080:80 nginx
```

:::card{label="What just happened" accent=blue}
No local image, so Docker pulled it, then started a container from it and mapped
port 8080 on your machine to port 80 inside.
:::

<!-- region -->

::terminal{id=demo height=300}

Note: Click Run rather than typing — the output is paced deliberately and typing
races it. Call out the three phases as they stream: no local image, pull, then
the container id.

---

<!--
layout: split
eyebrow: The Docker CLI
-->

# It's really running

<!-- region -->

:::fragment
The port mapping is the part worth pointing at: `0.0.0.0:8080->80/tcp`.
:::

```bash terminal-id=demo
docker ps
```

<!-- region -->

::terminal{id=demo height=300}

Note: The container from the previous slide is still running — state carries
across slides, because every terminal in the deck shares one simulated machine.
Reveal the fragment after they've read the table.

---

<!--
layout: split
eyebrow: The Docker CLI
-->

# And it serves traffic

<!-- region -->

```bash terminal-id=demo
curl localhost:8080
```

:::card{label="Try it yourself" accent=blue}
This is the moment the abstraction stops being abstract — it's just a web server,
in a container, on a port.
:::

<!-- region -->

::terminal{id=demo height=320}

Note: This is the "oh, it's just a web server" moment. Then stop the container so
you leave the machine clean for the next run-through: `docker stop web` — you can
type that one into the terminal directly.

---

<!--
layout: default
eyebrow: Platform comparison
-->

# Docker Desktop vs. raw Docker Engine

| Capability                  | Docker Engine | Docker Desktop |
| --------------------------- | ------------- | -------------- |
| GUI + Dev Environments UI   | —             | Yes            |
| Docker Build Cloud          | Manual        | Built-in       |
| Docker Scout dashboard      | —             | Yes            |
| Admin policy controls (SSO) | —             | Business       |
| MicroVM sandboxing          | —             | Yes            |
| Testcontainers support      | Partial       | Full           |

Note: Don't read the table. Say "Desktop is Engine plus the things a team needs"
and let them scan it.
