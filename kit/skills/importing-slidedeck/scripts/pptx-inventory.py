#!/usr/bin/env python3
"""Dump the structure of a .pptx so a deck can be rebuilt, not photographed.

A .pptx is a zip of XML. Every shape carries its own geometry, its placeholder
role, its text with run-level formatting, and (via the slide layout it was
built from) a human-authored layout name like "Two Content" or "Section
Header". That is far more than a screenshot tells you, and it's what makes a
faithful import possible.

Standard library only — no pip install, works wherever python3 does.

    python3 pptx-inventory.py deck.pptx                     # digest to stdout
    python3 pptx-inventory.py deck.pptx -o inventory.json   # + full JSON
    python3 pptx-inventory.py deck.pptx --media assets/     # + extract images

Geometry is reported as a fraction of the slide (x=0.5 is the horizontal
centre), so the numbers mean the same thing on a 4:3 deck and a 16:9 one.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import zipfile
from collections import defaultdict
from xml.etree import ElementTree as ET

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
RELS = "http://schemas.openxmlformats.org/package/2006/relationships"

NS = {"a": A, "p": P, "r": R}
EMU_PER_PT = 12700


def q(ns, tag):
    return f"{{{ns}}}{tag}"


# ---------------------------------------------------------------- packaging


def rels_path_for(part):
    d, name = os.path.split(part)
    return f"{d}/_rels/{name}.rels"


def load_rels(zf, part):
    """Relationship id -> normalised part path, for one part."""
    path = rels_path_for(part)
    if path not in zf.namelist():
        return {}
    root = ET.fromstring(zf.read(path))
    base = os.path.dirname(part)
    out = {}
    for rel in root.findall(q(RELS, "Relationship")):
        target = rel.get("Target", "")
        if rel.get("TargetMode") == "External" or target.startswith("http"):
            out[rel.get("Id")] = target
        else:
            out[rel.get("Id")] = os.path.normpath(os.path.join(base, target)).replace(
                os.sep, "/"
            )
    return out


def slide_parts_in_order(zf):
    """Slides in presentation order, with each one's `show` flag."""
    pres = ET.fromstring(zf.read("ppt/presentation.xml"))
    rels = load_rels(zf, "ppt/presentation.xml")
    out = []
    lst = pres.find(q(P, "sldIdLst"))
    for sld in [] if lst is None else lst.findall(q(P, "sldId")):
        rid = sld.get(q(R, "id"))
        if rid in rels:
            out.append(rels[rid])
    return out


def slide_size(zf):
    pres = ET.fromstring(zf.read("ppt/presentation.xml"))
    sz = pres.find(q(P, "sldSz"))
    if sz is None:
        return 12192000, 6858000
    return int(sz.get("cx")), int(sz.get("cy"))


# ------------------------------------------------------------------- shapes


def ph_info(sp):
    """(placeholder type, idx) for a shape, or (None, None) if it isn't one."""
    ph = sp.find(f"./{q(P, 'nvSpPr')}/{q(P, 'nvPr')}/{q(P, 'ph')}")
    if ph is None:
        ph = sp.find(f"./{q(P, 'nvPicPr')}/{q(P, 'nvPr')}/{q(P, 'ph')}")
    if ph is None:
        return None, None
    # A placeholder with no explicit type is a body placeholder.
    return ph.get("type", "body"), ph.get("idx")


def xfrm_of(sp):
    x = sp.find(f"./{q(P, 'spPr')}/{q(A, 'xfrm')}")
    if x is None:
        x = sp.find(f"./{q(P, 'grpSpPr')}/{q(A, 'xfrm')}")
    if x is None:
        x = sp.find(f"./{q(P, 'xfrm')}")  # graphicFrame
    if x is None:
        return None
    off, ext = x.find(q(A, "off")), x.find(q(A, "ext"))
    if off is None or ext is None:
        return None
    return (
        int(off.get("x", 0)),
        int(off.get("y", 0)),
        int(ext.get("cx", 0)),
        int(ext.get("cy", 0)),
    )


def prst_geom(sp):
    g = sp.find(f"./{q(P, 'spPr')}/{q(A, 'prstGeom')}")
    return None if g is None else g.get("prst")


def solid_fill(sp):
    pr = sp.find(q(P, "spPr"))
    if pr is None:
        return None
    fill = pr.find(q(A, "solidFill"))
    if fill is None:
        return None
    srgb = fill.find(q(A, "srgbClr"))
    if srgb is not None:
        return "#" + srgb.get("val", "")
    scheme = fill.find(q(A, "schemeClr"))
    return f"scheme:{scheme.get('val')}" if scheme is not None else "solid"
def has_outline(sp):
    ln = sp.find(f"./{q(P, 'spPr')}/{q(A, 'ln')}")
    return ln is not None and ln.find(q(A, "noFill")) is None


def read_text(sp):
    """Paragraphs with the formatting that hints at what a block *is*."""
    body = sp.find(q(P, "txBody"))
    if body is None:
        body = sp.find(f"./{q(P, 'tx')}/{q(P, 'txBody')}")
    if body is None:
        return []
    paras = []
    for p in body.findall(q(A, "p")):
        pieces, sizes, fonts, bold, has_field = [], [], [], False, False
        for node in p.iter():
            if node.tag == q(A, "t"):
                pieces.append(node.text or "")
            elif node.tag == q(A, "br"):
                pieces.append("\n")
            elif node.tag == q(A, "fld"):
                has_field = True
            elif node.tag == q(A, "rPr"):
                if node.get("sz"):
                    sizes.append(int(node.get("sz")) / 100.0)
                if node.get("b") == "1":
                    bold = True
                latin = node.find(q(A, "latin"))
                if latin is not None and latin.get("typeface"):
                    fonts.append(latin.get("typeface"))
        text = "".join(pieces).strip()
        ppr = p.find(q(A, "pPr"))
        lvl = int(ppr.get("lvl", 0)) if ppr is not None else 0
        bullet = True
        if ppr is not None and ppr.find(q(A, "buNone")) is not None:
            bullet = False
        if not text and not has_field:
            continue
        paras.append(
            {
                "text": text,
                "level": lvl,
                "bullet": bullet,
                "size_pt": max(sizes) if sizes else None,
                "bold": bold,
                "fonts": sorted(set(fonts)),
                "is_field": has_field,
            }
        )
    return paras


def read_table(frame):
    tbl = frame.find(f".//{q(A, 'tbl')}")
    if tbl is None:
        return None
    rows = []
    for tr in tbl.findall(q(A, "tr")):
        row = []
        for tc in tr.findall(q(A, "tc")):
            row.append(" ".join(t.text or "" for t in tc.iter(q(A, "t"))).strip())
        rows.append(row)
    return rows


def frame_kind(frame):
    uri = frame.find(f".//{q(A, 'graphicData')}")
    u = "" if uri is None else (uri.get("uri") or "")
    if "table" in u:
        return "table"
    if "chart" in u:
        return "chart"
    if "diagram" in u or "smartArt" in u:
        return "smartart"
    if "ole" in u:
        return "embedded-object"
    return "graphic"


MONO_HINTS = ("mono", "consol", "courier", "menlo", "source code", "roboto mono")


def looks_monospace(paras):
    for p in paras:
        for f in p["fonts"]:
            if any(h in f.lower() for h in MONO_HINTS):
                return True
    return False


def walk(tree, zf, part_rels, sw, sh, inherited, out, depth=0):
    """Flatten the shape tree into records. Groups are recursed into."""
    for sp in tree:
        tag = sp.tag
        if tag == q(P, "grpSp"):
            rec_children = []
            walk(sp, zf, part_rels, sw, sh, inherited, rec_children, depth + 1)
            geom = xfrm_of(sp)
            out.append(
                {
                    "kind": "group",
                    "geom": norm_geom(geom, sw, sh),
                    "children": rec_children,
                    "depth": depth,
                }
            )
            continue
        if tag not in (q(P, "sp"), q(P, "pic"), q(P, "graphicFrame"), q(P, "cxnSp")):
            continue

        ph_type, ph_idx = ph_info(sp)
        geom = xfrm_of(sp)
        if geom is None and ph_type:
            geom = inherited.get((ph_type, ph_idx)) or inherited.get((ph_type, None))
        rec = {
            "kind": {
                q(P, "sp"): "shape",
                q(P, "pic"): "picture",
                q(P, "graphicFrame"): "frame",
                q(P, "cxnSp"): "connector",
            }[tag],
            "placeholder": ph_type,
            "geom": norm_geom(geom, sw, sh),
            "depth": depth,
        }
        if tag == q(P, "graphicFrame"):
            rec["frame_kind"] = frame_kind(sp)
            rows = read_table(sp)
            if rows:
                rec["table"] = rows
        if tag == q(P, "pic"):
            blip = sp.find(f".//{q(A, 'blip')}")
            rid = blip.get(q(R, "embed")) if blip is not None else None
            rec["media"] = part_rels.get(rid) if rid else None
            name = sp.find(f"./{q(P, 'nvPicPr')}/{q(P, 'cNvPr')}")
            if name is not None:
                rec["descr"] = name.get("descr") or name.get("name")
        if tag in (q(P, "sp"), q(P, "graphicFrame")):
            paras = read_text(sp)
            if paras:
                rec["paragraphs"] = paras
                rec["monospace"] = looks_monospace(paras)
        if tag == q(P, "sp"):
            rec["prst"] = prst_geom(sp)
            fill = solid_fill(sp)
            if fill:
                rec["fill"] = fill
            if has_outline(sp):
                rec["outlined"] = True
        out.append(rec)


def norm_geom(geom, sw, sh):
    if not geom:
        return None
    x, y, cx, cy = geom
    r = lambda v: round(v, 3)
    return {"x": r(x / sw), "y": r(y / sh), "w": r(cx / sw), "h": r(cy / sh)}


def placeholder_geometry(zf, part, sw, sh):
    """Placeholder positions a slide inherits from its layout, then master."""
    out = {}
    for p in reversed(list(chain_of_layouts(zf, part))):
        try:
            root = ET.fromstring(zf.read(p))
        except KeyError:
            continue
        tree = root.find(f"./{q(P, 'cSld')}/{q(P, 'spTree')}")
        if tree is None:
            continue
        for sp in tree:
            t, idx = ph_info(sp)
            if not t:
                continue
            g = xfrm_of(sp)
            if g:
                out[(t, idx)] = g
                out.setdefault((t, None), g)
    return out


def chain_of_layouts(zf, slide_part):
    """[layout, master] parts behind a slide, nearest first."""
    rels = load_rels(zf, slide_part)
    layout = next((v for v in rels.values() if "slideLayout" in v), None)
    if not layout:
        return []
    chain = [layout]
    lrels = load_rels(zf, layout)
    master = next((v for v in lrels.values() if "slideMaster" in v), None)
    if master:
        chain.append(master)
    return chain


def layout_name(zf, slide_part):
    for p in chain_of_layouts(zf, slide_part)[:1]:
        try:
            root = ET.fromstring(zf.read(p))
        except KeyError:
            return None
        csld = root.find(q(P, "cSld"))
        if csld is not None and csld.get("name"):
            return csld.get("name")
        typ = root.get("type")
        return typ
    return None


def notes_for(zf, slide_part):
    rels = load_rels(zf, slide_part)
    part = next((v for v in rels.values() if "notesSlide" in v), None)
    if not part or part not in zf.namelist():
        return None
    root = ET.fromstring(zf.read(part))
    tree = root.find(f"./{q(P, 'cSld')}/{q(P, 'spTree')}")
    if tree is None:
        return None
    chunks = []
    for sp in tree.findall(q(P, "sp")):
        t, _ = ph_info(sp)
        if t == "sldNum":
            continue
        for para in read_text(sp):
            if para["text"] and not para["is_field"]:
                chunks.append(para["text"])
    text = "\n".join(chunks).strip()
    return text or None


def build_hint_count(zf, slide_part):
    """How many animated build steps the slide has — a `:::fragment` hint."""
    root = ET.fromstring(zf.read(slide_part))
    timing = root.find(q(P, "timing"))
    if timing is None:
        return 0
    # Each click-triggered node in the main sequence is one build step.
    return len(
        [
            n
            for n in timing.iter(q(P, "cond"))
            if n.get("evt") == "onClick" and n.find(q(P, "tgtEl")) is not None
        ]
    )


# ------------------------------------------------------------------- digest


def flat(shapes):
    for s in shapes:
        if s["kind"] == "group":
            yield from flat(s["children"])
        else:
            yield s


def shape_text(s):
    return " ".join(p["text"] for p in s.get("paragraphs", []) if p["text"]).strip()


def suggest(slide):
    """A first-guess simspace layout. Advisory — the agent decides."""
    name = (slide.get("layout_name") or "").lower()
    shapes = [s for s in flat(slide["shapes"]) if s["kind"] != "connector"]
    texts = [s for s in shapes if s.get("paragraphs")]
    body = [s for s in texts if s.get("placeholder") not in ("sldNum", "ftr", "dt")]
    n = slide["index"]

    if "section" in name or "divider" in name:
        return "section"
    if "title slide" in name or "title only" in name and n == 1:
        return "title"
    if n == 1 and len(body) <= 3 and all(len(shape_text(s)) < 120 for s in body):
        return "title"

    big = [s for s in body if is_big_number(s)]
    if len(big) >= 2:
        return "stats"

    for s in body:
        t = shape_text(s)
        if (t.startswith("“") or t.startswith('"')) and len(t) > 40:
            return "quote"

    cols = columns_of(body)
    if len(cols) >= 2:
        return "split"
    return "default"


def is_big_number(s):
    """A short numeric line set much larger than its caption — a `:::stat`."""
    for p in s.get("paragraphs", []):
        t = p["text"]
        if t and len(t) <= 12 and re.search(r"\d", t) and (p["size_pt"] or 0) >= 40:
            return True
    return False


def columns_of(shapes):
    """Group shapes into columns by horizontal band, ignoring full-width ones."""
    cols = defaultdict(list)
    for s in shapes:
        g = s.get("geom")
        if not g or g["w"] > 0.7:
            continue
        cols[round(g["x"], 1)].append(s)
    return [c for c in cols.values() if c]


def digest(deck, media_repeats):
    L = []
    W = deck["slide_size"]
    L.append(f"# {deck['file']} — {len(deck['slides'])} slides ({W['ratio']})\n")
    for sl in deck["slides"]:
        head = f"## Slide {sl['index']}"
        if sl.get("layout_name"):
            head += f'  ·  pptx layout "{sl["layout_name"]}"'
        if sl.get("hidden"):
            head += "  ·  HIDDEN"
        if sl.get("build_steps"):
            head += f"  ·  {sl['build_steps']} build steps"
        L.append(head)
        for s in flat(sl["shapes"]):
            g = s.get("geom") or {}
            pos = (
                f"x{g.get('x', '?'):<5} y{g.get('y', '?'):<5} "
                f"w{g.get('w', '?'):<5} h{g.get('h', '?'):<5}"
                if g
                else " " * 26
            )
            label = (s.get("placeholder") or s["kind"]).upper()
            extra = []
            if s.get("monospace"):
                extra.append("mono")
            if s.get("fill"):
                extra.append(f"fill={s['fill']}")
            if s.get("outlined"):
                extra.append("outlined")
            if s.get("prst") and s["prst"] not in ("rect",):
                extra.append(s["prst"])
            if s.get("frame_kind"):
                extra.append(s["frame_kind"])
            if s.get("media"):
                rep = media_repeats.get(s["media"], 1)
                extra.append(
                    f"{s['media']}" + (f" [repeats on {rep} slides]" if rep > 2 else "")
                )
            sizes = [p["size_pt"] for p in s.get("paragraphs", []) if p["size_pt"]]
            if sizes:
                extra.append(
                    f"{min(sizes):g}-{max(sizes):g}pt"
                    if min(sizes) != max(sizes)
                    else f"{max(sizes):g}pt"
                )
            L.append(f"    {label:<10} {pos} {' '.join(extra)}")
            # Paragraphs on their own lines, indented by outline level, so a
            # bullet list reads as a bullet list rather than one run-on string.
            for p in s.get("paragraphs", []):
                if not p["text"]:
                    continue
                t = p["text"].replace("\n", " ⏎ ")
                if len(t) > 100:
                    t = t[:97] + "…"
                mark = "•" if p["bullet"] else "·"
                sz = f" [{p['size_pt']:g}pt]" if p["size_pt"] else ""
                L.append(f"               {'  ' * p['level']}{mark} {t}{sz}")
            for row in s.get("table", []):
                L.append("               | " + " | ".join(row) + " |")
        if sl.get("notes"):
            note = sl["notes"].replace("\n", " ")
            L.append(f"    NOTES      {note[:200]}{'…' if len(note) > 200 else ''}")
        L.append(f"    -> suggested layout: {sl['suggested_layout']}\n")
    return "\n".join(L)


# --------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pptx")
    ap.add_argument("-o", "--json", help="write the full inventory as JSON")
    ap.add_argument("--media", help="extract embedded images into this directory")
    ap.add_argument("--quiet", action="store_true", help="suppress the digest")
    args = ap.parse_args()

    zf = zipfile.ZipFile(args.pptx)
    sw, sh = slide_size(zf)
    parts = slide_parts_in_order(zf)

    slides = []
    for i, part in enumerate(parts, 1):
        root = ET.fromstring(zf.read(part))
        tree = root.find(f"./{q(P, 'cSld')}/{q(P, 'spTree')}")
        rels = load_rels(zf, part)
        inherited = placeholder_geometry(zf, part, sw, sh)
        shapes = []
        if tree is not None:
            walk(tree, zf, rels, sw, sh, inherited, shapes)
        sl = {
            "index": i,
            "part": part,
            "hidden": root.get("show") == "0",
            "layout_name": layout_name(zf, part),
            "build_steps": build_hint_count(zf, part),
            "notes": notes_for(zf, part),
            "shapes": shapes,
        }
        sl["suggested_layout"] = suggest(sl)
        slides.append(sl)

    repeats = defaultdict(int)
    for sl in slides:
        for m in {s.get("media") for s in flat(sl["shapes"]) if s.get("media")}:
            repeats[m] += 1

    deck = {
        "file": os.path.basename(args.pptx),
        "slide_size": {
            "cx": sw,
            "cy": sh,
            "ratio": "16:9" if abs(sw / sh - 16 / 9) < 0.05 else f"{sw}:{sh}",
        },
        "slides": slides,
        "media_repeats": dict(repeats),
    }

    if args.media:
        os.makedirs(args.media, exist_ok=True)
        seen, written = {}, []
        for name in sorted(zf.namelist()):
            if not name.startswith("ppt/media/"):
                continue
            data = zf.read(name)
            h = hashlib.sha1(data).hexdigest()[:8]
            base = os.path.basename(name)
            if h in seen:
                continue
            seen[h] = base
            dest = os.path.join(args.media, base)
            with open(dest, "wb") as fh:
                fh.write(data)
            written.append((dest, len(data), repeats.get(name, 0)))
        deck["media_written"] = [
            {"path": p, "bytes": n, "used_on_slides": u} for p, n, u in written
        ]
        print(f"# extracted {len(written)} unique images to {args.media}/", file=sys.stderr)
        for p, n, u in written:
            flag = "  <- chrome? on many slides" if u > 2 else ""
            print(f"#   {p}  {n // 1024}KB  used on {u} slide(s){flag}", file=sys.stderr)

    if args.json:
        with open(args.json, "w") as fh:
            json.dump(deck, fh, indent=2)
        print(f"# full inventory -> {args.json}", file=sys.stderr)

    if not args.quiet:
        print(digest(deck, repeats))


if __name__ == "__main__":
    main()
