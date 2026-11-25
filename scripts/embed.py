"""Group the blocks into passages and embed each passage with the Gemini embedding API.

    uv run --no-project python scripts/embed.py

Half of the blocks are a single short turn ("Yes indeed."), too little to carry a subject, so
consecutive blocks of one interview are joined until a passage holds about MIN_CHARS of speech
and the interviewer speaks again, so a question stays with its answer. A passage never crosses
an interview. Themes are found on
passages and every block inherits the theme of its passage.

Writes build/passages.json and build/vectors.json. Embeddings are cached by text under
build/cache/embeddings.jsonl, so a rerun only pays for passages that changed.
The Gemini key is read from $GOOGLE_AI (as in linked-jazz-segments) and sent in a header,
never in the URL.
"""
import hashlib, json, os, sys, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
MODEL = "gemini-embedding-2"
DIMS = 1536
MIN_CHARS = 500          # keep adding turns until a passage has this much
MAX_CHARS = 1800         # do not add a block that would push a passage past this
LEAD_IN = 300            # unless the passage so far is only a short lead-in to that block
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:batchEmbedContents"


def passages(corpus):
    out = []
    blocks, ents = corpus["blocks"], corpus["entities"]
    for d in corpus["docs"]:
        asks = set(d["interviewers"])
        question = lambda bid: bool(set(blocks[bid]["speakers"]) & asks)
        cur, size, mine = [], 0, []
        for bid in d["blocks"]:
            n = len(blocks[bid]["text"])
            # a passage ends where the interviewer speaks again, so a question stays with its
            # answer; a passage that is already long ends at any turn
            full = size >= MIN_CHARS and (question(bid) or size >= MAX_CHARS)
            too_big = size + n > MAX_CHARS and size >= LEAD_IN and not question(cur[-1]) if cur else False
            if cur and (full or too_big):
                mine.append(cur); cur, size = [], 0
            cur.append(bid); size += n
        if cur:
            if mine and size < MIN_CHARS / 2:
                mine[-1].extend(cur)          # a short tail joins the passage before it
            else:
                mine.append(cur)
        for i, ids in enumerate(mine):
            lines = []
            for bid in ids:
                b = blocks[bid]
                who = b["said_by"] or (ents[b["speakers"][0]]["label"] if b["speakers"] else "")
                lines.append((who + ": " if who else "") + b["text"])
            out.append({"id": f"{d['id']}.{i}", "doc": d["id"], "blocks": ids, "text": "\n".join(lines)})
    return out


def embed(texts, key):
    body = {"requests": [{"model": f"models/{MODEL}", "content": {"parts": [{"text": t}]}, "outputDimensionality": DIMS} for t in texts]}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Goog-Api-Key": key, "User-Agent": "transcript-embed/0.1"})
    for attempt in range(6):
        try:
            return [e["values"] for e in json.load(urllib.request.urlopen(req, timeout=180))["embeddings"]]
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:400]
            if e.code not in (429, 500, 503) or attempt == 5:
                sys.exit(f"embedding request failed: HTTP {e.code} {msg}")
            print(f"  HTTP {e.code}, waiting", flush=True)
            time.sleep(15 * (attempt + 1))


def main():
    key = os.environ.get("GOOGLE_AI") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        sys.exit("set GOOGLE_AI to a Gemini API key")
    corpus = json.loads((BUILD / "corpus.json").read_text(encoding="utf-8"))
    ps = passages(corpus)
    (BUILD / "passages.json").write_text(json.dumps(ps, ensure_ascii=False, indent=1), encoding="utf-8")
    sizes = sorted(len(p["text"]) for p in ps)
    print(f"{len(ps)} passages; characters: median {sizes[len(sizes) // 2]}, shortest {sizes[0]}, longest {sizes[-1]}")
    if "--dry" in sys.argv:
        return

    cache_file = BUILD / "cache" / "embeddings.jsonl"
    cache = {}
    if cache_file.exists():
        for ln in cache_file.open(encoding="utf-8"):
            r = json.loads(ln); cache[r["h"]] = r["v"]
    # gemini-embedding-2 takes the task as an instruction in the text; this is the clustering form
    wrap = lambda t: "task: clustering | query: " + t
    h = lambda t: hashlib.sha256((MODEL + str(DIMS) + wrap(t)).encode()).hexdigest()
    todo = [p for p in ps if h(p["text"]) not in cache]
    print(f"{len(todo)} to embed, {len(ps) - len(todo)} cached")
    with cache_file.open("a", encoding="utf-8") as fh:
        for i in range(0, len(todo), 20):
            chunk = todo[i:i + 20]
            for p, v in zip(chunk, embed([wrap(p["text"]) for p in chunk], key)):
                cache[h(p["text"])] = v
                fh.write(json.dumps({"h": h(p["text"]), "v": v}) + "\n")
            fh.flush()
            print(f"  {min(i + 20, len(todo))}/{len(todo)}", flush=True)
            time.sleep(1.0)
    (BUILD / "vectors.json").write_text(json.dumps({"ids": [p["id"] for p in ps], "vectors": [cache[h(p["text"])] for p in ps]}), encoding="utf-8")
    print("wrote build/vectors.json")


if __name__ == "__main__":
    main()
