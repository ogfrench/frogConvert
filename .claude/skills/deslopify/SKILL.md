---
name: deslopify
description: >-
  Detect and remove AI writing tells in marketing, brand, deck, landing-page,
  and UI copy. Use when reviewing or auditing copy for "AI vibe", checking
  whether text reads as machine-written, killing the "not X, it's Y" flip, or
  cleaning up brand/marketing/pitch copy. Produces a catalog of anti-patterns
  plus a line-by-line review with verdicts and fixes. Complements humanizer:
  humanizer rewrites prose at length; this one audits copy and flags structural
  tells like repeated antithesis, then fixes surgically. Runs as the cleanup pass
  after frogify. Triggers: "AI anti-patterns", "does this sound AI", "review my
  copy", "remove AI tells", "copy review", "deslopify this", "deslop this",
  "/deslopify".
---

# deslopify — AI copy anti-patterns

Audit short-form copy (headlines, decks, landing pages, taglines, UI strings, B2B
marketing) for the patterns that make writing read as machine-generated, then fix
them surgically without flattening the voice.

The work is two passes: **list the relevant patterns**, then **review the copy
line by line** with a verdict and a fix for each offender.

## The meta-rule

The strongest tell is rarely a single word. It is **a structure used more than
once**. One antithesis ("A. But B.") is a strong line. The third one in a deck is
a tic. When you review, track *shapes* across the whole piece, not just lines in
isolation. Repetition of a rhetorical move is itself an anti-pattern.

**Earned vs. tic.** A single deliberate antithesis that lands a real point is craft,
not slop ("a chasm, not a step"). Keep it. The tell is the *reflexive* flip — the
same move two or three times, or used to fake profundity where a plain claim would
do. Cut those; protect the one that works.

## The catalog

### Structure tells
1. **Negative-parallelism flip** — "not X, it's Y" / "isn't just X, it's Y" / a
   trailing "X, not Y". Fake profundity when reflexive. The most common tell. Keep
   at most one earned instance; rewrite the rest as a plain positive claim.
2. **Rule of three** — forced abstract triads ("faster, smarter, stronger").
   Concrete lists of three real items are fine; invented triads are the tell.
3. **Antithesis on repeat** — the two-beat "A. But B." contrast. Keep it on the
   hero line at most; flatten the rest to declaratives.
4. **Staccato drama** — a run of short fragments to manufacture gravitas ("It
   arrived. Nothing was the same. The rules broke."). One short line for emphasis
   is fine; a run is theatre.
5. **Em/en-dash overuse** — dramatic dashes where a period, comma, or colon works.
6. **False range** — "from X to Y" where X and Y are not a real scale.
7. **Empty profundity / cryptic metaphor** — a line that sounds sharp but does not
   decode. Stacked metaphors are the usual culprit: "The brand still wins the run; the
   page AI reads belongs to its challengers" reads as deep and tells the reader
   nothing literal (wins what? which page? belongs how?). Also covers the point left
   to pure inference. Run the decode test (below). If you cannot state the literal
   claim in plain words, rewrite it explicit.

### Vocabulary tells
8. **Inflated significance** — "in an age where", "a pivotal/defining moment", "a
   new era", "redefining", "the future of", "ushering in".
9. **Promotional adjectives** — seamless, robust, powerful, cutting-edge,
   world-class, vibrant, game-changing, best-in-class.
10. **Hype verbs** — unlock, supercharge, elevate, leverage, harness, revolutionize,
    empower, transform-as-filler.
11. **Buzzword stacking** — AI-powered, data-driven, end-to-end, next-gen, holistic,
    turnkey.
12. **Copula avoidance** — "serves as / stands as / acts as" instead of plain "is".
13. **"-ing" tail padding** — "..., driving growth, empowering teams, ensuring
    success." Cut the participle clauses or make them real sentences.
14. **Aphorism formula** — "X is the new Y", "data is the new oil", "X becomes a
    trap", "the language of Y".

### Tone tells
15. **Vague authority** — "industry leaders agree", "studies show", "it's well
    known". Name the source or cut the claim.
16. **Conversational hooks** — "Here's the thing", "Let's be honest", "The truth
    is", "Honestly?" as a fake-candid opener.
17. **Generic upbeat closer** — "the future is bright", "exciting times ahead",
    "the possibilities are endless".
18. **Second-person chumminess** in a B2B/brand context — consumer-app "you" and
    "your year" where third-person about the brand is more professional.
19. **Meta copy / talking to yourself.** Copy that explains the artifact's own
    methodology, defends its own credibility, or instructs the reader on the
    interface: "scored on evidence the team can point to", "select one for the
    rationale", "click below to expand", "in this section we will". It is written
    for the author, not the audience. The reader does not care how it was made; they
    care what it says. Cut it and let the work speak for itself. If a mechanic truly
    needs explaining, the design should show it, not a line of copy.
20. **Hedging / filler** — "arguably", "it's worth noting", "in order to", "at the
    end of the day".

### Mechanical tells
21. **Title Case Headings**, emoji decoration, and boldface sprayed across phrases.
22. **Curly quotes** mixed with other tells; **synonym cycling** (elegant variation)
    where one noun keeps changing to avoid repetition.

## What NOT to flag (false positives)

- **Verbatim quotes** (including quoted AI output as evidence). The machine tone is
  authentic and must stay.
- **A concrete list of three** real, specific items. Rule of three only applies to
  abstract, invented triads.
- **One** antithesis or **one** short emphatic fragment. The tell is repetition. A
  frog-style "X, not Y" that lands a real point is craft — leave it.
- **Domain terms** that are simply correct (a real product name, a real metric).
- **A single common transition** ("however", "additionally"). Tells cluster; one is
  nothing.

When unsure, look for a **cluster** of tells, not an isolated one.

## The review process

1. **Read the whole piece first.** Note recurring shapes (how many antitheses, how
   many triads, how many grand openers).
2. **Run the decode test on every line.** State its literal claim in plain words. If
   you cannot, or it needs a second read, flag it as too implicit (tell #7) and
   rewrite it explicit before checking anything else. Cryptic is a tell, not a style.
3. **Go line by line.** For each line output a row: the line, a verdict
   (✅ clean / ⚠️ borderline / ❌ tell), and a one-line fix for anything not clean.
4. **Write a verdict** with the fixes ordered by priority. Lead with structural
   repetition (the meta-rule), then single-line tells, then mechanical nits.
5. **Offer the surgical fix.** Propose the smallest set of edits that removes the
   tells without rewriting clean lines or killing the intended voice. Do not
   touch lines that are already clean.

## Output format

```
## Catalog (relevant patterns for this copy)
<short list of the patterns that actually apply here>

## Review
| Line | Verdict | Fix |
|------|---------|-----|
| "<line>" | ✅ / ⚠️ / ❌ | <fix or note> |

## Verdict
1. <highest-priority issue, usually a repeated structure>
2. <single-line tells>
3. <nits, or "leave as-is" calls>

<one-line offer to apply the surgical fixes>
```

## Principles

- **Surgical, not scorched.** Remove tells; keep the writer's voice and any line
  that already works. The goal is copy that reads like a sharp human wrote it, not
  copy sanded into neutral mush.
- **Protect the earned move.** One antithesis that lands is craft. Kill repetition,
  not rhythm.
- **Positive over negated.** Most flips ("not X, it's Y") become stronger as a
  direct positive claim.
- **Explicit over implied.** If the reader has to infer the point, state it.
- **Concrete beats grand.** Replace "a new era has arrived" with the specific thing
  that changed.
- **Count the shapes.** If the same rhetorical move appears three times, that is the
  finding, even when each instance reads well alone.
- No em dashes in the rewrite. Straight quotes. Sentence-case headings.
