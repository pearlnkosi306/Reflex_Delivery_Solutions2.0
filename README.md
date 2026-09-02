# Reflex — Delivery Coordination

Small Kenyan retailers (electronics shops, pharmacies, hardware stores) currently coordinate deliveries over WhatsApp threads and phone calls — no shared record, no live status, no proof of delivery. **Reflex** replaces that with one shared, role-based system: a retailer logs a request, an automatic dispatch agent offers it to the best available rider, the rider accepts and fulfills it, and everyone — retailer, dispatcher, rider — watches the same record update live.

Built for the Power Learn Project **Readiness Sprint**.

## What's in the prototype

- **Three role-gated views** — Retailer, Dispatcher, Rider — each with its own color, hero banner, and character illustration.
- **An automatic dispatch agent.** New requests are offered to the nearest *available* rider without a human clicking "assign." The rider has a 15-second window to Accept or Decline; a decline or timeout automatically re-offers the job to the next-best rider.
- **Affinity + fairness scoring.** The agent favors a rider who has previously delivered in that same area (they know the shortcuts) and nudges work toward riders with fewer total orders, so it doesn't pile onto the same one or two people. The reasoning is visible in each order's timeline.
- **Two confirmation pathways, scan or manual, at both ends.** Retailers can scan a saved customer QR or type details manually when logging a request; riders scan-or-type the order's ID to confirm pickup, and scan-or-type a customer confirmation code to confirm final delivery.
- **Simulated customer SMS** at every real milestone (assigned, picked up with an ETA, delivered), visible as a message log on each order.
- **A full accessibility panel** (bottom-right button): brightness, text size, dyslexia-friendly text, high contrast, an autism-friendly calmer mode, reduce-motion, and a working "read this page aloud."

## Tech stack

React 18 + Vite + Tailwind CSS, [lucide-react](https://lucide.dev) for icons. No backend — see **Known limitations** below.

## Getting started

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (typically `http://localhost:5173`).

To build a production bundle locally:

```bash
npm run build
npm run preview
```

## Deploying to GitHub Pages

This repo includes `.github/workflows/deploy.yml`, which builds and deploys automatically on every push to `main`.

**One-time setup**, after you push this repo to GitHub:

1. Go to your repo's **Settings → Pages**.
2. Under **Source**, choose **GitHub Actions** (not "Deploy from a branch").
3. Push to `main` (or re-run the workflow from the **Actions** tab).
4. Your live URL will appear at the top of the **Actions** run, and under **Settings → Pages** — it'll look like `https://<your-username>.github.io/<repo-name>/`.

Prefer a manual deploy instead? `npm run deploy` uses the included `gh-pages` package to push a build to a `gh-pages` branch — just make sure Pages is pointed at that branch instead if you go this route (don't mix both approaches on the same repo).

## Getting this onto GitHub

If you haven't pushed a repo before:

```bash
git init
git add .
git commit -m "Reflex prototype — Readiness Sprint"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

(Create the empty repo on GitHub.com first, without a README/license, so there's nothing to conflict with.) GitHub Desktop is a fine no-command-line alternative for the same steps.

## Known limitations

- **Storage is local to your browser.** The interactive Claude-hosted version of this prototype used a shared, cross-device storage API that only exists inside Claude's artifact runtime. That doesn't exist in a normal deployed website, so this build persists to `localStorage` instead — state lives on one device, in one browser, and won't sync to a teammate's laptop or your phone. See `BLOCKERS.md` for the full reasoning. To get real multi-device sync back, swap the `fetchDeliveries` / `persistDeliveries` functions near the top of `src/App.jsx` for calls to a real backend — the project's design document specifies Supabase (Postgres + Realtime + Row-Level Security) for exactly this reason.
- **No real authentication.** Switching roles in the header is a demo convenience, not a login system.
- **Distance and ETA are simulated**, not real GPS — see the `pseudoDistanceKm` note in `src/App.jsx`.
- **SMS is simulated in-app**, not sent through a real gateway (Africa's Talking is the recommended one in the design document).

None of these are accidents — each is a documented, deliberate scope decision for a sprint-length build, not a bug.

## Project structure

```
├── .github/workflows/deploy.yml   GitHub Pages auto-deploy
├── src/
│   ├── App.jsx                    Everything: state, the dispatch agent, all views
│   ├── main.jsx                   React entry point
│   └── index.css                  Tailwind directives
├── index.html
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── BLOCKERS.md                    Build journal — real blockers hit, how they were resolved
└── package.json
```

`App.jsx` is intentionally one file for now — it started as a single-file interactive prototype and splitting it into smaller components is a natural next step, not yet done (see `BLOCKERS.md`).
