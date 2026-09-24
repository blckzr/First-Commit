# First Commit: Design System Provenance

| | |
|---|---|
| **Source** | claude.ai design project `f4e40614-da82-42d9-ba7c-912150c70e95`, file `First Commit.dc.html` |
| **Design system** | TechMatch Design System (`techmatch-design-system-ae95e92c`) |
| **Related documents** | [design.md](design.md), [task-tracker.md](task-tracker.md) |
| **Version** | 0.1 |

This file records where the visual system came from, what in it is a substitution rather
than a brand decision, and what was changed on the way into the codebase. It exists because
`design.md` §3 is a defended document, and a reader is entitled to ask where its palette
came from.

---

## 1. What the source is

A clickable prototype of the whole platform — **31 routes** across public, onboarding,
learner, and admin — built on a 25-component design system with a full token set.

**`First Commit.dc.html` is the authority on what a screen looks like.** The ASCII sketches
in `design.md` §5 say what is *on* a screen; the prototype says how it is built, screen by
screen, with real measurements.

The design system also ships **UI kits** of its own — `ui_kits/marketing/` and
`ui_kits/app/`. `ui_kits/app/` is a generic learning app: `AppShell`, `Dashboard`,
`LessonPlayer`. It is **not** First Commit, and it disagrees with the prototype on the
frame itself — an ink sidebar under a white top bar, where First Commit has an ink pill
above a white sidebar panel. It is useful for seeing how the system composes its parts,
and it is not a substitute for the prototype.

## 2. What the design system's own readme discloses

The system was generated from **one 736×1307 flattened JPG** of a marketing homepage. Its
readme is explicit about the consequences, and they are quoted here rather than paraphrased:

- **The artwork and the brief describe different products.** The source artwork sells tech
  gadgets; First Commit is a learning platform. The system keeps the artwork's visual
  language and retargets its content.
- **Colours were sampled from a lossy JPG** by averaging pixel regions, so the hex values
  are, in its words, *"close but not authoritative."*
- **Both typefaces are Google Fonts substitutions**, not supplied brand fonts. Plus Jakarta
  Sans stands in for the artwork's geometric grotesque; JetBrains Mono was chosen because a
  platform teaching code needs a monospace and the artwork shows none.
- **The icons are Lucide**, a documented substitution for an icon set that could not be
  extracted from a flattened image.
- **There is no logo.** The wordmark is set in type, with the second word in lime. The
  `code-xml` glyph beside it is a placeholder, not a brand mark.

None of this makes the system unusable — it is coherent and well specified. It does mean
the palette should not be described as derived from First Commit's own brand, because there
isn't one yet.

## 3. What changed on the way in

### 3.1 Contrast

Adopting the system unaltered would have broken the WCAG 2.2 AA target in `design.md` §12.
Measured ratios, computed from the token values:

| Pair | Ratio | Verdict |
|---|---|---|
| `--text-accent` (lime-600) on white | **1.98:1** | fails 4.5:1 for text |
| lime-700 on white | **3.11:1** | still fails 4.5:1 |
| `--border-strong` (`#CFC8DE`) on white | **1.62:1** | fails 3:1 for a control edge |
| lime-400 fill on the page | **1.38:1** | fails 3:1 for a control boundary |
| lime fill on its progress track | **1.08:1** | fails 3:1 |

The system's signature move is a single lime-highlighted phrase per headline, which is safe
on ink (13.1:1) and unsafe on light surfaces. Four corrections were made:

1. **Lime is a fill colour and an on-ink text colour, never text on a light surface.** On
   light panels the accent phrase uses `--text-accent` (violet-700, 8.26:1). The design's
   character is preserved — the lime CTA, the lime progress fill, the accent word on dark
   panels all stay.
2. **`--border-control` (`#847C93`, 3.97:1 on card / 3.36:1 on page)** was added for the
   edges of inputs, unchecked boxes, radios, outline buttons, and tags, where the border is
   the only thing identifying the control. `--border-subtle` remains for decorative rules.
3. **A lime fill carries a 1px `--border-accent` (`--lime-800`) edge**, giving the primary
   button a 3.88:1 boundary against the page.
4. **The progress fill carries the same edge**, at 3.47:1 against its track. On ink the edge
   is dropped, since lime there is already 12.6:1.

After the corrections, all 28 checked pairs pass — 4.5:1 for text, 3:1 for UI components.

### 3.2 Status colours

The system's status family (`--green-500` `#3FA96B` at 2.96:1, and similar) fails 4.5:1 as
text. Each status therefore has a **text** value that passes and a lighter **fill/tint**
value for icons and backgrounds. The text values are carried over from the platform's
earlier palette, which was built to pass.

### 3.3 A token name collision in the source

The system defined `--text-body` twice — as a colour in `colors.css` and as `15px` in
`typography.css`. Because `styles.css` imports typography after colours, `--text-body`
resolved to a length, and `base.css`'s `color: var(--text-body)` was invalid, so body text
fell back to an inherited colour. Here the size is `--text-body-base` and `--text-body`
stays the colour.

### 3.4 Interaction state moved from JavaScript to CSS

The system's components drove hover and press with `React.useState` plus `onMouseEnter` /
`onMouseDown`. The port uses CSS Modules with `:hover`, `:active`, and `:focus-visible`,
which `design.md` §13.1 already specified. This removes a re-render per interaction, gives
keyboard users the focus ring the original had no treatment for at all, and lets
`prefers-reduced-motion` be honoured in CSS.

### 3.5 Read and current are not one state

The system's `LessonRow` models a lesson as `todo | active | done`, which is right for a
video course: the lesson you are on is by definition the one you have not finished. A
First Commit lesson is read by pressing "Mark as read" and **stays open afterwards**, so
it is routinely both at once. Ported as one value, the tick disappeared from the row the
learner was standing on — which a test caught. The port takes `done` and `current` as
separate props.

The same row needed three contrast corrections: the current lesson's disc moved from
`--violet-500` (white on it is **3.98:1**) to `--violet-600` (5.65:1); an unread number
moved from `--text-faint` on `--surface-inset` (**2.65:1**) to `--text-muted` (4.88:1);
and because `--text-muted` measures **4.44:1** on the current row's violet tint, a row
that is both read and current keeps `--text-strong`.

### 3.6 Icons

The system's `Icon` fetched each SVG from unpkg at runtime. The port uses `lucide-react`, so
glyphs are bundled and tree-shaken with no network round trip and no
`dangerouslySetInnerHTML`. `Icon.tsx` remains the single swap point, as the readme intends.

## 4. What was ported and what was not

The prototype uses **12 of the 25** components. Those, plus `Card` and `IconButton`, were
ported — 14 in total, with `LinkButton` added so navigation controls are anchors rather
than buttons wrapping anchors.

**`LessonRow` was added later, in the learner design pass.** It was first left behind as
course-shop furniture; that was wrong. The module page's lesson rail is exactly this row,
and `design.md` §5.9 gives it the same three states. What it is *not* is the source's
version — see §3.5.

**Deliberately not ported:** `CourseCard`, `ReviewCard`, `CollectionCard`,
`CategoryTile`, `ComparisonTable`, `CarouselDots`, `StatItem`, `RangeSlider` — these belong
to the source's course-shop product. `NavBar` and `Footer` are marketing chrome, replaced by
`LearnerShell` and `AdminShell` per `design.md` §13.2.

Eighteen Lucide glyphs are in use: `arrow-left`, `arrow-right`, `award`, `bell`, `check`,
`chevron-down`, `circle`, `circle-dot`, `code-xml`, `copy`, `external-link`, `flag`, `info`,
`lock`, `log-out`, `search`, `settings`, `user`, `wrench`, `x`.

## 5. Route coverage

The prototype covers 31 routes. Against `design.md` §4.3 it **does not cover five**, and
these still need designing:

| Missing route | What it is |
|---|---|
| `/forgot-password` | Request a reset link |
| `/reset-password` | Set a new password |
| `/verify/:code` | **Public certificate verification** — mobile-first, opened from a QR code |
| `/app/notifications` | The notifications list |
| `/admin/certificates` | Certificate templates, lookup, revoke, reissue |

It **adds two** the document does not list: `/app/profile` and `/admin/profile`. `design.md`
§4.3 folds profile into `/app/settings`; either the document or the prototype should move.

**The other 26 were the ones that went wrong.** Only the five above were ever turned into
tasks, because "the prototype covers it" was read as *needs no design work* when it means
the opposite: the design exists and has to be applied. Four learner screens were then
built from `design.md` §5's behaviour alone and never given the system's vocabulary —
panels, the ink surface, the accent phrase. `task-tracker.md` now tracks **all 31**, with
a state per route, so a covered route is visible rather than absent.

## 6. If the real brand assets arrive

The substitutions are all isolated, so replacing them is small:

- **Fonts** — change `--font-display`, `--font-body`, `--font-mono` in
  `apps/web/src/styles/tokens.css`. Nothing else names a family.
- **Icons** — change `apps/web/src/components/core/Icon.tsx`. Nothing else imports the icon
  library.
- **Logo** — replace the `code-xml` glyph in `LearnerShell` and `Landing`.
- **Colours** — if original design files exist, correct the token values against them; the
  contrast checks in §3.1 must be re-run afterwards.
