# Ask Brightside: an AI support agent that knows when not to answer

**Live demo:** https://support-agent-demo-chi.vercel.app
**Built by:** David Divine, AI Agent Engineer (Lagos, working with US/EU teams) · [GitHub](https://github.com/wwwdave123789-hub) · [www.dave123789@gmail.com](mailto:www.dave123789@gmail.com)

> Want this for your business? **2-week pilot, one workflow.** Send me your FAQ, price list and policies; you get a working agent on your site plus a staff inbox for everything it shouldn't handle alone.

---

## What it does

A front-desk support agent for a fictional US small business, **Brightside Dental (Austin, TX)**. It:

1. **Answers routine questions** (hours, parking, prices, insurance, new-patient steps, cancellation policy) **only from the business's own knowledge base**, never from the model's imagination.
2. **Classifies every message** by intent (`faq`, `booking`, `billing`, `complaint`, `emergency`) and urgency (`low`, `medium`, `high`).
3. **Hands off to a human** when it should: emergencies, angry customers, billing disputes, booking requests and anything not covered by the docs. Each handoff lands in a **staff inbox** with a **ready-to-send reply drafted** for the team.
4. **Shows its work.** The "Behind the scenes" panel shows what was detected, which knowledge-base snippets were used, and whether the message was auto-answered or escalated.
5. **Counts the payoff:** "Est. staff minutes saved" (3 min per auto-answered message, a conservative front-desk estimate).

The point for a business owner: routine questions get answered at 2 AM, and the messages that need a human reach one faster, already triaged and drafted.

## Architecture

```
 Browser (static HTML/CSS/JS, no framework)
 ┌────────────────────────────────────────────────────────────┐
 │  Chat widget  ──POST {message, history}──►  /api/chat      │
 │  Behind-the-scenes panel  ◄── {reply, intent, urgency,     │
 │  Staff inbox (localStorage)      handoff, staff_draft,     │
 │  Minutes-saved counter           sources[], mode}          │
 │                                                            │
 │  engine.js (same file the server uses) = offline fallback  │
 └────────────────────────────────────────────────────────────┘
                              │
                              ▼
 Vercel serverless function  api/chat.js (Node, no dependencies)
 ┌────────────────────────────────────────────────────────────┐
 │ 1. Guards: 500-char limit, POST only, history capped at 6  │
 │ 2. Retrieval: BM25 keyword scoring over                    │
 │    kb/brightside-kb.json (25 policy docs + 25 FAQs)        │
 │ 3. Rules-engine hint: keyword intent + urgency             │
 │ 4. LLM: Groq gpt-oss-20b (or Gemini Flash-Lite fallback)   │
 │    • system prompt: answer only from snippets, refuse      │
 │      off-topic / prompt-injection, when to hand off        │
 │    • JSON mode / responseSchema forces strict JSON output  │
 │ 5. Validate output (enum intents, known source ids only)   │
 │ 6. No API key or model error → deterministic               │
 │    rules-based answer, mode:"offline" (never a dead page)  │
 └────────────────────────────────────────────────────────────┘
```

**Stack:** plain HTML/CSS/JS + one Node serverless function on Vercel. No database, no build step, no paid services, no npm dependencies. Groq and Gemini both offer free developer tiers (demo data only; use a paid tier for real client data).

### Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | The page: chat, behind-the-scenes trace, staff inbox, counter. Mobile-first responsive. |
| `engine.js` | Shared, dependency-free: tokenizer, BM25 retrieval, keyword intent/urgency rules, deterministic offline answers. Runs in the browser and on the server. |
| `api/chat.js` | The serverless endpoint: guards → retrieval → LLM (Groq or Gemini, strict JSON) → validation → graceful fallback. |
| `kb/brightside-kb.json` | The business's knowledge base: hours, location, services and price ranges, insurance, new-patient process, cancellation, emergency, payment plans, billing, plus 25 Q&As. |

### Guardrails

- Max 500 characters per message (client and server), max 20 messages per browser session.
- The prompt restricts the agent to the business's topics and tells it to refuse coding, essays, general knowledge and "ignore your instructions" style requests.
- The model can only cite source ids that really exist in the knowledge base; unknown intents/urgencies fall back to the rules engine.
- It never confirms appointment slots or reads account balances; those are handed off, which is how a real deployment should start.
- Emergencies always include ER/911 warning signs and the after-hours line.

## Run it locally

```bash
npm i -g vercel                    # once
cd support-agent-demo
vercel dev                         # http://localhost:3000, runs /api/chat too
# optional: live AI
echo 'GROQ_API_KEY=your_key' > .env.local && vercel dev
```

Without a key, everything still works in **offline demo mode** (the badge in the chat header says so).

## Turn on the live AI on Vercel

1. Get a key at https://console.groq.com/keys (or Gemini: https://aistudio.google.com/apikey). Use the Copy button; Groq shows the full key only once.
2. Vercel → project **support-agent-demo** → **Settings → Environment Variables** → add `GROQ_API_KEY` (or `GEMINI_API_KEY`) for Production → Save. If both are set, Groq is used.
3. Redeploy the latest production deployment.
4. Reload the site: the badge turns green, "Live AI". Optional: `GROQ_MODEL` / `GEMINI_MODEL` to change models.

## Swap in a client's own docs

1. Replace `kb/brightside-kb.json` with the client's content, same shape:
   ```json
   { "business": { "name": "...", "phone": "...", "email": "..." },
     "docs": [ { "id": "returns", "title": "Returns policy", "tags": ["return","refund"], "text": "..." } ],
     "faqs": [ { "id": "faq-1", "q": "Do you ship to Canada?", "a": "..." } ] }
   ```
   Short, single-topic docs retrieve best. `tags` add synonyms customers actually use.
2. Edit the business description and handoff rules in the `SYSTEM` prompt in `api/chat.js` (for example, "refund requests over $200 always go to a human").
3. Adjust the intent keywords in `engine.js` (`RULES`) so the offline fallback matches the new domain.
4. Update the branding and starter chips in `index.html`. Deploy.

Typical next steps in a paid pilot: pull docs automatically from the client's site/Google Drive/Notion, push handoffs to their real inbox (email, Slack, HubSpot, Zendesk), add a booking integration (Calendly, Acuity, practice-management software), and log conversations so the FAQ improves weekly.

---

*Brightside Dental, its staff, address and phone number are fictional. This demo is not medical advice.*
