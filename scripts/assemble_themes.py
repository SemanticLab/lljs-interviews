"""Join the clusters, the names the readers gave them and the hand-made groups into data/themes.js.

    uv run --no-project python scripts/assemble_themes.py

Reads build/clusters.json (cluster.py), build/themes/cNN.json (one per cluster, written by the
agents that followed scripts/BRIEF_THEMES.md) and scripts/theme_groups.json. Passages a reader
listed as misfits lose their theme. Block and entity positions are those of data/corpus.js, so
run build_corpus.py first.
"""
import collections, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"


US = [(r"eighbour", "eighbor"), (r"rganis", "rganiz"), (r"\bcentre", "center"), (r"\bprogramme", "program"), (r"\btheatre", "theater")]


def us(x):
    """The readers mixed British and American spelling; the site uses American. Proper names
    (capitalised Centre, Theatre) are left alone."""
    if isinstance(x, list):
        return [us(v) for v in x]
    for a, b in US:
        x = re.sub(a, b, x)
    return x


def main():
    corpus = json.loads((BUILD / "corpus.json").read_text(encoding="utf-8"))
    site = json.loads((ROOT / "data" / "corpus.js").read_text(encoding="utf-8")[len("window.LLJS_CORPUS = "):].rstrip().rstrip(";"))
    block_at = {row[0]: i for i, row in enumerate(site["blocks"])}
    ent_at = {e["id"]: i for i, e in enumerate(site["entities"])}
    cl = json.loads((BUILD / "clusters.json").read_text(encoding="utf-8"))
    groups = json.loads((ROOT / "scripts" / "theme_groups.json").read_text(encoding="utf-8"))["groups"]
    group_of = {c: g["id"] for g in groups for c in g["clusters"]}
    asks = {q for d in corpus["docs"] for q in d["interviewers"]}

    ps = cl["passages"]
    names = {}
    for c in cl["clusters"]:
        f = BUILD / "themes" / f"c{c['id']:02d}.json"
        if not f.exists():
            sys.exit(f"no theme file for cluster {c['id']}")
        t = json.loads(f.read_text(encoding="utf-8"))
        if t["id"] != c["id"] or c["id"] not in group_of:
            sys.exit(f"cluster {c['id']}: wrong id in its theme file, or no group in theme_groups.json")
        names[c["id"]] = t
        for i in t.get("misfits", []):
            if 0 <= i < len(ps) and ps[i]["cluster"] == c["id"]:
                ps[i]["cluster"] = -1

    themes = []
    for c in cl["clusters"]:
        t = names[c["id"]]
        mine = [i for i in c["passages"] if ps[i]["cluster"] == c["id"]]          # most central first
        mine = [i for i in mine if ps[i]["core"]] + [i for i in mine if not ps[i]["core"]]
        tags = collections.Counter()
        for i in mine:
            seen = set()
            for b in ps[i]["blocks"]:
                seen.update(corpus["blocks"][b]["entities"])
            tags.update(seen - asks)
        themes.append({"id": c["id"], "name": us(t["name"]), "summary": us(t["summary"]), "threads": us(t["threads"]), "kind": t["kind"],
                       "coherence": t["coherence"], "group": group_of[c["id"]], "size": len(mine),
                       "interviews": len({ps[i]["doc"] for i in mine}), "passages": mine,
                       "entities": [[ent_at[q], n] for q, n in tags.most_common(14) if q in ent_at]})
    order = {g["id"]: k for k, g in enumerate(groups)}
    themes.sort(key=lambda t: (order[t["group"]], -t["size"]))
    out = {"model": "gemini-embedding-2",
           "groups": [{"id": g["id"], "name": g["name"], "colour": g["colour"]} for g in groups],
           "themes": themes,
           "passages": [[block_at[p["blocks"][0]], len(p["blocks"]), p["cluster"], 1 if p["core"] else 0, p["x"], p["y"],
                         [j for j, _ in p["related"][:4]]] for p in ps]}
    for p in ps:      # a passage is a run of consecutive blocks
        at = [block_at[b] for b in p["blocks"]]
        assert at == list(range(at[0], at[0] + len(at))), p["id"]
    (ROOT / "data" / "themes.js").write_text("window.LLJS_THEMES = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    themed = sum(1 for p in ps if p["cluster"] >= 0)
    print(f"{len(themes)} themes in {len(groups)} groups; {themed} of {len(ps)} passages have a theme")
    for t in themes:
        print(f"  {t['group']:8} c{t['id']:02d} {t['size']:3} passages {t['interviews']:2} interviews  {t['kind']:5} {t['coherence']}  {t['name']}")


if __name__ == "__main__":
    main()
