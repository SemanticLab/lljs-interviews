# Brief: naming the themes of the Linking Lost Jazz Shrines interviews

## What this is

Linking Lost Jazz Shrines is an oral-history project of the Weeksville Heritage Center about
the jazz life of central Brooklyn: the clubs, bars, lofts, churches and cultural centres
("shrines"), the musicians who played them and the people who ran them and went to them.
Twenty-seven interviews were recorded, most by Willard Jenkins, some by Maxine Gordon and
Jennifer Scott.

The transcripts were cut into passages of a few turns each (672 in all), a question always with its answer, each passage was
embedded, and the embeddings were clustered. You are given some of those clusters. For each
one, read its passages and say what the cluster is about, so that a visitor to the project's
site can browse the interviews by theme.

## What you read

One file per cluster in `build/packs/`, named `cNN.md`. A pack gives the number of passages,
the interviews they come from, the entities most often tagged in them, and then the passages
themselves, most central first, each under a heading

    ## Passage 170 | James Spaulding | core: yes

The number is the passage's id. `core: yes` means the clustering put the passage in this
cluster outright. `core: no` means the passage sat between clusters and was attached to this
one afterwards because its nearest neighbours are here; such passages fit less often.

Read every passage in the pack. Decide the theme from the core passages. A long passage is
cut at 2,400 characters in the pack, which is marked.

## What you write

One JSON file per cluster, `build/themes/cNN.json`, UTF-8, exactly this shape:

```json
{
  "id": 5,
  "name": "The Fulton Street club circuit",
  "summary": "Two to four sentences.",
  "threads": ["three to six short phrases"],
  "kind": "story",
  "coherence": 4,
  "misfits": [412, 630]
}
```

- **name**: two to six words, a noun phrase, sentence case. It must tell this theme apart
  from the other themes of a collection that is entirely about Brooklyn jazz, so "Jazz in
  Brooklyn", "Memories of the scene" or "Clubs and musicians" are useless. Name the actual
  subject: a kind of place, a practice, a period, a conflict, a question the interviewer keeps
  asking. Use a proper name in the title only when the cluster really is about that one place,
  person or organisation. No colon, no quotation marks, no "and more".
- **summary**: what the passages say, as a reader would want it before opening them: what is
  being remembered or argued, by what kinds of people, about which years and places where the
  passages say so. Name two to five of the people or places that carry the theme. Where the
  speakers disagree or remember differently, say so. Write it in your own words. Do not quote
  a sentence; a quoted phrase of up to five words is fine when the wording itself matters.
  Report only what the passages say. Do not add jazz history from your own knowledge.
- **threads**: the three to six narrower subjects that recur inside the theme, each a short
  phrase a reader could scan ("house bands and jam sessions", "why the clubs closed").
- **kind**: `story` when the passages share a subject; `meta` when what they share is the
  mechanics of an interview (introductions, where were you born, thanks, a recording being
  set up, people talking over each other in a car); `mixed` when you can find two or three
  subjects and no single one.
- **coherence**: 1 to 5. 5 = nearly every core passage is plainly about the named subject.
  3 = a recognisable subject with a fair number of strays. 1 = no common subject.
- **misfits**: the ids of passages that are plainly not about the theme you named. Be strict
  about `core: no` passages and lenient about core ones. An empty list is fine. Do not list a
  passage only because it is short or because it touches the subject from an odd angle.

## Rules

- Write only the files `build/themes/cNN.json` for the clusters you were given. Do not edit
  anything else and do not run the build scripts.
- Work from the pack files. You do not need the network.
- Plain, concrete English. No headline style, no "tapestry", "vibrant", "rich history".
- Spell names as the passages spell them.
- When all your files are written, reply with one line per cluster: id, name, kind, coherence.
