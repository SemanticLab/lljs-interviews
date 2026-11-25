"""Snapshot the LLJS interview blocks from the Semantic Lab wikibase.

    uv run --no-project python scripts/build_corpus.py

SPARQL gives the documents, their blocks (order, speaker, tagged entities) and the
entities; the full text of each block comes from its P20 file on S3 (cached under
build/cache/texts/). Writes build/corpus.json, which the later steps read, and
data/corpus.js, which the site loads.
"""
import collections, concurrent.futures, html, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
CACHE = BUILD / "cache" / "texts"
UA = {"User-Agent": "semlab-data-process"}
SPARQL = "https://query.semlab.io/proxy/wdqs/bigdata/namespace/wdq/sparql"
PROJECT = "Q18807"          # Linking Lost Jazz Shrines
TRANSCRIPT = "Q1960"        # interview transcript
BLOCK = "Q2013"
SHRINE = "Q18806"


def sparql(q):
    url = SPARQL + "?format=json&query=" + urllib.parse.quote(q)
    for attempt in range(4):          # the query service now and then stalls mid-answer
        try:
            req = urllib.request.Request(url, headers=UA)
            return json.load(urllib.request.urlopen(req, timeout=60))["results"]["bindings"]
        except (TimeoutError, OSError) as e:
            if attempt == 3:
                raise
            print(f"  query failed ({e}), trying again", flush=True)
            time.sleep(5)


def qid(b, k):
    return b[k]["value"].rsplit("/", 1)[-1] if k in b else ""


def val(b, k):
    return b[k]["value"] if k in b else ""


def clean(text):
    """Display text of a block and the speaker name the transcript prints before it.

    Drops the working marks left in a few files (the entity dagger, the block arrows) and
    lifts a leading "Name:" off the first line."""
    t = html.unescape(text).replace("\u2021", "").replace("\r", "").replace("\u00a0", " ")
    t = re.sub(r"^\s*\u2193\[\d+\]\s*", "", t)
    t = "\n".join(re.sub(r"[ \t]+", " ", ln).strip() for ln in t.split("\n"))
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    m = re.match(r"^([A-Z][^:\n\[\]]{1,48}):\s*(?=\S)", t)
    name = ""
    if m and not re.search(r"\d", m.group(1)) and len(m.group(1).split()) <= 6:
        name, t = m.group(1).strip(), t[m.end():]
    return name, t


def fetch_text(url):
    """One block's text. Cached by document and local id."""
    m = re.search(r"/texts/(Q\d+)/([^/]+)\.txt$", url)
    path = CACHE / m.group(1) / (m.group(2) + ".txt")
    if path.exists():
        return path.read_text(encoding="utf-8")
    raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "semlab-data-process"}), timeout=60).read()
    text = raw.decode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text


def main():
    # ---- documents
    docs = {}
    for b in sparql(f"""SELECT ?d ?label ?date ?prec ?url WHERE {{
        ?d wdt:P1 wd:{TRANSCRIPT} ; wdt:P11 wd:{PROJECT} ; rdfs:label ?label . FILTER(LANG(?label)="en")
        OPTIONAL {{ ?d p:P98 ?st . ?st psv:P98 ?v . ?v wikibase:timeValue ?date ; wikibase:timePrecision ?prec }}
        OPTIONAL {{ ?d wdt:P12 ?url }} }}"""):
        d = docs.setdefault(qid(b, "d"), {"id": qid(b, "d"), "label": val(b, "label"), "interviewees": [], "interviewers": []})
        if "date" in b:
            p = int(val(b, "prec")); iso = val(b, "date")
            d["date"] = iso[:10] if p >= 11 else iso[:7] if p == 10 else iso[:4]
        if "url" in b:
            d["source"] = val(b, "url")
    for prop, key in (("P13", "interviewees"), ("P14", "interviewers")):
        for b in sparql(f"SELECT ?d ?p WHERE {{ ?d wdt:P1 wd:{TRANSCRIPT} ; wdt:P11 wd:{PROJECT} ; wdt:{prop} ?p }}"):
            if re.fullmatch(r"Q\d+", qid(b, "p")):                             # skips "unknown value"
                docs[qid(b, "d")][key].append(qid(b, "p"))

    # ---- blocks
    blocks = {}
    for b in sparql(f"""SELECT ?b ?d ?n ?url WHERE {{
        ?d wdt:P1 wd:{TRANSCRIPT} ; wdt:P11 wd:{PROJECT} . ?b wdt:P24 ?d ; wdt:P1 wd:{BLOCK} ; wdt:P17 ?n . OPTIONAL {{ ?b wdt:P20 ?url }} }}"""):
        blocks[qid(b, "b")] = {"id": qid(b, "b"), "doc": qid(b, "d"), "n": val(b, "n"), "url": val(b, "url"), "speakers": [], "entities": []}
    for prop, key in (("P23", "speakers"), ("P21", "entities")):
        for b in sparql(f"""SELECT ?b ?e WHERE {{ ?d wdt:P1 wd:{TRANSCRIPT} ; wdt:P11 wd:{PROJECT} . ?b wdt:P24 ?d ; wdt:P1 wd:{BLOCK} ; wdt:{prop} ?e }}"""):
            if qid(b, "b") in blocks and re.fullmatch(r"Q\d+", qid(b, "e")):   # skips "unknown value"
                blocks[qid(b, "b")][key].append(qid(b, "e"))
    docs = {k: v for k, v in docs.items() if any(b["doc"] == k for b in blocks.values())}
    missing = [b["id"] for b in blocks.values() if not b["url"]]
    if missing:
        sys.exit(f"{len(missing)} blocks have no text URL, e.g. {missing[:5]}")

    with concurrent.futures.ThreadPoolExecutor(12) as ex:
        for b, text in zip(blocks.values(), ex.map(fetch_text, [b["url"] for b in blocks.values()])):
            b["raw"] = text
            b["said_by"], b["text"] = clean(text)

    def order(n):
        try:
            return float(n)
        except ValueError:
            return 1e9
    by_doc = collections.defaultdict(list)
    for b in blocks.values():
        by_doc[b["doc"]].append(b)
    for d in docs.values():
        by_doc[d["id"]].sort(key=lambda b: order(b["n"]))

    # ---- entities: everything tagged on a block, plus speakers and the people of each document
    want = set()
    for b in blocks.values():
        want.update(b["entities"]); want.update(b["speakers"])
    for d in docs.values():
        want.update(d["interviewees"]); want.update(d["interviewers"])
    ents = {q: {"id": q, "label": q, "classes": []} for q in want}
    ids = sorted(want, key=lambda q: int(q[1:]))
    for i in range(0, len(ids), 150):
        chunk = " ".join("wd:" + q for q in ids[i:i + 150])
        for b in sparql(f"""SELECT ?e ?label ?desc ?wd ?img WHERE {{ VALUES ?e {{ {chunk} }}
            OPTIONAL {{ ?e rdfs:label ?label FILTER(LANG(?label)="en") }}
            OPTIONAL {{ ?e schema:description ?desc FILTER(LANG(?desc)="en") }}
            OPTIONAL {{ ?e wdt:P8 ?wd }} OPTIONAL {{ ?e wdt:P3 ?img }} }}"""):
            e = ents[qid(b, "e")]
            if "label" in b: e["label"] = val(b, "label")
            if "desc" in b: e["desc"] = val(b, "desc")
            if "wd" in b: e["wikidata"] = val(b, "wd")
            if "img" in b: e["image"] = val(b, "img")
        for b in sparql(f"SELECT ?e ?c WHERE {{ VALUES ?e {{ {chunk} }} ?e wdt:P1 ?c }}"):
            ents[qid(b, "e")]["classes"].append(qid(b, "c"))
        for b in sparql(f"SELECT ?e ?a WHERE {{ VALUES ?e {{ {chunk} }} ?e skos:altLabel ?a FILTER(LANG(?a)=\"en\") }}"):
            ents[qid(b, "e")].setdefault("aliases", []).append(val(b, "a"))
    class_ids = sorted({c for e in ents.values() for c in e["classes"]})
    class_label = {}
    if class_ids:
        chunk = " ".join("wd:" + q for q in class_ids)
        for b in sparql(f"SELECT ?e ?label WHERE {{ VALUES ?e {{ {chunk} }} ?e rdfs:label ?label FILTER(LANG(?label)=\"en\") }}"):
            class_label[qid(b, "e")] = val(b, "label")

    out = {
        "docs": [dict(d, blocks=[b["id"] for b in by_doc[d["id"]]]) for d in sorted(docs.values(), key=lambda d: d["label"])],
        "blocks": {b["id"]: {k: b[k] for k in ("id", "doc", "n", "speakers", "said_by", "entities", "text")} for b in blocks.values()},
        "entities": ents,
        "classes": class_label,
    }
    BUILD.mkdir(exist_ok=True)
    (BUILD / "corpus.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    write_site(out)
    chars = sum(len(b["text"]) for b in blocks.values())
    print(f"{len(out['docs'])} documents, {len(blocks)} blocks, {chars:,} characters, {len(ents)} entities, "
          f"{sum(len(b['entities']) for b in blocks.values())} tags")


def kind(e):
    """One display group per entity, from its classes."""
    c = set(e["classes"])
    if "Q1" in c: return "person"
    if SHRINE in c: return "shrine"
    if c & {"Q19072", "Q26025", "Q19103"}: return "place"            # venue, restaurant, museum
    if c & {"Q20618"}: return "school"
    if c and c <= TERMS: return "other"
    if any(x in GROUPS for x in c): return "group"
    if c & PLACES: return "place"
    return "org" if c else "other"


GROUPS, PLACES, TERMS = set(), set(), set()


def write_site(out):
    """data/corpus.js: the same snapshot, compact, as a script so the page also opens from disk."""
    for q, label in out["classes"].items():
        if label in ("music group",): GROUPS.add(q)
        if label in ("role", "kinship", "occupation"): TERMS.add(q)
        if label in ("borough", "country", "city", "neighborhood", "place", "state"): PLACES.add(q)
    used = collections.Counter()
    for b in out["blocks"].values():
        used.update(set(b["entities"]))
    people = set()
    for d in out["docs"]:
        people.update(d["interviewees"]); people.update(d["interviewers"])
    for b in out["blocks"].values():
        people.update(b["speakers"])
    ids = sorted(set(used) | people, key=lambda q: (-used[q], out["entities"][q]["label"]))
    index = {q: i for i, q in enumerate(ids)}
    ents = []
    for q in ids:
        e = out["entities"][q]
        row = {"id": q, "label": e["label"], "kind": kind(e), "n": used[q]}
        if e.get("desc"): row["desc"] = e["desc"]
        if e.get("aliases"): row["aliases"] = sorted(set(a for a in e["aliases"] if a != e["label"]))
        if e.get("wikidata"): row["wd"] = e["wikidata"]
        if e.get("image"): row["img"] = e["image"]
        ents.append(row)
    docs, blocks = [], []
    for d in out["docs"]:
        first = len(blocks)
        for bid in d["blocks"]:
            b = out["blocks"][bid]
            sp = index[b["speakers"][0]] if b["speakers"] else -1
            said = b["said_by"] if (sp < 0 or b["said_by"] != out["entities"][b["speakers"][0]]["label"]) else ""
            blocks.append([bid, len(docs), b["n"], sp, said, b["text"], sorted(index[q] for q in set(b["entities"]))])
        docs.append({"id": d["id"], "name": re.sub(r"\s+Weeksville Oral History$", "", d["label"]), "label": d["label"],
                     "date": d.get("date", ""), "source": d.get("source", ""),
                     "interviewees": [index[q] for q in d["interviewees"]], "interviewers": [index[q] for q in d["interviewers"]],
                     "first": first, "count": len(blocks) - first})
    site = {"built": __import__("datetime").date.today().isoformat(), "docs": docs, "entities": ents, "blocks": blocks}
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "corpus.js").write_text("window.LLJS_CORPUS = " + json.dumps(site, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")


if __name__ == "__main__":
    main()
