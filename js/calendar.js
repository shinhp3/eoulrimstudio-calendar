(function () {
  "use strict";

  var STORAGE_KEY = "eoulrim_calendar_events_v1";

  /** @type {{ viewYear: number, viewMonth: number, selected: string | null }} */
  var state = {
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(),
    selected: null,
  };

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toKey(y, m, d) {
    return y + "-" + pad(m + 1) + "-" + pad(d);
  }

  function parseKey(key) {
    var p = key.split("-").map(Number);
    return { y: p[0], m: p[1] - 1, d: p[2] };
  }

  function loadEvents() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveEvents(map) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  }

  function normalizeEvent(ev, i) {
    if (!ev || typeof ev !== "object") return null;
    var title = String(ev.title || "").trim();
    if (!title) return null;
    return {
      id:
        typeof ev.id === "string"
          ? ev.id
          : "legacy-" + i + "-" + title + "-" + String(ev.time || ""),
      title: title,
      time: ev.time ? String(ev.time) : "",
    };
  }

  function getEventsForDay(key) {
    var all = loadEvents();
    var list = all[key];
    if (!Array.isArray(list)) return [];
    return list.map(normalizeEvent).filter(Boolean);
  }

  function setEventsForDay(key, list) {
    var all = loadEvents();
    if (list.length === 0) delete all[key];
    else all[key] = list;
    saveEvents(all);
  }

  function formatSelectedLabel(key) {
    if (!key) return "날짜를 선택하세요";
    var p = parseKey(key);
    var dt = new Date(p.y, p.m, p.d);
    var w = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
    return (
      p.y +
      "년 " +
      (p.m + 1) +
      "월 " +
      p.d +
      "일 (" +
      w +
      ")"
    );
  }

  function truncate(str, max) {
    if (str.length <= max) return str;
    return str.slice(0, Math.max(0, max - 1)) + "…";
  }

  function daysInMonth(y, m) {
    return new Date(y, m + 1, 0).getDate();
  }

  function buildMonthCells(y, m) {
    var first = new Date(y, m, 1);
    var startWeekday = first.getDay();
    var dim = daysInMonth(y, m);
    var prevDim = daysInMonth(y, m - 1);
    var cells = [];

    for (var i = 0; i < startWeekday; i++) {
      var d = prevDim - startWeekday + i + 1;
      var pm = m - 1;
      var py = y;
      if (pm < 0) {
        pm = 11;
        py--;
      }
      cells.push({ y: py, m: pm, d: d, outside: true });
    }

    for (var day = 1; day <= dim; day++) {
      cells.push({ y: y, m: m, d: day, outside: false });
    }

    var tail = 42 - cells.length;
    if (tail < 0) tail = 0;
    var nm = m + 1;
    var ny = y;
    if (nm > 11) {
      nm = 0;
      ny++;
    }
    for (var j = 1; j <= tail; j++) {
      cells.push({ y: ny, m: nm, d: j, outside: true });
    }

    return cells;
  }

  var els = {
    grid: document.getElementById("calendarGrid"),
    viewYearLabel: document.getElementById("viewYearLabel"),
    viewMonthLabel: document.getElementById("viewMonthLabel"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    btnToday: document.getElementById("btnToday"),
    selectedDateLabel: document.getElementById("selectedDateLabel"),
    eventForm: document.getElementById("eventForm"),
    eventList: document.getElementById("eventList"),
    eventEmpty: document.getElementById("eventEmpty"),
  };

  function isToday(y, m, d) {
    var t = new Date();
    return (
      t.getFullYear() === y &&
      t.getMonth() === m &&
      t.getDate() === d
    );
  }

  function renderGrid() {
    var y = state.viewYear;
    var m = state.viewMonth;
    els.viewYearLabel.textContent = String(y);
    els.viewMonthLabel.textContent = m + 1 + "월";
    els.viewMonthLabel.setAttribute("datetime", y + "-" + pad(m + 1) + "-01");

    var cells = buildMonthCells(y, m);
    var frag = document.createDocumentFragment();
    var all = loadEvents();

    cells.forEach(function (cell) {
      var key = toKey(cell.y, cell.m, cell.d);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "grid__cell";
      btn.setAttribute("role", "gridcell");
      btn.dataset.date = key;

      if (cell.outside) btn.classList.add("grid__cell--outside");

      var wd = new Date(cell.y, cell.m, cell.d).getDay();
      if (wd === 0) btn.classList.add("grid__cell--sun");
      if (wd === 6) btn.classList.add("grid__cell--sat");

      if (!cell.outside && isToday(cell.y, cell.m, cell.d)) {
        btn.classList.add("grid__cell--today");
      }

      if (state.selected === key) btn.classList.add("grid__cell--selected");

      var num = document.createElement("span");
      num.className = "grid__cell-num";
      num.textContent = String(cell.d);
      btn.appendChild(num);

      var rawList = all[key] || [];
      var normalizedCell = Array.isArray(rawList)
        ? rawList.map(normalizeEvent).filter(Boolean)
        : [];
      if (normalizedCell.length > 0 && !cell.outside) {
        btn.classList.add("grid__cell--has-events");
        var eventsWrap = document.createElement("div");
        eventsWrap.className = "grid__cell-events";
        var maxChips = 3;
        var slice = normalizedCell.slice(0, maxChips);
        slice.forEach(function (ev) {
          var chip = document.createElement("span");
          chip.className = "grid__event-chip";
          chip.textContent = truncate(ev.title, 16);
          chip.title =
            ev.title + (ev.time ? " · " + ev.time : "");
          eventsWrap.appendChild(chip);
        });
        var extra = normalizedCell.length - maxChips;
        if (extra > 0) {
          var more = document.createElement("span");
          more.className = "grid__event-more";
          more.textContent = "+" + extra;
          more.title = extra + "개 더 있음";
          eventsWrap.appendChild(more);
        }
        btn.appendChild(eventsWrap);
      }

      if (!cell.outside) {
        btn.addEventListener("click", function () {
          state.selected = key;
          renderGrid();
          renderDetail();
        });
      } else {
        btn.tabIndex = -1;
        btn.setAttribute("aria-hidden", "true");
      }

      frag.appendChild(btn);
    });

    els.grid.replaceChildren(frag);
  }

  function renderDetail() {
    els.selectedDateLabel.textContent = formatSelectedLabel(state.selected);
    els.eventList.innerHTML = "";

    if (!state.selected) {
      els.eventEmpty.textContent =
        "달력에서 날짜를 선택하면 일정을 추가할 수 있습니다.";
      els.eventEmpty.classList.remove("is-hidden");
      els.eventForm.querySelector("[name=title]").disabled = true;
      els.eventForm.querySelector("[name=time]").disabled = true;
      els.eventForm.querySelector("button[type=submit]").disabled = true;
      return;
    }

    els.eventForm.querySelector("[name=title]").disabled = false;
    els.eventForm.querySelector("[name=time]").disabled = false;
    els.eventForm.querySelector("button[type=submit]").disabled = false;

    var items = getEventsForDay(state.selected);
    if (items.length === 0) {
      els.eventEmpty.textContent = "등록된 일정이 없습니다.";
      els.eventEmpty.classList.remove("is-hidden");
      return;
    }

    els.eventEmpty.classList.add("is-hidden");

    items
      .slice()
      .sort(function (a, b) {
        var ta = a.time || "";
        var tb = b.time || "";
        return ta.localeCompare(tb);
      })
      .forEach(function (ev) {
        var li = document.createElement("li");
        li.className = "event-item";

        var body = document.createElement("div");
        body.className = "event-item__body";
        var h = document.createElement("p");
        h.className = "event-item__title";
        h.textContent = ev.title;
        body.appendChild(h);
        if (ev.time) {
          var t = document.createElement("p");
          t.className = "event-item__time";
          t.textContent = ev.time;
          body.appendChild(t);
        }

        var del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn--danger";
        del.textContent = "삭제";
        del.addEventListener("click", function () {
          var list = getEventsForDay(state.selected).filter(function (x) {
            return x.id !== ev.id;
          });
          setEventsForDay(state.selected, list);
          renderGrid();
          renderDetail();
        });

        li.appendChild(body);
        li.appendChild(del);
        els.eventList.appendChild(li);
      });
  }

  els.btnPrev.addEventListener("click", function () {
    state.viewMonth--;
    if (state.viewMonth < 0) {
      state.viewMonth = 11;
      state.viewYear--;
    }
    renderGrid();
  });

  els.btnNext.addEventListener("click", function () {
    state.viewMonth++;
    if (state.viewMonth > 11) {
      state.viewMonth = 0;
      state.viewYear++;
    }
    renderGrid();
  });

  els.btnToday.addEventListener("click", function () {
    var t = new Date();
    state.viewYear = t.getFullYear();
    state.viewMonth = t.getMonth();
    state.selected = toKey(t.getFullYear(), t.getMonth(), t.getDate());
    renderGrid();
    renderDetail();
  });

  els.eventForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!state.selected) return;
    var fd = new FormData(els.eventForm);
    var title = String(fd.get("title") || "").trim();
    var time = String(fd.get("time") || "").trim();
    if (!title) return;

    var list = getEventsForDay(state.selected);
    list.push({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      title: title,
      time: time || "",
    });
    setEventsForDay(state.selected, list);
    els.eventForm.reset();
    renderGrid();
    renderDetail();
  });

  renderGrid();
  renderDetail();
})();
