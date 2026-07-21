# Run a container

Start a simulated nginx container. Click the **Run** button on the code block
below (or type it into the terminal yourself):

```bash
docker run --name $$containerName$$ -d -p 8080:80 nginx
```

Confirm it's running:

```bash
docker ps
```

Now try reaching it with `curl`. By default the network is blocked — open the
**Settings** panel in the terminal header and enable *network access*, then run:

```bash
curl http://localhost:8080
```

When you're done, stop the container:

```bash
docker stop $$containerName$$
```
