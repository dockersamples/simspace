# Edit and save a file

The lab ships with a starter file at :filelink[app/server.js]{path="app/server.js"}.
Click it to `cat` the current contents in the terminal.

Let's add a health-check endpoint. Click the **Save** button on the block below
to write it to the virtual filesystem:

```js save-as=app/server.js
const express = require("express");
const app = express();

app.get("/", (_, res) => res.send("Hello from the lab!"));
app.get("/health", (_, res) => res.sendStatus(200));

app.listen(3000, () => console.log("listening on :3000"));
```

Now confirm the file was updated:

```bash
cat app/server.js
```

You can also list the project directory at any time:

```bash
ls app
```

That's the whole loop: read instructions, run scripted commands, and edit files
— all in the browser. 🎉
