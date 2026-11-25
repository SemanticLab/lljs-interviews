# Linking Lost Jazz Shrines: the interviews

A static site for searching and reading the 27 oral-history interviews of the Linking Lost
Jazz Shrines project (Weeksville Heritage Center recordings, 2008–2010), as they are held on
the [Semantic Lab Wikibase](https://base.semlab.io/wiki/Item:Q18807).

Open `index.html` in a browser, or serve the folder (`python3 -m http.server`). There is no
build step for the page and nothing is fetched at run time except portraits.

## What it does

| Page | Route | |
|---|---|---|
| Search | `#/` | Full-text search of every block, run in the browser. Words are ANDed, `"a phrase"` is exact, `word*` matches a beginning, plurals match singulars. Filters: tagged people and places (several at once), who is speaking, interview. Results show the matched words, the block's tags and its theme. |
| Read | `#/read/<doc QID>/<block local id>` | An interview opened at one block, with what was said before and after. "Read earlier" and "Keep reading" bring in more (the next blocks also arrive as you scroll), or show the whole interview. Tagged names in the text are links. The selected block shows its tags, its theme, its Wikibase item and similar passages in other interviews. |
| Interviews | `#/interviews` | The 27 interviews. |
| People & places | `#/entities` | The 937 tagged people, jazz shrines, groups and organizations, by kind, with counts. |
| Themes | `#/themes`, `#/theme/<id>` | 29 themes found by clustering, in five groups, with a map of the passages. |

Every search and every block is a link: the page keeps its state in the URL hash.

## Why the text ships with the site

The Wikibase gives a 399-character preview of each block (`P19`) and a link to the full text
on S3 (`P20`), one file per block. Searching the full text in the browser needs all of it at
once, and 3,314 requests on page load is not an option, so the build takes a snapshot. The
whole corpus is small: 672,558 characters, 913 KB as `data/corpus.js` with the tags and the
entity list, about 300 KB gzipped. The index (an inverted index with BM25 ranking) is built
in the page at load. The data files are scripts, not JSON fetched by the page, so the site
also works when opened from disk.

To pick up edits made on the Wikibase, rerun the build.

## Data

```
data/corpus.js   window.LLJS_CORPUS = { built, docs, entities, blocks }
                 blocks: [block QID, doc index, local id, speaker entity index (-1 none),
                          speaker name as printed when it differs, text, [entity indexes]]
data/themes.js   window.LLJS_THEMES = { model, groups, themes, passages }
                 passages: [first block index, block count, theme id (-1 none), core 0/1, x, y, [similar passages]]
```

27 interviews, 3,314 blocks, 7,195 tags to 937 entities (614 people, 171 jazz shrines).
The two transcripts marked "Do Not Use" on the Wikibase have no blocks and are left out.

## Rebuilding

All with `uv`; intermediate files go to `build/` (not committed).

```sh
uv run --no-project python scripts/build_corpus.py     # SPARQL + S3 -> build/corpus.json, data/corpus.js
uv run --no-project python scripts/embed.py            # passages + Gemini embeddings (needs $GOOGLE_AI)
uv run scripts/cluster.py                              # centering, UMAP, HDBSCAN -> build/clusters.json, build/packs/
#   ... one reader per cluster writes build/themes/cNN.json, following scripts/BRIEF_THEMES.md
uv run --no-project python scripts/assemble_themes.py  # -> data/themes.js
```

`build_corpus.py` cleans the block text for display: it removes the working marks left in a
few files (`‡`, `↓[n]`), decodes HTML entities and lifts the leading `Name:` off each block.
The speaker shown is the block's `P23`; the printed name is kept when there is no `P23`.

Only the first step is needed to refresh the text and tags. The theme steps need redoing
only when the text changes enough to matter, and they are not deterministic end to end
(see below).

## How the themes were made

1. **Passages.** Half the blocks are one short turn, too little to carry a subject. Blocks
   are joined, within an interview, until a passage has about 500 characters and the
   interviewer speaks again, so a question stays with its answer: 672 passages. (A first
   version cut on length alone and left 40 questions without their answers; they clustered
   together as two themes about nothing.)
2. **Embeddings.** `gemini-embedding-2`, 1,536 dimensions, with the clustering task prefix.
3. **Clustering.** Each interview's mean vector is subtracted first: before that, 83% of a
   passage's ten nearest neighbours were in its own interview; after, 20%. Then PCA (50),
   UMAP (10 dimensions), HDBSCAN with leaf selection, minimum cluster size 8: 29 clusters,
   170 passages outside any. A left-out passage is attached to a cluster when at least 7 of
   its 10 nearest clustered neighbours are in it (100 were); the other 70 have no theme.
4. **Reading.** Six Claude Opus agents each read four or five clusters in full and wrote a
   name, a summary, the threads inside the theme, a kind (story, meta, mixed), a coherence
   score and the passages that do not fit, following `scripts/BRIEF_THEMES.md`. The 71
   passages they listed as misfits lose their theme, which leaves 531 of 672 with one.
5. **Groups.** The five groups and their colours are hand-made (`scripts/theme_groups.json`).
   That file names clusters by number, so it must be redone after any re-clustering.

The summaries are a model's description of what the speakers say. They were not checked
line by line against the transcripts. Four themes are marked `mixed` by their readers
(coherence 2 or 3), and several themes about the clubs overlap ("Roll call of neighborhood
clubs", "Naming the clubs of the heyday", "Clubs people frequented, 1950s to 1970s").

The "similar passages" in the reader are the nearest passages by the same vectors, taken
from other interviews.

## Look

Paper, ink and type follow the sibling sites (`linked-jazz-lljs-network`,
`linked-jazz-lljs-map`): Baskerville for the voices, a sans for the interface, one gold
accent, the dark green panel for the map. The mark is `assets/lljs-icon.png`.

## Deployment

Pushing to `main` deploys the site to GitHub Pages through `.github/workflows/pages.yml`,
which publishes `index.html`, `app.js`, `style.css`, `assets/` and `data/` only.

## License

MIT, see `LICENSE`.
