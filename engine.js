/*
 * Brightside support engine - shared by the browser (offline demo mode)
 * and the /api/chat serverless function (retrieval before calling Gemini).
 * No dependencies. UMD so it works with <script> and require().
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SupportEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STOP = new Set(("a an the and or but if of to in on at for with from by is are was were be been am i me my we our you your it its this that " +
    "do does did can could would should will what when where how who why which there here have has had not no so as about any some just " +
    "please hi hello hey thanks thank us").split(" "));

  function stem(w) {
    if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length > 4 && w.endsWith("ing")) return w.slice(0, -3);
    if (w.length > 3 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  }

  function tokenize(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9$ ]+/g, " ").split(/\s+/)
      .filter(function (w) { return w && !STOP.has(w); }).map(stem);
  }

  /* ---------- BM25 index over docs + FAQs ---------- */
  function buildIndex(kb) {
    var items = [];
    (kb.docs || []).forEach(function (d) {
      items.push({ id: d.id, title: d.title, text: d.text, kind: "doc",
        tokens: tokenize(d.title + " " + d.title + " " + (d.tags || []).join(" ") + " " + (d.tags || []).join(" ") + " " + d.text) });
    });
    (kb.faqs || []).forEach(function (f) {
      items.push({ id: f.id, title: f.q, text: f.a, kind: "faq",
        tokens: tokenize(f.q + " " + f.q + " " + f.a) });
    });
    var df = {}, total = 0;
    items.forEach(function (it) {
      total += it.tokens.length;
      it.tf = {};
      it.tokens.forEach(function (t) { it.tf[t] = (it.tf[t] || 0) + 1; });
      Object.keys(it.tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    });
    return { items: items, df: df, N: items.length, avgdl: total / Math.max(1, items.length) };
  }

  function search(index, query, k) {
    var q = tokenize(query), k1 = 1.4, b = 0.75;
    var scored = index.items.map(function (it) {
      var s = 0;
      q.forEach(function (t) {
        var f = it.tf[t]; if (!f) return;
        var idf = Math.log(1 + (index.N - index.df[t] + 0.5) / (index.df[t] + 0.5));
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * it.tokens.length / index.avgdl));
      });
      return { item: it, score: s };
    }).filter(function (x) { return x.score > 0; });
    scored.sort(function (a, b2) { return b2.score - a.score; });
    return scored.slice(0, k || 4).map(function (x) {
      return { id: x.item.id, title: x.item.title, text: x.item.text, kind: x.item.kind, score: Math.round(x.score * 100) / 100 };
    });
  }

  /* ---------- Rules-based intent + urgency (offline mode, and a hint for the LLM) ---------- */
  var RULES = {
    emergency: /(emergenc|knocked out|knocked-out|bleed|swell|swollen|abscess|severe pain|unbearable|can'?t sleep|throbbing|broke(n)? (my )?tooth|cracked tooth|chipped|fever|pus|jaw (hurts|pain)|accident|kill(ing)? me)/i,
    complaint: /(complain|terrible|horrible|awful|worst|rude|unacceptable|ridiculous|furious|angry|disgust|scam|ripped off|never coming back|lawyer|review|refund now|waited (for )?(an hour|\d+)|manager|unprofessional|disappointed)/i,
    billing: /(bill|billing|charge|charged|invoice|statement|balance|refund|overcharg|payment|pay |paid|insurance claim|claim|copay|financ|payment plan|carecredit|hsa|fsa)/i,
    booking: /(book|appointment|schedule|reschedul|availab|slot|come in|see (the|a) dentist|next week|tomorrow|cancel my|move my|openings?|any availability|get in)/i
  };
  var ANGRY = /(!!|terrible|worst|furious|angry|unacceptable|ridiculous|scam|lawyer|never coming back)/i;
  var OFFTOPIC = /(write (me )?(a|an) (poem|essay|story|code)|python|javascript|homework|bitcoin|crypto|stock|recipe|weather|president|election|joke|ignore (all|previous|your)|system prompt|jailbreak|pretend you)/i;

  var DENTAL = /(tooth|teeth|dent|gum|mouth|jaw|brace|align|crown|filling|implant|x-?ray|clean|insur|price|cost|pay|bill|appoint|book|visit|office|hour|open|park|patient|kid|child|doctor|hygien|whiten|smile|cavit|sedat|brightside)/i;

  function classify(message) {
    var m = String(message || "");
    var intent = "faq";
    if (RULES.emergency.test(m)) intent = "emergency";
    else if (RULES.complaint.test(m)) intent = "complaint";
    else if (RULES.billing.test(m) && /(wrong|overcharg|dispute|charged twice|double|refund|why was i|incorrect)/i.test(m)) intent = "billing";
    else if (RULES.booking.test(m)) intent = "booking";
    else if (RULES.billing.test(m)) intent = "billing";
    var urgency = "low";
    if (intent === "emergency") urgency = /(knocked out|bleed|swell|fever|breath|swallow|accident)/i.test(m) ? "high" : "medium";
    else if (intent === "complaint") urgency = ANGRY.test(m) ? "high" : "medium";
    else if (intent === "billing" || intent === "booking") urgency = "medium";
    var offTopic = OFFTOPIC.test(m);
    return { intent: intent, urgency: urgency, offTopic: offTopic };
  }

  /* ---------- Deterministic reply (offline demo mode) ---------- */
  function offlineAnswer(kb, index, message) {
    var c = classify(message);
    var phone = (kb.business && kb.business.phone) || "";
    if (c.offTopic) {
      return { reply: "I'm Brightside Dental's assistant, so I can only help with questions about our practice: hours, services, pricing, insurance, appointments, and billing. What can I help you with?",
        intent: "faq", urgency: "low", handoff: false, staff_draft: "", sources: [] };
    }
    var hits = search(index, message, 3);
    var sources = hits.filter(function (h) { return h.score >= hits[0].score * 0.5; }).map(function (h) { return h.id; });
    var top = hits[0];
    var reply, handoff = false, draft = "";

    if (c.intent === "emergency") {
      var em = (kb.docs || []).filter(function (d) { return d.id === "emergency"; })[0];
      if (sources.indexOf("emergency") === -1) sources.unshift("emergency");
      reply = "I'm sorry you're dealing with this. " + (em ? em.text : "") + " I've flagged this for our team so someone can reach out about a same-day emergency slot.";
      handoff = true;
      draft = "URGENT - possible dental emergency. Patient wrote: \"" + message + "\". Please call back ASAP to offer a same-day emergency slot ($95 exam) and triage for ER warning signs (swelling affecting breathing/swallowing, uncontrolled bleeding, fever).";
    } else if (c.intent === "complaint") {
      if (sources.indexOf("complaints") === -1) sources.unshift("complaints");
      reply = "I'm really sorry about your experience, and thank you for telling us. I've passed this straight to our practice manager, Dana Brooks, who personally reviews every complaint and will contact you within one business day. If you'd like, share the best phone number or email to reach you.";
      handoff = true;
      draft = "Hi, this is Dana Brooks, practice manager at Brightside Dental. I read your message and I'm sorry we let you down. I'd like to understand what happened and make it right. Could I call you today at a time that suits you? - Dana";
    } else if (c.intent === "billing" && /(wrong|overcharg|dispute|charged twice|double|refund|why was i|incorrect)/i.test(message)) {
      if (sources.indexOf("billing") === -1) sources.unshift("billing");
      reply = "I can't see account balances, but I've sent this to our billing coordinator, who reviews disputed balances within 2 business days. Refunds for overpayments go back to your original payment method within 10 business days.";
      handoff = true;
      draft = "Billing review requested. Patient wrote: \"" + message + "\". Please pull the ledger and latest insurance EOB, then reply with the corrected balance or an explanation of the charge.";
    } else if (c.intent === "booking") {
      if (sources.indexOf("booking") === -1) sources.unshift("booking");
      reply = "Happy to help you get in. I can't confirm a time slot myself, but if you share your preferred days and times (and whether you're a new patient), a team member will text you a confirmation within 2 business hours. You can also book directly at brightsidedental.example/book or call " + phone + ".";
      handoff = true;
      draft = "Booking request. Patient wrote: \"" + message + "\". Please text available slots that match their request and confirm new vs. returning patient and insurance.";
    } else if (top && top.score > 1.2) {
      reply = top.text;
    } else if (!DENTAL.test(message)) {
      reply = "I can only help with questions about Brightside Dental: hours, services, pricing, insurance, appointments, and billing. What can I help you with?";
      sources = [];
    } else {
      reply = "I'm not sure about that one, so I've passed it to our front desk and they'll get back to you within one business day. You can also call " + phone + ".";
      handoff = true;
      draft = "Question the assistant couldn't answer from the knowledge base: \"" + message + "\". Please reply directly and consider adding the answer to the FAQ.";
    }
    return { reply: reply, intent: c.intent, urgency: c.urgency, handoff: handoff, staff_draft: draft, sources: sources.slice(0, 3) };
  }

  return { tokenize: tokenize, buildIndex: buildIndex, search: search, classify: classify, offlineAnswer: offlineAnswer };
});
