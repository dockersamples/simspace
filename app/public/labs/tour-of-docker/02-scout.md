# Find and fix a CVE with Scout

Shipping an image means shipping everything inside it — including your
dependencies and their known vulnerabilities. **Docker Scout** analyzes an image
and tells you exactly what's in it and what needs attention.

Our project is a tiny Express app. Take a look at what it depends on:

:filelink[package.json]{path="package.json"}

## Build the image

Scout analyzes a built image, so build one first:

```bash
docker build -t scout-demo .
```

## Analyze it

Now ask Scout what's inside:

```bash
docker scout cves scout-demo
```

Scout finds one **MEDIUM** vulnerability — **CVE-2024-29041** in `express@4.17.1`,
fixed in `4.19.2`. Ask Scout how to resolve it:

```bash
docker scout recommendations scout-demo
```

It recommends upgrading Express to `4.19.2`.

## Fix it

Apply the recommended upgrade. This updates
:filelink[package.json]{path="package.json"} for you:

```bash
npm install express@4.19.2
```

Confirm the version changed:

```bash
cat package.json
```

## Rebuild and re-scan

The fix only lands in the image once you rebuild it:

```bash
docker build -t scout-demo .
```

Now re-run the analysis:

```bash
docker scout cves scout-demo
```

This time Scout reports **0 vulnerabilities** — _no vulnerable packages
detected_. 🎉

> That's the Scout loop: **build → analyze → fix → rebuild → confirm**. In a real
> project you'd wire `docker scout` into CI so regressions get caught before they
> ship — which is exactly where we're headed in the last section.
