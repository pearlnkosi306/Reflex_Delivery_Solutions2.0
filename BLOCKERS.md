# Blocker Journal

A running log of real problems hit while building Reflex, in the order they came up — what the blocker was, why it mattered, how it got resolved, and what it changed going forward. Kept honest on purpose: a team that shows its own rough edges is harder to catch off guard than one that hides them.

---

### 1. Assumed the wrong library for Word docs

**Blocker:** Started planning the design document and trade-off log around `python-docx`, the more commonly known library for generating `.docx` files.

**Why it mattered:** Would have meant writing an entire generation script against the wrong API before finding out it doesn't apply here.

**Resolution:** Read the environment's actual docx skill documentation *before* writing any code, which specified `docx` (docx-js, a Node/JavaScript library) instead. Rewrote the generation approach around that from the start.

**Lesson:** Check the actual tool documentation before assuming based on what's most common elsewhere. This was worth doing once and then trusting for the rest of the build.

---

### 2. Same mistake, second tool: slides

**Blocker:** Same assumption problem, this time for the executive deck — expected `python-pptx`, actual tool is `pptxgenjs`.

**Resolution:** Same fix — read the skill doc first. It also specified real design constraints (a deliberate color palette, real icons instead of clip-art, no decorative "accent bar under every title" pattern) that meaningfully changed the deck's design, not just the code.

---

### 3. Table columns wider than the page

**Blocker:** The trade-off log's docx table was built with column widths that summed to 9.9 inches on a page with roughly 6.9 inches of usable width. The last column ran off the edge of the page.

**Why it mattered:** Caught by luck, not process — it only showed up because the doc was rendered to an image and actually looked at, not just assumed correct from the code.

**Resolution:** Rewrote the table helper to treat input widths as *ratios* that get normalized to fit the page, instead of trusting literal inch values. That class of bug can't recur now regardless of what numbers get passed in.

**Lesson:** Visual QA (render it, look at it) catches a category of bug that reading code never will.

---

### 4. A spreadsheet formula that looked wrong before anyone touched it

**Blocker:** The timing log's Variance column (`Actual − Planned`) showed a full negative number in every unfilled row before any real dry-run data had been entered, because a blank "Actual" cell evaluates to zero.

**Why it mattered:** A form meant to be filled in later shouldn't show numbers that look like real (wrong) data before anyone's touched it.

**Resolution:** Wrapped the formula in a blank-check (`=IF(Actual="","",Actual−Planned)`) so the cell stays empty until there's real data to compute against.

---

### 5. Lost the `path` parameter on a file-creation call — three times

**Blocker:** Called the file-creation tool without its required `path` argument on the first attempt at the redesigned prototype. It failed outright with no file written. It happened again on the very first attempt at *this file* — the one you're reading — while writing the entry below about it happening.

**Resolution:** Re-issued each call with all required parameters. Genuinely low-stakes each time (nothing was silently wrong, the tool just refused and said so), but worth logging accurately rather than rounding down, because that's exactly the kind of small process slip that repeats under time pressure — which this entry just demonstrated in real time.

**Lesson:** Say the real number, even when it's a little embarrassing that it went up while writing the sentence about it.

---

### 6. Platform constraints that don't show up until you read the fine print

**Blocker:** A handful of hard constraints specific to the interactive-prototype runtime aren't obvious from React/Tailwind knowledge alone:
- `<form>` tags aren't allowed — every "submit" is a plain button with an `onClick` handler instead.
- Tailwind's arbitrary-value syntax (`text-[11px]`, `w-[240px]`) silently does nothing, because there's no JIT compiler generating those classes on demand — everything has to be either a core Tailwind class or an inline style.
- The CSS `zoom` property, used for the text-size accessibility control, gets silently corrupted (`"1.1px"` instead of `"1.1"`) if you pass it to React as a raw number instead of a string, because React auto-appends `px` to numeric style values it doesn't recognize as unitless.

**Resolution:** Audited the whole file for each of these once identified, fixed every instance, then added them to a standing checklist for anything written afterward.

---

### 7. Couldn't verify icon names before using them

**Blocker:** The interactive prototype imports icons from `lucide-react`, but that package isn't installed in the sandbox used to write and check the code — so there was no way to `require()` it and confirm an icon name exists before using it. A broken import can crash the *entire* rendered app, not just the one button using it, since React throws when asked to render an undefined component.

**Resolution:** Restricted every new icon choice to names with very high confidence of existing (long-standing, extremely common icons — `Bike`, `Sun`, `Plus`, `Minus`, `Volume2`, and so on) and skipped anything uncertain in favor of a text-only label instead, even where a more specific icon would have been nice to have.

**Lesson:** When a risk can't be verified directly, reduce it by picking safer options rather than proceeding on assumed confidence.

---

### 8. Simulating "nearest rider" with no real GPS

**Blocker:** The dispatch agent needed a "distance" to rank riders by, but there's no real location data anywhere in a sprint-scale prototype.

**Resolution:** Wrote a deterministic hash of `(riderId + address)` that produces a stable, plausible-looking distance in kilometers — the same rider and address always produce the same number, so the demo doesn't visibly wobble between renders, but it's clearly documented in the code as simulated, not real geolocation.

---

### 9. Registry package installs blocked when producing this repo

**Blocker:** While assembling this GitHub repo, `npm install` failed with a `403 Forbidden` from the npm registry — and not just for one package. A plain, unscoped package (`lodash`) failed in a completely empty test directory with no other dependencies involved, which ruled out anything specific to this project's own `package.json`.

**Why it mattered:** The original plan was to run a real `npm install` and `npm run build` in the sandbox to verify this repo compiles cleanly before handing it over — the same "build it, then actually test it" approach used everywhere else in this sprint (see #3 and #4 above).

**Resolution:** Confirmed it's a sandbox-level restriction on live registry fetches, not a problem with the packages or this project's configuration — the same failure happened for a totally unrelated package in a brand-new directory. Rather than claim a build verification that didn't actually happen, this is being said plainly: **this repo has not been through a live `npm install && npm run build` in the environment that produced it.** What it has been through: a full JSX syntax check via the TypeScript compiler, and a set of structural checks (no stray `<form>` tags, no unsupported Tailwind syntax, balanced braces, exactly one default export, no leftover references to the old storage API). Those checks — plus the fact that only two small functions changed between the already-working interactive version and this one — make a clean `npm install && npm run dev` on a normal machine likely, but "likely" isn't "verified," and that distinction is worth stating outright rather than glossing over.

**Lesson:** When a planned verification step turns out to be unavailable, say so specifically, rather than quietly downgrading the claim or leaving it ambiguous.

---

### 10. The interactive version's storage doesn't exist outside Claude

**Blocker:** The interactive prototype relies on `window.storage`, a shared, cross-device key-value API that Claude's artifact runtime injects into the page — it isn't a real browser API and doesn't exist on a normally deployed website.

**Why it mattered:** Copying the component's code straight into this repo without changing anything would compile fine but fail at runtime the instant anyone tried to create or update a delivery, since `window.storage` would simply be `undefined`.

**Resolution:** Swapped those two functions for a `localStorage`-backed equivalent with the same `async` signatures, so nothing else in the ~1,400-line component had to change. Documented clearly, in both the code comments and the README, that this trades away the shared cross-device sync the Claude-hosted version has (including the "assign the same order from two open tabs" demo trick) in exchange for something that works with zero backend and zero configuration. Swapping in a real backend (Supabase, per the design document) is noted as the path back to genuine multi-device sync.
