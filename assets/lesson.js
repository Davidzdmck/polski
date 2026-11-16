/* Shared lesson parts. Every lesson page calls PL.lesson({ id, quiz }) once.
   Expects on the page: #quiz, #words, #done, #done-msg. Optional sound tables via PL.soundRows. */
(function () {
  const { el, say, quiz, practice, stressed, store } = PL;

  PL.soundRows = function (target, list) {
    const box = document.getElementById(target);
    list.forEach(([letter, desc, ex, de]) => {
      box.append(el("div", { class: "sound" },
        el("span", { class: "letter" }, letter),
        el("span", { class: "desc" }, el("span", { html: desc }), el("br"),
          el("span", { class: "ex" }, ex), el("span", { class: "muted small" }, "  " + de)),
        el("button", { type: "button", "aria-label": ex + " anhören", onclick: () => say(ex) }, "▶")));
    });
  };

  PL.lesson = function (opts) {
    PL.trackTime();
    const lesson = LESSONS.find((l) => l.id === opts.id);
    if (opts.quiz) document.getElementById("quiz").append(quiz(opts.quiz));

    let i = 0;
    const wbox = document.getElementById("words");
    function showWord() {
      wbox.innerHTML = "";
      const c = CARDS[lesson.cards[i]];
      const last = i === lesson.cards.length - 1;
      wbox.append(
        el("p", { class: "eyebrow" }, "Wort " + (i + 1) + " von " + lesson.cards.length),
        el("p", { class: "pl" }, stressed(c.syl)),
        el("p", {}, el("b", {}, c.de), el("span", { class: "muted small" }, " · " + c.hint)),
        practice(c),
        el("div", { class: "row" },
          el("button", { type: "button", disabled: i === 0, onclick: () => { i--; showWord(); } }, "← Zurück"),
          el("button", { type: "button", class: "primary", onclick: () => { if (!last) { i++; showWord(); } else document.getElementById("done").focus(); } },
            last ? "Alle durch" : "Nächstes Wort")));
    }
    showWord();

    const msg = document.getElementById("done-msg");
    const s = store.load();
    if (s.lessons[lesson.id]) msg.textContent = "Schon abgeschlossen am " + s.lessons[lesson.id] + ". Wiederholen geht jederzeit.";
    document.getElementById("done").onclick = () => {
      store.completeLesson(lesson.id, lesson.cards);
      msg.textContent = "";
      const next = LESSONS[LESSONS.indexOf(lesson) + 1];
      msg.append("Gespeichert. " + lesson.cards.length + " Wörter sind im Training. ",
        el("a", { href: "../index.html" }, "Zurück zu Heute"));
      if (next) msg.append(" · Morgen dran: ", el("a", { href: "../" + next.href }, "Lektion " + Number(next.id)));
    };
  };
})();
