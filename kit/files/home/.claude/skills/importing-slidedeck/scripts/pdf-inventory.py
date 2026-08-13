#!/usr/bin/env python3
"""Dump the structure of a slide-deck PDF so it can be rebuilt, not photographed.

A PDF has no placeholders and no layout names, but it does have every glyph's
position and size, and every image's placement. That's enough to tell a title
from a column from a caption — which is the decision this tool exists to
support. It is the companion to pptx-inventory.py and prints the same digest,
so the mapping rules in SKILL.md apply unchanged.

Standard library only — no pip install, works wherever python3 does.

    python3 pdf-inventory.py deck.pdf                     # digest to stdout
    python3 pdf-inventory.py deck.pdf -o inventory.json   # + full JSON
    python3 pdf-inventory.py deck.pdf --media assets/     # + extract images

Geometry is a fraction of the page with the origin at the TOP-left, matching
the pptx tool (PDF's own origin is bottom-left; that's converted here). Font
sizes are normalised to a 960pt-wide reference page — the size a 16:9 slide is
exported at — so the same "≥ 40pt is a headline" reasoning holds whatever the
page size.
"""

import argparse
import binascii
import hashlib
import json
import math
import os
import re
import sys
import zlib
from collections import defaultdict

# --------------------------------------------------------------- object model


class Name(str):
    """A PDF /Name. A str subclass so it compares to plain strings."""


class Ref(tuple):
    def __new__(cls, num, gen):
        return super().__new__(cls, (num, gen))


class Stream:
    def __init__(self, d, raw):
        self.dict, self.raw = d, raw


DELIM = b"()<>[]{}/%"
WS = b"\x00\t\n\x0c\r "


class Lexer:
    """Tokenises PDF syntax — objects and content streams use the same one."""

    def __init__(self, data, pos=0):
        self.d, self.i = data, pos

    def skip(self):
        while self.i < len(self.d):
            c = self.d[self.i]
            if c in WS:
                self.i += 1
            elif c == 0x25:  # % comment
                while self.i < len(self.d) and self.d[self.i] not in b"\r\n":
                    self.i += 1
            else:
                return

    def token(self):
        """Next raw token: bytes for an operator/keyword, or a parsed object."""
        self.skip()
        if self.i >= len(self.d):
            return None
        c = self.d[self.i]
        if c == 0x2F:  # /Name
            self.i += 1
            s = self.i
            while self.i < len(self.d) and self.d[self.i] not in WS + DELIM:
                self.i += 1
            return Name(decode_name(self.d[s : self.i]))
        if c == 0x28:  # (string)
            return self.literal_string()
        if c == 0x3C:  # << dict, or <hex>
            if self.d[self.i : self.i + 2] == b"<<":
                self.i += 2
                return b"<<"
            return self.hex_string()
        if self.d[self.i : self.i + 2] == b">>":
            self.i += 2
            return b">>"
        if c in b"[]{}":
            self.i += 1
            return bytes([c])
        s = self.i
        while self.i < len(self.d) and self.d[self.i] not in WS + DELIM:
            self.i += 1
        if self.i == s:  # lone delimiter we don't handle; step over it
            self.i += 1
            return bytes([c])
        word = self.d[s : self.i]
        if re.fullmatch(rb"[+-]?\d+", word):
            return int(word)
        if re.fullmatch(rb"[+-]?(\d*\.\d*|\d+)", word) and word not in (b".", b""):
            try:
                return float(word)
            except ValueError:
                pass
        return word  # an operator or keyword

    def literal_string(self):
        self.i += 1
        out, depth = bytearray(), 1
        while self.i < len(self.d):
            c = self.d[self.i]
            if c == 0x5C:  # backslash
                self.i += 1
                if self.i >= len(self.d):
                    break
                e = self.d[self.i]
                mapping = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}
                if e in mapping:
                    out.append(mapping[e])
                    self.i += 1
                elif 0x30 <= e <= 0x37:  # octal
                    oct_digits = ""
                    while len(oct_digits) < 3 and 0x30 <= self.d[self.i] <= 0x37:
                        oct_digits += chr(self.d[self.i])
                        self.i += 1
                    out.append(int(oct_digits, 8) & 0xFF)
                elif e in b"\r\n":  # line continuation
                    self.i += 1
                    if self.i < len(self.d) and self.d[self.i] == 0x0A:
                        self.i += 1
                else:
                    out.append(e)
                    self.i += 1
                continue
            if c == 0x28:
                depth += 1
            elif c == 0x29:
                depth -= 1
                if depth == 0:
                    self.i += 1
                    return bytes(out)
            out.append(c)
            self.i += 1
        return bytes(out)

    def hex_string(self):
        self.i += 1
        s = self.i
        while self.i < len(self.d) and self.d[self.i] != 0x3E:
            self.i += 1
        h = re.sub(rb"[^0-9A-Fa-f]", b"", self.d[s : self.i])
        self.i += 1
        if len(h) % 2:
            h += b"0"
        try:
            return binascii.unhexlify(h)
        except binascii.Error:
            return b""

    def obj(self):
        """A full object, resolving `n g R` references and nested containers."""
        t = self.token()
        return self.obj_from(t)

    def obj_from(self, t):
        if t == b"<<":
            d = {}
            while True:
                k = self.token()
                if k is None or k == b">>":
                    return d
                if not isinstance(k, Name):
                    continue
                d[str(k)] = self.obj()
        if t == b"[":
            arr = []
            while True:
                save = self.i
                x = self.token()
                if x is None or x == b"]":
                    return arr
                self.i = save
                arr.append(self.obj())
        if isinstance(t, int):
            save = self.i
            t2 = self.token()
            if isinstance(t2, int):
                t3 = self.token()
                if t3 == b"R":
                    return Ref(t, t2)
            self.i = save
            return t
        return t


def decode_name(b):
    out = bytearray()
    i = 0
    while i < len(b):
        if b[i] == 0x23 and i + 2 < len(b):
            try:
                out.append(int(b[i + 1 : i + 3], 16))
                i += 3
                continue
            except ValueError:
                pass
        out.append(b[i])
        i += 1
    return out.decode("latin-1")


# ------------------------------------------------------------------ document


class PDF:
    """Objects are found by scanning for `N G obj`, not by trusting the xref.

    Decks get re-saved, appended to, and exported by tools with their own idea
    of a correct xref table. Scanning finds every object in the file including
    superseded ones (later definitions win, which matches incremental updates),
    and never fails on a broken table.
    """

    def __init__(self, data):
        self.data = data
        self.objs = {}
        self.cache = {}
        for m in re.finditer(rb"(?:^|[\s>])(\d+)\s+(\d+)\s+obj\b", data):
            self.objs[int(m.group(1))] = m.end()
        self._expand_object_streams()

    def _at(self, pos):
        lx = Lexer(self.data, pos)
        o = lx.obj()
        lx.skip()
        if self.data[lx.i : lx.i + 6] == b"stream":
            j = lx.i + 6
            if self.data[j : j + 2] == b"\r\n":
                j += 2
            elif self.data[j : j + 1] in (b"\n", b"\r"):
                j += 1
            length = self.resolve(o.get("Length")) if isinstance(o, dict) else None
            raw = None
            if isinstance(length, int) and length >= 0:
                raw = self.data[j : j + length]
                tail = self.data[j + length : j + length + 20]
                if b"endstream" not in tail:
                    raw = None  # Length lied; fall back to scanning
            if raw is None:
                end = self.data.find(b"endstream", j)
                raw = self.data[j : end if end != -1 else len(self.data)]
                raw = raw.rstrip(b"\r\n")
            return Stream(o, raw)
        return o

    def _expand_object_streams(self):
        """Pull objects out of /ObjStm containers (PDF 1.5+ compressed objects)."""
        for num in list(self.objs):
            try:
                o = self.get(num)
            except Exception:
                continue
            if not isinstance(o, Stream) or o.dict.get("Type") != "ObjStm":
                continue
            try:
                data = self.stream_data(o)
                n = self.resolve(o.dict.get("N")) or 0
                first = self.resolve(o.dict.get("First")) or 0
                header = data[:first].split()
                for k in range(n):
                    onum, off = int(header[2 * k]), int(header[2 * k + 1])
                    if onum in self.objs:
                        continue  # a top-level definition wins
                    lx = Lexer(data, first + off)
                    self.cache[onum] = lx.obj()
                    self.objs.setdefault(onum, -1)
            except Exception:
                continue

    def get(self, num):
        if num in self.cache:
            return self.cache[num]
        pos = self.objs.get(num)
        if pos is None or pos < 0:
            return None
        self.cache[num] = None  # guard against reference cycles
        try:
            self.cache[num] = self._at(pos)
        except Exception:
            self.cache[num] = None
        return self.cache[num]

    def resolve(self, o, depth=0):
        while isinstance(o, Ref) and depth < 32:
            o = self.get(o[0])
            depth += 1
        return o

    def dget(self, d, *keys, default=None):
        """Resolve d[key] for the first key present."""
        if isinstance(d, Stream):
            d = d.dict
        if not isinstance(d, dict):
            return default
        for k in keys:
            if k in d:
                return self.resolve(d[k])
        return default

    def stream_data(self, st):
        if not isinstance(st, Stream):
            return b""
        data = st.raw
        filters = self.dget(st.dict, "Filter", default=[])
        if isinstance(filters, (str, Name)):
            filters = [filters]
        parms = self.dget(st.dict, "DecodeParms", "DP", default=None)
        if isinstance(parms, dict) or parms is None:
            parms = [parms] * len(filters)
        for f, pm in zip(filters, parms):
            if f in ("FlateDecode", "Fl"):
                try:
                    data = zlib.decompress(data)
                except zlib.error:
                    try:
                        data = zlib.decompressobj().decompress(data)
                    except zlib.error:
                        return b""
                data = apply_predictor(data, self.resolve(pm), self)
            elif f in ("ASCIIHexDecode", "AHx"):
                h = re.sub(rb"[^0-9A-Fa-f]", b"", data.split(b">")[0])
                data = binascii.unhexlify(h + b"0" * (len(h) % 2))
            elif f in ("ASCII85Decode", "A85"):
                try:
                    data = a85(data)
                except Exception:
                    return b""
            elif f in ("LZWDecode", "LZW"):
                try:
                    data = lzw(data)
                except Exception:
                    return b""
                data = apply_predictor(data, self.resolve(pm), self)
            else:
                return b""  # an image codec — handled by the media extractor
        return data


def a85(data):
    data = re.sub(rb"\s", b"", data)
    if data.startswith(b"<~"):
        data = data[2:]
    data = data.split(b"~>")[0]
    out = bytearray()
    i = 0
    while i < len(data):
        if data[i : i + 1] == b"z":
            out += b"\0\0\0\0"
            i += 1
            continue
        chunk = data[i : i + 5]
        i += 5
        pad = 5 - len(chunk)
        chunk += b"u" * pad
        v = 0
        for c in chunk:
            v = v * 85 + (c - 33)
        b4 = v.to_bytes(4, "big")
        out += b4[: 4 - pad]
    return bytes(out)


def lzw(data, early=1):
    out, table = bytearray(), {i: bytes([i]) for i in range(256)}
    nxt, width, prev, buf, nbits = 258, 9, None, 0, 0
    for byte in data:
        buf = (buf << 8) | byte
        nbits += 8
        while nbits >= width:
            code = (buf >> (nbits - width)) & ((1 << width) - 1)
            nbits -= width
            if code == 256:
                table = {i: bytes([i]) for i in range(256)}
                nxt, width, prev = 258, 9, None
                continue
            if code == 257:
                return bytes(out)
            if prev is None:
                entry = table[code]
            elif code in table:
                entry = table[code]
                table[nxt] = prev + entry[:1]
                nxt += 1
            else:
                entry = prev + prev[:1]
                table[nxt] = entry
                nxt += 1
            out += entry
            prev = entry
            if nxt + early >= (1 << width) and width < 12:
                width += 1
    return bytes(out)


def apply_predictor(data, parms, pdf):
    if not isinstance(parms, dict):
        return data
    pred = pdf.resolve(parms.get("Predictor")) or 1
    if pred < 2:
        return data
    colors = pdf.resolve(parms.get("Colors")) or 1
    bpc = pdf.resolve(parms.get("BitsPerComponent")) or 8
    columns = pdf.resolve(parms.get("Columns")) or 1
    bpp = max(1, (colors * bpc) // 8)
    rowlen = (columns * colors * bpc + 7) // 8
    if pred == 2:
        return data
    out, prev = bytearray(), bytearray(rowlen)
    i = 0
    while i + 1 <= len(data) - 1:
        ft = data[i]
        row = bytearray(data[i + 1 : i + 1 + rowlen])
        i += 1 + rowlen
        if len(row) < rowlen:
            row += bytes(rowlen - len(row))
        for j in range(rowlen):
            a = row[j - bpp] if j >= bpp else 0
            b = prev[j]
            c = prev[j - bpp] if j >= bpp else 0
            if ft == 1:
                row[j] = (row[j] + a) & 0xFF
            elif ft == 2:
                row[j] = (row[j] + b) & 0xFF
            elif ft == 3:
                row[j] = (row[j] + (a + b) // 2) & 0xFF
            elif ft == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                row[j] = (row[j] + pr) & 0xFF
        out += row
        prev = row
    return bytes(out)


# --------------------------------------------------------------------- fonts


def parse_cmap(data):
    """code -> unicode, from a ToUnicode CMap's bfchar/bfrange sections."""
    out = {}
    txt = data.decode("latin-1", "replace")

    def uni(h):
        try:
            b = bytes.fromhex(h)
        except ValueError:
            return ""
        return b.decode("utf-16-be", "ignore") if len(b) >= 2 else b.decode("latin-1")

    for m in re.finditer(r"beginbfchar(.*?)endbfchar", txt, re.S):
        for src, dst in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", m.group(1)):
            out[int(src, 16)] = uni(dst)
    for m in re.finditer(r"beginbfrange(.*?)endbfrange", txt, re.S):
        body = m.group(1)
        for lo, hi, dst in re.findall(
            r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", body
        ):
            base = uni(dst)
            lo_i, hi_i = int(lo, 16), int(hi, 16)
            for k in range(min(hi_i - lo_i + 1, 65536)):
                if base and len(base) == 1:
                    out[lo_i + k] = chr(ord(base[0]) + k)
                else:
                    out[lo_i + k] = base
        for lo, hi, arr in re.findall(
            r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]", body, re.S
        ):
            items = re.findall(r"<([0-9A-Fa-f]+)>", arr)
            for k, dst in enumerate(items):
                out[int(lo, 16) + k] = uni(dst)
    return out


class Font:
    def __init__(self, pdf, d):
        self.pdf, self.d = pdf, d
        self.two_byte = False
        self.tounicode = {}
        self.widths = {}
        self.default_width = 500
        self.name = str(pdf.dget(d, "BaseFont", default="") or "")
        subtype = pdf.dget(d, "Subtype", default="")
        tu = pdf.dget(d, "ToUnicode")
        if isinstance(tu, Stream):
            self.tounicode = parse_cmap(pdf.stream_data(tu))
        if subtype == "Type0":
            enc = pdf.dget(d, "Encoding", default="")
            self.two_byte = not str(enc).endswith("-V") or True
            desc = pdf.dget(d, "DescendantFonts", default=[]) or []
            desc = pdf.resolve(desc[0]) if desc else None
            if desc:
                self.default_width = pdf.dget(desc, "DW", default=1000) or 1000
                self._cid_widths(pdf.dget(desc, "W", default=[]) or [])
        else:
            first = pdf.dget(d, "FirstChar", default=0) or 0
            ws = pdf.dget(d, "Widths", default=[]) or []
            for i, w in enumerate(ws):
                self.widths[first + i] = pdf.resolve(w) or 0
            if not ws:
                self.default_width = 500

    def _cid_widths(self, w):
        i = 0
        w = [self.pdf.resolve(x) for x in w]
        while i < len(w):
            if i + 1 < len(w) and isinstance(w[i + 1], list):
                start = w[i]
                for k, val in enumerate(w[i + 1]):
                    self.widths[start + k] = self.pdf.resolve(val) or 0
                i += 2
            elif i + 2 < len(w):
                lo, hi, val = w[i], w[i + 1], w[i + 2]
                if isinstance(lo, int) and isinstance(hi, int) and hi - lo < 65536:
                    for c in range(lo, hi + 1):
                        self.widths[c] = val
                i += 3
            else:
                break

    def codes(self, raw):
        if self.two_byte:
            return [
                (raw[i] << 8) | (raw[i + 1] if i + 1 < len(raw) else 0)
                for i in range(0, len(raw), 2)
            ]
        return list(raw)

    def decode(self, raw):
        out = []
        for c in self.codes(raw):
            if c in self.tounicode:
                out.append(self.tounicode[c])
            elif not self.two_byte:
                out.append(bytes([c]).decode("cp1252", "replace"))
            else:
                out.append("")
        return "".join(out)

    def width(self, code):
        return self.widths.get(code, self.default_width) / 1000.0


# ---------------------------------------------------------- content stream VM


def mat_mul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (
        a * A + b * C,
        a * B + b * D,
        c * A + d * C,
        c * B + d * D,
        e * A + f * C + E,
        e * B + f * D + F,
    )


ID = (1, 0, 0, 1, 0, 0)


class Page:
    def __init__(self):
        self.runs = []  # dicts: text, x, y (top-left), size, font, w
        self.images = []
        self.rects = []


def run_content(pdf, data, resources, page, ctm, depth=0):
    """Execute a content stream, collecting text runs, images, and filled rects."""
    if depth > 6:
        return
    fonts = {}
    fdict = pdf.dget(resources, "Font", default={}) or {}
    for k, v in (fdict.items() if isinstance(fdict, dict) else []):
        fd = pdf.resolve(v)
        if isinstance(fd, dict):
            try:
                fonts[k] = Font(pdf, fd)
            except Exception:
                pass
    xobjs = pdf.dget(resources, "XObject", default={}) or {}

    lx = Lexer(data)
    stack, gs = [], {"ctm": ctm, "fill": None}
    tm = tlm = ID
    font = None
    size = 0.0
    leading = charsp = wordsp = 0.0
    hscale = 1.0
    operands = []
    pending_rect = None

    def flush_text(raw):
        nonlocal tm
        if font is None or not raw:
            return
        m = mat_mul((size * hscale, 0, 0, size, 0, 0), mat_mul(tm, gs["ctm"]))
        text = font.decode(raw)
        adv = 0.0
        for c in font.codes(raw):
            ch = font.tounicode.get(c, " ")
            adv += font.width(c) * size + charsp + (wordsp if ch == " " else 0)
        adv *= hscale
        scale_y = math.hypot(m[2], m[3])
        scale_x = math.hypot(m[0], m[1]) / max(size * hscale, 1e-6)
        if text.strip():
            page.runs.append(
                {
                    "text": text,
                    "x": m[4],
                    "y": m[5],
                    "size": scale_y,
                    "w": adv * scale_x,
                    "font": font.name,
                }
            )
        tm = mat_mul((1, 0, 0, 1, adv, 0), tm)

    while True:
        try:
            t = lx.token()
        except Exception:
            break
        if t is None:
            break
        if isinstance(t, (int, float, Name, bytes)) and not isinstance(t, bytes):
            operands.append(t)
            continue
        if t in (b"<<", b"["):
            lx.i -= len(t)
            operands.append(lx.obj())
            continue
        if isinstance(t, bytes) and t not in (
            b"<<",
            b">>",
            b"[",
            b"]",
            b"{",
            b"}",
        ):
            op = t
            try:
                if op == b"q":
                    stack.append(dict(gs))
                elif op == b"Q":
                    if stack:
                        gs = stack.pop()
                elif op == b"cm" and len(operands) >= 6:
                    gs["ctm"] = mat_mul(tuple(operands[-6:]), gs["ctm"])
                elif op == b"BT":
                    tm = tlm = ID
                elif op == b"Tf" and len(operands) >= 2:
                    font = fonts.get(str(operands[-2]))
                    size = float(operands[-1])
                elif op == b"Td" and len(operands) >= 2:
                    tlm = mat_mul((1, 0, 0, 1, operands[-2], operands[-1]), tlm)
                    tm = tlm
                elif op == b"TD" and len(operands) >= 2:
                    leading = -float(operands[-1])
                    tlm = mat_mul((1, 0, 0, 1, operands[-2], operands[-1]), tlm)
                    tm = tlm
                elif op == b"Tm" and len(operands) >= 6:
                    tm = tlm = tuple(float(x) for x in operands[-6:])
                elif op == b"T*":
                    tlm = mat_mul((1, 0, 0, 1, 0, -leading), tlm)
                    tm = tlm
                elif op == b"TL" and operands:
                    leading = float(operands[-1])
                elif op == b"Tc" and operands:
                    charsp = float(operands[-1])
                elif op == b"Tw" and operands:
                    wordsp = float(operands[-1])
                elif op == b"Tz" and operands:
                    hscale = float(operands[-1]) / 100.0
                elif op == b"Tj" and operands:
                    flush_text(operands[-1])
                elif op == b"'" and operands:
                    tlm = mat_mul((1, 0, 0, 1, 0, -leading), tlm)
                    tm = tlm
                    flush_text(operands[-1])
                elif op == b'"' and len(operands) >= 3:
                    wordsp, charsp = float(operands[-3]), float(operands[-2])
                    tlm = mat_mul((1, 0, 0, 1, 0, -leading), tlm)
                    tm = tlm
                    flush_text(operands[-1])
                elif op == b"TJ" and operands:
                    for el in operands[-1] if isinstance(operands[-1], list) else []:
                        if isinstance(el, bytes):
                            flush_text(el)
                        elif isinstance(el, (int, float)):
                            tm = mat_mul(
                                (1, 0, 0, 1, -el / 1000.0 * size * hscale, 0), tm
                            )
                elif op in (b"rg", b"g", b"sc", b"scn") and operands:
                    nums = [o for o in operands if isinstance(o, (int, float))]
                    if len(nums) >= 3:
                        gs["fill"] = "#%02X%02X%02X" % tuple(
                            max(0, min(255, int(v * 255))) for v in nums[-3:]
                        )
                    elif len(nums) == 1:
                        v = max(0, min(255, int(nums[-1] * 255)))
                        gs["fill"] = "#%02X%02X%02X" % (v, v, v)
                elif op == b"re" and len(operands) >= 4:
                    pending_rect = tuple(float(x) for x in operands[-4:])
                elif op in (b"f", b"F", b"f*", b"b", b"B") and pending_rect:
                    x, y, w, h = pending_rect
                    m = gs["ctm"]
                    page.rects.append(
                        {
                            "x": x * m[0] + y * m[2] + m[4],
                            "y": y * m[3] + x * m[1] + m[5],
                            "w": abs(w * m[0]),
                            "h": abs(h * m[3]),
                            "fill": gs["fill"],
                        }
                    )
                    pending_rect = None
                elif op == b"Do" and operands:
                    xo = pdf.resolve(
                        xobjs.get(str(operands[-1])) if isinstance(xobjs, dict) else None
                    )
                    if isinstance(xo, Stream):
                        st = pdf.dget(xo.dict, "Subtype", default="")
                        m = gs["ctm"]
                        if st == "Image":
                            page.images.append(
                                {
                                    "name": str(operands[-1]),
                                    "obj": xo,
                                    "x": m[4],
                                    "y": m[5],
                                    "w": math.hypot(m[0], m[1]),
                                    "h": math.hypot(m[2], m[3]),
                                }
                            )
                        elif st == "Form":
                            fm = pdf.dget(xo.dict, "Matrix", default=None)
                            sub = mat_mul(tuple(fm), m) if fm and len(fm) == 6 else m
                            run_content(
                                pdf,
                                pdf.stream_data(xo),
                                pdf.dget(xo.dict, "Resources", default=resources),
                                page,
                                sub,
                                depth + 1,
                            )
                elif op == b"BI":
                    j = data.find(b"EI", lx.i)
                    lx.i = len(data) if j == -1 else j + 2
            except Exception:
                pass
            operands = []
    return page


# ------------------------------------------------------------------ assembly


def pages_of(pdf):
    """Pages in document order, via the page tree; falls back to a scan."""
    root = None
    for m in re.finditer(rb"/Root\s+(\d+)\s+(\d+)\s+R", pdf.data):
        root = pdf.resolve(Ref(int(m.group(1)), int(m.group(2))))
    pages = []
    seen = set()

    def walk(node, inherited, depth=0):
        node = pdf.resolve(node)
        if not isinstance(node, (dict, Stream)) or depth > 32:
            return
        d = node.dict if isinstance(node, Stream) else node
        inh = dict(inherited)
        for k in ("Resources", "MediaBox", "CropBox", "Rotate"):
            if k in d:
                inh[k] = d[k]
        if pdf.dget(d, "Type", default="") == "Page" or (
            "Contents" in d and "Kids" not in d
        ):
            key = id(d)
            if key not in seen:
                seen.add(key)
                pages.append((d, inh))
            return
        for kid in pdf.dget(d, "Kids", default=[]) or []:
            walk(kid, inh, depth + 1)

    if root:
        walk(pdf.dget(root, "Pages"), {})
    if not pages:  # no usable tree — take every /Page object in file order
        for num in sorted(pdf.objs):
            o = pdf.resolve(pdf.get(num))
            d = o.dict if isinstance(o, Stream) else o
            if isinstance(d, dict) and pdf.dget(d, "Type", default="") == "Page":
                pages.append((d, d))
    return pages


def page_content(pdf, pd):
    c = pdf.dget(pd, "Contents")
    parts = []
    for st in c if isinstance(c, list) else [c]:
        st = pdf.resolve(st)
        if isinstance(st, Stream):
            parts.append(pdf.stream_data(st))
    return b"\n".join(parts)


BULLETS = "•●○▪▫◦‣·-–—*"


def group_blocks(runs, pw, ph):
    """Text runs -> lines -> blocks, the way a reader groups them."""
    if not runs:
        return []
    lines = []
    for r in sorted(runs, key=lambda r: (-r["y"], r["x"])):
        placed = False
        for ln in lines:
            if (
                abs(ln["y"] - r["y"]) <= max(2.0, r["size"] * 0.4)
                and abs(ln["size"] - r["size"]) <= max(1.5, r["size"] * 0.35)
            ):
                ln["runs"].append(r)
                ln["y"] = (ln["y"] * len(ln["runs"]) + r["y"]) / (len(ln["runs"]) + 1)
                placed = True
                break
        if not placed:
            lines.append({"y": r["y"], "size": r["size"], "runs": [r]})

    out = []
    for ln in lines:
        rs = sorted(ln["runs"], key=lambda r: r["x"])
        # Split at a gutter. Two columns of body text sit on the same baseline,
        # so without this every two-column slide reads as one wide paragraph —
        # and column structure is the main thing this tool exists to recover.
        segments, cur = [], [rs[0]]
        for prev, r in zip(rs, rs[1:]):
            gutter = max(prev["size"] * 2.0, pw * 0.035)
            if r["x"] - (prev["x"] + prev["w"]) > gutter:
                segments.append(cur)
                cur = [r]
            else:
                cur.append(r)
        segments.append(cur)

        for seg in segments:
            text = ""
            prev_end = None
            for r in seg:
                if prev_end is not None and r["x"] - prev_end > r["size"] * 0.22:
                    text += " "
                text += r["text"]
                prev_end = r["x"] + r["w"]
            out.append(
                {
                    "text": re.sub(r"\s+", " ", text).strip(),
                    "x": min(r["x"] for r in seg),
                    "x1": max(r["x"] + r["w"] for r in seg),
                    "y": ln["y"],
                    "size": max(r["size"] for r in seg),
                    "font": seg[0]["font"],
                }
            )
    out = [l for l in out if l["text"]]

    blocks = []
    for ln in sorted(out, key=lambda l: -l["y"]):
        joined = False
        for b in blocks:
            gap = b["y_min"] - ln["y"]
            same_col = not (ln["x1"] < b["x"] - 4 or ln["x"] > b["x1"] + 4)
            if (
                same_col
                and 0 <= gap <= max(ln["size"], b["size"]) * 2.6
                and abs(ln["size"] - b["size"]) <= max(2.0, b["size"] * 0.45)
            ):
                b["lines"].append(ln)
                b["y_min"] = min(b["y_min"], ln["y"])
                b["x"] = min(b["x"], ln["x"])
                b["x1"] = max(b["x1"], ln["x1"])
                b["size"] = max(b["size"], ln["size"])
                joined = True
                break
        if not joined:
            blocks.append(
                {
                    "lines": [ln],
                    "x": ln["x"],
                    "x1": ln["x1"],
                    "y_max": ln["y"],
                    "y_min": ln["y"],
                    "size": ln["size"],
                    "font": ln["font"],
                }
            )
    return blocks


def to_paragraphs(block):
    """Block lines -> paragraph records shaped like the pptx tool's."""
    paras = []
    left = min(l["x"] for l in block["lines"])
    for ln in block["lines"]:
        text = ln["text"]
        bullet = False
        m = re.match(rf"^\s*([{re.escape(BULLETS)}]|\d+[.)])\s+(.*)$", text)
        if m:
            bullet, text = True, m.group(2)
        level = 0
        if ln["size"] > 0:
            level = max(0, min(4, int(round((ln["x"] - left) / (ln["size"] * 1.6)))))
        if text.strip():
            paras.append(
                {
                    "text": text.strip(),
                    "level": level,
                    "bullet": bullet,
                    "size_pt": round(ln["size"], 1),
                    "bold": bool(re.search(r"bold|black|heavy", ln["font"], re.I)),
                    "fonts": [ln["font"]] if ln["font"] else [],
                    "is_field": False,
                }
            )
    return paras


MONO_HINTS = ("mono", "consol", "courier", "menlo", "source code", "roboto mono")


def build_slide(pdf, index, pd, inherited, opts):
    box = pdf.dget(pd, "MediaBox") or pdf.dget(inherited, "MediaBox") or [0, 0, 612, 792]
    box = [float(pdf.resolve(v)) for v in box]
    x0, y0, x1, y1 = box
    pw, ph = abs(x1 - x0), abs(y1 - y0)
    res = pdf.dget(pd, "Resources") or pdf.dget(inherited, "Resources") or {}

    page = Page()
    try:
        run_content(pdf, page_content(pdf, pd), res, page, (1, 0, 0, 1, -x0, -y0))
    except Exception as e:
        print(f"# slide {index}: content stream failed ({e})", file=sys.stderr)

    # Notes-export layout: a portrait page with the slide in a 16:9 box up top
    # and the notes beneath. Google Slides' "1 slide with notes" print layout.
    notes_split = None
    if opts.notes_layout != "off" and ph > pw * 1.05:
        notes_split = ph - pw * 9 / 16 * 0.92

    scale = 960.0 / pw if pw else 1.0
    blocks = group_blocks(page.runs, pw, ph)

    shapes, notes = [], []
    for b in blocks:
        top = ph - b["y_max"] - b["size"]
        height = (b["y_max"] - b["y_min"]) + b["size"] * 1.25
        paras = to_paragraphs(b)
        if not paras:
            continue
        if notes_split is not None and b["y_max"] < notes_split:
            notes.extend(p["text"] for p in paras)
            continue
        rec = {
            "kind": "shape",
            "placeholder": None,
            "geom": frac(b["x"], top, b["x1"] - b["x"], height, pw, ph, notes_split),
            "paragraphs": [dict(p, size_pt=round(p["size_pt"] * scale, 1)) for p in paras],
            "monospace": any(
                any(h in (p["fonts"][0] if p["fonts"] else "").lower() for h in MONO_HINTS)
                for p in paras
            ),
        }
        card = enclosing_rect(page.rects, b, ph)
        if card:
            rec["fill"] = card
        shapes.append(rec)

    for im in page.images:
        if im["w"] < pw * 0.01 or im["h"] < ph * 0.01:
            continue
        rec = {
            "kind": "picture",
            "placeholder": None,
            "geom": frac(
                im["x"], ph - im["y"] - im["h"], im["w"], im["h"], pw, ph, notes_split
            ),
            "media": None,
            "_obj": im["obj"],
            "descr": im["name"],
        }
        shapes.append(rec)

    shapes.sort(key=lambda s: ((s.get("geom") or {}).get("y", 0), (s.get("geom") or {}).get("x", 0)))
    sl = {
        "index": index,
        "part": f"page {index}",
        "hidden": False,
        "layout_name": None,
        "build_steps": 0,
        "notes": "\n".join(notes).strip() or None,
        "shapes": shapes,
        "page_size": {"w": round(pw, 1), "h": round(ph, 1)},
    }
    return sl


def frac(x, y, w, h, pw, ph, notes_split):
    """Normalise to a fraction of the slide area, origin top-left."""
    if notes_split is not None:
        ph = ph - notes_split  # the slide occupies the top band only
    if pw <= 0 or ph <= 0:
        return None
    r = lambda v: round(v, 3)
    return {"x": r(x / pw), "y": r(y / ph), "w": r(w / pw), "h": r(h / ph)}


def enclosing_rect(rects, block, ph):
    """The fill of the smallest filled rect containing this text — a card hint."""
    best = None
    for rc in rects:
        if rc["w"] <= 0 or rc["h"] <= 0 or not rc["fill"]:
            continue
        if rc["w"] > 0.96 * 960 and rc["h"] > 0.9 * ph:
            continue  # the page background
        top, bot = rc["y"], rc["y"] + rc["h"]
        if (
            rc["x"] - 6 <= block["x"]
            and rc["x"] + rc["w"] + 6 >= block["x1"]
            and top - 6 <= block["y_min"]
            and bot + 6 >= block["y_max"] + block["size"]
        ):
            area = rc["w"] * rc["h"]
            if best is None or area < best[0]:
                best = (area, rc["fill"])
    return best[1] if best else None


# ---------------------------------------------------------- shared with pptx

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from importlib import import_module

    _pptx = import_module("pptx-inventory".replace("-", "_"))
except Exception:
    _pptx = None


def flat(shapes):
    for s in shapes:
        if s.get("kind") == "group":
            yield from flat(s.get("children", []))
        else:
            yield s


def shape_text(s):
    return " ".join(p["text"] for p in s.get("paragraphs", []) if p["text"]).strip()


def is_big_number(s):
    for p in s.get("paragraphs", []):
        t = p["text"]
        if t and len(t) <= 12 and re.search(r"\d", t) and (p["size_pt"] or 0) >= 40:
            return True
    return False


def block_size(s):
    return max((p["size_pt"] or 0) for p in s["paragraphs"]) if s.get("paragraphs") else 0


def suggest(slide):
    shapes = [s for s in flat(slide["shapes"]) if s.get("paragraphs")]
    if not shapes:
        return "default"
    biggest = max(block_size(s) for s in shapes)

    # Running heads and footers repeat on every slide and become deck `brand`
    # chrome, so they must not count as content when classifying the layout.
    def is_chrome(s):
        g = s.get("geom") or {}
        return (g.get("y", 0.5) < 0.09 or g.get("y", 0.5) > 0.86) and block_size(
            s
        ) <= max(biggest * 0.45, 14)

    body = [s for s in shapes if not is_chrome(s)]
    if not body:
        body = shapes
    top = max(block_size(s) for s in body)

    if sum(1 for s in body if is_big_number(s)) >= 2:
        return "stats"

    # A pull quote is the *dominant* text on the slide. Body copy that merely
    # contains a quoted phrase is not a quote slide.
    for s in body:
        t = shape_text(s)
        if (
            t[:1] in ("“", '"', "„", "«")
            and len(t) > 40
            and block_size(s) >= top * 0.9
        ):
            return "quote"

    # Column structure: group body blocks by left edge, ignoring full-width ones.
    cols = defaultdict(list)
    for s in body:
        g = s.get("geom")
        # Skip full-width blocks and the title band — a heading above the
        # columns is not itself a column.
        if not g or g["w"] > 0.62 or g["y"] < 0.22:
            continue
        cols[round(g["x"] * 2) / 2].append(s)
    groups = [c for c in cols.values() if c]

    if len(groups) >= 2:
        # The same two columns repeated down the slide is a list of rows, not a
        # two-column split — it wants a table or a stack of cards.
        rows = {round((s.get("geom") or {}).get("y", 0), 1) for g in groups for s in g}
        if len(rows) >= 3 and min(len(g) for g in groups) >= 3:
            return "default"
        return "split"

    # One headline much larger than anything else, and little else on the slide:
    # an opener or a divider. Which of the two is a judgement the reader makes —
    # position in the deck is the only signal a PDF offers.
    ranked = sorted((block_size(s) for s in body), reverse=True)
    second = ranked[1] if len(ranked) > 1 else 0
    if top >= 34 and (second == 0 or top >= second * 1.7) and len(body) <= 5:
        return "title" if slide["index"] <= 2 else "section"
    return "default"


IMG_EXT = {
    "DCTDecode": ".jpg",
    "JPXDecode": ".jp2",
    "CCITTFaxDecode": ".tif",
    "JBIG2Decode": ".jbig2",
}


def extract_images(pdf, slides, outdir):
    os.makedirs(outdir, exist_ok=True)
    seen, written = {}, []
    for sl in slides:
        for s in flat(sl["shapes"]):
            xo = s.pop("_obj", None)
            if xo is None:
                continue
            filters = pdf.dget(xo.dict, "Filter", default=[])
            if isinstance(filters, (str, Name)):
                filters = [filters]
            codec = next((f for f in filters if f in IMG_EXT), None)
            data = xo.raw if codec else pdf.stream_data(xo)
            if not data:
                continue
            h = hashlib.sha1(data).hexdigest()[:8]
            if h in seen:
                s["media"] = seen[h]
                continue
            if codec:
                name = f"image-{h}{IMG_EXT[codec]}"
                path = os.path.join(outdir, name)
                with open(path, "wb") as fh:
                    fh.write(data)
            else:
                w = pdf.dget(xo.dict, "Width", default=0) or 0
                ht = pdf.dget(xo.dict, "Height", default=0) or 0
                bpc = pdf.dget(xo.dict, "BitsPerComponent", default=8) or 8
                cs = pdf.dget(xo.dict, "ColorSpace", default="")
                name = f"image-{h}.png"
                path = os.path.join(outdir, name)
                if not write_png(path, data, w, ht, bpc, cs, pdf):
                    continue
            seen[h] = path
            s["media"] = path
            written.append((path, len(data)))
    return written


def write_png(path, data, w, h, bpc, cs, pdf):
    """Re-wrap a raw image sample array as a PNG. Greyscale/RGB, 8-bit only."""
    if not w or not h or bpc != 8:
        return False
    name = cs
    if isinstance(cs, list):
        name = str(pdf.resolve(cs[0]))
    name = str(name)
    if "RGB" in name:
        ctype, nchan = 2, 3
    elif "Gray" in name:
        ctype, nchan = 0, 1
    else:
        return False
    stride = w * nchan
    if len(data) < stride * h:
        return False
    raw = b"".join(
        b"\x00" + data[r * stride : (r + 1) * stride] for r in range(h)
    )
    import struct

    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c))

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as fh:
        fh.write(png)
    return True


def digest(deck):
    L = [f"# {deck['file']} — {len(deck['slides'])} pages ({deck['ratio']})\n"]
    if deck.get("notes_layout"):
        L.append(
            "# Portrait pages detected — read as a 'slide with notes' export;\n"
            "# text below each slide is treated as speaker notes.\n"
        )
    for sl in deck["slides"]:
        L.append(f"## Slide {sl['index']}")
        for s in flat(sl["shapes"]):
            g = s.get("geom") or {}
            pos = (
                f"x{g.get('x'):<5} y{g.get('y'):<5} w{g.get('w'):<5} h{g.get('h'):<5}"
                if g
                else " " * 26
            )
            label = "PICTURE" if s["kind"] == "picture" else "TEXT"
            extra = []
            if s.get("monospace"):
                extra.append("mono")
            if s.get("fill"):
                extra.append(f"on {s['fill']}")
            if s.get("media"):
                extra.append(os.path.basename(s["media"]))
            elif s["kind"] == "picture":
                extra.append("(not extracted)")
            sizes = [p["size_pt"] for p in s.get("paragraphs", []) if p["size_pt"]]
            if sizes:
                extra.append(
                    f"{min(sizes):g}-{max(sizes):g}pt"
                    if min(sizes) != max(sizes)
                    else f"{max(sizes):g}pt"
                )
            L.append(f"    {label:<10} {pos} {' '.join(extra)}")
            for p in s.get("paragraphs", []):
                t = p["text"]
                if len(t) > 100:
                    t = t[:97] + "…"
                mark = "•" if p["bullet"] else "·"
                L.append(
                    f"               {'  ' * p['level']}{mark} {t} [{p['size_pt']:g}pt]"
                )
        if sl.get("notes"):
            note = sl["notes"].replace("\n", " ")
            L.append(f"    NOTES      {note[:200]}{'…' if len(note) > 200 else ''}")
        L.append(f"    -> suggested layout: {sl['suggested_layout']}\n")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf")
    ap.add_argument("-o", "--json")
    ap.add_argument("--media")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--pages", help="only these pages, e.g. 1-10,14")
    ap.add_argument(
        "--notes-layout",
        choices=["auto", "off"],
        default="auto",
        help="read portrait pages as slide-plus-notes exports (default: auto)",
    )
    args = ap.parse_args()

    pdf = PDF(open(args.pdf, "rb").read())
    pages = pages_of(pdf)
    if not pages:
        sys.exit("No pages found — is this a PDF?")

    wanted = None
    if args.pages:
        wanted = set()
        for part in args.pages.split(","):
            if "-" in part:
                a, b = part.split("-")
                wanted.update(range(int(a), int(b) + 1))
            else:
                wanted.add(int(part))

    slides = []
    for i, (pd, inh) in enumerate(pages, 1):
        if wanted and i not in wanted:
            continue
        sl = build_slide(pdf, i, pd, inh, args)
        sl["suggested_layout"] = suggest(sl)
        slides.append(sl)

    empty = [s["index"] for s in slides if not any(
        x.get("paragraphs") for x in flat(s["shapes"])
    )]
    if len(empty) > len(slides) * 0.6:
        print(
            "# WARNING: most pages yielded no text. This PDF is probably vector or\n"
            "# raster art with no text layer — ask for the .pptx instead.",
            file=sys.stderr,
        )

    first = slides[0]["page_size"] if slides else {"w": 1, "h": 1}
    ratio = "16:9" if abs(first["w"] / max(first["h"], 1) - 16 / 9) < 0.05 else (
        f"{first['w']:g}x{first['h']:g}pt"
    )
    deck = {
        "file": os.path.basename(args.pdf),
        "ratio": ratio,
        "notes_layout": first["h"] > first["w"] and args.notes_layout != "off",
        "slides": slides,
    }

    if args.media:
        written = extract_images(pdf, slides, args.media)
        print(f"# extracted {len(written)} unique images to {args.media}/", file=sys.stderr)
        for p, n in written:
            print(f"#   {p}  {n // 1024}KB", file=sys.stderr)
    else:
        for sl in slides:
            for s in flat(sl["shapes"]):
                s.pop("_obj", None)

    if args.json:
        with open(args.json, "w") as fh:
            json.dump(deck, fh, indent=2, default=str)
        print(f"# full inventory -> {args.json}", file=sys.stderr)

    if not args.quiet:
        print(digest(deck))


if __name__ == "__main__":
    main()
