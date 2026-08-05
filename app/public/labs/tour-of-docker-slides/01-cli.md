# Let's actually run one

Note: Switch to demo mode here. If you're on a projector, hit the pop-out button
on the terminal so it lands on your laptop screen — the deck stays on the big
screen. The reset button next to it re-seeds the demo if you rehearsed earlier.

---

## Start a container

```bash terminal-id=demo
docker run -d --name $$containerName$$ -p 8080:80 nginx
```

::terminal{id=demo height=300}

Note: Click Run rather than typing — the output is paced deliberately and typing
races it. Call out the three phases as they stream: no local image, pull, then
the container id.

---

## It's really running

```bash terminal-id=demo
docker ps
```

:::fragment
The port mapping is the part worth pointing at: `0.0.0.0:8080->80/tcp`.
:::

::terminal{id=demo height=280}

Note: The container from the previous slide is still running — state carries
across slides, because every terminal in the deck shares one simulated machine.
Reveal the fragment after they've read the table.

---

## And it serves traffic

```bash terminal-id=demo
curl localhost:8080
```

::terminal{id=demo height=300}

Note: This is the "oh, it's just a web server" moment. Then stop the container so
you leave the machine clean for the next run-through:
`docker stop web` — you can type that one into the terminal directly.
