"""
Cut the NASA documents in data/docs/ into small text pieces ("chunks") for the Ask tab.

  Input : data/docs/sources.json  -> list of { file, title, url } (+ optional "pages": [[first, last], ...])
          data/docs/<file>        -> .pdf, .txt or .html
  Output: api/chunks.json         -> list of { id, title, url, page, text }

api/ask.js searches these chunks for the ones that best match a question and sends
them to the AI, so it can answer from the documents and cite them like [1].

Run (from the project folder):
    .venv/bin/pip install pypdf          # only once
    .venv/bin/python scripts/build_chunks.py
Re-run it whenever you add or change a document.
"""

import json
import re
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "data" / "docs"
OUT = ROOT / "api" / "chunks.json"

CHUNK_SIZE = 800      # characters per chunk (roughly)
OVERLAP = 150         # characters repeated from the end of the previous chunk
MIN_CHUNK = 80        # pieces shorter than this (e.g. an almost empty page) are skipped


# ---------- reading files ----------
def read_pdf(path):
    """Returns [(page_number, text), ...], one entry per page (numbers start at 1)."""
    reader = PdfReader(path)
    return [(i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)]


class _TextOnly(HTMLParser):
    """Collects the visible text of an HTML page (skips scripts, styles, menus)."""
    SKIP = {"script", "style", "noscript", "nav", "header", "footer", "svg"}

    def __init__(self):
        super().__init__()
        self.parts, self.skipping = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skipping += 1
        elif tag in {"p", "br", "div", "li", "h1", "h2", "h3", "h4", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skipping:
            self.skipping -= 1

    def handle_data(self, data):
        if not self.skipping:
            self.parts.append(data)


def read_html(path):
    parser = _TextOnly()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    return [(None, "".join(parser.parts))]


def read_txt(path):
    """A .txt can mark pages with lines like [[page 23]] (the page number in the original PDF),
    so citations still open the right page. Without markers the whole file is one page."""
    text = path.read_text(encoding="utf-8", errors="replace")
    parts = re.split(r"^\[\[page (\d+)\]\]\s*$", text, flags=re.M)
    if len(parts) == 1:
        return [(None, text)]
    return [(int(parts[i]), parts[i + 1]) for i in range(1, len(parts), 2)]


READERS = {".pdf": read_pdf, ".html": read_html, ".htm": read_html, ".txt": read_txt}


# ---------- cleaning ----------
def repeated_lines(pages):
    """Lines that appear at the top or bottom of many pages = headers/footers.
    Digits are ignored when comparing, so 'Page 3' and 'Page 4' count as the same line."""
    if len(pages) < 4:
        return set()
    counts = Counter()
    for _, text in pages:
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        edge = set(lines[:2] + lines[-2:])          # first 2 and last 2 lines of the page
        counts.update(re.sub(r"\d+", "#", l) for l in edge)
    return {line for line, n in counts.items() if n >= len(pages) * 0.4}


def clean(text, headers):
    lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line or re.fullmatch(r"\d{1,3}", line):            # empty, or just a page number
            continue
        if re.sub(r"\d+", "#", line) in headers:                    # repeated header/footer
            continue
        lines.append(line)
    text = "\n".join(lines)
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)                    # "combus-\ntion" -> "combustion"
    text = re.sub(r"\s+", " ", text)                                # all whitespace -> one space
    # PDF quirk: a capital letter split off its word ("R emoval", "B ecause").
    # "A" and "I" are real words, and "3-D" follows a hyphen, so those are left alone.
    text = re.sub(r"(?<![\w-])([B-HJ-Z]) (?=[a-z])", r"\1", text)
    return text.strip()


# ---------- splitting ----------
def split(text):
    """~CHUNK_SIZE characters per chunk, ~OVERLAP characters shared with the previous one,
    never cutting a word in half."""
    words = text.split(" ")
    chunks, start = [], 0
    while start < len(words):
        end, length = start, 0
        while end < len(words) and (length == 0 or length + len(words[end]) + 1 <= CHUNK_SIZE):
            length += len(words[end]) + 1
            end += 1
        chunks.append(" ".join(words[start:end]))
        if end >= len(words):
            break
        # step back from the end until we have ~OVERLAP characters to repeat
        back, overlap = end, 0
        while back > start + 1 and overlap < OVERLAP:
            back -= 1
            overlap += len(words[back]) + 1
        start = back
    return chunks


# ---------- main ----------
def main():
    sources = json.loads((DOCS / "sources.json").read_text(encoding="utf-8"))
    all_chunks = []

    for src in sources:
        path = DOCS / src["file"]
        reader = READERS.get(path.suffix.lower())
        if not path.exists():
            print(f"  MISSING  {src['file']} (listed in sources.json but not in data/docs/)")
            continue
        if not reader:
            print(f"  SKIPPED  {src['file']} (only .pdf, .html and .txt are supported)")
            continue

        pages = reader(path)
        # optional "pages": [[first, last], ...] in sources.json = only use those PDF pages
        # (e.g. skip long appendices or tables that are already in the cleaned data)
        if "pages" in src:
            keep = lambda n: n is not None and any(a <= n <= b for a, b in src["pages"])
            pages = [(n, text) for n, text in pages if keep(n)]
        headers = repeated_lines(pages)
        slug = re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")
        count = 0

        # chunks never cross a page, so every chunk keeps its own page number
        for page, raw in pages:
            for piece in split(clean(raw, headers)):
                if len(piece) < MIN_CHUNK:
                    continue
                count += 1
                all_chunks.append({
                    "id": f"{slug}-{count}",
                    "title": src["title"],
                    "url": src["url"],
                    "page": page,
                    "text": piece,
                })
        print(f"  {count:4d} chunks  {src['file']}  ({len(pages)} page(s), {len(headers)} header/footer line(s) removed)")

    OUT.write_text(json.dumps(all_chunks, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n{len(all_chunks)} chunks written to {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
