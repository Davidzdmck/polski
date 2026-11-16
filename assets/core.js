/* Polnisch-App: shared components for every page.
   PL.store    progress in localStorage + Leitner spacing
   PL.say      text-to-speech with the device's Polish voice
   PL.Recorder record yourself, play it back
   PL.listen   speech recognition (Safari: needs Siri on)
   PL.practice speaking widget: hear -> record -> compare -> recognize
   PL.quiz     multiple-choice widget with instant feedback */
(function () {
  const KEY = "pl-progress-v1";
  // Days until next review per box. Box 0 = new / forgotten.
  const INTERVALS = [0, 1, 2, 4, 8, 16, 35, 70, 140];

  function today(d) {
    d = d || new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return today(d); }
  function fresh() { return { v: 1, cards: {}, lessons: {}, days: {}, settings: { rate: 0.85 } }; }

  const store = {
    load() {
      try {
        const s = JSON.parse(localStorage.getItem(KEY));
        if (s && s.v === 1) return Object.assign(fresh(), s);
      } catch (e) {}
      return fresh();
    },
    save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } },
    update(fn) { const s = store.load(); fn(s); store.save(s); return s; },
    completeLesson(id, cardIds) {
      return store.update((s) => {
        s.lessons[id] = s.lessons[id] || today();
        (cardIds || []).forEach((c) => { if (!s.cards[c]) s.cards[c] = { box: 0, due: today(), seen: 0, lapses: 0 }; });
      });
    },
    grade(id, ok) {
      return store.update((s) => {
        const c = s.cards[id] || (s.cards[id] = { box: 0, due: today(), seen: 0, lapses: 0 });
        c.seen++;
        if (ok) { c.box = Math.min(c.box + 1, INTERVALS.length - 1); }
        else { c.lapses++; c.box = 0; }
        c.due = addDays(INTERVALS[c.box]);
        const d = s.days[today()] || (s.days[today()] = { reviews: 0, seconds: 0 });
        d.reviews++;
      });
    },
    due() { const s = store.load(); const t = today(); return Object.keys(s.cards).filter((k) => s.cards[k].due <= t); },
    addSeconds(sec) {
      if (sec <= 0) return;
      store.update((s) => { const d = s.days[today()] || (s.days[today()] = { reviews: 0, seconds: 0 }); d.seconds += Math.round(sec); });
    },
    streak() {
      const s = store.load(); let n = 0; const d = new Date();
      if (!s.days[today(d)]) d.setDate(d.getDate() - 1); // today not done yet: count from yesterday
      while (s.days[today(d)] && s.days[today(d)].seconds >= 60) { n++; d.setDate(d.getDate() - 1); }
      return n;
    },
    exportCode() { return btoa(unescape(encodeURIComponent(JSON.stringify(store.load())))); },
    importCode(code) {
      const s = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
      if (!s || s.v !== 1) throw new Error("Unbekanntes Format");
      store.save(s); return s;
    },
    today,
  };

  /* ---------- Speech output ---------- */
  let voice = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const vs = speechSynthesis.getVoices().filter((v) => /^pl/i.test(v.lang));
    // Prefer enhanced/premium voices when installed.
    voice = vs.find((v) => /enhanced|premium|erweitert/i.test(v.name)) || vs[0] || null;
  }
  if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  function say(text, rate) {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) return resolve(false);
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "pl-PL";
      if (voice) u.voice = voice;
      u.rate = rate || store.load().settings.rate || 0.85;
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      speechSynthesis.speak(u);
    });
  }
  say.hasVoice = () => !!voice;

  /* ---------- Recording ---------- */
  class Recorder {
    constructor() { this.url = null; this.rec = null; this.stream = null; }
    static supported() { return !!(navigator.mediaDevices && window.MediaRecorder); }
    async start() {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      this.rec = new MediaRecorder(this.stream);
      this.rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      this.done = new Promise((res) => {
        this.rec.onstop = () => {
          if (this.url) URL.revokeObjectURL(this.url);
          this.url = URL.createObjectURL(new Blob(chunks, { type: this.rec.mimeType }));
          this.stream.getTracks().forEach((t) => t.stop());
          res(this.url);
        };
      });
      this.rec.start();
    }
    stop() { if (this.rec && this.rec.state !== "inactive") this.rec.stop(); return this.done; }
    play() { if (this.url) return new Audio(this.url).play(); }
  }

  /* ---------- Speech recognition ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function listen() {
    return new Promise((resolve, reject) => {
      if (!SR) return reject(new Error("unsupported"));
      const r = new SR();
      r.lang = "pl-PL"; r.interimResults = false; r.maxAlternatives = 5;
      let got = false;
      r.onresult = (e) => {
        got = true;
        const alts = Array.from(e.results[0]).map((a) => a.transcript);
        resolve(alts);
      };
      r.onerror = (e) => reject(new Error(e.error || "error"));
      r.onend = () => { if (!got) resolve([]); };
      r.start();
    });
  }
  listen.supported = () => !!SR;

  function norm(s) { return s.toLowerCase().replace(/[.,!?;:¿¡"'„”…-]/g, "").replace(/\s+/g, " ").trim(); }
  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a.length && !b.length) return 1;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
  }

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      if (attrs[k] == null || attrs[k] === false) continue;
      if (k === "class") n.className = attrs[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
      else if (k === "html") n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    kids.flat().forEach((c) => c != null && n.append(c));
    return n;
  }

  /* Highlights the stressed syllable: "dzię|ku|ję" with stress index -> spans.
     card.syl = "dzień do·bry" style string where the stressed syllable is wrapped in [ ]. */
  function stressed(syl) {
    const out = el("span", { class: "pl-word" });
    syl.split(/(\[[^\]]+\])/).forEach((part) => {
      if (!part) return;
      if (part.startsWith("[")) out.append(el("span", { class: "stress" }, part.slice(1, -1)));
      else out.append(part);
    });
    return out;
  }

  /* ---------- Speaking widget ----------
     opts.onResult(score|null) is called after a recognition attempt. */
  function practice(card, opts) {
    opts = opts || {};
    const rec = new Recorder();
    const status = el("p", { class: "feedback small" });
    const btnHear = el("button", { type: "button", onclick: () => say(card.pl) }, "▶ Hören");
    const btnSlow = el("button", { type: "button", onclick: () => say(card.pl, 0.6) }, "Langsam");
    const btnMine = el("button", { type: "button", disabled: "", onclick: () => rec.play() }, "Mich hören");
    let recording = false;
    const btnRec = el("button", {
      type: "button",
      onclick: async () => {
        if (!recording) {
          try { await rec.start(); recording = true; btnRec.textContent = "■ Stopp"; btnRec.classList.add("rec-on"); status.textContent = "Sprich jetzt."; status.className = "feedback small"; }
          catch (e) { status.textContent = "Kein Mikrofon-Zugriff. In Safari erlauben."; }
        } else {
          await rec.stop(); recording = false; btnRec.textContent = "● Aufnehmen"; btnRec.classList.remove("rec-on");
          btnMine.removeAttribute("disabled");
          status.textContent = "Jetzt vergleichen: erst das Original, dann dich.";
        }
      },
    }, "● Aufnehmen");
    if (!Recorder.supported()) btnRec.setAttribute("disabled", "");

    const btnCheck = el("button", {
      type: "button",
      onclick: async () => {
        status.className = "feedback small"; status.textContent = "Ich höre zu …";
        try {
          const alts = await listen();
          if (!alts.length) { status.textContent = "Nichts verstanden. Nochmal, etwas lauter."; opts.onResult && opts.onResult(null); return; }
          const best = alts.reduce((m, a) => Math.max(m, similarity(a, card.pl)), 0);
          const heard = alts[0];
          if (best >= 0.85) { status.className = "feedback small ok"; status.textContent = "Verstanden: „" + heard + "“. Sitzt."; }
          else if (best >= 0.6) { status.className = "feedback small"; status.textContent = "Verstanden: „" + heard + "“. Fast. Hör dir das Original nochmal an."; }
          else { status.className = "feedback small no"; status.textContent = "Verstanden: „" + heard + "“. Noch nicht. Langsam anhören, nachsprechen."; }
          opts.onResult && opts.onResult(best);
        } catch (e) {
          status.textContent = e.message === "not-allowed" ? "Spracherkennung blockiert. Siri und Diktieren in den iPhone-Einstellungen einschalten." : "Spracherkennung nicht verfügbar. Aufnehmen und selbst vergleichen.";
          opts.onResult && opts.onResult(null);
        }
      },
    }, "✓ Prüfen lassen");
    if (!listen.supported()) btnCheck.setAttribute("hidden", "");

    return el("div", { class: "stack" },
      el("div", { class: "row" }, btnHear, btnSlow),
      el("div", { class: "row" }, btnRec, btnMine, btnCheck),
      status);
  }

  /* ---------- Quiz widget ----------
     questions: [{prompt, audio?, options:[...], answer: index, why}] */
  function quiz(questions, onDone) {
    let i = 0, right = 0;
    const box = el("div", { class: "stack" });
    const bar = el("div", { class: "meter" }, el("i"));
    function show() {
      box.innerHTML = "";
      bar.firstChild.style.width = (i / questions.length) * 100 + "%";
      if (i >= questions.length) {
        box.append(el("p", {}, el("b", {}, right + " von " + questions.length + " richtig. "),
          right === questions.length ? "Die Regeln sitzen." : "Lies die Zeilen oben zu den Fehlern nochmal, dann weiter."));
        onDone && onDone(right, questions.length);
        return;
      }
      const q = questions[i];
      const fb = el("p", { class: "feedback" });
      const next = el("button", { type: "button", class: "primary", hidden: "", onclick: () => { i++; show(); } }, "Weiter");
      const opts = el("div", { class: "opts" });
      q.options.forEach((o, k) => {
        opts.append(el("button", {
          type: "button",
          onclick: (ev) => {
            if (opts.dataset.done) return; opts.dataset.done = "1";
            const ok = k === q.answer; if (ok) right++;
            ev.currentTarget.classList.add(ok ? "right" : "wrong");
            opts.children[q.answer].classList.add("right");
            fb.className = "feedback " + (ok ? "ok" : "no");
            fb.textContent = (ok ? "Richtig. " : "Nicht ganz. ") + (q.why || "");
            next.hidden = false; next.focus();
          },
        }, o));
      });
      box.append(
        el("p", { class: "eyebrow" }, "Frage " + (i + 1) + " von " + questions.length),
        el("div", { class: "row" }, el("p", { class: "grow", html: q.prompt }),
          q.audio ? el("button", { type: "button", onclick: () => say(q.audio) }, "▶") : null),
        opts, fb, next);
    }
    show();
    return el("div", { class: "stack" }, bar, box);
  }

  /* Track active time on a page while it is visible. */
  function trackTime() {
    let last = Date.now();
    const flush = () => { const now = Date.now(); const sec = Math.min((now - last) / 1000, 120); last = now; if (document.visibilityState === "visible" || sec < 120) store.addSeconds(sec); };
    // Count only while visible; cap gaps so a phone left open does not inflate minutes.
    let t = setInterval(() => { if (document.visibilityState === "visible") flush(); else last = Date.now(); }, 15000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); else last = Date.now(); });
    window.addEventListener("pagehide", flush);
    return () => clearInterval(t);
  }

  window.PL = { store, say, Recorder, listen, similarity, practice, quiz, el, stressed, trackTime };
})();
