# The Docker CLI

The everyday Docker workflow is a tight loop: **run** a container, check it's
**up**, read its **logs**, then **clean it up**. Let's walk the whole loop with a
web server.

## Run a container

Start a simulated nginx container in the background, publishing port 8080:

```bash
docker run --name $$containerName$$ -d -p 8080:80 nginx
```

Docker pulls the image (it isn't cached yet) and prints the new container's ID.

## See it running

List the running containers:

```bash
docker ps
```

You'll see **$$containerName$$** with a status of _Up_ and its published port.

## Read the logs

Anything the container writes to stdout/stderr is captured. Tail the logs:

```bash
docker logs $$containerName$$
```

## Clean up

Containers are cheap and disposable. Stop it first:

```bash
docker stop $$containerName$$
```

> Try `docker rm $$containerName$$` **before** stopping it — Docker refuses to
> remove a running container. Stop it first, then remove it.

Now remove it:

```bash
docker rm $$containerName$$
```

Run `docker ps` again and the list is empty.

## Bonus: Docker Compose

A single `docker run` is fine for one container, but real apps have several.
**Compose** describes them all in one file — this lab ships a
:filelink[compose.yaml]{path="compose.yaml"} with a `web` service and a `redis`
service. Start the whole stack:

```bash
docker compose up -d
```

Check what's running:

```bash
docker compose ps
```

And tear it all down — containers and network — in one command:

```bash
docker compose down
```

That's the core container lifecycle. Next, let's look at what's _inside_ an
image with Docker Scout.
