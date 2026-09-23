// A 60-line element builder, so the UI reads as structure rather than as string
// concatenation — and so nothing here has to be escaped by hand.

/**
 * el("div.card", { onclick }, [children]) builds an element. The tag accepts
 * `tag.class.class` shorthand; `props` sets attributes, `on*` handlers, and
 * `$` for direct property assignment (value, checked, …). Children may be
 * nodes, strings, numbers, or nested arrays; null and false are skipped, so
 * `cond && el(…)` works inline.
 */
export function el(spec, props = {}, children = []) {
  const [tag, ...classes] = String(spec).split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "$") {
      Object.assign(node, value);
    } else if (key === "class") {
      node.className = [node.className, value].filter(Boolean).join(" ");
    } else if (key === "style" && typeof value === "object") {
      Object.assign(node.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }

  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function fill(node, children) {
  clear(node);
  append(node, children);
  return node;
}

/** A labelled field wrapper, the shape every form row in the editor uses. */
export function field(label, control, hint) {
  return el("div", {}, [
    label && el("label", {}, label),
    control,
    hint && el("div.field-hint", {}, hint),
  ]);
}

export function text(value, props = {}) {
  return el("input", { type: "text", ...props, $: { value: value ?? "" } });
}

export function select(options, value, props = {}) {
  const node = el(
    "select",
    props,
    options.map((opt) => {
      const { value: v, label } =
        typeof opt === "string" ? { value: opt, label: opt } : opt;
      return el("option", { value: v }, label ?? v);
    }),
  );
  node.value = value ?? "";
  return node;
}

export function button(label, props = {}) {
  return el("button.btn", { type: "button", ...props }, label);
}

export function iconButton(glyph, title, onclick, extra = "") {
  return el(
    `button.btn-icon${extra ? `.${extra}` : ""}`,
    { type: "button", title, "aria-label": title, onclick },
    glyph,
  );
}

/** A card with a title, an optional action area, and a body. */
export function card(title, body, actions) {
  return el("section.card", {}, [
    el("div.card-head", {}, [
      el("span.card-title", {}, title),
      actions && el("div.row-flex", {}, actions),
    ]),
    el("div.card-body", {}, body),
  ]);
}

export function toast(message, { kind = "", detail = "", ms = 4200 } = {}) {
  const root = document.getElementById("toasts");
  const node = el(`div.toast${kind ? `.toast-${kind}` : ""}`, {}, [
    el("div", {}, message),
    detail && el("div.toast-detail", {}, detail),
  ]);
  root.appendChild(node);
  setTimeout(() => node.remove(), ms);
}

/** Opens a modal and returns a close function. Esc and the backdrop close it. */
export function modal({ title, body, foot, onClose }) {
  const root = document.getElementById("modal-root");
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  const backdrop = el(
    "div.modal-backdrop",
    {
      onclick: (e) => {
        if (e.target === backdrop) close();
      },
    },
    el("div.modal", {}, [
      el("div.modal-head", {}, [
        el("span.modal-title", {}, title),
        iconButton("✕", "Close", close),
      ]),
      el("div.modal-body", {}, body),
      foot && el("div.modal-foot", {}, foot),
    ]),
  );
  root.appendChild(backdrop);
  document.addEventListener("keydown", onKey);
  return close;
}

/**
 * Makes a list's rows draggable. `onMove(from, to)` gets index-to-index moves;
 * rows are identified by their `data-index` attribute.
 */
export function draggable(container, onMove) {
  let from = -1;
  container.addEventListener("dragstart", (e) => {
    const row = e.target.closest("[data-index]");
    if (!row) return;
    from = Number(row.dataset.index);
    row.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    // Firefox needs data set for a drag to start at all.
    e.dataTransfer.setData("text/plain", String(from));
  });
  container.addEventListener("dragend", () => {
    container
      .querySelectorAll(".is-dragging, .is-drop-target")
      .forEach((n) => n.classList.remove("is-dragging", "is-drop-target"));
  });
  container.addEventListener("dragover", (e) => {
    const row = e.target.closest("[data-index]");
    if (!row || from < 0) return;
    e.preventDefault();
    container
      .querySelectorAll(".is-drop-target")
      .forEach((n) => n.classList.remove("is-drop-target"));
    row.classList.add("is-drop-target");
  });
  container.addEventListener("drop", (e) => {
    const row = e.target.closest("[data-index]");
    if (!row || from < 0) return;
    e.preventDefault();
    const to = Number(row.dataset.index);
    if (to !== from) onMove(from, to);
    from = -1;
  });
}

/** Debounces a function, so typing in a field doesn't re-render per keystroke. */
export function debounce(fn, ms = 250) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
