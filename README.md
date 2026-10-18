# LemmeTeach

A subscription AI tutor that solves the learner's own questions. They type a question, paste a screenshot of it, or attach the file it is in; it is worked through on a whiteboard one step at a time and explained aloud, and they can stop it at any point to ask something. It has dedicated guidance for math, physics, chemistry, computer science, biology, finance and psychology, and a general mode for any other subject.

There are two ways in. Someone with their own API key from an AI service — Anthropic, OpenAI, Google, Mistral, Groq, DeepSeek, xAI, OpenRouter and several others — pastes it and pays that service directly; we charge nothing. Everyone else subscribes.

Subscribers pay monthly through Lemon Squeezy. Each plan includes a fixed amount of AI credit, which is provisioned automatically as a spend-capped OpenRouter key. Solving runs in the learner's browser and calls the model directly; the only backend is two small functions that handle billing.

This README is for whoever runs the product. The full specification is [CLAUDE.md](CLAUDE.md).

---

## Plans and margin

| Plan | Price / month | AI credit | Shown as |
|---|---|---|---|
| Starter | $8 | $4.25 | about 280 questions |
| Regular | $12 | $7.75 | about 500 questions |
| Intensive | $20 | $14.75 | about 950 questions |

Every plan keeps at least $2 per subscriber per month after Lemon Squeezy's fees, its payout fee, OpenRouter's fee on the credit, and a $0.25 allowance for hosting, assuming the learner spends all their credit. Unspent credit does not roll over and is extra margin. There is no per-user storage cost, because a learner's data is stored in their own browser.

The table, the fee assumptions and the maths live in [shared/plans.ts](shared/plans.ts). The landing page and the billing functions both read from it, and [shared/plans.test.ts](shared/plans.test.ts) fails if a price change drops any plan below $2.

### Why a plan covers so many questions

Every turn re-sends the instructions, the tool definitions and the conversation, and a question is about fifteen turns. So:

- **A question already solved is not sent again.** Asking the same thing, or pressing Replay under Recently solved, plays the saved solution back through the board and voice with no request at all.
- **Smaller requests.** The fixed part of each solver turn went from about 6,050 tokens to about 3,750, mostly by not describing the board's operations twice. A test fails if it grows past 4,200.
- **A short conversation.** Older steps are replaced by a brief summary once the conversation passes about 8,000 tokens.
- **Fewer turns.** The note and the finish go in one turn; a step's numbers are computed in one call.
- **Prompt caching** through OpenRouter, which bills the repeated part at a tenth of the price.
- **A small, cheap model:** Claude Haiku 5.5, at $0.10 per million input tokens and $0.50 per million output.

The question counts assume 1.5 cents a question. That comes from measured prompt sizes — roughly 1.1 cents without caching and half a cent with it — but not yet from a live key. Measure it before launch and correct `TYPICAL_LESSON_USD` in [shared/plans.ts](shared/plans.ts).

---

## Going live

1. **OpenRouter.** Create an account, add credit, turn on auto top-up so the balance cannot run dry, and create a management key.
2. **Lemon Squeezy.** Create one subscription product with three monthly variants at the prices above. On each variant, turn on license keys. Set the product's post-purchase redirect to `https://<your-site>/?activate`.
3. **Vercel.** Import this repository. Build command `npm run build`, output directory `dist`. Add the environment variables listed in [.env.example](.env.example).
4. **Webhook.** In Lemon Squeezy, add a webhook to `https://<your-site>/api/webhook` with a signing secret, subscribed to `subscription_created`, `subscription_updated`, `subscription_expired` and `order_refunded`.
5. **Test.** With Lemon Squeezy in test mode, buy a plan, paste the license key on the site, and solve a typed question and a screenshot. Then cancel and confirm the key is disabled when the subscription expires.

Vercel's free Hobby plan is for non-commercial use, so a site that takes payments needs Vercel Pro.

Without any environment variables the site still builds and runs as a demo: the five prepared questions can be solved, and the plan buttons are disabled.

---

## How it works

### Solving runs in the browser

Three agents share one model gateway and one tool bus. Each is a system prompt, a tool allowlist and a budget:

| Agent | Does | Turns |
|---|---|---|
| Reader | Reads the question and anything attached, restates it in full, plans the solution | 6 |
| Solver | Works it through on the board, one move per step, explaining aloud | 40 |
| Repairer | Fixes board operations that failed validation | 2 |

Only the reader sees an uploaded screenshot or PDF. It restates the question in words and the solver works from that, so a picture is sent once rather than on every step.

The reader may ask one clarifying question, and only when part of an upload cannot be read or the question is ambiguous. The solver cannot ask the learner anything: there are no quizzes and no exam.

The learner can stop it at any point and ask, by typing or by voice. The solver answers in one step, the learner is asked whether that made sense, and only when they say yes does the solution carry on from where it stopped. The session enforces that wait; the model does not get to decide the learner has understood.

Everything written stays on the board, which scrolls, so any earlier step can be looked at again.

The solver never writes SVG, HTML or coordinates. It emits board operations such as `derive`, `plot` and `diagram`, and the renderer owns the layout. Every operation is validated before it is drawn.

The model writes steps faster than a voice can speak them, so the session holds it one step ahead of the narration. Every step is spoken in order, and the summary appears only after the last one.

Code the solver runs executes in a sandboxed iframe with no network. Solved questions are stored in the learner's browser and nowhere else.

### Using your own key

A pasted key is recognised by its shape where it has one (a Mistral key is 32 letters and digits with no prefix, so the screen also lets the learner say which service it is from), checked with one read-only request to that service and no other, and stored in the browser. The model is chosen automatically: a small, fast one the key can use. Services that speak the OpenAI format run on the shared adapter with a per-service note of where they differ. Our servers take no part in this path. The code is in [src/providers/own-key.ts](src/providers/own-key.ts).

### Improving it

[src/agents/skills.ts](src/agents/skills.ts) is a short, versioned list of instructions the solver needs because a real run got something wrong; add to it one line at a time. [evals/golden.json](evals/golden.json) is twelve questions with known answers to run before and after any prompt or model change. There is no automatic runner yet.

### What the backend does

Two functions in [api/](api/), no database:

- **`POST /api/activate`** takes a license key, checks it with Lemon Squeezy, and returns an OpenRouter key capped at the plan's credit. Activating again, for example on a second device, replaces the key with a new one holding whatever credit was left.
- **`POST /api/webhook`** receives Lemon Squeezy events, verifies their signature, and creates, tops up or disables the key. A renewal sets the cap to what has been spent plus one more period of credit.

The state lives in the two services that already hold it: Lemon Squeezy knows who is paying, and each OpenRouter key's name records its order, plan and billing period. The rules are in [api/_lib/grants.ts](api/_lib/grants.ts) and are written so that a retried webhook can never grant credit twice.

### What the backend never sees

Questions, uploads and solutions. They go from the browser straight to OpenRouter or stay on the device. The spending cap is enforced by OpenRouter on the key itself, so a learner cannot spend more than their plan includes, whatever the client does.

---

## Running it locally

```bash
npm install
npm run dev          # http://localhost:5173, demo only
npm test             # the whole suite, no keys and no network needed
npm run build        # static files in dist/
```

`npm run dev` serves the app but not the functions in `api/`. To exercise activation locally, use `npx vercel dev` with a `.env.local` copied from `.env.example`.

Optional:

```bash
npm run vendor:fonts     # self-host the two typefaces
npm run vendor:pyodide   # about 10 MB, for offline or restricted networks
```

---

## Testing

The suite runs with no API key and no network. The demo adapter replays prepared walkthroughs through the real session, tool bus and board model, which covers a question solved end to end, an attachment reaching the reader once, a clarifying question that waits for a real answer, a raised hand, an abort, the pacing against the voice, a missing sandbox, and budget exhaustion. An accessibility pass runs over each screen.

The billing tests run both functions against in-memory stand-ins for Lemon Squeezy and OpenRouter: a purchase, an activation, a second device, a renewal delivered twice, a plan change, a cancellation, an expiry and a refund.

---

## Known gaps

- **Nothing has run against a live model.** Solution quality, screenshot and PDF reading, and the real cost of a solved question all need a real key. The question counts on the pricing page rest on an estimate.
- **Own keys are untested against live keys** on every service, and only OpenAI's older chat models are offered, because the newer ones reject two parameters the adapter sends. A service not on the list is refused rather than guessed at.
- **Own keys undercut the plans.** Anyone with a key pays nothing to us. That was a deliberate choice.
- **Voice input depends on the browser.** Chrome and Safari have it; Firefox does not, and there the button is hidden.
- **The billing functions have not run against the live services.** They are tested against stand-ins built from the Lemon Squeezy and OpenRouter documentation. Step 5 of "Going live" is the real check.
- **The demo walkthroughs read like lessons.** They were written for an earlier version that taught topics, and still need rewriting as worked solutions.
- **No legal pages.** Terms, privacy and refund policy are not written, and the footer does not link to them yet.
- **No accounts or sync.** The license key is the only credential, and history stays on the device it was made on.
- **Finding a subscriber's key walks the OpenRouter key list.** That is fine for hundreds of subscribers and should move to a key-value store before thousands.
- **The board cannot draw everything.** It has no maps, musical notation or pictures.
- **English first.**
