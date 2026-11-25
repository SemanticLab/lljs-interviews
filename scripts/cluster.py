# /// script
# requires-python = "==3.12.*"
# dependencies = ["numpy", "scikit-learn", "umap-learn", "hdbscan"]
# ///
"""Cluster the passage embeddings and write a reading pack per cluster.

    uv run scripts/cluster.py

1. Subtract each interview's mean vector. Passages of one interview share speakers, names and
   a period, and without this step a passage's nearest neighbours are mostly its own interview.
2. PCA (50) -> UMAP (10 dimensions, cosine) -> HDBSCAN with leaf selection. (The default
   selection gives two clusters on a corpus this small: one of 753 passages and one of 41.)
3. A passage HDBSCAN leaves out is attached to a cluster when at least 7 of its 10 nearest
   clustered neighbours belong to it, and marked as not core. The rest have no theme.
4. A second UMAP in 2 dimensions gives the positions for the map on the site.

Writes build/clusters.json and build/packs/<cluster>.md (what the naming agents read).
"""
import collections, json
from pathlib import Path

import hdbscan
import numpy as np
import umap
from sklearn.decomposition import PCA

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SEED = 7
MIN_CLUSTER = 8
MIN_SAMPLES = 3
VOTE = 7


def unit(m):
    return m / np.linalg.norm(m, axis=1, keepdims=True)


def main():
    corpus = json.loads((BUILD / "corpus.json").read_text(encoding="utf-8"))
    ps = json.loads((BUILD / "passages.json").read_text(encoding="utf-8"))
    vj = json.loads((BUILD / "vectors.json").read_text())
    assert vj["ids"] == [p["id"] for p in ps]
    raw = unit(np.array(vj["vectors"], dtype=np.float32))
    docs = np.array([p["doc"] for p in ps])

    centered = raw.copy()
    for d in set(docs):
        centered[docs == d] -= centered[docs == d].mean(axis=0)
    centered = unit(centered)

    def same_doc_share(m):
        sims = m @ m.T
        np.fill_diagonal(sims, -1)
        nn = np.argsort(-sims, axis=1)[:, :10]
        return float((docs[nn] == docs[:, None]).mean())
    print(f"nearest 10 neighbours in the same interview: raw {same_doc_share(raw):.0%}, centered {same_doc_share(centered):.0%}")

    pcs = PCA(n_components=50, random_state=SEED).fit_transform(centered)
    emb10 = umap.UMAP(n_components=10, n_neighbors=10, min_dist=0.0, metric="cosine", random_state=SEED).fit_transform(pcs)
    labels = hdbscan.HDBSCAN(min_cluster_size=MIN_CLUSTER, min_samples=MIN_SAMPLES, cluster_selection_method="leaf").fit_predict(emb10)
    core = labels >= 0
    print(f"{labels.max() + 1} clusters; {int((~core).sum())} of {len(ps)} passages left out by HDBSCAN")

    # peripheral assignment: the cluster of at least VOTE of the 10 nearest core neighbours in
    # the 10-d space; a passage whose neighbours are split stays without a theme
    final = labels.copy()
    core_idx = np.where(core)[0]
    for i in np.where(~core)[0]:
        dist = np.linalg.norm(emb10[core_idx] - emb10[i], axis=1)
        near = core_idx[np.argsort(dist)[:10]]
        c, votes = collections.Counter(labels[near].tolist()).most_common(1)[0]
        if votes >= VOTE:
            final[i] = c
    print(f"{int(((final >= 0) & ~core).sum())} attached to a cluster, {int((final < 0).sum())} left without one")

    xy = umap.UMAP(n_components=2, n_neighbors=20, min_dist=0.25, metric="cosine", random_state=SEED).fit_transform(pcs)
    xy = (xy - xy.min(axis=0)) / (xy.max(axis=0) - xy.min(axis=0))

    # related passages: nearest by the centered vectors, other interviews only
    sims = centered @ centered.T
    related = []
    for i in range(len(ps)):
        s = sims[i].copy(); s[docs == docs[i]] = -1
        top = np.argsort(-s)[:5]
        related.append([[int(j), round(float(s[j]), 3)] for j in top if s[j] > 0.2])

    blocks, ents = corpus["blocks"], corpus["entities"]
    doc_name = {d["id"]: d["label"].replace(" Weeksville Oral History", "") for d in corpus["docs"]}
    order = sorted(set(final[final >= 0].tolist()), key=lambda c: -int((final == c).sum()))
    for f in (BUILD / "packs").glob("c*.md") if (BUILD / "packs").exists() else []:
        f.unlink()
    renum = {c: i for i, c in enumerate(order)}
    clusters = []
    (BUILD / "packs").mkdir(exist_ok=True)
    for old in order:
        cid = renum[old]
        members = np.where(final == old)[0]
        cen = unit(centered[members].mean(axis=0, keepdims=True))[0]
        close = centered[members] @ cen
        ranked = [int(members[j]) for j in np.argsort(-close)]
        per_doc = collections.Counter(docs[members].tolist())
        tags = collections.Counter()
        for i in members:
            seen = set()
            for bid in ps[i]["blocks"]:
                seen.update(blocks[bid]["entities"])
            tags.update(seen)
        clusters.append({"id": cid, "size": len(members), "core": int(core[members].sum()), "interviews": len(per_doc),
                         "top_interview_share": round(per_doc.most_common(1)[0][1] / len(members), 2),
                         "passages": ranked, "entities": [[q, n] for q, n in tags.most_common(15)]})
        lines = [f"# Cluster {cid}", "",
                 f"{len(members)} passages from {len(per_doc)} interviews ({int(core[members].sum())} core).", "",
                 "Interviews: " + "; ".join(f"{doc_name[d]} ({n})" for d, n in per_doc.most_common()), "",
                 "Most tagged entities: " + "; ".join(f"{ents[q]['label']} ({n})" for q, n in tags.most_common(15)), "",
                 "Passages, most central first. `core: no` marks a passage that was attached to the cluster afterwards.", ""]
        for i in ranked:
            text = ps[i]["text"] if len(ps[i]["text"]) <= 2400 else ps[i]["text"][:2400] + " [cut here; the passage continues]"
            lines += [f"## Passage {i} | {doc_name[ps[i]['doc']]} | core: {'yes' if core[i] else 'no'}", "", text, ""]
        (BUILD / "packs" / f"c{cid:02d}.md").write_text("\n".join(lines), encoding="utf-8")

    out = {"passages": [{"id": p["id"], "doc": p["doc"], "blocks": p["blocks"], "cluster": renum.get(int(final[i]), -1), "core": bool(core[i]),
                         "x": round(float(xy[i, 0]), 4), "y": round(float(xy[i, 1]), 4), "related": related[i]} for i, p in enumerate(ps)],
           "clusters": clusters}
    (BUILD / "clusters.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    for c in clusters:
        print(f"  c{c['id']:02d}  {c['size']:3} passages ({c['core']:3} core)  {c['interviews']:2} interviews  top share {c['top_interview_share']:.0%}  "
              + ", ".join(ents[q]["label"] for q, _ in c["entities"][:5]))


if __name__ == "__main__":
    main()
