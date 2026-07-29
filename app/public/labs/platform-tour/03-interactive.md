# Interactive content

Beyond commands, section markdown has a small set of interactive directives for
building guided, adaptive instructions.

## Set-a-value buttons

A `:variableSetButton` sets one or more variables to fixed values in a single
click — great for offering choices. Pick a greeting style:

:variableSetButton[Use the friendly style]{variables="style=friendly"}
:variableSetButton[Use the formal style]{variables="style=formal"}

The button shows a checkmark when its value is already active.

## Content that reacts to variables

The `:conditionalDisplay` directive shows or hides a block based on a variable's
value. Your current style is **$$style$$**, so:

:::conditionalDisplay{variable="style" requiredValue="friendly"}
> 👋 **Friendly mode.** Greetings will look like `Hey there!` — casual and warm.
:::

:::conditionalDisplay{variable="style" requiredValue="formal"}
> 🎩 **Formal mode.** Greetings will look like `Good day.` — buttoned-up and polite.
:::

Click the other style button above and watch this section swap — no reload, no
command.

## Content that reacts to the operating system

`:conditionalDisplay` can also branch on the learner's OS, so you can show the
right command for their platform:

:::conditionalDisplay{os="unix"}
You're on **macOS or Linux**, so a path would look like `~/projects/greeting`.
:::

:::conditionalDisplay{os="windows"}
You're on **Windows**, so a path would look like `C:\Users\you\greeting`.
:::

Together, variables and conditionals let one markdown file adapt to each learner.
