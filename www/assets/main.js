// src/core/result.ts
var ok = (value) => ({ ok: true, value });
var fail = (error) => ({ ok: false, error });

// src/api/client.ts
var ApiClient = class {
  constructor(base) {
    this.base = base;
    this.auth = {
      register: (name, email, password) => this.request("POST", "/auth/register", { name, email, password }),
      login: (email, password) => this.request("POST", "/auth/login", { email, password }),
      logout: () => this.requestVoid("POST", "/auth/logout"),
      me: () => this.request("GET", "/auth/me")
    };
    this.state = () => this.request("GET", "/state");
    this.sessions = {
      create: (draft) => this.request("POST", "/sessions", draft),
      update: (id, draft) => this.request("PUT", `/sessions/${id}`, draft),
      remove: (id) => this.request("DELETE", `/sessions/${id}`),
      restore: (undoToken) => this.requestVoid("POST", "/sessions/restore", { undoToken })
    };
    this.bookings = {
      create: (sessionId) => this.request("POST", "/bookings", { sessionId }),
      cancel: (id) => this.request("DELETE", `/bookings/${id}`)
    };
    this.users = {
      update: (id, patch) => this.request("PUT", `/users/${id}`, patch),
      remove: (id) => this.request("DELETE", `/users/${id}`),
      restore: (undoToken) => this.requestVoid("POST", "/users/restore", { undoToken })
    };
  }
  async send(method, path, body) {
    let response;
    try {
      response = await fetch(this.base + path, {
        method,
        credentials: "include",
        headers: body === void 0 ? void 0 : { "Content-Type": "application/json" },
        body: body === void 0 ? void 0 : JSON.stringify(body)
      });
    } catch {
      return fail({ code: "network", message: "\u0421\u0435\u0440\u0432\u0435\u0440 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D" });
    }
    if (response.status === 204) return ok(null);
    let payload;
    try {
      payload = await response.json();
    } catch {
      return fail({
        code: "contract",
        message: `\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u043E\u0442\u0432\u0435\u0442 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 (${response.status})`
      });
    }
    if (!response.ok) {
      const err = payload?.error;
      if (err) return fail(err);
      const detail = payload?.detail;
      const message = typeof detail === "string" ? detail : `\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 (${response.status})`;
      return fail({
        code: response.status === 401 ? "unauthorized" : "server",
        message
      });
    }
    return ok(payload);
  }
  async request(method, path, body) {
    const r = await this.send(method, path, body);
    return r.ok ? ok(r.value) : r;
  }
  async requestVoid(method, path, body) {
    const r = await this.send(method, path, body);
    return r.ok ? ok(void 0) : r;
  }
};

// src/core/rules.ts
var MINUTE_MS = 6e4;
var sessionEndsAt = (s) => Date.parse(s.startsAt) + s.durationMin * MINUTE_MS;
var hasStarted = (s, now) => Date.parse(s.startsAt) <= now.getTime();
var isFinished = (s, now) => sessionEndsAt(s) < now.getTime();
var pad = (n) => String(n).padStart(2, "0");
function dayKey(value) {
  const d = typeof value === "string" ? new Date(value) : value;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(base, days) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}
function timeBucket(iso) {
  const h2 = new Date(iso).getHours();
  if (h2 < 12) return "morning";
  if (h2 < 17) return "day";
  return "evening";
}
var seatsTaken = (bookings, sessionId) => bookings.filter((b) => b.sessionId === sessionId).length;
var seatsLeft = (s, bookings) => s.capacity - seatsTaken(bookings, s.id);
var bookingOf = (bookings, userId, sessionId) => bookings.find((b) => b.userId === userId && b.sessionId === sessionId);
var occupancyPct = (s, bookings) => s.capacity === 0 ? 0 : Math.round(seatsTaken(bookings, s.id) / s.capacity * 100);
function checkBookable(s, bookings, userId, now) {
  if (hasStarted(s, now)) return fail({ code: "session-started" });
  if (bookingOf(bookings, userId, s.id))
    return fail({ code: "already-booked" });
  if (seatsLeft(s, bookings) <= 0) return fail({ code: "session-full" });
  return ok(true);
}
function filterSessions(all, f, now) {
  const key = dayKey(addDays(now, f.dayOffset));
  const q = f.query.trim().toLowerCase();
  return all.filter((s) => dayKey(s.startsAt) === key).filter((s) => f.kind === "all" || s.kind === f.kind).filter((s) => f.time === "all" || timeBucket(s.startsAt) === f.time).filter(
    (s) => !q || `${s.title} ${s.trainer} ${s.room}`.toLowerCase().includes(q)
  );
}
function sortSessions(list, mode, bookings) {
  return [...list].sort(
    (a, b) => mode === "seats" ? seatsLeft(b, bookings) - seatsLeft(a, bookings) || a.startsAt.localeCompare(b.startsAt) : a.startsAt.localeCompare(b.startsAt)
  );
}
function buildReport(sessions, bookings, users) {
  const sorted = [...sessions].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt)
  );
  const rows = sorted.map((s) => ({
    session: s,
    booked: seatsTaken(bookings, s.id),
    occupancy: occupancyPct(s, bookings)
  }));
  const cap = sorted.reduce((n, s) => n + s.capacity, 0);
  const total = bookings.length;
  const kindOf = new Map(sorted.map((s) => [s.id, s.kind]));
  const byKind = /* @__PURE__ */ new Map();
  for (const b of bookings) {
    const k = kindOf.get(b.sessionId);
    if (k) byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  let topKind = null;
  let top = 0;
  for (const [k, n] of byKind)
    if (n > top) {
      top = n;
      topKind = k;
    }
  return {
    rows,
    totalSessions: sorted.length,
    totalBookings: total,
    activeClients: users.filter((u) => u.role === "client").length,
    occupancy: cap ? Math.round(total / cap * 100) : 0,
    topKind
  };
}

// src/application/services.ts
var RemoteAuth = class {
  constructor(api, state) {
    this.api = api;
    this.state = state;
  }
  currentUser() {
    return this.state.me;
  }
  async login(email, password) {
    const r = await this.api.auth.login(email, password);
    if (!r.ok) return r;
    await this.state.refresh();
    this.state.setMe(r.value);
    return r;
  }
  async register(name, email, password) {
    const r = await this.api.auth.register(name, email, password);
    if (!r.ok) return r;
    await this.state.refresh();
    this.state.setMe(r.value);
    return r;
  }
  async logout() {
    await this.api.auth.logout();
    this.state.setMe(null);
  }
  async restoreSession() {
    const r = await this.api.auth.me();
    if (!r.ok) return r;
    await this.state.refresh();
    this.state.setMe(r.value);
    return r;
  }
};
var RemoteBooking = class {
  constructor(api, state) {
    this.api = api;
    this.state = state;
  }
  async book(sessionId) {
    const me = this.state.me;
    if (!me) return fail({ code: "forbidden" });
    const session = this.state.sessionById(sessionId);
    if (!session)
      return fail({ code: "not-found", message: "\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" });
    const check = checkBookable(
      session,
      this.state.allBookings(),
      me.id,
      /* @__PURE__ */ new Date()
    );
    if (!check.ok) return check;
    const temp = {
      id: `tmp-${Date.now()}`,
      userId: me.id,
      sessionId,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.state.addBooking(temp);
    const r = await this.api.bookings.create(sessionId);
    if (!r.ok) {
      this.state.removeBooking(temp.id);
      return r;
    }
    this.state.replaceBooking(temp.id, r.value);
    return r;
  }
  async cancel(bookingId) {
    const snapshot = this.state.bookingById(bookingId);
    if (snapshot) this.state.removeBooking(bookingId);
    const r = await this.api.bookings.cancel(bookingId);
    if (!r.ok && snapshot) this.state.addBooking(snapshot);
    return r;
  }
  async restore(booking) {
    return this.book(booking.sessionId);
  }
  ofCurrentUser() {
    const me = this.state.me;
    return me ? this.state.allBookings().filter((b) => b.userId === me.id) : [];
  }
};
var RemoteCatalog = class {
  constructor(api, state) {
    this.api = api;
    this.state = state;
  }
  async create(draft) {
    const r = await this.api.sessions.create(draft);
    if (r.ok) this.state.upsertSession(r.value);
    return r;
  }
  async update(id, draft) {
    const r = await this.api.sessions.update(id, draft);
    if (r.ok) this.state.upsertSession(r.value);
    return r;
  }
  async remove(id) {
    const r = await this.api.sessions.remove(id);
    if (r.ok) this.state.removeSession(id);
    return r;
  }
  async restore(undoToken) {
    const r = await this.api.sessions.restore(undoToken);
    if (r.ok) await this.state.refresh();
    return r;
  }
};
var RemoteAccounts = class {
  constructor(api, state) {
    this.api = api;
    this.state = state;
  }
  async update(id, patch) {
    const r = await this.api.users.update(id, patch);
    if (r.ok) this.state.upsertUser(r.value);
    return r;
  }
  async remove(id) {
    const r = await this.api.users.remove(id);
    if (r.ok) this.state.removeUser(id);
    return r;
  }
  async restore(undoToken) {
    const r = await this.api.users.restore(undoToken);
    if (r.ok) await this.state.refresh();
    return r;
  }
};

// src/ui/dom.ts
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== void 0) el.textContent = props.text;
  if (props.style) el.setAttribute("style", props.style);
  if (props.attrs) {
    for (const [name, value] of Object.entries(props.attrs)) {
      if (value === false) continue;
      el.setAttribute(name, value === true ? "" : String(value));
    }
  }
  if (props.dataset) Object.assign(el.dataset, props.dataset);
  if (props.on) {
    for (const [type, handler] of Object.entries(props.on)) {
      if (handler) el.addEventListener(type, handler);
    }
  }
  append(el, children);
  if (props.value !== void 0)
    el.value = props.value;
  if (props.checked !== void 0)
    el.checked = props.checked;
  if (props.disabled !== void 0)
    el.disabled = props.disabled;
  return el;
}
function append(el, children) {
  for (const child of children) {
    if (child === null || child === void 0 || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else
      el.append(
        child instanceof Node ? child : document.createTextNode(String(child))
      );
  }
}
function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

// src/ui/icons.ts
var PATHS = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  ticket: '<path d="M4 7.5h16V11a2 2 0 0 0 0 4v3.5H4V15a2 2 0 0 0 0-4z"/><path d="M14.5 7.5v11" stroke-dasharray="2.5 3"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  download: '<path d="M12 4v10.5M7.5 11l4.5 4.5L16.5 11M4.5 19.5h15"/>',
  edit: '<path d="M4.5 19.5l4-1L19 8a2.1 2.1 0 0 0-3-3L5.5 15.5z"/><path d="M13.5 7.5l3 3"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-6.5-5.2-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.8 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c1.4-3.8 4.6-5.5 7.5-5.5s6.1 1.7 7.5 5.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M2.8 19.5c1.2-3.2 3.9-4.7 6.2-4.7s5 1.5 6.2 4.7"/><path d="M15.5 5.6a3.3 3.3 0 0 1 0 5.8M17.8 15.2c1.6.7 2.9 2.1 3.5 4.3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  bookmark: '<path d="M6 3.5h12V21l-6-4-6 4z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  chart: '<path d="M4 20h16"/><path d="M7 20v-6M12 20V6M17 20v-9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19"/>',
  moon: '<path d="M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5z"/>',
  "arrow-left": '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  sliders: '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2.2"/><circle cx="9" cy="16" r="2.2"/>'
};
function icon(name, size = 20) {
  const tpl = document.createElement("template");
  tpl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return tpl.content.firstElementChild;
}

// src/ui/format.ts
var KIND_LABEL = {
  strength: "\u0421\u0438\u043B\u043E\u0432\u0430\u044F",
  cardio: "\u041A\u0430\u0440\u0434\u0438\u043E",
  yoga: "\u0419\u043E\u0433\u0430",
  crossfit: "\u041A\u0440\u043E\u0441\u0441\u0444\u0438\u0442",
  stretch: "\u0421\u0442\u0440\u0435\u0442\u0447\u0438\u043D\u0433"
};
var KIND_INTENSITY = {
  strength: { label: "\u0418\u043D\u0442\u0435\u043D\u0441\u0438\u0432\u043D\u0430\u044F", level: 3 },
  crossfit: { label: "\u0418\u043D\u0442\u0435\u043D\u0441\u0438\u0432\u043D\u0430\u044F", level: 3 },
  cardio: { label: "\u0421\u0440\u0435\u0434\u043D\u044F\u044F", level: 2 },
  yoga: { label: "\u0421\u043F\u043E\u043A\u043E\u0439\u043D\u0430\u044F", level: 1 },
  stretch: { label: "\u0421\u043F\u043E\u043A\u043E\u0439\u043D\u0430\u044F", level: 1 }
};
var unsplash = (id, w) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;
var KIND_PHOTO = {
  strength: unsplash("photo-1526506118085-60ce8714f8c5", 800),
  cardio: unsplash("photo-1476480862126-209bfaa8edc8", 800),
  yoga: unsplash("photo-1544367567-0f2fcb009e0b", 800),
  crossfit: unsplash("photo-1541534741688-6078c6bfb5c5", 800),
  stretch: unsplash("photo-1552196563-55cd4e45efb3", 800)
};
var KIND_GRADIENT = {
  strength: "linear-gradient(135deg,#1e3a8a,#2f6fed)",
  cardio: "linear-gradient(135deg,#b3300f,#e4572e)",
  yoga: "linear-gradient(135deg,#5b34b8,#8b5cf6)",
  crossfit: "linear-gradient(135deg,#7a5200,#c98a0b)",
  stretch: "linear-gradient(135deg,#0b6e6a,#12a5a0)"
};
var HERO_PHOTO = unsplash("photo-1571902943202-507ec2618e8f", 1400);
var AUTH_PHOTO = unsplash("photo-1534438327276-14e5300c3a48", 1200);
var coverUrl = (kind) => KIND_PHOTO[kind];
var timeFmt = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit"
});
var dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short"
});
var fullFmt = new Intl.DateTimeFormat("ru-RU", {
  weekday: "long",
  day: "numeric",
  month: "long"
});
var weekdayFmt = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });
var fmtTime = (iso) => timeFmt.format(new Date(iso));
var fmtDate = (iso) => dateFmt.format(new Date(iso));
var fmtFull = (iso) => `${fullFmt.format(new Date(iso))}, ${fmtTime(iso)}`;
var fmtEndTime = (iso, durationMin) => fmtTime(new Date(Date.parse(iso) + durationMin * 6e4).toISOString());
function dayLabel(offset, now) {
  const d = addDays(now, offset);
  const top = offset === 0 ? "\u0421\u0435\u0433\u043E\u0434\u043D\u044F" : offset === 1 ? "\u0417\u0430\u0432\u0442\u0440\u0430" : weekdayFmt.format(d);
  return { top, sub: dateFmt.format(d) };
}
function relativeDay(iso, now) {
  const key = dayKey(iso);
  if (key === dayKey(now)) return "\u0421\u0435\u0433\u043E\u0434\u043D\u044F";
  if (key === dayKey(addDays(now, 1))) return "\u0417\u0430\u0432\u0442\u0440\u0430";
  if (key === dayKey(addDays(now, -1))) return "\u0412\u0447\u0435\u0440\u0430";
  return weekdayFmt.format(new Date(iso));
}
function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
function timeInputValue(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
var toCsv = (rows) => rows.map(
  (row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")
).join("\r\n");
function downloadText(filename, text) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" })
  );
  const a = h("a", { attrs: { href: url, download: filename } });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1e3);
}

// src/ui/controls.ts
function button(opts) {
  const cls = [
    "btn",
    `btn-${opts.tone ?? "primary"}`,
    opts.wide ? "btn-wide" : "",
    opts.small ? "btn-small" : ""
  ].filter(Boolean).join(" ");
  return h(
    "button",
    {
      class: cls,
      attrs: { type: opts.type ?? "button" },
      disabled: opts.disabled,
      on: opts.onClick ? { click: opts.onClick } : void 0
    },
    opts.icon ? icon(opts.icon, 18) : null,
    h("span", { text: opts.label })
  );
}
function iconButton(name, label, onClick, opts) {
  return h(
    "button",
    {
      class: `icon-btn${opts?.danger ? " danger" : ""}`,
      attrs: { type: "button", "aria-label": label, title: label },
      disabled: opts?.disabled,
      on: { click: onClick }
    },
    icon(name, 18)
  );
}
function chip(label, active, onClick) {
  return h("button", {
    class: `chip-btn${active ? " active" : ""}`,
    attrs: { type: "button", "aria-pressed": String(active) },
    on: { click: onClick },
    text: label
  });
}
var kindBadge = (kind) => h("span", { class: `chip k-${kind}`, text: KIND_LABEL[kind] });
var intensityChip = (kind) => {
  const meta = KIND_INTENSITY[kind];
  return h("span", {
    class: `intensity i-${meta.level}`,
    text: meta.label,
    attrs: { title: `\u0418\u043D\u0442\u0435\u043D\u0441\u0438\u0432\u043D\u043E\u0441\u0442\u044C: ${meta.label.toLowerCase()}` }
  });
};
function remoteImg(src, alt, cls, makeFallback) {
  const img = h("img", {
    class: cls,
    attrs: {
      src,
      alt,
      loading: "lazy",
      decoding: "async",
      referrerpolicy: "no-referrer"
    }
  });
  img.addEventListener(
    "error",
    () => {
      img.replaceWith(makeFallback());
    },
    { once: true }
  );
  return img;
}
var coverImg = (kind, cls = "cover-img") => remoteImg(
  coverUrl(kind),
  KIND_LABEL[kind],
  cls,
  () => h(
    "div",
    { class: "cover-fallback", style: `background:${KIND_GRADIENT[kind]}` },
    h("span", { text: KIND_LABEL[kind] })
  )
);
var miniAvatar = (name) => h("span", {
  class: "mini-avatar",
  text: name.charAt(0).toUpperCase(),
  attrs: { "aria-hidden": "true" }
});
var roleBadge = (role) => h("span", {
  class: `role-badge ${role}`,
  text: role === "admin" ? "\u0410\u0434\u043C\u0438\u043D" : "\u041A\u043B\u0438\u0435\u043D\u0442"
});
var avatar = (name) => h("span", { class: "avatar", text: name.charAt(0).toUpperCase() });
var field = (label, input, wide = false) => h(
  "label",
  { class: `field${wide ? " span2" : ""}` },
  h("span", { class: "field-label", text: label }),
  input
);
var textInput = (attrs, value) => h("input", { class: "input", attrs, value });
var selectInput = (options, value) => h(
  "select",
  { class: "input select", value },
  ...options.map(
    (o) => h("option", { attrs: { value: o.value }, text: o.label })
  )
);
var emptyState = (text, action, iconName = "search") => h(
  "div",
  { class: "empty" },
  icon(iconName, 28),
  h("p", { text }),
  action ?? null
);
var occupancyBar = (pct) => h(
  "span",
  { class: `bar${pct >= 100 ? " full" : ""}` },
  h("span", { style: `width:${Math.min(100, Math.max(0, pct))}%` })
);
var statCard = (value, label) => h(
  "div",
  { class: "r-card" },
  h("strong", { text: String(value) }),
  h("span", { text: label })
);
var pageHead = (title, subtitle, actions) => h(
  "section",
  { class: "hero" },
  h(
    "div",
    { class: "hero-text" },
    h("h1", { text: title }),
    h("p", { class: "muted", text: subtitle })
  ),
  actions ?? null
);
function dataTable(headers, rows) {
  const toCell = (c) => c instanceof HTMLElement && c.tagName === "TD" ? c : h("td", {}, c);
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, ...headers.map((head) => h("th", {}, head)))),
      h(
        "tbody",
        {},
        ...rows.map(
          (row) => h(
            "tr",
            {
              ...row.class ? { class: row.class } : {},
              ...row.onClick ? { on: { click: row.onClick } } : {}
            },
            ...row.cells.map(toCell)
          )
        )
      )
    )
  );
}

// src/ui/theme.ts
var KEY = "atlet:theme";
function system() {
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function stored() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}
function apply(theme) {
  document.documentElement.dataset.theme = theme;
}
function initTheme() {
  const theme = stored() ?? system();
  apply(theme);
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (!stored()) apply(system());
  });
  return theme;
}
function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(KEY, next);
  } catch {
  }
  apply(next);
  return next;
}

// src/app/shell.ts
var AppShell = class {
  constructor(ctx, root) {
    this.ctx = ctx;
    this.route = "home";
    initTheme();
    this.bannerText = h("span", {
      text: "\u041D\u0435\u0442 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F \u2014 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435"
    });
    this.banner = h(
      "div",
      { class: "net-banner", attrs: { role: "alert" } },
      this.bannerText,
      button({
        label: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C",
        tone: "ghost",
        small: true,
        onClick: () => {
          void this.ctx.state.refresh();
        }
      })
    );
    this.header = h("header", { class: "top" });
    this.content = h("main", { class: "main" });
    this.footer = h(
      "footer",
      { class: "foot" },
      h("span", { text: "\u0410\u0422\u041B\u0415\u0422 \xB7 \u0443\u0447\u0435\u0431\u043D\u044B\u0439 \u043F\u0440\u043E\u0435\u043A\u0442 \xB7 \u0434\u0430\u043D\u043D\u044B\u0435 \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435" })
    );
    this.mobileNav = h("nav", {
      class: "mob-nav",
      attrs: { "aria-label": "\u041C\u043E\u0431\u0438\u043B\u044C\u043D\u0430\u044F \u043D\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u044F" }
    });
    root.append(
      this.banner,
      this.header,
      this.content,
      this.footer,
      this.mobileNav
    );
    this.ctx.bus.on("auth", () => this.sync(this.route));
    this.ctx.bus.on("users", () => this.renderHeader());
    this.ctx.bus.on("bookings", () => this.renderHeader());
    this.ctx.bus.on("sessions", () => this.renderHeader());
    this.ctx.bus.on("sync", () => this.syncBanner());
    window.addEventListener("online", () => this.networkChanged(true));
    window.addEventListener("offline", () => this.networkChanged(false));
    this.syncBanner();
  }
  sync(route) {
    this.route = route;
    this.content.className = "main " + (route === "home" ? "main-landing" : route === "admin" ? "main-admin" : "main-app");
    this.footer.hidden = route === "home" || route === "auth";
    this.renderHeader();
    this.renderMobileNav();
    this.syncBanner();
  }
  themeButton() {
    const btn = iconButton(
      currentTheme() === "dark" ? "sun" : "moon",
      "\u0421\u043C\u0435\u043D\u0438\u0442\u044C \u0442\u0435\u043C\u0443",
      () => {
        const next = toggleTheme();
        replace(btn, icon(next === "dark" ? "sun" : "moon", 18));
      }
    );
    return btn;
  }
  brand(suffix = "") {
    return h(
      "button",
      {
        class: "brand",
        attrs: { type: "button", "aria-label": "\u0410\u0422\u041B\u0415\u0422 \u2014 \u043D\u0430 \u0433\u043B\u0430\u0432\u043D\u0443\u044E" },
        on: { click: () => this.ctx.navigate("home") }
      },
      h("span", { class: "logo-mark" }, icon("dumbbell", 22)),
      h("span", {
        class: "brand-name",
        text: suffix ? `\u0410\u0422\u041B\u0415\u0422 ${suffix}` : "\u0410\u0422\u041B\u0415\u0422"
      })
    );
  }
  renderHeader() {
    const user = this.ctx.auth.currentUser();
    let variant;
    let items;
    if (this.route === "auth") {
      variant = "top-public";
      items = [
        this.brand(),
        h(
          "div",
          { class: "top-actions" },
          button({
            label: "\u041D\u0430 \u0433\u043B\u0430\u0432\u043D\u0443\u044E",
            tone: "ghost",
            small: true,
            icon: "arrow-left",
            onClick: () => this.ctx.navigate("home")
          }),
          this.themeButton()
        )
      ];
    } else if (this.route === "home") {
      variant = "top-public";
      const anchor = (id, label) => h("button", {
        class: "nav-link",
        attrs: { type: "button" },
        text: label,
        on: {
          click: () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
      });
      items = [
        this.brand(),
        h(
          "nav",
          { class: "nav nav-public", attrs: { "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B" } },
          anchor("directions", "\u041D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F"),
          anchor("trainers", "\u0422\u0440\u0435\u043D\u0435\u0440\u044B"),
          anchor("pricing", "\u0426\u0435\u043D\u044B")
        ),
        h(
          "div",
          { class: "top-actions" },
          button({
            label: user ? "\u0412 \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435" : "\u0412\u043E\u0439\u0442\u0438",
            tone: "primary",
            small: true,
            onClick: () => this.ctx.navigate(user ? "schedule" : "auth")
          }),
          this.themeButton()
        )
      ];
    } else if (this.route === "admin" && user) {
      variant = "top-admin";
      items = [
        this.brand("ADMIN"),
        h(
          "div",
          { class: "top-actions" },
          button({
            label: "\u041D\u0430 \u0441\u0430\u0439\u0442",
            tone: "ghost",
            small: true,
            icon: "arrow-left",
            onClick: () => this.ctx.navigate("schedule")
          }),
          this.themeButton(),
          this.userChip(user)
        )
      ];
    } else if (user) {
      variant = "top-app";
      const upcoming = this.upcomingCount();
      const navBtn = (route, label, name, badge = 0) => h(
        "button",
        {
          class: `nav-btn${this.route === route ? " active" : ""}`,
          attrs: {
            type: "button",
            ...this.route === route ? { "aria-current": "page" } : {}
          },
          on: { click: () => this.ctx.navigate(route) }
        },
        icon(name, 20),
        h("span", { text: label }),
        badge > 0 ? h("em", { class: "badge", text: String(badge) }) : null
      );
      items = [
        this.brand(),
        h(
          "nav",
          { class: "nav", attrs: { "aria-label": "\u041E\u0441\u043D\u043E\u0432\u043D\u0430\u044F \u043D\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u044F" } },
          navBtn("schedule", "\u0420\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435", "calendar"),
          navBtn("bookings", "\u041C\u043E\u0438 \u0437\u0430\u043F\u0438\u0441\u0438", "ticket", upcoming)
        ),
        h(
          "div",
          { class: "top-actions" },
          this.themeButton(),
          this.userChip(user)
        )
      ];
    } else {
      variant = "top-public";
      items = [
        this.brand(),
        h("div", { class: "top-actions" }, this.themeButton())
      ];
    }
    this.header.className = `top ${variant}`;
    replace(this.header, h("div", { class: "top-inner" }, ...items));
  }
  userChip(user) {
    return h(
      "div",
      { class: "user-chip" },
      avatar(user.name),
      h("span", { class: "user-name", text: user.name }),
      iconButton("logout", "\u0412\u044B\u0439\u0442\u0438", () => {
        void this.ctx.auth.logout();
      })
    );
  }
  upcomingCount() {
    const now = /* @__PURE__ */ new Date();
    return this.ctx.booking.ofCurrentUser().filter((b) => {
      const s = this.ctx.state.sessionById(b.sessionId);
      return s !== void 0 && !isFinished(s, now);
    }).length;
  }
  networkChanged(online) {
    this.syncBanner();
    this.ctx.toasts.show(
      online ? "\u0421\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E" : "\u0421\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435 \u043F\u043E\u0442\u0435\u0440\u044F\u043D\u043E",
      online ? "ok" : "err"
    );
    if (online) void this.ctx.state.refresh();
  }
  syncBanner() {
    const offline = !navigator.onLine;
    const serverDown = navigator.onLine && !this.ctx.state.isSyncOk;
    this.banner.hidden = !offline && !serverDown || this.route === "auth";
    this.bannerText.textContent = offline ? "\u041D\u0435\u0442 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F \u2014 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435" : "\u0421\u0435\u0440\u0432\u0435\u0440 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u2014 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435";
  }
  renderMobileNav() {
    const user = this.ctx.auth.currentUser();
    if (!user || this.route === "home" || this.route === "auth" || this.route === "admin") {
      this.mobileNav.replaceChildren();
      return;
    }
    const upcoming = this.upcomingCount();
    const btn = (route, label, name, badge = 0) => h(
      "button",
      {
        class: `mob-nav-btn${this.route === route ? " active" : ""}`,
        attrs: {
          type: "button",
          ...this.route === route ? { "aria-current": "page" } : {}
        },
        on: { click: () => this.ctx.navigate(route) }
      },
      icon(name, 22),
      h("span", { text: label }),
      badge > 0 ? h("em", { class: "badge", text: String(badge) }) : null
    );
    replace(
      this.mobileNav,
      btn("schedule", "\u0420\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435", "calendar"),
      btn("bookings", "\u0417\u0430\u043F\u0438\u0441\u0438", "ticket", upcoming)
    );
  }
};

// src/app/router.ts
var ROUTES = [
  "home",
  "auth",
  "schedule",
  "bookings",
  "admin"
];
var Router = class {
  constructor(ctx, host, factories, onRoute) {
    this.ctx = ctx;
    this.host = host;
    this.factories = factories;
    this.onRoute = onRoute;
    this.current = null;
    this.currentRoute = null;
  }
  start() {
    window.addEventListener("hashchange", () => this.resolve());
    this.ctx.bus.on("auth", () => this.resolve());
    this.ctx.bus.on("users", () => this.resolve());
    this.resolve();
  }
  navigate(route) {
    const hash = `#/${route}`;
    if (location.hash === hash) this.resolve();
    else location.hash = hash;
  }
  resolve() {
    const route = this.guard(this.parse());
    const canonical = `#/${route}`;
    if (location.hash !== canonical) history.replaceState(null, "", canonical);
    this.onRoute(route);
    if (route === this.currentRoute && this.current) return;
    this.current?.destroy();
    this.currentRoute = route;
    this.current = this.factories[route]();
    this.host.replaceChildren();
    this.current.mount(this.host);
    window.scrollTo({ top: 0 });
  }
  parse() {
    const raw = location.hash.replace(/^#\/?/, "");
    return ROUTES.includes(raw) ? raw : "home";
  }
  /** Лендинг доступен всем. Закрыты только auth для авторизованных и admin для не-админов. */
  guard(requested) {
    const user = this.ctx.auth.currentUser();
    if (!user) return requested === "auth" ? "auth" : "home";
    if (requested === "auth")
      return user.role === "admin" ? "admin" : "schedule";
    if (requested === "admin" && user.role !== "admin") return "schedule";
    return requested;
  }
};

// src/app/saved-views.ts
var KEY2 = "atlet:presets:v1";
var SavedViewsStore = class {
  all() {
    try {
      const raw = localStorage.getItem(KEY2);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  save(name, filters) {
    const preset = {
      id: crypto.randomUUID(),
      name,
      filters: { ...filters }
    };
    try {
      localStorage.setItem(KEY2, JSON.stringify([...this.all(), preset]));
    } catch {
    }
  }
  remove(id) {
    try {
      localStorage.setItem(
        KEY2,
        JSON.stringify(this.all().filter((p) => p.id !== id))
      );
    } catch {
    }
  }
};

// src/state/app-state.ts
var EventBus = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Map();
  }
  on(event, fn) {
    const set = this.listeners.get(event) ?? /* @__PURE__ */ new Set();
    set.add(fn);
    this.listeners.set(event, set);
    return () => set.delete(fn);
  }
  emit(event) {
    for (const fn of [...this.listeners.get(event) ?? []]) fn();
  }
};
var SNAPSHOT_KEY = "atlet:snapshot:v1";
var AppState = class {
  constructor(api, bus) {
    this.api = api;
    this.bus = bus;
    this.user = null;
    this.users = [];
    this.sessions = [];
    this.bookings = [];
    this.syncOk = true;
    this.syncErrorHandler = null;
  }
  get me() {
    return this.user;
  }
  get isSyncOk() {
    return this.syncOk;
  }
  onSyncError(fn) {
    this.syncErrorHandler = fn;
  }
  markSyncFailed() {
    this.syncOk = false;
    this.bus.emit("sync");
  }
  setMe(user) {
    this.user = user;
    if (!user) {
      this.users = [];
      this.sessions = [];
      this.bookings = [];
    }
    this.bus.emit("auth");
  }
  allUsers() {
    return this.users;
  }
  allSessions() {
    return this.sessions;
  }
  allBookings() {
    return this.bookings;
  }
  userById(id) {
    return this.users.find((u) => u.id === id);
  }
  sessionById(id) {
    return this.sessions.find((s) => s.id === id);
  }
  bookingById(id) {
    return this.bookings.find((b) => b.id === id);
  }
  async refresh() {
    const r = await this.api.state();
    if (!r.ok) {
      const code = r.error.code;
      this.syncOk = code !== "network";
      if (code === "unauthorized") this.setMe(null);
      else this.syncErrorHandler?.(r.error);
      this.bus.emit("sync");
      return r;
    }
    try {
      const { sessions, bookings, users } = r.value;
      if (!Array.isArray(sessions) || !Array.isArray(bookings)) {
        throw new Error("state: \u043E\u0436\u0438\u0434\u0430\u044E\u0442\u0441\u044F \u043C\u0430\u0441\u0441\u0438\u0432\u044B sessions/bookings");
      }
      this.sessions = sessions;
      this.bookings = bookings;
      this.users = Array.isArray(users) ? users : [];
      this.syncOk = true;
      this.persist();
      this.bus.emit("sessions");
      this.bus.emit("bookings");
      this.bus.emit("users");
      this.bus.emit("sync");
      return ok(void 0);
    } catch {
      this.syncOk = true;
      this.syncErrorHandler?.({
        code: "contract",
        message: "\u0414\u0430\u043D\u043D\u044B\u0435 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u043D\u0435 \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u044E\u0442 \u0444\u043E\u0440\u043C\u0430\u0442\u0443"
      });
      this.bus.emit("sync");
      return fail({ code: "contract", message: "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0444\u043E\u0440\u043C\u0430\u0442 \u0434\u0430\u043D\u043D\u044B\u0445" });
    }
  }
  loadSnapshot() {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      this.sessions = data.sessions ?? [];
      this.bookings = data.bookings ?? [];
      this.users = data.users ?? [];
      return this.sessions.length > 0;
    } catch {
      return false;
    }
  }
  persist() {
    try {
      localStorage.setItem(
        SNAPSHOT_KEY,
        JSON.stringify({
          sessions: this.sessions,
          bookings: this.bookings,
          users: this.users
        })
      );
    } catch {
    }
  }
  addBooking(b) {
    this.bookings = [...this.bookings, b];
    this.bus.emit("bookings");
  }
  removeBooking(id) {
    this.bookings = this.bookings.filter((b) => b.id !== id);
    this.bus.emit("bookings");
  }
  replaceBooking(tempId, real) {
    this.bookings = this.bookings.map((b) => b.id === tempId ? real : b);
    this.bus.emit("bookings");
  }
  upsertSession(s) {
    const i = this.sessions.findIndex((x) => x.id === s.id);
    this.sessions = i >= 0 ? this.sessions.map((x) => x.id === s.id ? s : x) : [...this.sessions, s];
    this.bus.emit("sessions");
  }
  removeSession(id) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.bookings = this.bookings.filter((b) => b.sessionId !== id);
    this.bus.emit("sessions");
    this.bus.emit("bookings");
  }
  upsertUser(u) {
    const i = this.users.findIndex((x) => x.id === u.id);
    this.users = i >= 0 ? this.users.map((x) => x.id === u.id ? u : x) : [...this.users, u];
    this.bus.emit("users");
  }
  removeUser(id) {
    this.users = this.users.filter((u) => u.id !== id);
    this.bookings = this.bookings.filter((b) => b.userId !== id);
    this.bus.emit("users");
    this.bus.emit("bookings");
  }
};

// src/ui/messages.ts
var FALLBACK = {
  validation: "\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0432\u0432\u0435\u0434\u0451\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435",
  "not-found": "\u0414\u0430\u043D\u043D\u044B\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B",
  forbidden: "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043F\u0440\u0430\u0432 \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F",
  "invalid-credentials": "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 email \u0438\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C",
  "email-taken": "\u042D\u0442\u043E\u0442 email \u0443\u0436\u0435 \u0437\u0430\u043D\u044F\u0442",
  "session-full": "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0445 \u043C\u0435\u0441\u0442 \u043D\u0435 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C",
  "already-booked": "\u0412\u044B \u0443\u0436\u0435 \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u044B \u043D\u0430 \u044D\u0442\u0443 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0443",
  "session-started": "\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u0443\u0436\u0435 \u043D\u0430\u0447\u0430\u043B\u0430\u0441\u044C \u0438\u043B\u0438 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043B\u0430\u0441\u044C",
  "capacity-below-booked": "\u0412\u043C\u0435\u0441\u0442\u0438\u043C\u043E\u0441\u0442\u044C \u043C\u0435\u043D\u044C\u0448\u0435 \u0447\u0438\u0441\u043B\u0430 \u0437\u0430\u043F\u0438\u0441\u0435\u0439",
  "self-delete": "\u041D\u0435\u043B\u044C\u0437\u044F \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u0443\u044E \u0443\u0447\u0451\u0442\u043D\u0443\u044E \u0437\u0430\u043F\u0438\u0441\u044C",
  network: "\u0421\u0435\u0440\u0432\u0435\u0440 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D"
};
function errorMessage(error) {
  const message = error.message?.trim();
  if (message) return message;
  return FALLBACK[error.code] ?? "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430";
}

// src/ui/overlay.ts
var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
var OverlayHost = class {
  constructor(host) {
    this.host = host;
    this.stack = [];
    document.addEventListener("keydown", (e) => {
      const top = this.stack[this.stack.length - 1];
      if (!top) return;
      if (e.key === "Escape") top.close();
      else if (e.key === "Tab") this.trapFocus(e, top.panel);
    });
  }
  open(content, variant = "modal", onClose) {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = h(
      "div",
      {
        class: `panel panel-${variant}`,
        attrs: { role: "dialog", "aria-modal": "true", tabindex: "-1" }
      },
      content
    );
    const scrim = h("div", { class: `scrim scrim-${variant}` }, panel);
    scrim.addEventListener("click", (e) => {
      if (e.target === scrim) close();
    });
    const entry = { scrim, panel, previousFocus, close: () => {
    } };
    const close = () => {
      const idx = this.stack.indexOf(entry);
      if (idx < 0) return;
      this.stack.splice(idx, 1);
      scrim.classList.remove("open");
      window.setTimeout(() => scrim.remove(), 220);
      if (this.stack.length === 0) document.body.classList.remove("no-scroll");
      const below = this.stack[this.stack.length - 1];
      if (below) below.panel.focus();
      else previousFocus?.focus();
      onClose?.();
    };
    entry.close = close;
    this.stack.push(entry);
    this.host.append(scrim);
    document.body.classList.add("no-scroll");
    requestAnimationFrame(() => scrim.classList.add("open"));
    (panel.querySelector(FOCUSABLE) ?? panel).focus();
    return close;
  }
  closeActive() {
    this.stack[this.stack.length - 1]?.close();
  }
  closeAll() {
    while (this.stack.length > 0) this.stack[this.stack.length - 1].close();
  }
  confirm(opts) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      const body = h(
        "div",
        { class: "confirm" },
        h("h3", { text: opts.title }),
        h("p", { class: "muted", text: opts.text }),
        h(
          "div",
          { class: "modal-actions" },
          button({ label: "\u041E\u0442\u043C\u0435\u043D\u0430", tone: "ghost", onClick: () => close() }),
          button({
            label: opts.okLabel ?? "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
            tone: "danger",
            onClick: () => {
              done(true);
              close();
            }
          })
        )
      );
      const close = this.open(body, "modal", () => done(false));
    });
  }
  trapFocus(e, panel) {
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter(
      (el) => el.getClientRects().length > 0
    );
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || current === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && current === last) {
      e.preventDefault();
      first.focus();
    }
  }
};

// src/ui/toast.ts
var ToastCenter = class {
  constructor(host) {
    this.root = h("div", { class: "toasts", attrs: { "aria-live": "polite" } });
    host.append(this.root);
  }
  show(message, tone = "info", action) {
    const toast = h(
      "div",
      { class: `toast toast-${tone}`, attrs: { role: "status" } },
      h("span", { class: "toast-msg", text: message }),
      action ? h("button", {
        class: "toast-act",
        attrs: { type: "button" },
        text: action.label,
        on: {
          click: () => {
            action.run();
            dismiss();
          }
        }
      }) : null,
      h("button", {
        class: "toast-x",
        attrs: { type: "button", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C" },
        text: "\xD7",
        on: { click: () => dismiss() }
      })
    );
    let timer = 0;
    const dismiss = () => {
      window.clearTimeout(timer);
      toast.classList.add("out");
      window.setTimeout(() => toast.remove(), 200);
    };
    timer = window.setTimeout(dismiss, action ? 7e3 : 4200);
    this.root.append(toast);
    while (this.root.children.length > 4) this.root.firstElementChild?.remove();
  }
};

// src/core/types.ts
var WORKOUT_KINDS = [
  "strength",
  "cardio",
  "yoga",
  "crossfit",
  "stretch"
];
var DEFAULT_FILTERS = {
  dayOffset: 0,
  kind: "all",
  time: "all",
  query: "",
  sort: "time"
};

// src/views/view.ts
var BaseView = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.controller = new AbortController();
    this.unsubscribers = [];
  }
  mount(container) {
    this.root = container;
    this.init();
    this.render();
  }
  destroy() {
    this.controller.abort();
    for (const un of this.unsubscribers.splice(0)) un();
    this.onDestroy();
  }
  init() {
  }
  onDestroy() {
  }
  watch(event, fn) {
    this.unsubscribers.push(this.ctx.bus.on(event, fn));
  }
  listen(target, type, fn) {
    target.addEventListener(type, fn, {
      signal: this.controller.signal
    });
  }
};

// src/views/admin-view.ts
var AdminView = class extends BaseView {
  constructor(ctx) {
    super(ctx);
    this.section = "overview";
    this.dayFilter = "all";
    this.sessionQuery = "";
    this.clientQuery = "";
    this.selection = /* @__PURE__ */ new Set();
  }
  init() {
    this.watch("sessions", () => this.renderSection());
    this.watch("bookings", () => this.renderSection());
    this.watch("users", () => this.renderSection());
  }
  render() {
    this.sectionEl = h("div", { class: "admin-content" });
    replace(
      this.root,
      h("div", { class: "admin" }, this.sidebar(), this.sectionEl)
    );
    this.renderSection();
  }
  sidebar() {
    const item = (id, label, name) => h(
      "button",
      {
        class: `side-btn${this.section === id ? " active" : ""}`,
        attrs: {
          type: "button",
          "aria-current": this.section === id ? "page" : "false"
        },
        on: {
          click: () => {
            this.section = id;
            this.selection.clear();
            this.render();
          }
        }
      },
      icon(name, 18),
      h("span", { text: label })
    );
    return h(
      "aside",
      { class: "side" },
      h("span", { class: "side-title", text: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435" }),
      item("overview", "\u041E\u0431\u0437\u043E\u0440", "grid"),
      item("schedule", "\u0420\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435", "calendar"),
      item("clients", "\u041A\u043B\u0438\u0435\u043D\u0442\u044B", "users"),
      item("reports", "\u041E\u0442\u0447\u0451\u0442\u044B", "chart")
    );
  }
  renderSection() {
    this.pruneSelection();
    if (this.section === "overview") this.renderOverview();
    else if (this.section === "schedule") this.renderSchedule();
    else if (this.section === "clients") this.renderClients();
    else this.renderReports();
  }
  pruneSelection() {
    const ids = new Set(
      this.section === "schedule" ? this.ctx.state.allSessions().map((s) => s.id) : this.section === "clients" ? this.ctx.state.allUsers().map((u) => u.id) : []
    );
    for (const id of [...this.selection])
      if (!ids.has(id)) this.selection.delete(id);
  }
  sessions() {
    return [...this.ctx.state.allSessions()].sort(
      (a, b) => a.startsAt.localeCompare(b.startsAt)
    );
  }
  searchBox(placeholder, value, onInput) {
    const input = h("input", {
      class: "search-input",
      attrs: {
        type: "search",
        placeholder,
        "aria-label": placeholder,
        autocomplete: "off"
      },
      value,
      on: { input: () => onInput(input.value) }
    });
    return h(
      "div",
      { class: "toolbar" },
      h("label", { class: "search" }, icon("search", 18), input)
    );
  }
  bulkBar(onDelete) {
    return h(
      "div",
      { class: "bulk-bar" },
      h("span", { text: `\u0412\u044B\u0431\u0440\u0430\u043D\u043E: ${this.selection.size}` }),
      button({
        label: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
        tone: "danger",
        small: true,
        icon: "trash",
        onClick: onDelete
      }),
      button({
        label: "\u0421\u043D\u044F\u0442\u044C",
        tone: "ghost",
        small: true,
        onClick: () => {
          this.selection.clear();
          this.renderSection();
        }
      })
    );
  }
  // ---------- Обзор ----------
  renderOverview() {
    const now = /* @__PURE__ */ new Date();
    const sessions = this.sessions();
    const bookings = this.ctx.state.allBookings();
    const users = this.ctx.state.allUsers();
    const today = dayKey(now);
    const todaySessions = sessions.filter((s) => dayKey(s.startsAt) === today);
    const todayBookings = bookings.filter((b) => {
      const s = this.ctx.state.sessionById(b.sessionId);
      return s !== void 0 && dayKey(s.startsAt) === today;
    });
    const weekEnd = addDays(now, 7).getTime();
    const week = sessions.filter((s) => {
      const t = Date.parse(s.startsAt);
      return t >= now.getTime() && t < weekEnd;
    });
    const weekCap = week.reduce((n, s) => n + s.capacity, 0);
    const weekBooked = week.reduce((n, s) => n + seatsTaken(bookings, s.id), 0);
    const weekPct = weekCap ? Math.round(weekBooked / weekCap * 100) : 0;
    const upcoming = sessions.filter((s) => Date.parse(s.startsAt) > now.getTime()).slice(0, 5);
    const attention = upcoming.filter(
      (s) => Date.parse(s.startsAt) < now.getTime() + 48 * 36e5 && occupancyPct(s, bookings) < 30
    );
    replace(
      this.sectionEl,
      pageHead("\u041E\u0431\u0437\u043E\u0440", "\u0421\u0432\u043E\u0434\u043A\u0430 \u043F\u043E \u0446\u0435\u043D\u0442\u0440\u0443 \u043D\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F"),
      h(
        "div",
        { class: "report-cards" },
        statCard(todaySessions.length, "\u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043E\u043A \u0441\u0435\u0433\u043E\u0434\u043D\u044F"),
        statCard(todayBookings.length, "\u0437\u0430\u043F\u0438\u0441\u0435\u0439 \u0441\u0435\u0433\u043E\u0434\u043D\u044F"),
        statCard(users.filter((u) => u.role === "client").length, "\u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432"),
        statCard(`${weekPct}%`, "\u0437\u0430\u043F\u043E\u043B\u043D\u044F\u0435\u043C\u043E\u0441\u0442\u044C \u043D\u0435\u0434\u0435\u043B\u0438")
      ),
      attention.length > 0 ? this.attentionPanel(attention, bookings, now) : null,
      h(
        "div",
        { class: "grid2" },
        this.upcomingPanel(upcoming, bookings, now),
        this.loadPanel(sessions, bookings, now)
      )
    );
  }
  attentionPanel(list, bookings, now) {
    const items = list.map(
      (s) => h(
        "button",
        {
          class: "attn-item",
          attrs: { type: "button" },
          on: { click: () => this.openRoster(s) }
        },
        h("strong", {
          text: `${relativeDay(s.startsAt, now)} ${fmtTime(s.startsAt)}`
        }),
        h("span", { text: s.title }),
        h("span", { class: "muted", text: `${occupancyPct(s, bookings)}%` })
      )
    );
    return h(
      "div",
      { class: "panel-card attn" },
      h("h3", {}, icon("clock", 18), " \u0422\u0440\u0435\u0431\u0443\u044E\u0442 \u0432\u043D\u0438\u043C\u0430\u043D\u0438\u044F"),
      h("p", {
        class: "muted",
        text: "\u0421\u0442\u0430\u0440\u0442\u0443\u044E\u0442 \u0432 \u0431\u043B\u0438\u0436\u0430\u0439\u0448\u0438\u0435 48 \u0447\u0430\u0441\u043E\u0432, \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u044B \u043C\u0435\u043D\u044C\u0448\u0435 \u0447\u0435\u043C \u043D\u0430 30%."
      }),
      h("div", { class: "attn-list" }, ...items)
    );
  }
  upcomingPanel(list, bookings, now) {
    const rows = list.map(
      (s) => h(
        "div",
        { class: "mini-row" },
        h("span", {
          class: "mini-time",
          text: `${relativeDay(s.startsAt, now)} ${fmtTime(s.startsAt)}`
        }),
        h("span", { class: "mini-title", text: s.title }),
        occupancyBar(occupancyPct(s, bookings)),
        iconButton("users", "\u0421\u043E\u0441\u0442\u0430\u0432 \u0433\u0440\u0443\u043F\u043F\u044B", () => this.openRoster(s))
      )
    );
    return h(
      "div",
      { class: "panel-card" },
      h("h3", { text: "\u0411\u043B\u0438\u0436\u0430\u0439\u0448\u0438\u0435 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0438" }),
      list.length === 0 ? h("p", { class: "muted", text: "\u041D\u0435\u0442 \u0437\u0430\u043F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043E\u043A." }) : h("div", { class: "mini-list" }, ...rows)
    );
  }
  loadPanel(sessions, bookings, now) {
    const rows = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(now, i);
      const key = dayKey(day);
      const daySessions = sessions.filter((s) => dayKey(s.startsAt) === key);
      const cap = daySessions.reduce((n, s) => n + s.capacity, 0);
      const booked = daySessions.reduce(
        (n, s) => n + seatsTaken(bookings, s.id),
        0
      );
      const pct = cap ? Math.round(booked / cap * 100) : 0;
      return h(
        "div",
        { class: "chart-row" },
        h("span", {
          class: "chart-label",
          text: relativeDay(day.toISOString(), now)
        }),
        h(
          "span",
          { class: "chart-bar" },
          h("span", { style: `width:${pct}%` })
        ),
        h("span", { class: "chart-value", text: cap ? `${pct}%` : "\u2014" })
      );
    });
    return h(
      "div",
      { class: "panel-card" },
      h("h3", { text: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043F\u043E \u0434\u043D\u044F\u043C" }),
      h("div", { class: "chart" }, ...rows)
    );
  }
  // ---------- Расписание ----------
  renderSchedule() {
    const now = /* @__PURE__ */ new Date();
    const resultsEl = h("div", { class: "day-groups" });
    const renderResults = () => {
      replace(resultsEl, ...this.scheduleGroups());
    };
    replace(
      this.sectionEl,
      pageHead(
        "\u0420\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435",
        "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430\u043C\u0438 \u0438 \u0441\u043E\u0441\u0442\u0430\u0432\u043E\u043C \u0433\u0440\u0443\u043F\u043F",
        button({
          label: "\u041D\u043E\u0432\u0430\u044F \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430",
          icon: "plus",
          onClick: () => this.openSessionForm()
        })
      ),
      this.selection.size > 0 ? this.bulkBar(() => {
        void this.deleteSelectedSessions();
      }) : null,
      h(
        "div",
        { class: "chips" },
        chip("\u0412\u0441\u0435 \u0434\u043D\u0438", this.dayFilter === "all", () => {
          this.dayFilter = "all";
          this.renderSection();
        }),
        ...Array.from(
          { length: 7 },
          (_, i) => chip(
            relativeDay(addDays(now, i).toISOString(), now),
            this.dayFilter === i,
            () => {
              this.dayFilter = i;
              this.renderSection();
            }
          )
        )
      ),
      this.searchBox(
        "\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044E, \u0442\u0440\u0435\u043D\u0435\u0440\u0443, \u0437\u0430\u043B\u0443\u2026",
        this.sessionQuery,
        (v) => {
          this.sessionQuery = v;
          renderResults();
        }
      ),
      resultsEl
    );
    renderResults();
  }
  scheduleGroups() {
    const now = /* @__PURE__ */ new Date();
    const bookings = this.ctx.state.allBookings();
    const q = this.sessionQuery.trim().toLowerCase();
    let list = this.sessions();
    if (this.dayFilter !== "all") {
      const key = dayKey(addDays(now, this.dayFilter));
      list = list.filter((s) => dayKey(s.startsAt) === key);
    }
    if (q)
      list = list.filter(
        (s) => `${s.title} ${s.trainer} ${s.room}`.toLowerCase().includes(q)
      );
    if (list.length === 0) return [emptyState("\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043E\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E.")];
    const groups = /* @__PURE__ */ new Map();
    for (const s of list) {
      const key = dayKey(s.startsAt);
      const bucket = groups.get(key) ?? [];
      bucket.push(s);
      groups.set(key, bucket);
    }
    return [...groups.values()].map(
      (daySessions) => this.dayGroup(daySessions, bookings, now)
    );
  }
  dayGroup(daySessions, bookings, now) {
    const first = daySessions[0];
    const allChecked = daySessions.every((s) => this.selection.has(s.id));
    const master = h("input", {
      attrs: { type: "checkbox", "aria-label": "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0434\u0435\u043D\u044C" },
      checked: allChecked
    });
    master.addEventListener("change", () => {
      if (master.checked) daySessions.forEach((s) => this.selection.add(s.id));
      else daySessions.forEach((s) => this.selection.delete(s.id));
      this.renderSection();
    });
    const head = h(
      "h3",
      { class: "day-group-head" },
      master,
      h("span", {
        text: `${relativeDay(first.startsAt, now)}, ${fmtDate(first.startsAt)}`
      }),
      h("em", { class: "count-pill", text: String(daySessions.length) })
    );
    const table = h(
      "table",
      {},
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", { text: "" }),
          h("th", { text: "\u0412\u0440\u0435\u043C\u044F" }),
          h("th", { text: "\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430" }),
          h("th", { text: "\u0422\u0440\u0435\u043D\u0435\u0440 / \u0437\u0430\u043B" }),
          h("th", { text: "\u0417\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u043E" }),
          h("th", { text: "" })
        )
      ),
      h(
        "tbody",
        {},
        ...daySessions.map((s) => this.sessionRow(s, bookings, now))
      )
    );
    return h(
      "section",
      { class: "day-group" },
      head,
      h("div", { class: "table-wrap" }, table)
    );
  }
  sessionRow(s, bookings, now) {
    const taken = seatsTaken(bookings, s.id);
    const pct = occupancyPct(s, bookings);
    const box = h("input", {
      attrs: { type: "checkbox", "aria-label": `\u0412\u044B\u0431\u0440\u0430\u0442\u044C ${s.title}` },
      checked: this.selection.has(s.id)
    });
    box.addEventListener("change", () => {
      if (box.checked) this.selection.add(s.id);
      else this.selection.delete(s.id);
      this.renderSection();
    });
    const actions = h(
      "span",
      { class: "row-actions" },
      iconButton("users", "\u0421\u043E\u0441\u0442\u0430\u0432 \u0433\u0440\u0443\u043F\u043F\u044B", () => this.openRoster(s)),
      iconButton("edit", "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C", () => this.openSessionForm(s)),
      iconButton(
        "trash",
        "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
        () => {
          void this.deleteSession(s);
        },
        { danger: true }
      )
    );
    return h(
      "tr",
      { class: isFinished(s, now) ? "past" : "" },
      h("td", {}, box),
      h(
        "td",
        {},
        h("strong", { text: fmtTime(s.startsAt) }),
        h("small", { class: "muted", text: ` ${s.durationMin} \u043C\u0438\u043D` })
      ),
      h(
        "td",
        {},
        h(
          "span",
          { class: "cell-title" },
          h("span", { text: s.title }),
          kindBadge(s.kind)
        )
      ),
      h("td", { class: "muted", text: `${s.trainer} \xB7 ${s.room}` }),
      h(
        "td",
        {},
        h(
          "span",
          { class: "occ-cell" },
          occupancyBar(pct),
          h("span", { text: `${taken}/${s.capacity}` })
        )
      ),
      h("td", {}, actions)
    );
  }
  openRoster(s) {
    const content = h("div", { class: "drawer-body" });
    const close = this.ctx.overlays.open(content, "drawer");
    const fill = () => {
      const bookings = this.ctx.state.allBookings().filter((b) => b.sessionId === s.id);
      const pct = occupancyPct(s, this.ctx.state.allBookings());
      const rows = bookings.map((b) => {
        const u = this.ctx.state.userById(b.userId);
        return h(
          "li",
          { class: "roster-row" },
          avatar(u?.name ?? "?"),
          h(
            "span",
            { class: "roster-name" },
            h("strong", { text: u?.name ?? "\u0423\u0434\u0430\u043B\u0451\u043D\u043D\u044B\u0439 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C" }),
            h("small", { class: "muted", text: u?.email ?? "" })
          ),
          iconButton(
            "trash",
            "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u043F\u0438\u0441\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430",
            () => {
              void this.cancelFor(b, fill);
            },
            { danger: true }
          )
        );
      });
      replace(
        content,
        h(
          "div",
          { class: "drawer-head" },
          kindBadge(s.kind),
          iconButton("x", "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", () => close())
        ),
        h("h2", { text: s.title }),
        h("p", {
          class: "muted",
          text: `${fmtFull(s.startsAt)} \xB7 ${s.trainer} \xB7 ${s.room}`
        }),
        h(
          "div",
          { class: "occ" },
          h("div", { class: "occ-bar" }, h("span", { style: `width:${pct}%` })),
          h("p", {
            class: "muted",
            text: `\u0417\u0430\u043F\u0438\u0441\u0430\u043D\u043E ${bookings.length} \u0438\u0437 ${s.capacity}`
          })
        ),
        h("h4", { text: `\u0421\u043E\u0441\u0442\u0430\u0432 \u0433\u0440\u0443\u043F\u043F\u044B (${bookings.length})` }),
        bookings.length === 0 ? h("p", { class: "muted", text: "\u041F\u043E\u043A\u0430 \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u0437\u0430\u043F\u0438\u0441\u0430\u043D." }) : h("ul", { class: "roster" }, ...rows)
      );
    };
    fill();
  }
  async cancelFor(b, refresh) {
    const u = this.ctx.state.userById(b.userId);
    const confirmed = await this.ctx.overlays.confirm({
      title: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u043F\u0438\u0441\u044C?",
      text: `\u0417\u0430\u043F\u0438\u0441\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430 ${u?.name ?? ""} \u0431\u0443\u0434\u0435\u0442 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430.`,
      okLabel: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u043F\u0438\u0441\u044C"
    });
    if (!confirmed) return;
    const r = await this.ctx.booking.cancel(b.id);
    if (!r.ok) {
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    this.ctx.toasts.show("\u0417\u0430\u043F\u0438\u0441\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430", "info");
    refresh();
  }
  async deleteSession(s) {
    const confirmed = await this.ctx.overlays.confirm({
      title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0443?",
      text: `\xAB${s.title}\xBB \u0438 \u0432\u0441\u0435 \u0435\u0451 \u0437\u0430\u043F\u0438\u0441\u0438 \u0431\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043B\u0435\u043D\u044B.`
    });
    if (!confirmed) return;
    const r = await this.ctx.catalog.remove(s.id);
    if (!r.ok) {
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    const token = r.value.undoToken;
    this.ctx.toasts.show(`\xAB${s.title}\xBB \u0443\u0434\u0430\u043B\u0435\u043D\u0430`, "info", {
      label: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C",
      run: () => {
        void this.restoreSession(token);
      }
    });
  }
  async deleteSelectedSessions() {
    const count = this.selection.size;
    const confirmed = await this.ctx.overlays.confirm({
      title: `\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0438 (${count})?`,
      text: "\u0412\u0441\u0435 \u0441\u0432\u044F\u0437\u0430\u043D\u043D\u044B\u0435 \u0437\u0430\u043F\u0438\u0441\u0438 \u0431\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043B\u0435\u043D\u044B."
    });
    if (!confirmed) return;
    const tokens = [];
    for (const id of [...this.selection]) {
      const r = await this.ctx.catalog.remove(id);
      if (r.ok) tokens.push(r.value.undoToken);
    }
    this.selection.clear();
    this.ctx.toasts.show(`\u0423\u0434\u0430\u043B\u0435\u043D\u043E: ${tokens.length}`, "info", {
      label: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C",
      run: () => {
        void this.restoreSessions(tokens);
      }
    });
  }
  async restoreSession(token) {
    const r = await this.ctx.catalog.restore(token);
    this.ctx.toasts.show(
      r.ok ? "\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430" : errorMessage(r.error),
      r.ok ? "ok" : "err"
    );
  }
  async restoreSessions(tokens) {
    for (const t of tokens) await this.ctx.catalog.restore(t);
    this.ctx.toasts.show("\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0438 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u044B", "ok");
  }
  openSessionForm(existing) {
    const now = /* @__PURE__ */ new Date();
    const title = textInput(
      {
        type: "text",
        required: true,
        maxlength: 60,
        placeholder: "\u0421\u0438\u043B\u043E\u0432\u0430\u044F \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430"
      },
      existing?.title ?? ""
    );
    const kind = selectInput(
      WORKOUT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
      existing?.kind ?? "strength"
    );
    const trainer = textInput(
      { type: "text", required: true, placeholder: "\u0424\u0430\u043C\u0438\u043B\u0438\u044F \u0418\u043C\u044F" },
      existing?.trainer ?? ""
    );
    const room = textInput(
      { type: "text", required: true },
      existing?.room ?? "\u0417\u0430\u043B 1"
    );
    const date = textInput(
      { type: "date", required: true },
      existing ? dayKey(existing.startsAt) : dayKey(addDays(now, 1))
    );
    const time = textInput(
      { type: "time", required: true },
      existing ? timeInputValue(existing.startsAt) : "18:00"
    );
    const duration = textInput(
      { type: "number", min: 15, max: 180, step: 5, required: true },
      String(existing?.durationMin ?? 60)
    );
    const capacity = textInput(
      { type: "number", min: 1, max: 100, required: true },
      String(existing?.capacity ?? 12)
    );
    const submit = async () => {
      const draft = {
        title: title.value,
        kind: WORKOUT_KINDS.find((k) => k === kind.value) ?? "strength",
        trainer: trainer.value,
        room: room.value,
        date: date.value,
        time: time.value,
        durationMin: Number(duration.value),
        capacity: Number(capacity.value)
      };
      const r = existing ? await this.ctx.catalog.update(existing.id, draft) : await this.ctx.catalog.create(draft);
      if (!r.ok) {
        this.ctx.toasts.show(errorMessage(r.error), "err");
        return;
      }
      close();
      this.ctx.toasts.show(
        existing ? "\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0430" : "\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0430",
        "ok"
      );
    };
    const form = h(
      "form",
      {
        class: "form-grid",
        on: {
          submit: (e) => {
            e.preventDefault();
            void submit();
          }
        }
      },
      field("\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435", title, true),
      field("\u0422\u0438\u043F", kind),
      field("\u0422\u0440\u0435\u043D\u0435\u0440", trainer),
      field("\u0417\u0430\u043B", room),
      field("\u0414\u0430\u0442\u0430", date),
      field("\u0412\u0440\u0435\u043C\u044F", time),
      field("\u0414\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C, \u043C\u0438\u043D", duration),
      field("\u0412\u043C\u0435\u0441\u0442\u0438\u043C\u043E\u0441\u0442\u044C", capacity),
      h(
        "div",
        { class: "modal-actions span2" },
        button({ label: "\u041E\u0442\u043C\u0435\u043D\u0430", tone: "ghost", onClick: () => close() }),
        button({ label: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C", type: "submit" })
      )
    );
    const close = this.ctx.overlays.open(
      h(
        "div",
        {},
        h("h3", {
          text: existing ? "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0443" : "\u041D\u043E\u0432\u0430\u044F \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430"
        }),
        form
      )
    );
  }
  // ---------- Клиенты ----------
  renderClients() {
    const resultsEl = h("div", {});
    const renderResults = () => {
      replace(resultsEl, this.clientsTable());
    };
    replace(
      this.sectionEl,
      pageHead("\u041A\u043B\u0438\u0435\u043D\u0442\u044B", "\u041F\u043E\u0438\u0441\u043A, \u0434\u043E\u0441\u044C\u0435 \u0438 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0440\u043E\u043B\u044F\u043C\u0438"),
      this.selection.size > 0 ? this.bulkBar(() => {
        void this.deleteSelectedUsers();
      }) : null,
      this.searchBox("\u0418\u043C\u044F \u0438\u043B\u0438 email\u2026", this.clientQuery, (v) => {
        this.clientQuery = v;
        renderResults();
      }),
      resultsEl
    );
    renderResults();
  }
  clientsTable() {
    const now = /* @__PURE__ */ new Date();
    const bookings = this.ctx.state.allBookings();
    const q = this.clientQuery.trim().toLowerCase();
    const users = this.ctx.state.allUsers().filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q));
    if (users.length === 0)
      return emptyState("\u041D\u0438\u043A\u043E\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E.", void 0, "users");
    const selfId = this.ctx.auth.currentUser()?.id;
    const rows = users.map((u) => {
      const mine = bookings.filter((b) => b.userId === u.id);
      const upcoming = mine.filter((b) => {
        const s = this.ctx.state.sessionById(b.sessionId);
        return s !== void 0 && !isFinished(s, now);
      }).length;
      const box = h("input", {
        attrs: { type: "checkbox", "aria-label": `\u0412\u044B\u0431\u0440\u0430\u0442\u044C ${u.name}` },
        checked: this.selection.has(u.id),
        disabled: u.id === selfId
      });
      box.addEventListener("click", (e) => e.stopPropagation());
      box.addEventListener("change", () => {
        if (box.checked) this.selection.add(u.id);
        else this.selection.delete(u.id);
        this.renderSection();
      });
      const actions = h(
        "span",
        { class: "row-actions" },
        iconButton("edit", "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C", (e) => {
          e.stopPropagation();
          this.openUserForm(u);
        }),
        iconButton(
          "trash",
          "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
          (e) => {
            e.stopPropagation();
            void this.deleteUser(u);
          },
          { danger: true, disabled: u.id === selfId }
        )
      );
      return {
        class: "clickable",
        onClick: () => this.openClient(u),
        cells: [
          box,
          h(
            "span",
            { class: "cell-user" },
            avatar(u.name),
            h("strong", { text: u.name })
          ),
          h("span", { class: "muted", text: u.email }),
          roleBadge(u.role),
          String(mine.length),
          String(upcoming),
          actions
        ]
      };
    });
    return dataTable(
      ["", "\u0418\u043C\u044F", "Email", "\u0420\u043E\u043B\u044C", "\u0417\u0430\u043F\u0438\u0441\u0435\u0439", "\u041F\u0440\u0435\u0434\u0441\u0442\u043E\u0438\u0442", ""],
      rows
    );
  }
  openClient(u) {
    const content = h("div", { class: "drawer-body" });
    const close = this.ctx.overlays.open(content, "drawer");
    const fill = () => {
      const now = /* @__PURE__ */ new Date();
      const mine = this.ctx.state.allBookings().filter((b) => b.userId === u.id).map((b) => ({ b, s: this.ctx.state.sessionById(b.sessionId) })).filter(
        (x) => x.s !== void 0
      ).sort((a, b) => b.s.startsAt.localeCompare(a.s.startsAt));
      const upcoming = mine.filter((x) => !isFinished(x.s, now));
      const rows = mine.map(
        ({ b, s }) => h(
          "li",
          { class: `roster-row${isFinished(s, now) ? " past" : ""}` },
          h(
            "span",
            { class: "roster-name" },
            h("strong", { text: s.title }),
            h("small", {
              class: "muted",
              text: `${fmtDate(s.startsAt)} ${fmtTime(s.startsAt)} \xB7 ${s.trainer}`
            })
          ),
          isFinished(s, now) ? h("span", { class: "status-chip done", text: "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430" }) : iconButton(
            "trash",
            "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u043F\u0438\u0441\u044C",
            () => {
              void this.cancelFor(b, fill);
            },
            { danger: true }
          )
        )
      );
      replace(
        content,
        h(
          "div",
          { class: "drawer-head" },
          roleBadge(u.role),
          iconButton("x", "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", () => close())
        ),
        h(
          "div",
          { class: "client-head" },
          avatar(u.name),
          h(
            "div",
            {},
            h("h2", { text: u.name }),
            h("p", { class: "muted", text: u.email })
          )
        ),
        h(
          "div",
          { class: "report-cards two" },
          statCard(mine.length, "\u0437\u0430\u043F\u0438\u0441\u0435\u0439 \u0432\u0441\u0435\u0433\u043E"),
          statCard(upcoming.length, "\u043F\u0440\u0435\u0434\u0441\u0442\u043E\u0438\u0442")
        ),
        h("h4", { text: "\u0417\u0430\u043F\u0438\u0441\u0438" }),
        mine.length === 0 ? h("p", { class: "muted", text: "\u0417\u0430\u043F\u0438\u0441\u0435\u0439 \u043D\u0435\u0442." }) : h("ul", { class: "roster" }, ...rows)
      );
    };
    fill();
  }
  async deleteUser(u) {
    const confirmed = await this.ctx.overlays.confirm({
      title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F?",
      text: `${u.name} \u0438 \u0432\u0441\u0435 \u0435\u0433\u043E \u0437\u0430\u043F\u0438\u0441\u0438 \u0431\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043B\u0435\u043D\u044B.`
    });
    if (!confirmed) return;
    const r = await this.ctx.accounts.remove(u.id);
    if (!r.ok) {
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    const token = r.value.undoToken;
    this.ctx.toasts.show(`${u.name} \u0443\u0434\u0430\u043B\u0451\u043D`, "info", {
      label: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C",
      run: () => {
        void this.restoreUser(token);
      }
    });
  }
  async deleteSelectedUsers() {
    const count = this.selection.size;
    const confirmed = await this.ctx.overlays.confirm({
      title: `\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439 (${count})?`,
      text: "\u0412\u0441\u0435 \u0438\u0445 \u0437\u0430\u043F\u0438\u0441\u0438 \u0431\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043B\u0435\u043D\u044B."
    });
    if (!confirmed) return;
    const tokens = [];
    for (const id of [...this.selection]) {
      const r = await this.ctx.accounts.remove(id);
      if (r.ok) tokens.push(r.value.undoToken);
    }
    this.selection.clear();
    this.ctx.toasts.show(`\u0423\u0434\u0430\u043B\u0435\u043D\u043E: ${tokens.length}`, "info", {
      label: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C",
      run: () => {
        void this.restoreUsers(tokens);
      }
    });
  }
  async restoreUser(token) {
    const r = await this.ctx.accounts.restore(token);
    this.ctx.toasts.show(
      r.ok ? "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D" : errorMessage(r.error),
      r.ok ? "ok" : "err"
    );
  }
  async restoreUsers(tokens) {
    for (const t of tokens) await this.ctx.accounts.restore(t);
    this.ctx.toasts.show("\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u044B", "ok");
  }
  openUserForm(u) {
    const name = textInput(
      { type: "text", required: true, minlength: 2 },
      u.name
    );
    const email = textInput({ type: "email", required: true }, u.email);
    const role = selectInput(
      [
        { value: "client", label: "\u041A\u043B\u0438\u0435\u043D\u0442" },
        { value: "admin", label: "\u0410\u0434\u043C\u0438\u043D" }
      ],
      u.role
    );
    const submit = async () => {
      const r = await this.ctx.accounts.update(u.id, {
        name: name.value,
        email: email.value,
        role: role.value === "admin" ? "admin" : "client"
      });
      if (!r.ok) {
        this.ctx.toasts.show(errorMessage(r.error), "err");
        return;
      }
      close();
      this.ctx.toasts.show("\u0414\u0430\u043D\u043D\u044B\u0435 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u044B", "ok");
    };
    const form = h(
      "form",
      {
        class: "form-grid",
        on: {
          submit: (e) => {
            e.preventDefault();
            void submit();
          }
        }
      },
      field("\u0418\u043C\u044F", name, true),
      field("Email", email, true),
      field("\u0420\u043E\u043B\u044C", role, true),
      h(
        "div",
        { class: "modal-actions span2" },
        button({ label: "\u041E\u0442\u043C\u0435\u043D\u0430", tone: "ghost", onClick: () => close() }),
        button({ label: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C", type: "submit" })
      )
    );
    const close = this.ctx.overlays.open(
      h("div", {}, h("h3", { text: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C" }), form)
    );
  }
  // ---------- Отчёты ----------
  renderReports() {
    const now = /* @__PURE__ */ new Date();
    const report = buildReport(
      this.ctx.state.allSessions(),
      this.ctx.state.allBookings(),
      this.ctx.state.allUsers()
    );
    const byKind = WORKOUT_KINDS.map((kind) => {
      const ids = new Set(
        report.rows.filter((r) => r.session.kind === kind).map((r) => r.session.id)
      );
      return {
        kind,
        count: this.ctx.state.allBookings().filter((b) => ids.has(b.sessionId)).length
      };
    });
    const maxKind = Math.max(1, ...byKind.map((x) => x.count));
    const kindRows = byKind.map(
      (x) => h(
        "div",
        { class: "chart-row" },
        h("span", { class: "chart-label", text: KIND_LABEL[x.kind] }),
        h(
          "span",
          { class: "chart-bar" },
          h("span", {
            class: `k-${x.kind}`,
            style: `width:${Math.round(x.count / maxKind * 100)}%`
          })
        ),
        h("span", { class: "chart-value", text: String(x.count) })
      )
    );
    const table = dataTable(
      ["\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430", "\u0414\u0430\u0442\u0430", "\u0417\u0430\u043F\u0438\u0441\u0430\u043D\u043E", "\u0417\u0430\u043F\u043E\u043B\u043D\u044F\u0435\u043C\u043E\u0441\u0442\u044C"],
      report.rows.map((r) => ({
        class: isFinished(r.session, now) ? "past" : "",
        cells: [
          h(
            "span",
            { class: "cell-title" },
            h("span", { text: r.session.title }),
            kindBadge(r.session.kind)
          ),
          `${fmtDate(r.session.startsAt)} ${fmtTime(r.session.startsAt)}`,
          `${r.booked}/${r.session.capacity}`,
          h(
            "span",
            { class: "occ-cell" },
            occupancyBar(r.occupancy),
            h("span", { text: `${r.occupancy}%` })
          )
        ]
      }))
    );
    replace(
      this.sectionEl,
      pageHead(
        "\u041E\u0442\u0447\u0451\u0442\u044B",
        "\u0424\u043E\u0440\u043C\u0438\u0440\u0443\u044E\u0442\u0441\u044F \u043C\u0433\u043D\u043E\u0432\u0435\u043D\u043D\u043E \u0438\u0437 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0445 \u0434\u0430\u043D\u043D\u044B\u0445",
        button({
          label: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C CSV",
          tone: "ghost",
          icon: "download",
          onClick: () => this.exportCsv(report.rows)
        })
      ),
      h(
        "div",
        { class: "report-cards" },
        statCard(report.totalSessions, "\u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043E\u043A"),
        statCard(report.totalBookings, "\u0437\u0430\u043F\u0438\u0441\u0435\u0439"),
        statCard(report.activeClients, "\u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432"),
        statCard(`${report.occupancy}%`, "\u0437\u0430\u043F\u043E\u043B\u043D\u044F\u0435\u043C\u043E\u0441\u0442\u044C")
      ),
      h(
        "div",
        { class: "panel-card" },
        h("h3", { text: "\u0417\u0430\u043F\u0438\u0441\u0438 \u043F\u043E \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F\u043C" }),
        h("div", { class: "chart" }, ...kindRows)
      ),
      table
    );
  }
  exportCsv(rows) {
    const data = [
      [
        "\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430",
        "\u0422\u0438\u043F",
        "\u0414\u0430\u0442\u0430",
        "\u0412\u0440\u0435\u043C\u044F",
        "\u0422\u0440\u0435\u043D\u0435\u0440",
        "\u0417\u0430\u043B",
        "\u0417\u0430\u043F\u0438\u0441\u0430\u043D\u043E",
        "\u0412\u043C\u0435\u0441\u0442\u0438\u043C\u043E\u0441\u0442\u044C",
        "\u0417\u0430\u043F\u043E\u043B\u043D\u044F\u0435\u043C\u043E\u0441\u0442\u044C %"
      ],
      ...rows.map((r) => [
        r.session.title,
        KIND_LABEL[r.session.kind],
        fmtDate(r.session.startsAt),
        fmtTime(r.session.startsAt),
        r.session.trainer,
        r.session.room,
        r.booked,
        r.session.capacity,
        r.occupancy
      ])
    ];
    downloadText(`atlet-report-${dayKey(/* @__PURE__ */ new Date())}.csv`, toCsv(data));
    this.ctx.toasts.show("\u041E\u0442\u0447\u0451\u0442 \u0432\u044B\u0433\u0440\u0443\u0436\u0435\u043D \u0432 CSV", "ok");
  }
};

// src/views/auth-view.ts
var requestedTab = null;
function requestAuthTab(tab) {
  requestedTab = tab;
}
var AuthView = class extends BaseView {
  constructor(ctx) {
    super(ctx);
    this.tab = "login";
    this.busy = false;
  }
  init() {
    if (requestedTab) {
      this.tab = requestedTab;
      requestedTab = null;
    }
  }
  render() {
    replace(
      this.root,
      h("div", { class: "auth-wrap" }, this.art(), this.card())
    );
  }
  art() {
    return h(
      "section",
      { class: "auth-art" },
      remoteImg(
        AUTH_PHOTO,
        "\u0417\u0430\u043B \u0410\u0422\u041B\u0415\u0422",
        "auth-photo",
        () => h("div", { class: "auth-photo-fallback" })
      ),
      h("span", { class: "logo-mark" }, icon("dumbbell", 22)),
      h("h1", { class: "auth-slogan", text: "\u0422\u0440\u0435\u043D\u0438\u0440\u0443\u0439\u0441\u044F \u043F\u043E \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044E." }),
      h("p", {
        class: "auth-art-note",
        text: "\u041F\u044F\u0442\u044C \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0439, \u0434\u0432\u0430 \u0437\u0430\u043B\u0430 \u0438 \u0442\u0440\u0435\u043D\u0435\u0440\u044B, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0434\u043E\u0432\u043E\u0434\u044F\u0442 \u0434\u043E \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u0430."
      }),
      h(
        "ul",
        { class: "auth-points" },
        h("li", {}, icon("check", 16), "\u041F\u0435\u0440\u0432\u0430\u044F \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u2014 \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E"),
        h("li", {}, icon("check", 16), "\u041E\u0442\u043C\u0435\u043D\u0430 \u0438 \u0432\u043E\u0437\u0432\u0440\u0430\u0442 \u2014 \u0432 \u043E\u0434\u043D\u043E \u043A\u0430\u0441\u0430\u043D\u0438\u0435"),
        h("li", {}, icon("check", 16), "\u0420\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0441 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430 \u0438 \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440\u0430")
      )
    );
  }
  themeButton() {
    const btn = iconButton(
      currentTheme() === "dark" ? "sun" : "moon",
      "\u0421\u043C\u0435\u043D\u0438\u0442\u044C \u0442\u0435\u043C\u0443",
      () => {
        const next = toggleTheme();
        replace(btn, icon(next === "dark" ? "sun" : "moon", 18));
      }
    );
    return btn;
  }
  card() {
    return h(
      "section",
      { class: "auth-card" },
      h(
        "div",
        { class: "auth-top" },
        h(
          "button",
          {
            class: "auth-back",
            attrs: { type: "button" },
            on: { click: () => this.ctx.navigate("home") }
          },
          icon("arrow-left", 16),
          "\u041D\u0430 \u0433\u043B\u0430\u0432\u043D\u0443\u044E"
        ),
        this.themeButton()
      ),
      h(
        "div",
        { class: "auth-head" },
        h("h2", { text: this.tab === "login" ? "\u0412\u0445\u043E\u0434" : "\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044F" }),
        h("p", {
          class: "muted",
          text: this.tab === "login" ? "\u0421 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0435\u043D\u0438\u0435\u043C. \u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0438." : "\u0410\u043A\u043A\u0430\u0443\u043D\u0442 \u0437\u0430 20 \u0441\u0435\u043A\u0443\u043D\u0434 \u2014 \u0431\u0435\u0437 \u0430\u043D\u043A\u0435\u0442\u044B \u0438 \u0437\u0432\u043E\u043D\u043A\u043E\u0432."
        })
      ),
      h(
        "div",
        { class: "auth-tabs", attrs: { role: "tablist" } },
        this.tabButton("login", "\u0412\u0445\u043E\u0434"),
        this.tabButton("register", "\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044F")
      ),
      this.tab === "login" ? this.loginForm() : this.registerForm(),
      h("div", { class: "auth-divider" }, "\u0434\u0435\u043C\u043E-\u0434\u043E\u0441\u0442\u0443\u043F"),
      h(
        "div",
        { class: "auth-demo" },
        button({
          label: "\u041A\u043B\u0438\u0435\u043D\u0442",
          tone: "ghost",
          small: true,
          onClick: () => {
            void this.submit("client@atlet.kz", "client123");
          }
        }),
        button({
          label: "\u0410\u0434\u043C\u0438\u043D",
          tone: "ghost",
          small: true,
          onClick: () => {
            void this.submit("admin@atlet.kz", "admin123");
          }
        })
      ),
      h("p", {
        class: "auth-hint",
        text: "admin@atlet.kz / admin123 \xB7 client@atlet.kz / client123"
      })
    );
  }
  tabButton(tab, label) {
    return h("button", {
      class: `auth-tab${this.tab === tab ? " active" : ""}`,
      attrs: {
        type: "button",
        role: "tab",
        "aria-selected": String(this.tab === tab)
      },
      text: label,
      on: {
        click: () => {
          this.tab = tab;
          this.render();
        }
      }
    });
  }
  iconField(label, iconName, input) {
    return h(
      "label",
      { class: "auth-field" },
      h("span", { text: label }),
      h("div", { class: "auth-input-wrap" }, icon(iconName, 18), input)
    );
  }
  loginForm() {
    const email = textInput({
      type: "email",
      required: true,
      autocomplete: "email",
      placeholder: "you@mail.kz"
    });
    const password = textInput({
      type: "password",
      required: true,
      autocomplete: "current-password",
      placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
    });
    const submit = button({ label: "\u0412\u043E\u0439\u0442\u0438", type: "submit", wide: true });
    return h(
      "form",
      {
        class: "auth-form",
        on: {
          submit: (e) => {
            e.preventDefault();
            void this.submit(email.value, password.value, submit);
          }
        }
      },
      this.iconField("Email", "mail", email),
      this.iconField("\u041F\u0430\u0440\u043E\u043B\u044C", "lock", password),
      h("div", { class: "auth-submit" }, submit)
    );
  }
  registerForm() {
    const name = textInput({
      type: "text",
      required: true,
      minlength: 2,
      autocomplete: "name",
      placeholder: "\u0410\u043B\u0438\u044F \u0421\u0435\u0440\u0438\u043A\u043E\u0432\u0430"
    });
    const email = textInput({
      type: "email",
      required: true,
      autocomplete: "email",
      placeholder: "you@mail.kz"
    });
    const password = textInput({
      type: "password",
      required: true,
      minlength: 6,
      autocomplete: "new-password",
      placeholder: "\u041C\u0438\u043D\u0438\u043C\u0443\u043C 6 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432"
    });
    const submit = button({
      label: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0430\u043A\u043A\u0430\u0443\u043D\u0442",
      type: "submit",
      wide: true
    });
    return h(
      "form",
      {
        class: "auth-form",
        on: {
          submit: (e) => {
            e.preventDefault();
            void this.register(name.value, email.value, password.value, submit);
          }
        }
      },
      this.iconField("\u0418\u043C\u044F \u0438 \u0444\u0430\u043C\u0438\u043B\u0438\u044F", "user", name),
      this.iconField("Email", "mail", email),
      this.iconField("\u041F\u0430\u0440\u043E\u043B\u044C", "lock", password),
      h("div", { class: "auth-submit" }, submit)
    );
  }
  async submit(email, password, btn) {
    if (this.busy) return;
    this.busy = true;
    if (btn) btn.disabled = true;
    const r = await this.ctx.auth.login(email, password);
    this.busy = false;
    if (!r.ok) {
      if (btn) btn.disabled = false;
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    this.ctx.toasts.show(
      `\u0421 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0435\u043D\u0438\u0435\u043C, ${r.value.name.split(" ")[0]}!`,
      "ok"
    );
    this.ctx.navigate(r.value.role === "admin" ? "admin" : "schedule");
  }
  async register(name, email, password, btn) {
    if (this.busy) return;
    this.busy = true;
    btn.disabled = true;
    const r = await this.ctx.auth.register(name, email, password);
    this.busy = false;
    if (!r.ok) {
      btn.disabled = false;
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    this.ctx.toasts.show("\u0410\u043A\u043A\u0430\u0443\u043D\u0442 \u0441\u043E\u0437\u0434\u0430\u043D. \u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C!", "ok");
    this.ctx.navigate("schedule");
  }
};

// src/views/bookings-view.ts
var BookingsView = class extends BaseView {
  constructor(ctx) {
    super(ctx);
  }
  init() {
    this.watch("bookings", () => this.render());
    this.watch("sessions", () => this.render());
  }
  render() {
    const now = /* @__PURE__ */ new Date();
    const items = this.ctx.booking.ofCurrentUser().map((booking) => ({
      booking,
      session: this.ctx.state.sessionById(booking.sessionId)
    })).filter((x) => x.session !== void 0);
    const upcoming = items.filter((x) => !isFinished(x.session, now)).sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt));
    const history2 = items.filter((x) => isFinished(x.session, now)).sort((a, b) => b.session.startsAt.localeCompare(a.session.startsAt));
    replace(
      this.root,
      pageHead(
        "\u041C\u043E\u0438 \u0437\u0430\u043F\u0438\u0441\u0438",
        "\u041E\u0442\u043C\u0435\u043D\u0430 \u2014 \u0432 \u043E\u0434\u043D\u043E \u043A\u0430\u0441\u0430\u043D\u0438\u0435, \u0432\u0435\u0440\u043D\u0443\u0442\u044C \u043C\u043E\u0436\u043D\u043E \u0441\u0440\u0430\u0437\u0443 \u0438\u0437 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F."
      ),
      items.length === 0 ? emptyState(
        "\u0423 \u0432\u0430\u0441 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0437\u0430\u043F\u0438\u0441\u0435\u0439.",
        button({
          label: "\u041A \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044E",
          onClick: () => this.ctx.navigate("schedule")
        }),
        "ticket"
      ) : h(
        "div",
        {},
        h(
          "h2",
          { class: "section-title" },
          "\u041F\u0440\u0435\u0434\u0441\u0442\u043E\u044F\u0449\u0438\u0435 ",
          h("em", { class: "count-pill", text: String(upcoming.length) })
        ),
        h(
          "div",
          { class: "session-list" },
          upcoming.length > 0 ? upcoming.map((x, i) => this.card(x, i, false)) : h("p", { class: "muted", text: "\u041D\u0435\u0442 \u043F\u0440\u0435\u0434\u0441\u0442\u043E\u044F\u0449\u0438\u0445 \u0437\u0430\u043F\u0438\u0441\u0435\u0439." })
        ),
        history2.length > 0 ? h(
          "div",
          {},
          h(
            "h2",
            { class: "section-title" },
            "\u0418\u0441\u0442\u043E\u0440\u0438\u044F ",
            h("em", {
              class: "count-pill",
              text: String(history2.length)
            })
          ),
          h(
            "div",
            { class: "session-list" },
            ...history2.map((x, i) => this.card(x, i, true))
          )
        ) : null
      )
    );
  }
  card(item, index, past) {
    const { booking, session } = item;
    const now = /* @__PURE__ */ new Date();
    const cover = h(
      "div",
      { class: "card-cover" },
      coverImg(session.kind),
      h("span", { class: "cover-time", text: fmtTime(session.startsAt) })
    );
    const info = h(
      "div",
      { class: "session-info" },
      h(
        "div",
        { class: "session-top" },
        h("h3", { text: session.title }),
        kindBadge(session.kind),
        intensityChip(session.kind)
      ),
      h(
        "p",
        { class: "muted session-meta" },
        icon("calendar", 16),
        h("span", {
          text: `${fmtDate(session.startsAt)}, ${relativeDay(session.startsAt, now)} \xB7 ${session.trainer} \xB7 ${session.room}`
        })
      )
    );
    const side = h(
      "div",
      { class: "session-side" },
      past ? h("span", { class: "status-chip done", text: "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430" }) : h(
        "div",
        { class: "side-stack" },
        h("span", { class: "status-chip upcoming", text: "\u041F\u0440\u0435\u0434\u0441\u0442\u043E\u0438\u0442" }),
        button({
          label: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C",
          tone: "danger-ghost",
          small: true,
          onClick: () => {
            void this.cancel(booking);
          }
        })
      )
    );
    return h(
      "article",
      {
        class: `booking-card${past ? " past" : ""}`,
        style: `animation-delay:${Math.min(index * 40, 240)}ms`
      },
      cover,
      info,
      side
    );
  }
  async cancel(booking) {
    const r = await this.ctx.booking.cancel(booking.id);
    if (!r.ok) {
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    this.ctx.toasts.show("\u0417\u0430\u043F\u0438\u0441\u044C \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430", "info", {
      label: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C",
      run: () => {
        void this.restore(booking);
      }
    });
  }
  async restore(booking) {
    const r = await this.ctx.booking.book(booking.sessionId);
    this.ctx.toasts.show(
      r.ok ? "\u0417\u0430\u043F\u0438\u0441\u044C \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430" : errorMessage(r.error),
      r.ok ? "ok" : "err"
    );
  }
};

// src/app/content.ts
var PLANS = [
  {
    id: "single",
    name: "\u0420\u0430\u0437\u043E\u0432\u0430\u044F",
    price: 2500,
    period: "\u0437\u0430 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0443",
    tagline: "\u041F\u043E\u043F\u0440\u043E\u0431\u043E\u0432\u0430\u0442\u044C \u0431\u0435\u0437 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u0441\u0442\u0432",
    features: [
      "\u041B\u044E\u0431\u0430\u044F \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u0438\u0437 \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F",
      "\u041E\u0442\u043C\u0435\u043D\u0430 \u0431\u0435\u0437 \u0448\u0442\u0440\u0430\u0444\u0430 \u0437\u0430 2 \u0447\u0430\u0441\u0430",
      "\u041F\u043E\u043B\u043E\u0442\u0435\u043D\u0446\u0435 \u0438 \u0432\u043E\u0434\u0430 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u044B"
    ]
  },
  {
    id: "month",
    name: "\u0411\u0435\u0437\u043B\u0438\u043C\u0438\u0442",
    price: 19900,
    period: "\u0432 \u043C\u0435\u0441\u044F\u0446",
    tagline: "\u0422\u0440\u0435\u043D\u0438\u0440\u0443\u0439\u0441\u044F \u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0445\u043E\u0447\u0435\u0448\u044C",
    popular: true,
    badge: "\u0412\u044B\u0431\u043E\u0440 \u043A\u043B\u0438\u0435\u043D\u0442\u043E\u0432",
    features: [
      "\u0412\u0441\u0435 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0431\u0435\u0437 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0439",
      "\u0417\u0430\u043C\u043E\u0440\u043E\u0437\u043A\u0430 \u0434\u043E 7 \u0434\u043D\u0435\u0439",
      "\u041F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442\u043D\u0430\u044F \u0437\u0430\u043F\u0438\u0441\u044C \u043D\u0430 \u0432\u0435\u0447\u0435\u0440",
      "\u0413\u043E\u0441\u0442\u0435\u0432\u043E\u0439 \u0432\u0438\u0437\u0438\u0442 \u0434\u043B\u044F \u0434\u0440\u0443\u0433\u0430"
    ]
  },
  {
    id: "year",
    name: "\u0413\u043E\u0434",
    price: 149900,
    period: "\u0432 \u0433\u043E\u0434",
    tagline: "\u041C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0432\u044B\u0433\u043E\u0434\u0430",
    badge: "\u0412\u044B\u0433\u043E\u0434\u0430 37%",
    features: [
      "\u0412\u0441\u0451 \u0438\u0437 \xAB\u0411\u0435\u0437\u043B\u0438\u043C\u0438\u0442\u0430\xBB",
      "2 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0438",
      "\u0417\u0430\u043C\u043E\u0440\u043E\u0437\u043A\u0430 \u0434\u043E 30 \u0434\u043D\u0435\u0439",
      "\u0426\u0435\u043D\u0430 \u0437\u0430\u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u0430 \u043D\u0430 \u0433\u043E\u0434"
    ]
  }
];
var formatPrice = (value) => `${value.toLocaleString("ru-RU")} \u20B8`;
var portrait = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=400&q=70`;
var TRAINERS = [
  {
    name: "\u0414\u043C\u0438\u0442\u0440\u0438\u0439 \u041A\u0438\u043C",
    kind: "strength",
    role: "\u0421\u0438\u043B\u043E\u0432\u043E\u0439 \u0442\u0440\u0435\u043D\u0438\u043D\u0433",
    experience: "8 \u043B\u0435\u0442 \u043E\u043F\u044B\u0442\u0430",
    quote: "\u0422\u0435\u0445\u043D\u0438\u043A\u0430 \u043F\u0440\u0435\u0436\u0434\u0435 \u0432\u0441\u0435\u0433\u043E. \u0421\u0438\u043B\u0430 \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442 \u0441\u043B\u0435\u0434\u043E\u043C.",
    photo: portrait("photo-1507003211169-0a1dd7228f2d")
  },
  {
    name: "\u041C\u0430\u0440\u0430\u0442 \u0410\u0431\u0434\u0440\u0430\u0445\u043C\u0430\u043D\u043E\u0432",
    kind: "cardio",
    role: "\u041A\u0430\u0440\u0434\u0438\u043E \u0438 \u0432\u044B\u043D\u043E\u0441\u043B\u0438\u0432\u043E\u0441\u0442\u044C",
    experience: "6 \u043B\u0435\u0442 \u043E\u043F\u044B\u0442\u0430",
    quote: "\u041F\u0443\u043B\u044C\u0441 \u2014 \u0442\u0432\u043E\u0439 \u0447\u0435\u0441\u0442\u043D\u044B\u0439 \u0442\u0440\u0435\u043D\u0435\u0440. \u0421\u043B\u0443\u0448\u0430\u0439 \u0435\u0433\u043E.",
    photo: portrait("photo-1500648767791-00dcc994a43e")
  },
  {
    name: "\u0410\u0439\u0433\u0435\u0440\u0438\u043C \u0421\u0430\u043F\u0430\u0440\u043E\u0432\u0430",
    kind: "yoga",
    role: "\u0419\u043E\u0433\u0430 \u0438 \u043E\u0441\u0430\u043D\u043A\u0430",
    experience: "7 \u043B\u0435\u0442 \u043E\u043F\u044B\u0442\u0430",
    quote: "\u0413\u0438\u0431\u043A\u043E\u0441\u0442\u044C \u2014 \u044D\u0442\u043E \u0441\u0432\u043E\u0431\u043E\u0434\u0430 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F \u0432 \u043B\u044E\u0431\u043E\u043C \u0432\u043E\u0437\u0440\u0430\u0441\u0442\u0435.",
    photo: portrait("photo-1544005313-94ddf0286df2")
  },
  {
    name: "\u0421\u0435\u0440\u0433\u0435\u0439 \u041B\u0438",
    kind: "crossfit",
    role: "\u041A\u0440\u043E\u0441\u0441\u0444\u0438\u0442 \u0438 \u0444\u0443\u043D\u043A\u0446\u0438\u043E\u043D\u0430\u043B\u043A\u0430",
    experience: "5 \u043B\u0435\u0442 \u043E\u043F\u044B\u0442\u0430",
    quote: "\u041A\u0430\u0436\u0434\u044B\u0439 \u0440\u0430\u0443\u043D\u0434 \u2014 \u043C\u0430\u043B\u0435\u043D\u044C\u043A\u0430\u044F \u043F\u043E\u0431\u0435\u0434\u0430 \u043D\u0430\u0434 \u0441\u043E\u0431\u043E\u0439.",
    photo: portrait("photo-1506794778202-cad84cf45f1d")
  },
  {
    name: "\u0410\u043B\u0438\u043D\u0430 \u041A\u0438\u043C",
    kind: "stretch",
    role: "\u0421\u0442\u0440\u0435\u0442\u0447\u0438\u043D\u0433 \u0438 \u043C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u0441\u0442\u044C",
    experience: "4 \u0433\u043E\u0434\u0430 \u043E\u043F\u044B\u0442\u0430",
    quote: "\u0422\u0435\u043B\u043E \u0441\u043A\u0430\u0436\u0435\u0442 \u0441\u043F\u0430\u0441\u0438\u0431\u043E \u0443\u0436\u0435 \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u0437\u0430\u043D\u044F\u0442\u0438\u044F.",
    photo: portrait("photo-1573496359142-b8d87734a5a2")
  }
];
var DIRECTIONS = [
  {
    kind: "strength",
    title: "\u0421\u0438\u043B\u043E\u0432\u0430\u044F",
    description: "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0435 \u0432\u0435\u0441\u0430 \u0438 \u0442\u0440\u0435\u043D\u0430\u0436\u0451\u0440\u044B. \u041C\u044B\u0448\u0446\u044B, \u0441\u0438\u043B\u0430 \u0438 \u0443\u0432\u0435\u0440\u0435\u043D\u043D\u0430\u044F \u0442\u0435\u0445\u043D\u0438\u043A\u0430 \u043F\u043E\u0434 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u0435\u043C \u0442\u0440\u0435\u043D\u0435\u0440\u0430.",
    duration: "60 \u043C\u0438\u043D"
  },
  {
    kind: "cardio",
    title: "\u041A\u0430\u0440\u0434\u0438\u043E",
    description: "\u0418\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u044B, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0440\u0430\u0437\u0433\u043E\u043D\u044F\u044E\u0442 \u043F\u0443\u043B\u044C\u0441 \u0438 \u0441\u0436\u0438\u0433\u0430\u044E\u0442 \u043A\u0430\u043B\u043E\u0440\u0438\u0438. \u0411\u044B\u0441\u0442\u0440\u043E, \u0432\u0435\u0441\u0435\u043B\u043E, \u044D\u0444\u0444\u0435\u043A\u0442\u0438\u0432\u043D\u043E.",
    duration: "45 \u043C\u0438\u043D"
  },
  {
    kind: "yoga",
    title: "\u0419\u043E\u0433\u0430",
    description: "\u0414\u044B\u0445\u0430\u043D\u0438\u0435, \u0431\u0430\u043B\u0430\u043D\u0441 \u0438 \u0441\u043F\u043E\u043A\u043E\u0439\u043D\u0430\u044F \u0441\u0438\u043B\u0430. \u041F\u043E\u0434\u0445\u043E\u0434\u0438\u0442 \u043D\u043E\u0432\u0438\u0447\u043A\u0430\u043C \u0438 \u0442\u0435\u043C, \u043A\u043E\u043C\u0443 \u0437\u0430 60.",
    duration: "75 \u043C\u0438\u043D"
  },
  {
    kind: "crossfit",
    title: "\u041A\u0440\u043E\u0441\u0441\u0444\u0438\u0442",
    description: "\u0424\u0443\u043D\u043A\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0441\u044B \u0432 \u043A\u043E\u043C\u0430\u043D\u0434\u0435. \u0425\u0430\u0440\u0430\u043A\u0442\u0435\u0440 \u0437\u0430\u043A\u0430\u043B\u044F\u0435\u0442\u0441\u044F \u0437\u0434\u0435\u0441\u044C.",
    duration: "50 \u043C\u0438\u043D"
  },
  {
    kind: "stretch",
    title: "\u0421\u0442\u0440\u0435\u0442\u0447\u0438\u043D\u0433",
    description: "\u0420\u0430\u0441\u0442\u044F\u0436\u043A\u0430 \u0438 \u043C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u0441\u0442\u044C \u0441\u0443\u0441\u0442\u0430\u0432\u043E\u0432. \u041B\u0451\u0433\u043A\u043E\u0441\u0442\u044C \u0432 \u0442\u0435\u043B\u0435 \u0431\u0435\u0437 \u0443\u0434\u0430\u0440\u043D\u044B\u0445 \u043D\u0430\u0433\u0440\u0443\u0437\u043E\u043A.",
    duration: "60 \u043C\u0438\u043D"
  }
];
var REVIEWS = [
  {
    name: "\u0410\u0440\u0443\u0436\u0430\u043D \u0411\u0435\u043A\u043E\u0432\u0430",
    stars: 5,
    text: "\u0417\u0430\u043F\u0438\u0441\u0430\u043B\u0430\u0441\u044C \u043D\u0430 \u0439\u043E\u0433\u0443 \u0447\u0435\u0440\u0435\u0437 \u0442\u0435\u043B\u0435\u0444\u043E\u043D \u0437\u0430 \u043C\u0438\u043D\u0443\u0442\u0443. \u0427\u0435\u0440\u0435\u0437 \u043C\u0435\u0441\u044F\u0446 \u0441\u043F\u0438\u043D\u0430 \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u043B\u0430 \u0431\u043E\u043B\u0435\u0442\u044C \u2014 \u0442\u0435\u043F\u0435\u0440\u044C \u0445\u043E\u0436\u0443 \u0442\u0440\u0438 \u0440\u0430\u0437\u0430 \u0432 \u043D\u0435\u0434\u0435\u043B\u044E."
  },
  {
    name: "\u041D\u0438\u043A\u0438\u0442\u0430 \u0412\u043E\u043B\u043A\u043E\u0432",
    stars: 5,
    text: "\u041A\u0440\u043E\u0441\u0441\u0444\u0438\u0442 \u0443 \u0421\u0435\u0440\u0433\u0435\u044F \u2014 \u043B\u0443\u0447\u0448\u0435\u0435, \u0447\u0442\u043E \u0441\u043B\u0443\u0447\u0430\u043B\u043E\u0441\u044C \u0441 \u043C\u043E\u0435\u0439 \u0444\u043E\u0440\u043C\u043E\u0439. \u041C\u0438\u043D\u0443\u0441 8 \u043A\u0433 \u0437\u0430 \u0442\u0440\u0438 \u043C\u0435\u0441\u044F\u0446\u0430, \u0438 \u044D\u0442\u043E \u0431\u0435\u0437 \u0434\u0438\u0435\u0442."
  },
  {
    name: "\u0415\u043B\u0435\u043D\u0430 \u0426\u043E\u0439",
    stars: 5,
    text: "\u041C\u043D\u0435 58, \u0431\u043E\u044F\u043B\u0430\u0441\u044C, \u0447\u0442\u043E \u0431\u0443\u0434\u0435\u0442 \u043F\u043E\u0437\u0434\u043D\u043E. \u0421\u0442\u0440\u0435\u0442\u0447\u0438\u043D\u0433 \u0441 \u0410\u043B\u0438\u043D\u043E\u0439 \u2014 \u0431\u0435\u0440\u0435\u0436\u043D\u043E \u0438 \u0432\u043D\u0438\u043C\u0430\u0442\u0435\u043B\u044C\u043D\u043E. \u0427\u0443\u0432\u0441\u0442\u0432\u0443\u044E \u0441\u0435\u0431\u044F \u043D\u0430 20 \u043B\u0435\u0442 \u043C\u043E\u043B\u043E\u0436\u0435."
  }
];
var FAQ = [
  {
    q: "\u041D\u0443\u0436\u043D\u0430 \u043B\u0438 \u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0430 \u0434\u043B\u044F \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u0437\u0430\u043D\u044F\u0442\u0438\u044F?",
    a: "\u041D\u0435\u0442. \u0422\u0440\u0435\u043D\u0435\u0440 \u043F\u043E\u0434\u0431\u0435\u0440\u0451\u0442 \u043D\u0430\u0433\u0440\u0443\u0437\u043A\u0443 \u043F\u043E\u0434 \u0442\u0432\u043E\u0439 \u0443\u0440\u043E\u0432\u0435\u043D\u044C. \u0419\u043E\u0433\u0430 \u0438 \u0441\u0442\u0440\u0435\u0442\u0447\u0438\u043D\u0433 \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0442 \u0434\u0430\u0436\u0435 \u0431\u0435\u0437 \u043E\u043F\u044B\u0442\u0430."
  },
  {
    q: "\u0427\u0442\u043E \u0432\u0437\u044F\u0442\u044C \u0441 \u0441\u043E\u0431\u043E\u0439?",
    a: "\u0421\u043F\u043E\u0440\u0442\u0438\u0432\u043D\u0443\u044E \u0444\u043E\u0440\u043C\u0443, \u0441\u043C\u0435\u043D\u043D\u0443\u044E \u043E\u0431\u0443\u0432\u044C \u0438 \u0431\u0443\u0442\u044B\u043B\u043A\u0443 \u0432\u043E\u0434\u044B. \u041F\u043E\u043B\u043E\u0442\u0435\u043D\u0446\u0435, \u043A\u043E\u0432\u0440\u0438\u043A\u0438 \u0438 \u0438\u043D\u0432\u0435\u043D\u0442\u0430\u0440\u044C \u2014 \u043D\u0430\u0448\u0438."
  },
  {
    q: "\u041C\u043E\u0436\u043D\u043E \u043B\u0438 \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u043F\u0438\u0441\u044C?",
    a: "\u0414\u0430, \u0432 \u043E\u0434\u0438\u043D \u043A\u043B\u0438\u043A \u0432 \u0440\u0430\u0437\u0434\u0435\u043B\u0435 \xAB\u041C\u043E\u0438 \u0437\u0430\u043F\u0438\u0441\u0438\xBB. \u0411\u0435\u0437 \u0448\u0442\u0440\u0430\u0444\u043E\u0432 \u0438 \u0437\u0432\u043E\u043D\u043A\u043E\u0432 \u2014 \u043C\u0435\u0441\u0442\u043E \u0441\u0440\u0430\u0437\u0443 \u043E\u0441\u0432\u043E\u0431\u043E\u0436\u0434\u0430\u0435\u0442\u0441\u044F."
  },
  {
    q: "\u0421 \u043A\u0430\u043A\u043E\u0433\u043E \u0432\u043E\u0437\u0440\u0430\u0441\u0442\u0430 \u043C\u043E\u0436\u043D\u043E \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C\u0441\u044F?",
    a: "\u0421 16 \u043B\u0435\u0442 \u043D\u0430 \u0432\u0441\u0435 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F. \u0412\u0435\u0440\u0445\u043D\u0435\u0439 \u0433\u0440\u0430\u043D\u0438\u0446\u044B \u043D\u0435\u0442: \u0443 \u043D\u0430\u0441 \u0437\u0430\u043D\u0438\u043C\u0430\u044E\u0442\u0441\u044F \u0438 \u0432 60+, \u0442\u0440\u0435\u043D\u0435\u0440 \u0430\u0434\u0430\u043F\u0442\u0438\u0440\u0443\u0435\u0442 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0443."
  }
];
var CLUB_INFO = {
  city: "\u041A\u0430\u0440\u0430\u0433\u0430\u043D\u0434\u0430",
  address: "\u0443\u043B. \u0421\u043F\u043E\u0440\u0442\u0438\u0432\u043D\u0430\u044F, 12",
  phone: "+7 (7212) 55-01-02",
  hours: "\u0415\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u043E 07:00\u201323:00"
};

// src/views/landing-view.ts
var LandingView = class extends BaseView {
  constructor(ctx) {
    super(ctx);
    this.observer = null;
    this.counterObserver = null;
  }
  init() {
    this.watch("auth", () => this.render());
  }
  onDestroy() {
    this.observer?.disconnect();
    this.counterObserver?.disconnect();
  }
  render() {
    replace(
      this.root,
      this.promoBar(),
      this.hero(),
      this.marquee(),
      this.directions(),
      this.steps(),
      this.trainers(),
      this.pricing(),
      this.reviews(),
      this.faq(),
      this.ctaBand(),
      this.footer()
    );
    this.observeReveals();
    this.observeCounters();
  }
  observeReveals() {
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            this.observer?.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 }
    );
    this.root.querySelectorAll(".reveal").forEach((el) => this.observer?.observe(el));
  }
  observeCounters() {
    this.counterObserver?.disconnect();
    this.counterObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target;
          this.counterObserver?.unobserve(el);
          this.animateCount(el);
        }
      },
      { threshold: 0.4 }
    );
    this.root.querySelectorAll("[data-count]").forEach((el) => this.counterObserver?.observe(el));
  }
  animateCount(el) {
    const target = Number(el.dataset.count ?? "0");
    const suffix = el.dataset.suffix ?? "";
    const duration = 1100;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = `${Math.round(target * eased)}${suffix}`;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  go() {
    if (this.ctx.auth.currentUser()) {
      this.ctx.navigate("schedule");
      return;
    }
    requestAuthTab("register");
    this.ctx.navigate("auth");
  }
  scrollTo(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  promoBar() {
    return h(
      "div",
      { class: "promo-bar" },
      h("span", { text: "\u041F\u0435\u0440\u0432\u0430\u044F \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u2014 \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E" }),
      h("button", {
        class: "promo-link",
        attrs: { type: "button" },
        text: "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u2192",
        on: { click: () => this.go() }
      })
    );
  }
  hero() {
    const stat = (value, suffix, label) => h(
      "div",
      { class: "hl-stat" },
      h("strong", {
        attrs: { "data-count": String(value), "data-suffix": suffix },
        text: `0${suffix}`
      }),
      h("span", { text: label })
    );
    const art = h(
      "div",
      { class: "hl-art" },
      remoteImg(
        HERO_PHOTO,
        "\u0410\u0442\u043B\u0435\u0442 \u0432 \u0437\u0430\u043B\u0435",
        "hl-athlete",
        () => h("div", { class: "hl-athlete hl-athlete-fallback" })
      ),
      h(
        "div",
        { class: "hl-badge" },
        h("strong", { text: "16+" }),
        h("span", { text: "\u043B\u0435\u0442 \u0438 \u0441\u0442\u0430\u0440\u0448\u0435" })
      )
    );
    return h(
      "section",
      { class: "hl" },
      h(
        "div",
        { class: "hl-inner" },
        h(
          "div",
          { class: "hl-copy" },
          h("span", {
            class: "hl-kicker",
            text: `\u0421\u043F\u043E\u0440\u0442\u0438\u0432\u043D\u044B\u0439 \u0446\u0435\u043D\u0442\u0440 \xB7 ${CLUB_INFO.city}`
          }),
          h(
            "h1",
            { class: "hl-title" },
            "\u0421\u0438\u043B\u0430.",
            h("br"),
            "\u0420\u0438\u0442\u043C.",
            h("br"),
            h("span", { class: "hl-accent", text: "\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442." })
          ),
          h("p", {
            class: "hl-sub",
            text: "\u041F\u044F\u0442\u044C \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0439 \u0438 \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435, \u043A\u043E\u0442\u043E\u0440\u043E\u0435 \u043F\u043E\u0434\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u043F\u043E\u0434 \u0442\u0435\u0431\u044F. \u0417\u0430\u043F\u0438\u0441\u044C \u2014 \u0432 \u0434\u0432\u0430 \u043A\u043B\u0438\u043A\u0430, \u043F\u0435\u0440\u0432\u0430\u044F \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u2014 \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E."
          }),
          h(
            "div",
            { class: "hl-ctas" },
            button({ label: "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E", onClick: () => this.go() }),
            button({
              label: "\u0421\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u0446\u0435\u043D\u044B",
              tone: "ghost",
              onClick: () => this.scrollTo("pricing")
            })
          ),
          h(
            "div",
            { class: "hl-stats" },
            stat(5, "", "\u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0439"),
            stat(5, "", "\u0442\u0440\u0435\u043D\u0435\u0440\u043E\u0432"),
            stat(7, "", "\u0434\u043D\u0435\u0439 \u0432 \u043D\u0435\u0434\u0435\u043B\u044E"),
            stat(1200, "+", "\u0437\u0430\u043F\u0438\u0441\u0435\u0439")
          )
        ),
        art
      )
    );
  }
  marquee() {
    const text = WORKOUT_KINDS.map((k) => KIND_LABEL[k].toUpperCase()).join("  \xB7  ") + "  \xB7  ";
    return h(
      "div",
      { class: "marquee", attrs: { "aria-hidden": "true" } },
      h(
        "div",
        { class: "marquee-track" },
        h("span", { text }),
        h("span", { text })
      )
    );
  }
  sectionHead(kicker, title, sub) {
    return h(
      "div",
      { class: "ls-head reveal" },
      h("span", { class: "ls-kicker", text: kicker }),
      h("h2", { class: "ls-title", text: title }),
      sub ? h("p", { class: "ls-sub", text: sub }) : null
    );
  }
  directions() {
    const cards = DIRECTIONS.map(
      (dir) => h(
        "article",
        { class: "dir-card reveal" },
        h(
          "div",
          { class: "dir-cover" },
          coverImg(dir.kind, "dir-img"),
          h("span", { class: "dir-duration", text: dir.duration })
        ),
        h(
          "div",
          { class: "dir-body" },
          h(
            "div",
            { class: "dir-badges" },
            kindBadge(dir.kind),
            intensityChip(dir.kind)
          ),
          h("h3", { text: dir.title }),
          h("p", { class: "muted", text: dir.description }),
          button({
            label: "\u0412 \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435",
            tone: "ghost",
            small: true,
            onClick: () => this.go()
          })
        )
      )
    );
    return h(
      "section",
      { class: "ls", attrs: { id: "directions" } },
      this.sectionHead(
        "\u041D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F",
        "\u041D\u0430\u0439\u0434\u0438 \u0441\u0432\u043E\u044E \u043D\u0430\u0433\u0440\u0443\u0437\u043A\u0443",
        "\u041E\u0442 \u0441\u043F\u043E\u043A\u043E\u0439\u043D\u043E\u0439 \u0439\u043E\u0433\u0438 \u0434\u043E \u0436\u0451\u0441\u0442\u043A\u043E\u0433\u043E \u043A\u0440\u043E\u0441\u0441\u0444\u0438\u0442\u0430 \u2014 \u0438\u043D\u0442\u0435\u043D\u0441\u0438\u0432\u043D\u043E\u0441\u0442\u044C \u0432\u0438\u0434\u043D\u0430 \u0441\u0440\u0430\u0437\u0443."
      ),
      h("div", { class: "dir-grid" }, ...cards)
    );
  }
  steps() {
    const items = [
      {
        n: "01",
        title: "\u0412\u044B\u0431\u0435\u0440\u0438 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0443",
        text: "\u0420\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u043D\u0430 \u043D\u0435\u0434\u0435\u043B\u044E \u0432\u043F\u0435\u0440\u0451\u0434: \u0434\u0435\u043D\u044C, \u0432\u0440\u0435\u043C\u044F, \u0442\u0440\u0435\u043D\u0435\u0440 \u0438 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0435 \u043C\u0435\u0441\u0442\u0430 \u2014 \u0432\u0441\u0451 \u0432\u0438\u0434\u043D\u043E \u0441\u0440\u0430\u0437\u0443."
      },
      {
        n: "02",
        title: "\u0417\u0430\u043F\u0438\u0448\u0438\u0441\u044C \u0432 \u0434\u0432\u0430 \u043A\u043B\u0438\u043A\u0430",
        text: "\u0411\u0435\u0437 \u0437\u0432\u043E\u043D\u043A\u043E\u0432 \u0438 \u0430\u043D\u043A\u0435\u0442. \u041C\u0435\u0441\u0442\u043E \u0431\u0440\u043E\u043D\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u043C\u0433\u043D\u043E\u0432\u0435\u043D\u043D\u043E, \u043E\u0442\u043C\u0435\u043D\u0430 \u2014 \u0442\u043E\u0436\u0435 \u0432 \u043E\u0434\u0438\u043D \u043A\u043B\u0438\u043A."
      },
      {
        n: "03",
        title: "\u041F\u0440\u0438\u0445\u043E\u0434\u0438 \u0438 \u0442\u0440\u0435\u043D\u0438\u0440\u0443\u0439\u0441\u044F",
        text: "\u0422\u0440\u0435\u043D\u0435\u0440 \u0432\u0441\u0442\u0440\u0435\u0442\u0438\u0442, \u043F\u043E\u0434\u0431\u0435\u0440\u0451\u0442 \u043D\u0430\u0433\u0440\u0443\u0437\u043A\u0443 \u0438 \u0434\u043E\u0432\u0435\u0434\u0451\u0442 \u0434\u043E \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u0430. \u041F\u0435\u0440\u0432\u043E\u0435 \u0437\u0430\u043D\u044F\u0442\u0438\u0435 \u2014 \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E."
      }
    ];
    const cards = items.map(
      (s) => h(
        "div",
        { class: "step-card reveal" },
        h("span", { class: "step-num", text: s.n }),
        h("h3", { text: s.title }),
        h("p", { class: "muted", text: s.text })
      )
    );
    return h(
      "section",
      { class: "ls ls-alt" },
      this.sectionHead("\u041A\u0430\u043A \u044D\u0442\u043E \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442", "\u0422\u0440\u0438 \u0448\u0430\u0433\u0430 \u0434\u043E \u043F\u0435\u0440\u0432\u043E\u0439 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0438"),
      h("div", { class: "steps-grid" }, ...cards)
    );
  }
  trainers() {
    const cards = TRAINERS.map(
      (t) => h(
        "article",
        { class: `trainer-card reveal k-${t.kind}` },
        remoteImg(t.photo, t.name, "trainer-photo", () => avatar(t.name)),
        h("h3", { text: t.name }),
        h("span", { class: "trainer-role", text: t.role }),
        h("span", { class: "trainer-exp muted", text: t.experience }),
        h("p", { class: "trainer-quote", text: `\xAB${t.quote}\xBB` })
      )
    );
    return h(
      "section",
      { class: "ls", attrs: { id: "trainers" } },
      this.sectionHead(
        "\u041A\u043E\u043C\u0430\u043D\u0434\u0430",
        "\u0422\u0440\u0435\u043D\u0435\u0440\u044B, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0434\u043E\u0432\u043E\u0434\u044F\u0442 \u0434\u043E \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u0430",
        "\u041A\u0430\u0436\u0434\u044B\u0439 \u2014 \u0441\u043F\u0435\u0446\u0438\u0430\u043B\u0438\u0441\u0442 \u0432 \u0441\u0432\u043E\u0451\u043C \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0438, \u0430 \u043D\u0435 \u0443\u043D\u0438\u0432\u0435\u0440\u0441\u0430\u043B \xAB\u043E\u0431\u043E \u0432\u0441\u0451\u043C\xBB."
      ),
      h("div", { class: "trainer-grid" }, ...cards)
    );
  }
  pricing() {
    const cards = PLANS.map((plan) => this.priceCard(plan));
    return h(
      "section",
      { class: "ls ls-alt", attrs: { id: "pricing" } },
      this.sectionHead(
        "\u0410\u0431\u043E\u043D\u0435\u043C\u0435\u043D\u0442\u044B",
        "\u0427\u0435\u0441\u0442\u043D\u044B\u0435 \u0446\u0435\u043D\u044B \u0431\u0435\u0437 \u0437\u0432\u0451\u0437\u0434\u043E\u0447\u0435\u043A",
        "\u041F\u0435\u0440\u0432\u0430\u044F \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E. \u0414\u0430\u043B\u044C\u0448\u0435 \u2014 \u0432\u044B\u0431\u0435\u0440\u0438 \u0441\u0432\u043E\u0439 \u0444\u043E\u0440\u043C\u0430\u0442."
      ),
      h("div", { class: "price-grid" }, ...cards),
      h("p", {
        class: "price-note muted",
        text: "\u041E\u043F\u043B\u0430\u0442\u0430 \u0432 \u043A\u043B\u0443\u0431\u0435 \u0438\u043B\u0438 \u043E\u043D\u043B\u0430\u0439\u043D. \u0417\u0430\u043C\u043E\u0440\u043E\u0437\u043A\u0430 \u0438 \u043E\u0442\u043C\u0435\u043D\u0430 \u2014 \u0431\u0435\u0437 \u0448\u0442\u0440\u0430\u0444\u043E\u0432."
      })
    );
  }
  priceCard(plan) {
    const features = plan.features.map(
      (f) => h("li", {}, icon("check", 16), h("span", { text: f }))
    );
    return h(
      "article",
      { class: `price-card reveal${plan.popular ? " popular" : ""}` },
      plan.badge ? h("span", { class: "price-badge", text: plan.badge }) : null,
      h("h3", { text: plan.name }),
      h("p", { class: "muted price-tagline", text: plan.tagline }),
      h(
        "div",
        { class: "price-value" },
        h("strong", { text: formatPrice(plan.price) }),
        h("span", { class: "muted", text: plan.period })
      ),
      h("ul", { class: "feature-list" }, ...features),
      button({
        label: plan.popular ? "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0431\u0435\u0437\u043B\u0438\u043C\u0438\u0442" : "\u0412\u044B\u0431\u0440\u0430\u0442\u044C",
        tone: plan.popular ? "primary" : "ghost",
        wide: true,
        onClick: () => this.onPlan(plan)
      })
    );
  }
  onPlan(plan) {
    if (!this.ctx.auth.currentUser()) {
      requestAuthTab("register");
      this.ctx.navigate("auth");
      return;
    }
    this.openCheckout(plan);
  }
  openCheckout(plan) {
    const method = (value, label, checked) => h(
      "label",
      { class: "pay-opt" },
      h("input", { attrs: { type: "radio", name: "pay", value }, checked }),
      h("span", { text: label })
    );
    const form = h(
      "form",
      {
        on: {
          submit: (e) => {
            e.preventDefault();
            close();
            this.ctx.toasts.show(
              `\u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0430 \xAB${plan.name}\xBB \u043F\u0440\u0438\u043D\u044F\u0442\u0430 \u2014 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u0441\u0432\u044F\u0436\u0435\u0442\u0441\u044F \u0441 \u0442\u043E\u0431\u043E\u0439`,
              "ok"
            );
          }
        }
      },
      h("h3", { text: "\u041E\u0444\u043E\u0440\u043C\u043B\u0435\u043D\u0438\u0435 \u0430\u0431\u043E\u043D\u0435\u043C\u0435\u043D\u0442\u0430" }),
      h(
        "div",
        { class: "plan-summary" },
        h(
          "div",
          {},
          h("strong", { text: plan.name }),
          h("span", { class: "muted", text: plan.period })
        ),
        h("strong", { class: "plan-price", text: formatPrice(plan.price) })
      ),
      h(
        "div",
        { class: "pay-methods" },
        method("kaspi", "Kaspi QR", true),
        method("card", "\u0411\u0430\u043D\u043A\u043E\u0432\u0441\u043A\u0430\u044F \u043A\u0430\u0440\u0442\u0430", false)
      ),
      h("p", {
        class: "demo-note",
        text: "\u0414\u0435\u043C\u043E-\u0440\u0435\u0436\u0438\u043C: \u043E\u043D\u043B\u0430\u0439\u043D-\u043E\u043F\u043B\u0430\u0442\u0430 \u043D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0430. \u0417\u0430\u044F\u0432\u043A\u0430 \u043D\u0438 \u043A \u0447\u0435\u043C\u0443 \u043D\u0435 \u043E\u0431\u044F\u0437\u044B\u0432\u0430\u0435\u0442."
      }),
      h(
        "div",
        { class: "modal-actions" },
        button({ label: "\u041E\u0442\u043C\u0435\u043D\u0430", tone: "ghost", onClick: () => close() }),
        button({ label: "\u041E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443", type: "submit" })
      )
    );
    const close = this.ctx.overlays.open(form);
  }
  reviews() {
    const cards = REVIEWS.map(
      (r) => h(
        "article",
        { class: "review-card reveal" },
        h("span", {
          class: "stars",
          text: "\u2605".repeat(r.stars),
          attrs: { "aria-label": `\u041E\u0446\u0435\u043D\u043A\u0430 ${r.stars} \u0438\u0437 5` }
        }),
        h("p", { text: `\xAB${r.text}\xBB` }),
        h("strong", { text: r.name })
      )
    );
    return h(
      "section",
      { class: "ls" },
      this.sectionHead(
        "\u041E\u0442\u0437\u044B\u0432\u044B",
        "\u0427\u0442\u043E \u0433\u043E\u0432\u043E\u0440\u044F\u0442 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438",
        "\u0414\u0435\u043C\u043E\u043D\u0441\u0442\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0435 \u043E\u0442\u0437\u044B\u0432\u044B \u0443\u0447\u0435\u0431\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0435\u043A\u0442\u0430."
      ),
      h("div", { class: "review-grid" }, ...cards)
    );
  }
  faq() {
    const items = FAQ.map(
      (item) => h(
        "details",
        { class: "faq-item reveal" },
        h(
          "summary",
          {},
          h("span", { text: item.q }),
          h("span", {
            class: "faq-mark",
            attrs: { "aria-hidden": "true" },
            text: "+"
          })
        ),
        h("p", { class: "muted", text: item.a })
      )
    );
    return h(
      "section",
      { class: "ls ls-alt" },
      this.sectionHead("\u0412\u043E\u043F\u0440\u043E\u0441\u044B", "\u0427\u0430\u0441\u0442\u044B\u0435 \u0432\u043E\u043F\u0440\u043E\u0441\u044B"),
      h("div", { class: "faq-list" }, ...items)
    );
  }
  ctaBand() {
    return h(
      "section",
      { class: "cta-band reveal" },
      h("h2", { text: "\u041F\u0435\u0440\u0432\u0430\u044F \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u2014 \u0437\u0430 \u043D\u0430\u0448 \u0441\u0447\u0451\u0442" }),
      h("p", {
        text: "\u0412\u044B\u0431\u0435\u0440\u0438 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435, \u0437\u0430\u043F\u0438\u0448\u0438\u0441\u044C \u043E\u043D\u043B\u0430\u0439\u043D \u0438 \u043F\u0440\u0438\u0445\u043E\u0434\u0438. \u0411\u0435\u0437 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u0441\u0442\u0432."
      }),
      button({ label: "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E", onClick: () => this.go() })
    );
  }
  footer() {
    return h(
      "footer",
      { class: "landing-foot" },
      h(
        "div",
        { class: "lf-inner" },
        h(
          "div",
          { class: "lf-brand" },
          h("span", { class: "logo-mark" }, icon("dumbbell", 22)),
          h(
            "div",
            {},
            h("strong", { text: "\u0410\u0422\u041B\u0415\u0422" }),
            h("span", { class: "muted", text: "\u0441\u043F\u043E\u0440\u0442\u0438\u0432\u043D\u044B\u0439 \u0446\u0435\u043D\u0442\u0440" })
          )
        ),
        h(
          "div",
          { class: "lf-col" },
          h("strong", { text: "\u041A\u043E\u043D\u0442\u0430\u043A\u0442\u044B" }),
          h("span", { text: `${CLUB_INFO.city}, ${CLUB_INFO.address}` }),
          h("a", {
            attrs: { href: `tel:${CLUB_INFO.phone.replace(/[^\d+]/g, "")}` },
            text: CLUB_INFO.phone
          })
        ),
        h(
          "div",
          { class: "lf-col" },
          h("strong", { text: "\u0420\u0435\u0436\u0438\u043C \u0440\u0430\u0431\u043E\u0442\u044B" }),
          h("span", { text: CLUB_INFO.hours }),
          h("span", { class: "muted", text: "\u0423\u0447\u0435\u0431\u043D\u044B\u0439 \u043F\u0440\u043E\u0435\u043A\u0442 \xB7 \u0434\u0435\u043C\u043E-\u0434\u0430\u043D\u043D\u044B\u0435" })
        )
      )
    );
  }
};

// src/views/schedule-view.ts
var TIME_OPTIONS = [
  { value: "all", label: "\u041B\u044E\u0431\u043E\u0435 \u0432\u0440\u0435\u043C\u044F" },
  { value: "morning", label: "\u0423\u0442\u0440\u043E" },
  { value: "day", label: "\u0414\u0435\u043D\u044C" },
  { value: "evening", label: "\u0412\u0435\u0447\u0435\u0440" }
];
var ScheduleView = class extends BaseView {
  constructor(ctx) {
    super(ctx);
    this.filters = { ...DEFAULT_FILTERS };
    this.drawerContent = null;
    this.drawerSessionId = null;
    this.closeDrawer = null;
    this.searchTimer = 0;
  }
  init() {
    this.watch("sessions", () => {
      this.renderList();
      this.renderNext();
      this.refreshDrawer();
    });
    this.watch("bookings", () => {
      this.renderList();
      this.renderNext();
      this.refreshDrawer();
    });
  }
  onDestroy() {
    window.clearTimeout(this.searchTimer);
    this.closeDrawer?.();
  }
  render() {
    this.daysEl = h("div", {
      class: "days",
      attrs: { role: "tablist", "aria-label": "\u0414\u043D\u0438 \u043D\u0435\u0434\u0435\u043B\u0438" }
    });
    this.chipsEl = h("div", { class: "chips" });
    this.presetsEl = h("div", { class: "presets" });
    this.countEl = h("p", { class: "muted result-count" });
    this.listEl = h("div", { class: "session-list" });
    this.nextEl = h("div", { class: "next-slot" });
    this.searchInput = h("input", {
      class: "search-input",
      attrs: {
        type: "search",
        placeholder: "\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430, \u0442\u0440\u0435\u043D\u0435\u0440 \u0438\u043B\u0438 \u0437\u0430\u043B\u2026",
        "aria-label": "\u041F\u043E\u0438\u0441\u043A",
        autocomplete: "off"
      },
      value: this.filters.query,
      on: {
        input: () => {
          window.clearTimeout(this.searchTimer);
          this.searchTimer = window.setTimeout(() => {
            this.filters.query = this.searchInput.value;
            this.renderList();
          }, 150);
        }
      }
    });
    this.sortSelect = h(
      "select",
      {
        class: "input select sort-select",
        attrs: { "aria-label": "\u0421\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043A\u0430" },
        value: this.filters.sort,
        on: {
          change: () => {
            this.filters.sort = this.sortSelect.value === "seats" ? "seats" : "time";
            this.renderList();
          }
        }
      },
      h("option", { attrs: { value: "time" }, text: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0440\u0430\u043D\u043D\u0438\u0435" }),
      h("option", { attrs: { value: "seats" }, text: "\u0411\u043E\u043B\u044C\u0448\u0435 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0445 \u043C\u0435\u0441\u0442" })
    );
    replace(
      this.root,
      this.hero(),
      this.nextEl,
      this.daysEl,
      h(
        "div",
        { class: "toolbar" },
        h("label", { class: "search" }, icon("search", 18), this.searchInput),
        this.sortSelect
      ),
      this.chipsEl,
      this.presetsEl,
      this.countEl,
      this.listEl
    );
    this.renderDays();
    this.renderChips();
    this.renderPresets();
    this.renderList();
    this.renderNext();
  }
  hero() {
    const user = this.ctx.auth.currentUser();
    const first = user?.name.split(" ")[0] ?? "";
    return h(
      "section",
      { class: "hero-fit" },
      h(
        "div",
        { class: "hero-copy" },
        h("span", { class: "hero-kicker", text: "\u0420\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435" }),
        h("h1", {
          class: "hero-title",
          text: first ? `\u041F\u0440\u0438\u0432\u0435\u0442, ${first}` : "\u0422\u0440\u0435\u043D\u0438\u0440\u0443\u0439\u0441\u044F \u0432 \u0441\u0432\u043E\u0451\u043C \u0440\u0438\u0442\u043C\u0435"
        }),
        h("p", {
          class: "hero-sub",
          text: "\u0412\u044B\u0431\u0435\u0440\u0438 \u0434\u0435\u043D\u044C \u0438 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0443 \u2014 \u0437\u0430\u043F\u0438\u0441\u044C \u0437\u0430\u0439\u043C\u0451\u0442 \u043F\u0430\u0440\u0443 \u0441\u0435\u043A\u0443\u043D\u0434."
        })
      )
    );
  }
  renderNext() {
    const now = /* @__PURE__ */ new Date();
    const upcoming = this.ctx.booking.ofCurrentUser().map((b) => this.ctx.state.sessionById(b.sessionId)).filter(
      (s) => s !== void 0 && !isFinished(s, now)
    ).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const next = upcoming[0];
    if (!next) {
      replace(this.nextEl);
      this.nextEl.hidden = true;
      return;
    }
    this.nextEl.hidden = false;
    replace(
      this.nextEl,
      h(
        "div",
        { class: "next-card" },
        h(
          "div",
          { class: "next-info" },
          h("span", { class: "next-label", text: "\u0411\u043B\u0438\u0436\u0430\u0439\u0448\u0430\u044F \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430" }),
          h("strong", { text: next.title }),
          h("span", {
            class: "muted",
            text: `${relativeDay(next.startsAt, now)}, ${fmtTime(next.startsAt)} \xB7 ${next.trainer}`
          })
        ),
        button({
          label: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C",
          tone: "ghost",
          small: true,
          onClick: () => this.openDrawer(next.id)
        })
      )
    );
  }
  renderDays() {
    const now = /* @__PURE__ */ new Date();
    replace(
      this.daysEl,
      ...Array.from({ length: 7 }, (_, i) => {
        const label = dayLabel(i, now);
        return h(
          "button",
          {
            class: `day${this.filters.dayOffset === i ? " active" : ""}`,
            attrs: {
              type: "button",
              role: "tab",
              "aria-selected": String(this.filters.dayOffset === i)
            },
            on: {
              click: () => {
                this.filters.dayOffset = i;
                this.renderDays();
                this.renderList();
              }
            }
          },
          h("span", { text: label.top }),
          h("small", { text: label.sub })
        );
      })
    );
  }
  renderChips() {
    const kindChips = [
      chip("\u0412\u0441\u0435", this.filters.kind === "all", () => {
        this.filters.kind = "all";
        this.renderChips();
        this.renderList();
      }),
      ...WORKOUT_KINDS.map(
        (kind) => chip(KIND_LABEL[kind], this.filters.kind === kind, () => {
          this.filters.kind = kind;
          this.renderChips();
          this.renderList();
        })
      )
    ];
    const timeChips = TIME_OPTIONS.map(
      (opt) => chip(opt.label, this.filters.time === opt.value, () => {
        this.filters.time = opt.value;
        this.renderChips();
        this.renderList();
      })
    );
    replace(
      this.chipsEl,
      ...kindChips,
      h("span", { class: "chips-sep", attrs: { "aria-hidden": "true" } }),
      ...timeChips
    );
  }
  renderPresets() {
    const presets = this.ctx.savedViews.all();
    replace(
      this.presetsEl,
      presets.length > 0 ? h("span", { class: "presets-label muted", text: "\u0421\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0435:" }) : null,
      ...presets.map(
        (p) => h(
          "span",
          { class: "preset" },
          h("button", {
            class: "preset-apply",
            attrs: { type: "button", title: "\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440" },
            text: p.name,
            on: { click: () => this.applyPreset(p) }
          }),
          h("button", {
            class: "preset-x",
            attrs: { type: "button", "aria-label": `\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440 ${p.name}` },
            text: "\xD7",
            on: {
              click: () => {
                this.ctx.savedViews.remove(p.id);
                this.renderPresets();
              }
            }
          })
        )
      ),
      button({
        label: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440",
        tone: "ghost",
        small: true,
        icon: "bookmark",
        onClick: () => this.openSavePreset()
      })
    );
  }
  applyPreset(p) {
    this.filters = { ...DEFAULT_FILTERS, ...p.filters };
    this.searchInput.value = this.filters.query;
    this.sortSelect.value = this.filters.sort;
    this.renderDays();
    this.renderChips();
    this.renderList();
  }
  openSavePreset() {
    const input = textInput({
      type: "text",
      required: true,
      maxlength: 40,
      placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u0419\u043E\u0433\u0430 \u043F\u043E \u0443\u0442\u0440\u0430\u043C"
    });
    const form = h(
      "form",
      {
        on: {
          submit: (e) => {
            e.preventDefault();
            const name = input.value.trim();
            if (!name) return;
            this.ctx.savedViews.save(name, this.filters);
            close();
            this.renderPresets();
            this.ctx.toasts.show("\u0424\u0438\u043B\u044C\u0442\u0440 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D", "ok");
          }
        }
      },
      h("h3", { text: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u0444\u0438\u043B\u044C\u0442\u0440" }),
      field("\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435", input, true),
      h(
        "div",
        { class: "modal-actions" },
        button({ label: "\u041E\u0442\u043C\u0435\u043D\u0430", tone: "ghost", onClick: () => close() }),
        button({ label: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C", type: "submit" })
      )
    );
    const close = this.ctx.overlays.open(form);
  }
  renderList() {
    const now = /* @__PURE__ */ new Date();
    const bookings = this.ctx.state.allBookings();
    const list = sortSessions(
      filterSessions(this.ctx.state.allSessions(), this.filters, now),
      this.filters.sort,
      bookings
    );
    this.countEl.textContent = `${list.length} ${plural(list.length, ["\u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430", "\u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0438", "\u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043E\u043A"])}`;
    if (list.length === 0) {
      replace(
        this.listEl,
        emptyState(
          "\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E. \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u044B.",
          button({
            label: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440\u044B",
            tone: "ghost",
            onClick: () => {
              this.filters = {
                ...DEFAULT_FILTERS,
                dayOffset: this.filters.dayOffset
              };
              this.searchInput.value = "";
              this.sortSelect.value = "time";
              this.renderChips();
              this.renderList();
            }
          })
        )
      );
      return;
    }
    replace(this.listEl, ...list.map((s, i) => this.sessionCard(s, i)));
  }
  sessionCard(s, index) {
    const now = /* @__PURE__ */ new Date();
    const bookings = this.ctx.state.allBookings();
    const user = this.ctx.auth.currentUser();
    const left = seatsLeft(s, bookings);
    const mine = user ? bookingOf(bookings, user.id, s.id) : void 0;
    const finished = isFinished(s, now);
    const cover = h(
      "div",
      { class: "card-cover" },
      coverImg(s.kind),
      h("span", { class: "cover-time", text: fmtTime(s.startsAt) })
    );
    const info = h(
      "div",
      { class: "session-info" },
      h(
        "div",
        { class: "session-top" },
        h("h3", { text: s.title }),
        kindBadge(s.kind),
        intensityChip(s.kind)
      ),
      h(
        "p",
        { class: "muted session-meta" },
        miniAvatar(s.trainer),
        h("span", { text: `${s.trainer} \xB7 ${s.room} \xB7 ${s.durationMin} \u043C\u0438\u043D` })
      )
    );
    const action = finished ? button({ label: "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430", tone: "ghost", disabled: true }) : mine ? button({
      label: "\u0412\u044B \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u044B",
      tone: "ok",
      icon: "check",
      onClick: (e) => {
        e.stopPropagation();
        this.openDrawer(s.id);
      }
    }) : left <= 0 ? button({ label: "\u041C\u0435\u0441\u0442 \u043D\u0435\u0442", tone: "ghost", disabled: true }) : button({
      label: "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F",
      onClick: (e) => {
        e.stopPropagation();
        void this.book(s.id);
      }
    });
    const taken = seatsTaken(bookings, s.id);
    const pct = s.capacity ? Math.round(taken / s.capacity * 100) : 0;
    const spotsText = finished ? "\u2014" : left <= 0 ? "\u041C\u0435\u0441\u0442 \u043D\u0435\u0442" : `${left} ${plural(left, ["\u043C\u0435\u0441\u0442\u043E", "\u043C\u0435\u0441\u0442\u0430", "\u043C\u0435\u0441\u0442"])}`;
    const spotsCls = finished ? "spots" : left <= 0 ? "spots none" : left <= 3 ? "spots low urgent" : "spots";
    const side = h(
      "div",
      { class: "session-side" },
      h("span", { class: spotsCls, text: spotsText }),
      h(
        "div",
        { class: "card-occ" },
        occupancyBar(pct),
        h("span", { text: `${taken}/${s.capacity}` })
      ),
      action
    );
    return h(
      "article",
      {
        class: `session-card${finished ? " past" : ""}`,
        style: `animation-delay:${Math.min(index * 40, 240)}ms`,
        attrs: {
          tabindex: "0",
          role: "group",
          "aria-label": `${s.title}, ${fmtTime(s.startsAt)}. \u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u043E\u0434\u0440\u043E\u0431\u043D\u043E\u0441\u0442\u0438`
        },
        on: {
          click: () => this.openDrawer(s.id),
          keydown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              this.openDrawer(s.id);
            }
          }
        }
      },
      cover,
      info,
      side
    );
  }
  async book(sessionId) {
    const r = await this.ctx.booking.book(sessionId);
    if (!r.ok) {
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    const s = this.ctx.state.sessionById(sessionId);
    this.ctx.toasts.show(
      s ? `\u0412\u044B \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u044B: ${s.title}, ${fmtFull(s.startsAt)}` : "\u0412\u044B \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u044B",
      "ok",
      {
        label: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C",
        run: () => {
          void this.cancel(r.value.id);
        }
      }
    );
  }
  async cancel(bookingId) {
    const r = await this.ctx.booking.cancel(bookingId);
    if (!r.ok) {
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    this.ctx.toasts.show("\u0417\u0430\u043F\u0438\u0441\u044C \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430", "info", {
      label: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C",
      run: () => {
        void this.restore(r.value);
      }
    });
  }
  async restore(booking) {
    const r = await this.ctx.booking.book(booking.sessionId);
    this.ctx.toasts.show(
      r.ok ? "\u0417\u0430\u043F\u0438\u0441\u044C \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430" : errorMessage(r.error),
      r.ok ? "ok" : "err"
    );
  }
  openDrawer(sessionId) {
    if (!this.ctx.state.sessionById(sessionId)) return;
    this.drawerSessionId = sessionId;
    this.drawerContent = h("div", { class: "drawer-body" });
    this.fillDrawer();
    this.closeDrawer = this.ctx.overlays.open(
      this.drawerContent,
      "drawer",
      () => {
        this.drawerSessionId = null;
        this.drawerContent = null;
        this.closeDrawer = null;
      }
    );
  }
  refreshDrawer() {
    if (!this.drawerSessionId) return;
    if (!this.ctx.state.sessionById(this.drawerSessionId)) {
      this.closeDrawer?.();
      return;
    }
    this.fillDrawer();
  }
  fillDrawer() {
    if (!this.drawerContent || !this.drawerSessionId) return;
    const s = this.ctx.state.sessionById(this.drawerSessionId);
    if (!s) return;
    const now = /* @__PURE__ */ new Date();
    const bookings = this.ctx.state.allBookings();
    const user = this.ctx.auth.currentUser();
    const taken = seatsTaken(bookings, s.id);
    const left = seatsLeft(s, bookings);
    const mine = user ? bookingOf(bookings, user.id, s.id) : void 0;
    const finished = isFinished(s, now);
    const pct = s.capacity ? Math.round(taken / s.capacity * 100) : 0;
    const action = finished ? button({
      label: "\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430",
      tone: "ghost",
      wide: true,
      disabled: true
    }) : mine ? button({
      label: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u043F\u0438\u0441\u044C",
      tone: "danger",
      wide: true,
      onClick: () => {
        void this.cancel(mine.id);
      }
    }) : left <= 0 ? button({
      label: "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0445 \u043C\u0435\u0441\u0442 \u043D\u0435\u0442",
      tone: "ghost",
      wide: true,
      disabled: true
    }) : button({
      label: "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F",
      wide: true,
      onClick: () => {
        void this.book(s.id);
      }
    });
    const cover = h(
      "div",
      { class: "drawer-cover" },
      coverImg(s.kind, "drawer-cover-img"),
      h(
        "div",
        { class: "drawer-cover-badges" },
        kindBadge(s.kind),
        intensityChip(s.kind)
      ),
      iconButton("x", "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", () => this.closeDrawer?.())
    );
    replace(
      this.drawerContent,
      cover,
      h("h2", { text: s.title }),
      h("p", {
        class: "muted",
        text: `${fmtFull(s.startsAt)} \xB7 ${s.durationMin} \u043C\u0438\u043D`
      }),
      h(
        "ul",
        { class: "facts" },
        h(
          "li",
          {},
          icon("user", 18),
          h("span", {}, "\u0422\u0440\u0435\u043D\u0435\u0440: ", h("strong", { text: s.trainer }))
        ),
        h("li", {}, icon("pin", 18), h("span", { text: s.room })),
        h(
          "li",
          {},
          icon("clock", 18),
          h("span", {
            text: `${fmtTime(s.startsAt)}\u2013${fmtEndTime(s.startsAt, s.durationMin)}`
          })
        )
      ),
      h(
        "div",
        { class: "occ" },
        h("div", { class: "occ-bar" }, h("span", { style: `width:${pct}%` })),
        h("p", { class: "muted", text: `\u0417\u0430\u043F\u0438\u0441\u0430\u043D\u043E ${taken} \u0438\u0437 ${s.capacity}` })
      ),
      action
    );
  }
};

// src/main.ts
function requireElement(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u2014 \u043F\u0440\u043E\u0432\u0435\u0440\u044C www/index.html`);
  return el;
}
var apiBase = () => location.port === "8001" ? "/api" : `${location.protocol}//${location.hostname}:8001/api`;
async function bootstrap() {
  const bus = new EventBus();
  const api = new ApiClient(apiBase());
  const state = new AppState(api, bus);
  const auth = new RemoteAuth(api, state);
  const booking = new RemoteBooking(api, state);
  const catalog = new RemoteCatalog(api, state);
  const accounts = new RemoteAccounts(api, state);
  const savedViews = new SavedViewsStore();
  const toasts = new ToastCenter(document.body);
  const overlays = new OverlayHost(document.body);
  state.onSyncError((e) => toasts.show(errorMessage(e), "err"));
  let router;
  const ctx = {
    auth,
    booking,
    catalog,
    accounts,
    state,
    savedViews,
    bus,
    toasts,
    overlays,
    navigate: (route) => router.navigate(route)
  };
  const shell = new AppShell(ctx, requireElement("app"));
  router = new Router(
    ctx,
    shell.content,
    {
      home: () => new LandingView(ctx),
      auth: () => new AuthView(ctx),
      schedule: () => new ScheduleView(ctx),
      bookings: () => new BookingsView(ctx),
      admin: () => new AdminView(ctx)
    },
    (route) => shell.sync(route)
  );
  bus.on("auth", () => overlays.closeAll());
  const restored = await auth.restoreSession();
  if (!restored.ok && restored.error.code === "network") state.markSyncFailed();
  if (!auth.currentUser()) state.loadSnapshot();
  router.start();
  document.getElementById("boot")?.remove();
}
bootstrap().catch((error) => {
  console.error(error);
  const boot = document.getElementById("boot");
  if (boot)
    boot.textContent = "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435. \u041E\u0442\u043A\u0440\u043E\u0439 \u043A\u043E\u043D\u0441\u043E\u043B\u044C (F12) \u0438 \u043E\u0431\u043D\u043E\u0432\u0438 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443.";
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL2NvcmUvcmVzdWx0LnRzIiwgIi4uLy4uL3NyYy9hcGkvY2xpZW50LnRzIiwgIi4uLy4uL3NyYy9jb3JlL3J1bGVzLnRzIiwgIi4uLy4uL3NyYy9hcHBsaWNhdGlvbi9zZXJ2aWNlcy50cyIsICIuLi8uLi9zcmMvdWkvZG9tLnRzIiwgIi4uLy4uL3NyYy91aS9pY29ucy50cyIsICIuLi8uLi9zcmMvdWkvZm9ybWF0LnRzIiwgIi4uLy4uL3NyYy91aS9jb250cm9scy50cyIsICIuLi8uLi9zcmMvdWkvdGhlbWUudHMiLCAiLi4vLi4vc3JjL2FwcC9zaGVsbC50cyIsICIuLi8uLi9zcmMvYXBwL3JvdXRlci50cyIsICIuLi8uLi9zcmMvYXBwL3NhdmVkLXZpZXdzLnRzIiwgIi4uLy4uL3NyYy9zdGF0ZS9hcHAtc3RhdGUudHMiLCAiLi4vLi4vc3JjL3VpL21lc3NhZ2VzLnRzIiwgIi4uLy4uL3NyYy91aS9vdmVybGF5LnRzIiwgIi4uLy4uL3NyYy91aS90b2FzdC50cyIsICIuLi8uLi9zcmMvY29yZS90eXBlcy50cyIsICIuLi8uLi9zcmMvdmlld3Mvdmlldy50cyIsICIuLi8uLi9zcmMvdmlld3MvYWRtaW4tdmlldy50cyIsICIuLi8uLi9zcmMvdmlld3MvYXV0aC12aWV3LnRzIiwgIi4uLy4uL3NyYy92aWV3cy9ib29raW5ncy12aWV3LnRzIiwgIi4uLy4uL3NyYy9hcHAvY29udGVudC50cyIsICIuLi8uLi9zcmMvdmlld3MvbGFuZGluZy12aWV3LnRzIiwgIi4uLy4uL3NyYy92aWV3cy9zY2hlZHVsZS12aWV3LnRzIiwgIi4uLy4uL3NyYy9tYWluLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJleHBvcnQgdHlwZSBSZXN1bHQ8VCwgRT4gPVxyXG4gIHwgeyByZWFkb25seSBvazogdHJ1ZTsgcmVhZG9ubHkgdmFsdWU6IFQgfVxyXG4gIHwgeyByZWFkb25seSBvazogZmFsc2U7IHJlYWRvbmx5IGVycm9yOiBFIH07XHJcblxyXG5leHBvcnQgY29uc3Qgb2sgPSA8VD4odmFsdWU6IFQpOiBSZXN1bHQ8VCwgbmV2ZXI+ID0+ICh7IG9rOiB0cnVlLCB2YWx1ZSB9KTtcclxuZXhwb3J0IGNvbnN0IGZhaWwgPSA8RT4oZXJyb3I6IEUpOiBSZXN1bHQ8bmV2ZXIsIEU+ID0+ICh7IG9rOiBmYWxzZSwgZXJyb3IgfSk7XHJcbiIsICJpbXBvcnQgdHlwZSB7IERvbWFpbkVycm9yIH0gZnJvbSBcIi4uL2NvcmUvZXJyb3JzXCI7XHJcbmltcG9ydCB7IGZhaWwsIG9rLCB0eXBlIFJlc3VsdCB9IGZyb20gXCIuLi9jb3JlL3Jlc3VsdFwiO1xyXG5pbXBvcnQgdHlwZSB7XHJcbiAgQm9va2luZyxcclxuICBTZXNzaW9uRHJhZnQsXHJcbiAgVXNlcixcclxuICBVc2VyUGF0Y2gsXHJcbiAgV29ya291dFNlc3Npb24sXHJcbn0gZnJvbSBcIi4uL2NvcmUvdHlwZXNcIjtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgU3RhdGVEdG8ge1xyXG4gIHNlc3Npb25zOiBXb3Jrb3V0U2Vzc2lvbltdO1xyXG4gIGJvb2tpbmdzOiBCb29raW5nW107XHJcbiAgdXNlcnM6IFVzZXJbXSB8IG51bGw7XHJcbn1cclxuZXhwb3J0IGludGVyZmFjZSBVbmRvRHRvIHtcclxuICB1bmRvVG9rZW46IHN0cmluZztcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBBcGkge1xyXG4gIGF1dGg6IHtcclxuICAgIHJlZ2lzdGVyKFxyXG4gICAgICBuYW1lOiBzdHJpbmcsXHJcbiAgICAgIGVtYWlsOiBzdHJpbmcsXHJcbiAgICAgIHBhc3N3b3JkOiBzdHJpbmcsXHJcbiAgICApOiBQcm9taXNlPFJlc3VsdDxVc2VyLCBEb21haW5FcnJvcj4+O1xyXG4gICAgbG9naW4oZW1haWw6IHN0cmluZywgcGFzc3dvcmQ6IHN0cmluZyk6IFByb21pc2U8UmVzdWx0PFVzZXIsIERvbWFpbkVycm9yPj47XHJcbiAgICBsb2dvdXQoKTogUHJvbWlzZTxSZXN1bHQ8dm9pZCwgRG9tYWluRXJyb3I+PjtcclxuICAgIG1lKCk6IFByb21pc2U8UmVzdWx0PFVzZXIsIERvbWFpbkVycm9yPj47XHJcbiAgfTtcclxuICBzdGF0ZSgpOiBQcm9taXNlPFJlc3VsdDxTdGF0ZUR0bywgRG9tYWluRXJyb3I+PjtcclxuICBzZXNzaW9uczoge1xyXG4gICAgY3JlYXRlKGRyYWZ0OiBTZXNzaW9uRHJhZnQpOiBQcm9taXNlPFJlc3VsdDxXb3Jrb3V0U2Vzc2lvbiwgRG9tYWluRXJyb3I+PjtcclxuICAgIHVwZGF0ZShcclxuICAgICAgaWQ6IHN0cmluZyxcclxuICAgICAgZHJhZnQ6IFNlc3Npb25EcmFmdCxcclxuICAgICk6IFByb21pc2U8UmVzdWx0PFdvcmtvdXRTZXNzaW9uLCBEb21haW5FcnJvcj4+O1xyXG4gICAgcmVtb3ZlKGlkOiBzdHJpbmcpOiBQcm9taXNlPFJlc3VsdDxVbmRvRHRvLCBEb21haW5FcnJvcj4+O1xyXG4gICAgcmVzdG9yZSh1bmRvVG9rZW46IHN0cmluZyk6IFByb21pc2U8UmVzdWx0PHZvaWQsIERvbWFpbkVycm9yPj47XHJcbiAgfTtcclxuICBib29raW5nczoge1xyXG4gICAgY3JlYXRlKHNlc3Npb25JZDogc3RyaW5nKTogUHJvbWlzZTxSZXN1bHQ8Qm9va2luZywgRG9tYWluRXJyb3I+PjtcclxuICAgIGNhbmNlbChpZDogc3RyaW5nKTogUHJvbWlzZTxSZXN1bHQ8Qm9va2luZywgRG9tYWluRXJyb3I+PjtcclxuICB9O1xyXG4gIHVzZXJzOiB7XHJcbiAgICB1cGRhdGUoaWQ6IHN0cmluZywgcGF0Y2g6IFVzZXJQYXRjaCk6IFByb21pc2U8UmVzdWx0PFVzZXIsIERvbWFpbkVycm9yPj47XHJcbiAgICByZW1vdmUoaWQ6IHN0cmluZyk6IFByb21pc2U8UmVzdWx0PFVuZG9EdG8sIERvbWFpbkVycm9yPj47XHJcbiAgICByZXN0b3JlKHVuZG9Ub2tlbjogc3RyaW5nKTogUHJvbWlzZTxSZXN1bHQ8dm9pZCwgRG9tYWluRXJyb3I+PjtcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgQXBpQ2xpZW50IGltcGxlbWVudHMgQXBpIHtcclxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGJhc2U6IHN0cmluZykge31cclxuXHJcbiAgYXV0aCA9IHtcclxuICAgIHJlZ2lzdGVyOiAobmFtZTogc3RyaW5nLCBlbWFpbDogc3RyaW5nLCBwYXNzd29yZDogc3RyaW5nKSA9PlxyXG4gICAgICB0aGlzLnJlcXVlc3Q8VXNlcj4oXCJQT1NUXCIsIFwiL2F1dGgvcmVnaXN0ZXJcIiwgeyBuYW1lLCBlbWFpbCwgcGFzc3dvcmQgfSksXHJcbiAgICBsb2dpbjogKGVtYWlsOiBzdHJpbmcsIHBhc3N3b3JkOiBzdHJpbmcpID0+XHJcbiAgICAgIHRoaXMucmVxdWVzdDxVc2VyPihcIlBPU1RcIiwgXCIvYXV0aC9sb2dpblwiLCB7IGVtYWlsLCBwYXNzd29yZCB9KSxcclxuICAgIGxvZ291dDogKCkgPT4gdGhpcy5yZXF1ZXN0Vm9pZChcIlBPU1RcIiwgXCIvYXV0aC9sb2dvdXRcIiksXHJcbiAgICBtZTogKCkgPT4gdGhpcy5yZXF1ZXN0PFVzZXI+KFwiR0VUXCIsIFwiL2F1dGgvbWVcIiksXHJcbiAgfTtcclxuXHJcbiAgc3RhdGUgPSAoKTogUHJvbWlzZTxSZXN1bHQ8U3RhdGVEdG8sIERvbWFpbkVycm9yPj4gPT5cclxuICAgIHRoaXMucmVxdWVzdDxTdGF0ZUR0bz4oXCJHRVRcIiwgXCIvc3RhdGVcIik7XHJcblxyXG4gIHNlc3Npb25zID0ge1xyXG4gICAgY3JlYXRlOiAoZHJhZnQ6IFNlc3Npb25EcmFmdCkgPT5cclxuICAgICAgdGhpcy5yZXF1ZXN0PFdvcmtvdXRTZXNzaW9uPihcIlBPU1RcIiwgXCIvc2Vzc2lvbnNcIiwgZHJhZnQpLFxyXG4gICAgdXBkYXRlOiAoaWQ6IHN0cmluZywgZHJhZnQ6IFNlc3Npb25EcmFmdCkgPT5cclxuICAgICAgdGhpcy5yZXF1ZXN0PFdvcmtvdXRTZXNzaW9uPihcIlBVVFwiLCBgL3Nlc3Npb25zLyR7aWR9YCwgZHJhZnQpLFxyXG4gICAgcmVtb3ZlOiAoaWQ6IHN0cmluZykgPT4gdGhpcy5yZXF1ZXN0PFVuZG9EdG8+KFwiREVMRVRFXCIsIGAvc2Vzc2lvbnMvJHtpZH1gKSxcclxuICAgIHJlc3RvcmU6ICh1bmRvVG9rZW46IHN0cmluZykgPT5cclxuICAgICAgdGhpcy5yZXF1ZXN0Vm9pZChcIlBPU1RcIiwgXCIvc2Vzc2lvbnMvcmVzdG9yZVwiLCB7IHVuZG9Ub2tlbiB9KSxcclxuICB9O1xyXG5cclxuICBib29raW5ncyA9IHtcclxuICAgIGNyZWF0ZTogKHNlc3Npb25JZDogc3RyaW5nKSA9PlxyXG4gICAgICB0aGlzLnJlcXVlc3Q8Qm9va2luZz4oXCJQT1NUXCIsIFwiL2Jvb2tpbmdzXCIsIHsgc2Vzc2lvbklkIH0pLFxyXG4gICAgY2FuY2VsOiAoaWQ6IHN0cmluZykgPT4gdGhpcy5yZXF1ZXN0PEJvb2tpbmc+KFwiREVMRVRFXCIsIGAvYm9va2luZ3MvJHtpZH1gKSxcclxuICB9O1xyXG5cclxuICB1c2VycyA9IHtcclxuICAgIHVwZGF0ZTogKGlkOiBzdHJpbmcsIHBhdGNoOiBVc2VyUGF0Y2gpID0+XHJcbiAgICAgIHRoaXMucmVxdWVzdDxVc2VyPihcIlBVVFwiLCBgL3VzZXJzLyR7aWR9YCwgcGF0Y2gpLFxyXG4gICAgcmVtb3ZlOiAoaWQ6IHN0cmluZykgPT4gdGhpcy5yZXF1ZXN0PFVuZG9EdG8+KFwiREVMRVRFXCIsIGAvdXNlcnMvJHtpZH1gKSxcclxuICAgIHJlc3RvcmU6ICh1bmRvVG9rZW46IHN0cmluZykgPT5cclxuICAgICAgdGhpcy5yZXF1ZXN0Vm9pZChcIlBPU1RcIiwgXCIvdXNlcnMvcmVzdG9yZVwiLCB7IHVuZG9Ub2tlbiB9KSxcclxuICB9O1xyXG5cclxuICBwcml2YXRlIGFzeW5jIHNlbmQoXHJcbiAgICBtZXRob2Q6IHN0cmluZyxcclxuICAgIHBhdGg6IHN0cmluZyxcclxuICAgIGJvZHk/OiB1bmtub3duLFxyXG4gICk6IFByb21pc2U8UmVzdWx0PHVua25vd24sIERvbWFpbkVycm9yPj4ge1xyXG4gICAgbGV0IHJlc3BvbnNlOiBSZXNwb25zZTtcclxuICAgIHRyeSB7XHJcbiAgICAgIHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godGhpcy5iYXNlICsgcGF0aCwge1xyXG4gICAgICAgIG1ldGhvZCxcclxuICAgICAgICBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsXHJcbiAgICAgICAgaGVhZGVyczpcclxuICAgICAgICAgIGJvZHkgPT09IHVuZGVmaW5lZFxyXG4gICAgICAgICAgICA/IHVuZGVmaW5lZFxyXG4gICAgICAgICAgICA6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcclxuICAgICAgICBib2R5OiBib2R5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBKU09OLnN0cmluZ2lmeShib2R5KSxcclxuICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgLy8gXHUwNDE1XHUwNDM0XHUwNDM4XHUwNDNEXHUwNDQxXHUwNDQyXHUwNDMyXHUwNDM1XHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM5IFx1MDQ0N1x1MDQzNVx1MDQ0MVx1MDQ0Mlx1MDQzRFx1MDQ0Qlx1MDQzOSBcdTA0NDJcdTA0NDBcdTA0MzhcdTA0MzNcdTA0MzNcdTA0MzVcdTA0NDAgXHUwMEFCXHUwNDIxXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDM1XHUwNDQwIFx1MDQzRFx1MDQzNVx1MDQzNFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0M1x1MDQzRlx1MDQzNVx1MDQzRFx1MDBCQiBcdTIwMTQgXHUwNDNEXHUwNDM1XHUwNDQyIFx1MDQ0MVx1MDQzNVx1MDQ0Mlx1MDQzNVx1MDQzMlx1MDQzRVx1MDQzM1x1MDQzRSBcdTA0M0VcdTA0NDJcdTA0MzJcdTA0MzVcdTA0NDJcdTA0MzAuXHJcbiAgICAgIHJldHVybiBmYWlsKHsgY29kZTogXCJuZXR3b3JrXCIsIG1lc3NhZ2U6IFwiXHUwNDIxXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDM1XHUwNDQwIFx1MDQzRFx1MDQzNVx1MDQzNFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0M1x1MDQzRlx1MDQzNVx1MDQzRFwiIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDIwNCkgcmV0dXJuIG9rKG51bGwpO1xyXG5cclxuICAgIC8vIDIwMCwgXHUwNDNEXHUwNDNFIFx1MDQ0Mlx1MDQzNVx1MDQzQlx1MDQzRSBcdTA0M0RcdTA0MzUgSlNPTiBcdTIwMTQgXHUwNDREXHUwNDQyXHUwNDNFIFx1MDQzRVx1MDQ0OFx1MDQzOFx1MDQzMVx1MDQzQVx1MDQzMCBcdTA0M0FcdTA0M0VcdTA0M0RcdTA0NDJcdTA0NDBcdTA0MzBcdTA0M0FcdTA0NDJcdTA0MzAsIFx1MDQxRFx1MDQxNSBcdTA0NDNcdTA0NDFcdTA0M0ZcdTA0MzVcdTA0NDUgXHUwNDM4IFx1MDQxRFx1MDQxNSBcdTA0M0VcdTA0NDRcdTA0M0JcdTA0MzBcdTA0MzlcdTA0M0QuXHJcbiAgICBsZXQgcGF5bG9hZDogdW5rbm93bjtcclxuICAgIHRyeSB7XHJcbiAgICAgIHBheWxvYWQgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgcmV0dXJuIGZhaWwoe1xyXG4gICAgICAgIGNvZGU6IFwiY29udHJhY3RcIixcclxuICAgICAgICBtZXNzYWdlOiBgXHUwNDFEXHUwNDM1XHUwNDNBXHUwNDNFXHUwNDQwXHUwNDQwXHUwNDM1XHUwNDNBXHUwNDQyXHUwNDNEXHUwNDRCXHUwNDM5IFx1MDQzRVx1MDQ0Mlx1MDQzMlx1MDQzNVx1MDQ0MiBcdTA0NDFcdTA0MzVcdTA0NDBcdTA0MzJcdTA0MzVcdTA0NDBcdTA0MzAgKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XHJcbiAgICAgIC8vIFx1MDQxRlx1MDQ0MFx1MDQzRVx1MDQzMVx1MDQ0MFx1MDQzMFx1MDQ0MVx1MDQ0Qlx1MDQzMlx1MDQzMFx1MDQzNVx1MDQzQyBcdTA0MzRcdTA0M0VcdTA0M0NcdTA0MzVcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzkgZXJyb3IgXHUwNDM4XHUwNDM3IFx1MDQ0Mlx1MDQzNVx1MDQzQlx1MDQzMCBcdTA0M0FcdTA0MzBcdTA0M0EgXHUwNDM1XHUwNDQxXHUwNDQyXHUwNDRDOyBGYXN0QVBJIHtcImRldGFpbFwifSBcdTA0M0NcdTA0MzBcdTA0M0ZcdTA0M0ZcdTA0MzhcdTA0M0MgXHUwNDMyICdzZXJ2ZXInLFxyXG4gICAgICAvLyBcdTA0MURcdTA0MThcdTA0MUFcdTA0MUVcdTA0MTNcdTA0MTRcdTA0MTAgXHUwNDNEXHUwNDM1IFx1MDQzMiAnbmV0d29yaycgXHUyMDE0IFx1MDQ0MVx1MDQzNVx1MDQ0MFx1MDQzMlx1MDQzNVx1MDQ0MCBcdTA0M0VcdTA0NDJcdTA0MzJcdTA0MzVcdTA0NDJcdTA0MzhcdTA0M0IsIFx1MDQzRVx1MDQzRCBcdTA0MzZcdTA0MzhcdTA0MzIuXHJcbiAgICAgIGNvbnN0IGVyciA9IChwYXlsb2FkIGFzIHsgZXJyb3I/OiBEb21haW5FcnJvciB9IHwgbnVsbCk/LmVycm9yO1xyXG4gICAgICBpZiAoZXJyKSByZXR1cm4gZmFpbChlcnIpO1xyXG4gICAgICBjb25zdCBkZXRhaWwgPSAocGF5bG9hZCBhcyB7IGRldGFpbD86IHVua25vd24gfSB8IG51bGwpPy5kZXRhaWw7XHJcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPVxyXG4gICAgICAgIHR5cGVvZiBkZXRhaWwgPT09IFwic3RyaW5nXCJcclxuICAgICAgICAgID8gZGV0YWlsXHJcbiAgICAgICAgICA6IGBcdTA0MUVcdTA0NDhcdTA0MzhcdTA0MzFcdTA0M0FcdTA0MzAgXHUwNDQxXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDMwICgke3Jlc3BvbnNlLnN0YXR1c30pYDtcclxuICAgICAgcmV0dXJuIGZhaWwoe1xyXG4gICAgICAgIGNvZGU6IHJlc3BvbnNlLnN0YXR1cyA9PT0gNDAxID8gXCJ1bmF1dGhvcml6ZWRcIiA6IFwic2VydmVyXCIsXHJcbiAgICAgICAgbWVzc2FnZSxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG9rKHBheWxvYWQpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZXF1ZXN0PFQ+KFxyXG4gICAgbWV0aG9kOiBzdHJpbmcsXHJcbiAgICBwYXRoOiBzdHJpbmcsXHJcbiAgICBib2R5PzogdW5rbm93bixcclxuICApOiBQcm9taXNlPFJlc3VsdDxULCBEb21haW5FcnJvcj4+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLnNlbmQobWV0aG9kLCBwYXRoLCBib2R5KTtcclxuICAgIHJldHVybiByLm9rID8gb2soci52YWx1ZSBhcyBUKSA6IHI7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlcXVlc3RWb2lkKFxyXG4gICAgbWV0aG9kOiBzdHJpbmcsXHJcbiAgICBwYXRoOiBzdHJpbmcsXHJcbiAgICBib2R5PzogdW5rbm93bixcclxuICApOiBQcm9taXNlPFJlc3VsdDx2b2lkLCBEb21haW5FcnJvcj4+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLnNlbmQobWV0aG9kLCBwYXRoLCBib2R5KTtcclxuICAgIHJldHVybiByLm9rID8gb2sodW5kZWZpbmVkKSA6IHI7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgdHlwZSB7IERvbWFpbkVycm9yIH0gZnJvbSBcIi4vZXJyb3JzXCI7XHJcbmltcG9ydCB7IGZhaWwsIG9rLCB0eXBlIFJlc3VsdCB9IGZyb20gXCIuL3Jlc3VsdFwiO1xyXG5pbXBvcnQgdHlwZSB7XHJcbiAgQm9va2luZyxcclxuICBSZXBvcnQsXHJcbiAgU2NoZWR1bGVGaWx0ZXJzLFxyXG4gIFNlc3Npb25EcmFmdCxcclxuICBUaW1lT2ZEYXksXHJcbiAgVXNlcixcclxuICBXb3Jrb3V0S2luZCxcclxuICBXb3Jrb3V0U2Vzc2lvbixcclxufSBmcm9tIFwiLi90eXBlc1wiO1xyXG5cclxuZXhwb3J0IGNvbnN0IE1JTlVURV9NUyA9IDYwXzAwMDtcclxuXHJcbmV4cG9ydCBjb25zdCBzZXNzaW9uRW5kc0F0ID0gKHM6IFdvcmtvdXRTZXNzaW9uKTogbnVtYmVyID0+XHJcbiAgRGF0ZS5wYXJzZShzLnN0YXJ0c0F0KSArIHMuZHVyYXRpb25NaW4gKiBNSU5VVEVfTVM7XHJcbmV4cG9ydCBjb25zdCBoYXNTdGFydGVkID0gKHM6IFdvcmtvdXRTZXNzaW9uLCBub3c6IERhdGUpOiBib29sZWFuID0+XHJcbiAgRGF0ZS5wYXJzZShzLnN0YXJ0c0F0KSA8PSBub3cuZ2V0VGltZSgpO1xyXG5leHBvcnQgY29uc3QgaXNGaW5pc2hlZCA9IChzOiBXb3Jrb3V0U2Vzc2lvbiwgbm93OiBEYXRlKTogYm9vbGVhbiA9PlxyXG4gIHNlc3Npb25FbmRzQXQocykgPCBub3cuZ2V0VGltZSgpO1xyXG5cclxuY29uc3QgcGFkID0gKG46IG51bWJlcik6IHN0cmluZyA9PiBTdHJpbmcobikucGFkU3RhcnQoMiwgXCIwXCIpO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGRheUtleSh2YWx1ZTogRGF0ZSB8IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgY29uc3QgZCA9IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiA/IG5ldyBEYXRlKHZhbHVlKSA6IHZhbHVlO1xyXG4gIHJldHVybiBgJHtkLmdldEZ1bGxZZWFyKCl9LSR7cGFkKGQuZ2V0TW9udGgoKSArIDEpfS0ke3BhZChkLmdldERhdGUoKSl9YDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGFkZERheXMoYmFzZTogRGF0ZSwgZGF5czogbnVtYmVyKTogRGF0ZSB7XHJcbiAgY29uc3QgZCA9IG5ldyBEYXRlKGJhc2UpO1xyXG4gIGQuc2V0SG91cnMoMCwgMCwgMCwgMCk7XHJcbiAgZC5zZXREYXRlKGQuZ2V0RGF0ZSgpICsgZGF5cyk7XHJcbiAgcmV0dXJuIGQ7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiB0aW1lQnVja2V0KGlzbzogc3RyaW5nKTogVGltZU9mRGF5IHtcclxuICBjb25zdCBoID0gbmV3IERhdGUoaXNvKS5nZXRIb3VycygpO1xyXG4gIGlmIChoIDwgMTIpIHJldHVybiBcIm1vcm5pbmdcIjtcclxuICBpZiAoaCA8IDE3KSByZXR1cm4gXCJkYXlcIjtcclxuICByZXR1cm4gXCJldmVuaW5nXCI7XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBzZWF0c1Rha2VuID0gKFxyXG4gIGJvb2tpbmdzOiByZWFkb25seSBCb29raW5nW10sXHJcbiAgc2Vzc2lvbklkOiBzdHJpbmcsXHJcbik6IG51bWJlciA9PiBib29raW5ncy5maWx0ZXIoKGIpID0+IGIuc2Vzc2lvbklkID09PSBzZXNzaW9uSWQpLmxlbmd0aDtcclxuXHJcbmV4cG9ydCBjb25zdCBzZWF0c0xlZnQgPSAoXHJcbiAgczogV29ya291dFNlc3Npb24sXHJcbiAgYm9va2luZ3M6IHJlYWRvbmx5IEJvb2tpbmdbXSxcclxuKTogbnVtYmVyID0+IHMuY2FwYWNpdHkgLSBzZWF0c1Rha2VuKGJvb2tpbmdzLCBzLmlkKTtcclxuXHJcbmV4cG9ydCBjb25zdCBib29raW5nT2YgPSAoXHJcbiAgYm9va2luZ3M6IHJlYWRvbmx5IEJvb2tpbmdbXSxcclxuICB1c2VySWQ6IHN0cmluZyxcclxuICBzZXNzaW9uSWQ6IHN0cmluZyxcclxuKTogQm9va2luZyB8IHVuZGVmaW5lZCA9PlxyXG4gIGJvb2tpbmdzLmZpbmQoKGIpID0+IGIudXNlcklkID09PSB1c2VySWQgJiYgYi5zZXNzaW9uSWQgPT09IHNlc3Npb25JZCk7XHJcblxyXG5leHBvcnQgY29uc3Qgb2NjdXBhbmN5UGN0ID0gKFxyXG4gIHM6IFdvcmtvdXRTZXNzaW9uLFxyXG4gIGJvb2tpbmdzOiByZWFkb25seSBCb29raW5nW10sXHJcbik6IG51bWJlciA9PlxyXG4gIHMuY2FwYWNpdHkgPT09IDBcclxuICAgID8gMFxyXG4gICAgOiBNYXRoLnJvdW5kKChzZWF0c1Rha2VuKGJvb2tpbmdzLCBzLmlkKSAvIHMuY2FwYWNpdHkpICogMTAwKTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBjaGVja0Jvb2thYmxlKFxyXG4gIHM6IFdvcmtvdXRTZXNzaW9uLFxyXG4gIGJvb2tpbmdzOiByZWFkb25seSBCb29raW5nW10sXHJcbiAgdXNlcklkOiBzdHJpbmcsXHJcbiAgbm93OiBEYXRlLFxyXG4pOiBSZXN1bHQ8dHJ1ZSwgRG9tYWluRXJyb3I+IHtcclxuICBpZiAoaGFzU3RhcnRlZChzLCBub3cpKSByZXR1cm4gZmFpbCh7IGNvZGU6IFwic2Vzc2lvbi1zdGFydGVkXCIgfSk7XHJcbiAgaWYgKGJvb2tpbmdPZihib29raW5ncywgdXNlcklkLCBzLmlkKSlcclxuICAgIHJldHVybiBmYWlsKHsgY29kZTogXCJhbHJlYWR5LWJvb2tlZFwiIH0pO1xyXG4gIGlmIChzZWF0c0xlZnQocywgYm9va2luZ3MpIDw9IDApIHJldHVybiBmYWlsKHsgY29kZTogXCJzZXNzaW9uLWZ1bGxcIiB9KTtcclxuICByZXR1cm4gb2sodHJ1ZSk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBmaWx0ZXJTZXNzaW9ucyhcclxuICBhbGw6IHJlYWRvbmx5IFdvcmtvdXRTZXNzaW9uW10sXHJcbiAgZjogU2NoZWR1bGVGaWx0ZXJzLFxyXG4gIG5vdzogRGF0ZSxcclxuKTogV29ya291dFNlc3Npb25bXSB7XHJcbiAgY29uc3Qga2V5ID0gZGF5S2V5KGFkZERheXMobm93LCBmLmRheU9mZnNldCkpO1xyXG4gIGNvbnN0IHEgPSBmLnF1ZXJ5LnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xyXG4gIHJldHVybiBhbGxcclxuICAgIC5maWx0ZXIoKHMpID0+IGRheUtleShzLnN0YXJ0c0F0KSA9PT0ga2V5KVxyXG4gICAgLmZpbHRlcigocykgPT4gZi5raW5kID09PSBcImFsbFwiIHx8IHMua2luZCA9PT0gZi5raW5kKVxyXG4gICAgLmZpbHRlcigocykgPT4gZi50aW1lID09PSBcImFsbFwiIHx8IHRpbWVCdWNrZXQocy5zdGFydHNBdCkgPT09IGYudGltZSlcclxuICAgIC5maWx0ZXIoXHJcbiAgICAgIChzKSA9PlxyXG4gICAgICAgICFxIHx8IGAke3MudGl0bGV9ICR7cy50cmFpbmVyfSAke3Mucm9vbX1gLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocSksXHJcbiAgICApO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gc29ydFNlc3Npb25zKFxyXG4gIGxpc3Q6IHJlYWRvbmx5IFdvcmtvdXRTZXNzaW9uW10sXHJcbiAgbW9kZTogU2NoZWR1bGVGaWx0ZXJzW1wic29ydFwiXSxcclxuICBib29raW5nczogcmVhZG9ubHkgQm9va2luZ1tdLFxyXG4pOiBXb3Jrb3V0U2Vzc2lvbltdIHtcclxuICByZXR1cm4gWy4uLmxpc3RdLnNvcnQoKGEsIGIpID0+XHJcbiAgICBtb2RlID09PSBcInNlYXRzXCJcclxuICAgICAgPyBzZWF0c0xlZnQoYiwgYm9va2luZ3MpIC0gc2VhdHNMZWZ0KGEsIGJvb2tpbmdzKSB8fFxyXG4gICAgICAgIGEuc3RhcnRzQXQubG9jYWxlQ29tcGFyZShiLnN0YXJ0c0F0KVxyXG4gICAgICA6IGEuc3RhcnRzQXQubG9jYWxlQ29tcGFyZShiLnN0YXJ0c0F0KSxcclxuICApO1xyXG59XHJcblxyXG5jb25zdCBFTUFJTF9SRSA9IC9eW15cXHNAXStAW15cXHNAXStcXC5bXlxcc0BdezIsfSQvO1xyXG5leHBvcnQgY29uc3QgaXNWYWxpZEVtYWlsID0gKGVtYWlsOiBzdHJpbmcpOiBib29sZWFuID0+IEVNQUlMX1JFLnRlc3QoZW1haWwpO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlUmVnaXN0cmF0aW9uKFxyXG4gIG5hbWU6IHN0cmluZyxcclxuICBlbWFpbDogc3RyaW5nLFxyXG4gIHBhc3N3b3JkOiBzdHJpbmcsXHJcbik6IFJlc3VsdDx0cnVlLCBEb21haW5FcnJvcj4ge1xyXG4gIGlmIChuYW1lLnRyaW0oKS5sZW5ndGggPCAyKVxyXG4gICAgcmV0dXJuIGZhaWwoe1xyXG4gICAgICBjb2RlOiBcInZhbGlkYXRpb25cIixcclxuICAgICAgbWVzc2FnZTogXCJcdTA0MjNcdTA0M0FcdTA0MzBcdTA0MzZcdTA0MzhcdTA0NDJcdTA0MzUgXHUwNDM4XHUwNDNDXHUwNDRGIChcdTA0M0NcdTA0MzhcdTA0M0RcdTA0MzhcdTA0M0NcdTA0NDNcdTA0M0MgMiBcdTA0NDFcdTA0MzhcdTA0M0NcdTA0MzJcdTA0M0VcdTA0M0JcdTA0MzApXCIsXHJcbiAgICB9KTtcclxuICBpZiAoIWlzVmFsaWRFbWFpbChlbWFpbC50cmltKCkpKVxyXG4gICAgcmV0dXJuIGZhaWwoeyBjb2RlOiBcInZhbGlkYXRpb25cIiwgbWVzc2FnZTogXCJcdTA0MURcdTA0MzVcdTA0M0FcdTA0M0VcdTA0NDBcdTA0NDBcdTA0MzVcdTA0M0FcdTA0NDJcdTA0M0RcdTA0NEJcdTA0MzkgZW1haWxcIiB9KTtcclxuICBpZiAocGFzc3dvcmQubGVuZ3RoIDwgNilcclxuICAgIHJldHVybiBmYWlsKHsgY29kZTogXCJ2YWxpZGF0aW9uXCIsIG1lc3NhZ2U6IFwiXHUwNDFGXHUwNDMwXHUwNDQwXHUwNDNFXHUwNDNCXHUwNDRDIFx1MjAxNCBcdTA0M0NcdTA0MzhcdTA0M0RcdTA0MzhcdTA0M0NcdTA0NDNcdTA0M0MgNiBcdTA0NDFcdTA0MzhcdTA0M0NcdTA0MzJcdTA0M0VcdTA0M0JcdTA0M0VcdTA0MzJcIiB9KTtcclxuICByZXR1cm4gb2sodHJ1ZSk7XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBkcmFmdFRvU3RhcnREYXRlID0gKGRyYWZ0OiBTZXNzaW9uRHJhZnQpOiBEYXRlID0+XHJcbiAgbmV3IERhdGUoYCR7ZHJhZnQuZGF0ZX1UJHtkcmFmdC50aW1lfWApO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlU2Vzc2lvbkRyYWZ0KFxyXG4gIGRyYWZ0OiBTZXNzaW9uRHJhZnQsXHJcbiAgbm93OiBEYXRlLFxyXG4gIG9wdHM6IHsgaXNOZXc6IGJvb2xlYW47IGJvb2tlZDogbnVtYmVyIH0sXHJcbik6IFJlc3VsdDx0cnVlLCBEb21haW5FcnJvcj4ge1xyXG4gIGlmICghZHJhZnQudGl0bGUudHJpbSgpIHx8ICFkcmFmdC50cmFpbmVyLnRyaW0oKSB8fCAhZHJhZnQucm9vbS50cmltKCkpIHtcclxuICAgIHJldHVybiBmYWlsKHtcclxuICAgICAgY29kZTogXCJ2YWxpZGF0aW9uXCIsXHJcbiAgICAgIG1lc3NhZ2U6IFwiXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDNEXHUwNDM4XHUwNDQyXHUwNDM1IFx1MDQzRFx1MDQzMFx1MDQzN1x1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQzNSwgXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM1XHUwNDQwXHUwNDMwIFx1MDQzOCBcdTA0MzdcdTA0MzBcdTA0M0JcIixcclxuICAgIH0pO1xyXG4gIH1cclxuICBjb25zdCBzdGFydCA9IGRyYWZ0VG9TdGFydERhdGUoZHJhZnQpO1xyXG4gIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQuZ2V0VGltZSgpKSlcclxuICAgIHJldHVybiBmYWlsKHsgY29kZTogXCJ2YWxpZGF0aW9uXCIsIG1lc3NhZ2U6IFwiXHUwNDFEXHUwNDM1XHUwNDNBXHUwNDNFXHUwNDQwXHUwNDQwXHUwNDM1XHUwNDNBXHUwNDQyXHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQzNFx1MDQzMFx1MDQ0Mlx1MDQzMCBcdTA0MzhcdTA0M0JcdTA0MzggXHUwNDMyXHUwNDQwXHUwNDM1XHUwNDNDXHUwNDRGXCIgfSk7XHJcbiAgaWYgKG9wdHMuaXNOZXcgJiYgc3RhcnQuZ2V0VGltZSgpIDw9IG5vdy5nZXRUaW1lKCkpXHJcbiAgICByZXR1cm4gZmFpbCh7XHJcbiAgICAgIGNvZGU6IFwidmFsaWRhdGlvblwiLFxyXG4gICAgICBtZXNzYWdlOiBcIlx1MDQxRFx1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0RiBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0MzAgXHUwNDM0XHUwNDNFXHUwNDNCXHUwNDM2XHUwNDNEXHUwNDMwIFx1MDQzMVx1MDQ0Qlx1MDQ0Mlx1MDQ0QyBcdTA0MzIgXHUwNDMxXHUwNDQzXHUwNDM0XHUwNDQzXHUwNDQ5XHUwNDM1XHUwNDNDXCIsXHJcbiAgICB9KTtcclxuICBpZiAoXHJcbiAgICAhTnVtYmVyLmlzSW50ZWdlcihkcmFmdC5kdXJhdGlvbk1pbikgfHxcclxuICAgIGRyYWZ0LmR1cmF0aW9uTWluIDwgMTUgfHxcclxuICAgIGRyYWZ0LmR1cmF0aW9uTWluID4gMTgwXHJcbiAgKSB7XHJcbiAgICByZXR1cm4gZmFpbCh7XHJcbiAgICAgIGNvZGU6IFwidmFsaWRhdGlvblwiLFxyXG4gICAgICBtZXNzYWdlOiBcIlx1MDQxNFx1MDQzQlx1MDQzOFx1MDQ0Mlx1MDQzNVx1MDQzQlx1MDQ0Q1x1MDQzRFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0QyBcdTIwMTQgXHUwNDNFXHUwNDQyIDE1IFx1MDQzNFx1MDQzRSAxODAgXHUwNDNDXHUwNDM4XHUwNDNEXHUwNDQzXHUwNDQyXCIsXHJcbiAgICB9KTtcclxuICB9XHJcbiAgaWYgKFxyXG4gICAgIU51bWJlci5pc0ludGVnZXIoZHJhZnQuY2FwYWNpdHkpIHx8XHJcbiAgICBkcmFmdC5jYXBhY2l0eSA8IDEgfHxcclxuICAgIGRyYWZ0LmNhcGFjaXR5ID4gMTAwXHJcbiAgKSB7XHJcbiAgICByZXR1cm4gZmFpbCh7XHJcbiAgICAgIGNvZGU6IFwidmFsaWRhdGlvblwiLFxyXG4gICAgICBtZXNzYWdlOiBcIlx1MDQxMlx1MDQzQ1x1MDQzNVx1MDQ0MVx1MDQ0Mlx1MDQzOFx1MDQzQ1x1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0QyBcdTIwMTQgXHUwNDNFXHUwNDQyIDEgXHUwNDM0XHUwNDNFIDEwMCBcdTA0M0NcdTA0MzVcdTA0NDFcdTA0NDJcIixcclxuICAgIH0pO1xyXG4gIH1cclxuICBpZiAoZHJhZnQuY2FwYWNpdHkgPCBvcHRzLmJvb2tlZCkge1xyXG4gICAgcmV0dXJuIGZhaWwoe1xyXG4gICAgICBjb2RlOiBcImNhcGFjaXR5LWJlbG93LWJvb2tlZFwiLFxyXG4gICAgICBtZXNzYWdlOiBgXHUwNDIzXHUwNDM2XHUwNDM1IFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzMFx1MDQzRFx1MDQzRSAke29wdHMuYm9va2VkfSBcdTIwMTQgXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDRDXHUwNDQ4XHUwNDQzXHUwNDRFIFx1MDQzMlx1MDQzQ1x1MDQzNVx1MDQ0MVx1MDQ0Mlx1MDQzOFx1MDQzQ1x1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0QyBcdTA0MzdcdTA0MzBcdTA0MzRcdTA0MzBcdTA0NDJcdTA0NEMgXHUwNDNEXHUwNDM1XHUwNDNCXHUwNDRDXHUwNDM3XHUwNDRGYCxcclxuICAgIH0pO1xyXG4gIH1cclxuICByZXR1cm4gb2sodHJ1ZSk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBidWlsZFJlcG9ydChcclxuICBzZXNzaW9uczogcmVhZG9ubHkgV29ya291dFNlc3Npb25bXSxcclxuICBib29raW5nczogcmVhZG9ubHkgQm9va2luZ1tdLFxyXG4gIHVzZXJzOiByZWFkb25seSBVc2VyW10sXHJcbik6IFJlcG9ydCB7XHJcbiAgY29uc3Qgc29ydGVkID0gWy4uLnNlc3Npb25zXS5zb3J0KChhLCBiKSA9PlxyXG4gICAgYS5zdGFydHNBdC5sb2NhbGVDb21wYXJlKGIuc3RhcnRzQXQpLFxyXG4gICk7XHJcbiAgY29uc3Qgcm93cyA9IHNvcnRlZC5tYXAoKHMpID0+ICh7XHJcbiAgICBzZXNzaW9uOiBzLFxyXG4gICAgYm9va2VkOiBzZWF0c1Rha2VuKGJvb2tpbmdzLCBzLmlkKSxcclxuICAgIG9jY3VwYW5jeTogb2NjdXBhbmN5UGN0KHMsIGJvb2tpbmdzKSxcclxuICB9KSk7XHJcbiAgY29uc3QgY2FwID0gc29ydGVkLnJlZHVjZSgobiwgcykgPT4gbiArIHMuY2FwYWNpdHksIDApO1xyXG4gIGNvbnN0IHRvdGFsID0gYm9va2luZ3MubGVuZ3RoO1xyXG4gIGNvbnN0IGtpbmRPZiA9IG5ldyBNYXAoc29ydGVkLm1hcCgocykgPT4gW3MuaWQsIHMua2luZF0pKTtcclxuICBjb25zdCBieUtpbmQgPSBuZXcgTWFwPFdvcmtvdXRLaW5kLCBudW1iZXI+KCk7XHJcbiAgZm9yIChjb25zdCBiIG9mIGJvb2tpbmdzKSB7XHJcbiAgICBjb25zdCBrID0ga2luZE9mLmdldChiLnNlc3Npb25JZCk7XHJcbiAgICBpZiAoaykgYnlLaW5kLnNldChrLCAoYnlLaW5kLmdldChrKSA/PyAwKSArIDEpO1xyXG4gIH1cclxuICBsZXQgdG9wS2luZDogV29ya291dEtpbmQgfCBudWxsID0gbnVsbDtcclxuICBsZXQgdG9wID0gMDtcclxuICBmb3IgKGNvbnN0IFtrLCBuXSBvZiBieUtpbmQpXHJcbiAgICBpZiAobiA+IHRvcCkge1xyXG4gICAgICB0b3AgPSBuO1xyXG4gICAgICB0b3BLaW5kID0gaztcclxuICAgIH1cclxuICByZXR1cm4ge1xyXG4gICAgcm93cyxcclxuICAgIHRvdGFsU2Vzc2lvbnM6IHNvcnRlZC5sZW5ndGgsXHJcbiAgICB0b3RhbEJvb2tpbmdzOiB0b3RhbCxcclxuICAgIGFjdGl2ZUNsaWVudHM6IHVzZXJzLmZpbHRlcigodSkgPT4gdS5yb2xlID09PSBcImNsaWVudFwiKS5sZW5ndGgsXHJcbiAgICBvY2N1cGFuY3k6IGNhcCA/IE1hdGgucm91bmQoKHRvdGFsIC8gY2FwKSAqIDEwMCkgOiAwLFxyXG4gICAgdG9wS2luZCxcclxuICB9O1xyXG59XHJcbiIsICJpbXBvcnQgdHlwZSB7IEFwaSB9IGZyb20gXCIuLi9hcGkvY2xpZW50XCI7XHJcbmltcG9ydCB0eXBlIHsgRG9tYWluRXJyb3IgfSBmcm9tIFwiLi4vY29yZS9lcnJvcnNcIjtcclxuaW1wb3J0IHsgZmFpbCwgb2ssIHR5cGUgUmVzdWx0IH0gZnJvbSBcIi4uL2NvcmUvcmVzdWx0XCI7XHJcbmltcG9ydCB7IGNoZWNrQm9va2FibGUgfSBmcm9tIFwiLi4vY29yZS9ydWxlc1wiO1xyXG5pbXBvcnQgdHlwZSB7XHJcbiAgQm9va2luZyxcclxuICBTZXNzaW9uRHJhZnQsXHJcbiAgVXNlcixcclxuICBVc2VyUGF0Y2gsXHJcbiAgV29ya291dFNlc3Npb24sXHJcbn0gZnJvbSBcIi4uL2NvcmUvdHlwZXNcIjtcclxuaW1wb3J0IHR5cGUgeyBBcHBTdGF0ZSB9IGZyb20gXCIuLi9zdGF0ZS9hcHAtc3RhdGVcIjtcclxuXHJcbmV4cG9ydCBjbGFzcyBSZW1vdGVBdXRoIHtcclxuICBjb25zdHJ1Y3RvcihcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgYXBpOiBBcGksXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHN0YXRlOiBBcHBTdGF0ZSxcclxuICApIHt9XHJcbiAgY3VycmVudFVzZXIoKTogVXNlciB8IG51bGwge1xyXG4gICAgcmV0dXJuIHRoaXMuc3RhdGUubWU7XHJcbiAgfVxyXG5cclxuICBhc3luYyBsb2dpbihcclxuICAgIGVtYWlsOiBzdHJpbmcsXHJcbiAgICBwYXNzd29yZDogc3RyaW5nLFxyXG4gICk6IFByb21pc2U8UmVzdWx0PFVzZXIsIERvbWFpbkVycm9yPj4ge1xyXG4gICAgY29uc3QgciA9IGF3YWl0IHRoaXMuYXBpLmF1dGgubG9naW4oZW1haWwsIHBhc3N3b3JkKTtcclxuICAgIGlmICghci5vaykgcmV0dXJuIHI7XHJcbiAgICBhd2FpdCB0aGlzLnN0YXRlLnJlZnJlc2goKTtcclxuICAgIHRoaXMuc3RhdGUuc2V0TWUoci52YWx1ZSk7XHJcbiAgICByZXR1cm4gcjtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlZ2lzdGVyKFxyXG4gICAgbmFtZTogc3RyaW5nLFxyXG4gICAgZW1haWw6IHN0cmluZyxcclxuICAgIHBhc3N3b3JkOiBzdHJpbmcsXHJcbiAgKTogUHJvbWlzZTxSZXN1bHQ8VXNlciwgRG9tYWluRXJyb3I+PiB7XHJcbiAgICBjb25zdCByID0gYXdhaXQgdGhpcy5hcGkuYXV0aC5yZWdpc3RlcihuYW1lLCBlbWFpbCwgcGFzc3dvcmQpO1xyXG4gICAgaWYgKCFyLm9rKSByZXR1cm4gcjtcclxuICAgIGF3YWl0IHRoaXMuc3RhdGUucmVmcmVzaCgpO1xyXG4gICAgdGhpcy5zdGF0ZS5zZXRNZShyLnZhbHVlKTtcclxuICAgIHJldHVybiByO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgbG9nb3V0KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgYXdhaXQgdGhpcy5hcGkuYXV0aC5sb2dvdXQoKTtcclxuICAgIHRoaXMuc3RhdGUuc2V0TWUobnVsbCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyByZXN0b3JlU2Vzc2lvbigpOiBQcm9taXNlPFJlc3VsdDxVc2VyLCBEb21haW5FcnJvcj4+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmFwaS5hdXRoLm1lKCk7XHJcbiAgICBpZiAoIXIub2spIHJldHVybiByO1xyXG4gICAgYXdhaXQgdGhpcy5zdGF0ZS5yZWZyZXNoKCk7XHJcbiAgICB0aGlzLnN0YXRlLnNldE1lKHIudmFsdWUpO1xyXG4gICAgcmV0dXJuIHI7XHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgUmVtb3RlQm9va2luZyB7XHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFwaTogQXBpLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBzdGF0ZTogQXBwU3RhdGUsXHJcbiAgKSB7fVxyXG5cclxuICBhc3luYyBib29rKHNlc3Npb25JZDogc3RyaW5nKTogUHJvbWlzZTxSZXN1bHQ8Qm9va2luZywgRG9tYWluRXJyb3I+PiB7XHJcbiAgICBjb25zdCBtZSA9IHRoaXMuc3RhdGUubWU7XHJcbiAgICBpZiAoIW1lKSByZXR1cm4gZmFpbCh7IGNvZGU6IFwiZm9yYmlkZGVuXCIgfSk7XHJcbiAgICBjb25zdCBzZXNzaW9uID0gdGhpcy5zdGF0ZS5zZXNzaW9uQnlJZChzZXNzaW9uSWQpO1xyXG4gICAgaWYgKCFzZXNzaW9uKVxyXG4gICAgICByZXR1cm4gZmFpbCh7IGNvZGU6IFwibm90LWZvdW5kXCIsIG1lc3NhZ2U6IFwiXHUwNDIyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDMwIFx1MDQzRFx1MDQzNSBcdTA0M0RcdTA0MzBcdTA0MzlcdTA0MzRcdTA0MzVcdTA0M0RcdTA0MzBcIiB9KTtcclxuICAgIGNvbnN0IGNoZWNrID0gY2hlY2tCb29rYWJsZShcclxuICAgICAgc2Vzc2lvbixcclxuICAgICAgdGhpcy5zdGF0ZS5hbGxCb29raW5ncygpLFxyXG4gICAgICBtZS5pZCxcclxuICAgICAgbmV3IERhdGUoKSxcclxuICAgICk7XHJcbiAgICBpZiAoIWNoZWNrLm9rKSByZXR1cm4gY2hlY2s7XHJcbiAgICBjb25zdCB0ZW1wOiBCb29raW5nID0ge1xyXG4gICAgICBpZDogYHRtcC0ke0RhdGUubm93KCl9YCxcclxuICAgICAgdXNlcklkOiBtZS5pZCxcclxuICAgICAgc2Vzc2lvbklkLFxyXG4gICAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgIH07XHJcbiAgICB0aGlzLnN0YXRlLmFkZEJvb2tpbmcodGVtcCk7XHJcbiAgICBjb25zdCByID0gYXdhaXQgdGhpcy5hcGkuYm9va2luZ3MuY3JlYXRlKHNlc3Npb25JZCk7XHJcbiAgICBpZiAoIXIub2spIHtcclxuICAgICAgdGhpcy5zdGF0ZS5yZW1vdmVCb29raW5nKHRlbXAuaWQpO1xyXG4gICAgICByZXR1cm4gcjtcclxuICAgIH1cclxuICAgIHRoaXMuc3RhdGUucmVwbGFjZUJvb2tpbmcodGVtcC5pZCwgci52YWx1ZSk7XHJcbiAgICByZXR1cm4gcjtcclxuICB9XHJcblxyXG4gIGFzeW5jIGNhbmNlbChib29raW5nSWQ6IHN0cmluZyk6IFByb21pc2U8UmVzdWx0PEJvb2tpbmcsIERvbWFpbkVycm9yPj4ge1xyXG4gICAgY29uc3Qgc25hcHNob3QgPSB0aGlzLnN0YXRlLmJvb2tpbmdCeUlkKGJvb2tpbmdJZCk7XHJcbiAgICBpZiAoc25hcHNob3QpIHRoaXMuc3RhdGUucmVtb3ZlQm9va2luZyhib29raW5nSWQpO1xyXG4gICAgY29uc3QgciA9IGF3YWl0IHRoaXMuYXBpLmJvb2tpbmdzLmNhbmNlbChib29raW5nSWQpO1xyXG4gICAgaWYgKCFyLm9rICYmIHNuYXBzaG90KSB0aGlzLnN0YXRlLmFkZEJvb2tpbmcoc25hcHNob3QpO1xyXG4gICAgcmV0dXJuIHI7XHJcbiAgfVxyXG5cclxuICBhc3luYyByZXN0b3JlKGJvb2tpbmc6IEJvb2tpbmcpOiBQcm9taXNlPFJlc3VsdDxCb29raW5nLCBEb21haW5FcnJvcj4+IHtcclxuICAgIHJldHVybiB0aGlzLmJvb2soYm9va2luZy5zZXNzaW9uSWQpO1xyXG4gIH1cclxuXHJcbiAgb2ZDdXJyZW50VXNlcigpOiBCb29raW5nW10ge1xyXG4gICAgY29uc3QgbWUgPSB0aGlzLnN0YXRlLm1lO1xyXG4gICAgcmV0dXJuIG1lID8gdGhpcy5zdGF0ZS5hbGxCb29raW5ncygpLmZpbHRlcigoYikgPT4gYi51c2VySWQgPT09IG1lLmlkKSA6IFtdO1xyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIFJlbW90ZUNhdGFsb2cge1xyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBhcGk6IEFwaSxcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgc3RhdGU6IEFwcFN0YXRlLFxyXG4gICkge31cclxuXHJcbiAgYXN5bmMgY3JlYXRlKFxyXG4gICAgZHJhZnQ6IFNlc3Npb25EcmFmdCxcclxuICApOiBQcm9taXNlPFJlc3VsdDxXb3Jrb3V0U2Vzc2lvbiwgRG9tYWluRXJyb3I+PiB7XHJcbiAgICBjb25zdCByID0gYXdhaXQgdGhpcy5hcGkuc2Vzc2lvbnMuY3JlYXRlKGRyYWZ0KTtcclxuICAgIGlmIChyLm9rKSB0aGlzLnN0YXRlLnVwc2VydFNlc3Npb24oci52YWx1ZSk7XHJcbiAgICByZXR1cm4gcjtcclxuICB9XHJcblxyXG4gIGFzeW5jIHVwZGF0ZShcclxuICAgIGlkOiBzdHJpbmcsXHJcbiAgICBkcmFmdDogU2Vzc2lvbkRyYWZ0LFxyXG4gICk6IFByb21pc2U8UmVzdWx0PFdvcmtvdXRTZXNzaW9uLCBEb21haW5FcnJvcj4+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmFwaS5zZXNzaW9ucy51cGRhdGUoaWQsIGRyYWZ0KTtcclxuICAgIGlmIChyLm9rKSB0aGlzLnN0YXRlLnVwc2VydFNlc3Npb24oci52YWx1ZSk7XHJcbiAgICByZXR1cm4gcjtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlbW92ZShcclxuICAgIGlkOiBzdHJpbmcsXHJcbiAgKTogUHJvbWlzZTxSZXN1bHQ8eyB1bmRvVG9rZW46IHN0cmluZyB9LCBEb21haW5FcnJvcj4+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmFwaS5zZXNzaW9ucy5yZW1vdmUoaWQpO1xyXG4gICAgaWYgKHIub2spIHRoaXMuc3RhdGUucmVtb3ZlU2Vzc2lvbihpZCk7XHJcbiAgICByZXR1cm4gcjtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlc3RvcmUodW5kb1Rva2VuOiBzdHJpbmcpOiBQcm9taXNlPFJlc3VsdDx2b2lkLCBEb21haW5FcnJvcj4+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmFwaS5zZXNzaW9ucy5yZXN0b3JlKHVuZG9Ub2tlbik7XHJcbiAgICBpZiAoci5vaykgYXdhaXQgdGhpcy5zdGF0ZS5yZWZyZXNoKCk7XHJcbiAgICByZXR1cm4gcjtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBSZW1vdGVBY2NvdW50cyB7XHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFwaTogQXBpLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBzdGF0ZTogQXBwU3RhdGUsXHJcbiAgKSB7fVxyXG5cclxuICBhc3luYyB1cGRhdGUoXHJcbiAgICBpZDogc3RyaW5nLFxyXG4gICAgcGF0Y2g6IFVzZXJQYXRjaCxcclxuICApOiBQcm9taXNlPFJlc3VsdDxVc2VyLCBEb21haW5FcnJvcj4+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmFwaS51c2Vycy51cGRhdGUoaWQsIHBhdGNoKTtcclxuICAgIGlmIChyLm9rKSB0aGlzLnN0YXRlLnVwc2VydFVzZXIoci52YWx1ZSk7XHJcbiAgICByZXR1cm4gcjtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlbW92ZShcclxuICAgIGlkOiBzdHJpbmcsXHJcbiAgKTogUHJvbWlzZTxSZXN1bHQ8eyB1bmRvVG9rZW46IHN0cmluZyB9LCBEb21haW5FcnJvcj4+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmFwaS51c2Vycy5yZW1vdmUoaWQpO1xyXG4gICAgaWYgKHIub2spIHRoaXMuc3RhdGUucmVtb3ZlVXNlcihpZCk7XHJcbiAgICByZXR1cm4gcjtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlc3RvcmUodW5kb1Rva2VuOiBzdHJpbmcpOiBQcm9taXNlPFJlc3VsdDx2b2lkLCBEb21haW5FcnJvcj4+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmFwaS51c2Vycy5yZXN0b3JlKHVuZG9Ub2tlbik7XHJcbiAgICBpZiAoci5vaykgYXdhaXQgdGhpcy5zdGF0ZS5yZWZyZXNoKCk7XHJcbiAgICByZXR1cm4gcjtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBhc1Jlc3VsdCA9IG9rO1xyXG4iLCAiZXhwb3J0IHR5cGUgQ2hpbGQgPVxyXG4gIHwgTm9kZVxyXG4gIHwgc3RyaW5nXHJcbiAgfCBudW1iZXJcclxuICB8IG51bGxcclxuICB8IHVuZGVmaW5lZFxyXG4gIHwgZmFsc2VcclxuICB8IHJlYWRvbmx5IENoaWxkW107XHJcblxyXG50eXBlIEhhbmRsZXJzID0ge1xyXG4gIFtLIGluIGtleW9mIEhUTUxFbGVtZW50RXZlbnRNYXBdPzogKGV2ZW50OiBIVE1MRWxlbWVudEV2ZW50TWFwW0tdKSA9PiB2b2lkO1xyXG59O1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBQcm9wcyB7XHJcbiAgY2xhc3M/OiBzdHJpbmc7XHJcbiAgdGV4dD86IHN0cmluZztcclxuICBzdHlsZT86IHN0cmluZztcclxuICBhdHRycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+O1xyXG4gIGRhdGFzZXQ/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xyXG4gIG9uPzogSGFuZGxlcnM7XHJcbiAgdmFsdWU/OiBzdHJpbmc7XHJcbiAgY2hlY2tlZD86IGJvb2xlYW47XHJcbiAgZGlzYWJsZWQ/OiBib29sZWFuO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gaDxLIGV4dGVuZHMga2V5b2YgSFRNTEVsZW1lbnRUYWdOYW1lTWFwPihcclxuICB0YWc6IEssXHJcbiAgcHJvcHM6IFByb3BzID0ge30sXHJcbiAgLi4uY2hpbGRyZW46IENoaWxkW11cclxuKTogSFRNTEVsZW1lbnRUYWdOYW1lTWFwW0tdIHtcclxuICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnKTtcclxuICBpZiAocHJvcHMuY2xhc3MpIGVsLmNsYXNzTmFtZSA9IHByb3BzLmNsYXNzO1xyXG4gIGlmIChwcm9wcy50ZXh0ICE9PSB1bmRlZmluZWQpIGVsLnRleHRDb250ZW50ID0gcHJvcHMudGV4dDtcclxuICBpZiAocHJvcHMuc3R5bGUpIGVsLnNldEF0dHJpYnV0ZShcInN0eWxlXCIsIHByb3BzLnN0eWxlKTtcclxuICBpZiAocHJvcHMuYXR0cnMpIHtcclxuICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwcm9wcy5hdHRycykpIHtcclxuICAgICAgaWYgKHZhbHVlID09PSBmYWxzZSkgY29udGludWU7XHJcbiAgICAgIGVsLnNldEF0dHJpYnV0ZShuYW1lLCB2YWx1ZSA9PT0gdHJ1ZSA/IFwiXCIgOiBTdHJpbmcodmFsdWUpKTtcclxuICAgIH1cclxuICB9XHJcbiAgaWYgKHByb3BzLmRhdGFzZXQpIE9iamVjdC5hc3NpZ24oZWwuZGF0YXNldCwgcHJvcHMuZGF0YXNldCk7XHJcbiAgaWYgKHByb3BzLm9uKSB7XHJcbiAgICBmb3IgKGNvbnN0IFt0eXBlLCBoYW5kbGVyXSBvZiBPYmplY3QuZW50cmllcyhwcm9wcy5vbikpIHtcclxuICAgICAgaWYgKGhhbmRsZXIpIGVsLmFkZEV2ZW50TGlzdGVuZXIodHlwZSwgaGFuZGxlciBhcyBFdmVudExpc3RlbmVyKTtcclxuICAgIH1cclxuICB9XHJcbiAgYXBwZW5kKGVsLCBjaGlsZHJlbik7XHJcbiAgaWYgKHByb3BzLnZhbHVlICE9PSB1bmRlZmluZWQpXHJcbiAgICAoZWwgYXMgdW5rbm93biBhcyBIVE1MSW5wdXRFbGVtZW50KS52YWx1ZSA9IHByb3BzLnZhbHVlO1xyXG4gIGlmIChwcm9wcy5jaGVja2VkICE9PSB1bmRlZmluZWQpXHJcbiAgICAoZWwgYXMgdW5rbm93biBhcyBIVE1MSW5wdXRFbGVtZW50KS5jaGVja2VkID0gcHJvcHMuY2hlY2tlZDtcclxuICBpZiAocHJvcHMuZGlzYWJsZWQgIT09IHVuZGVmaW5lZClcclxuICAgIChlbCBhcyB1bmtub3duIGFzIEhUTUxCdXR0b25FbGVtZW50KS5kaXNhYmxlZCA9IHByb3BzLmRpc2FibGVkO1xyXG4gIHJldHVybiBlbDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGFwcGVuZChlbDogSFRNTEVsZW1lbnQsIGNoaWxkcmVuOiByZWFkb25seSBDaGlsZFtdKTogdm9pZCB7XHJcbiAgZm9yIChjb25zdCBjaGlsZCBvZiBjaGlsZHJlbikge1xyXG4gICAgaWYgKGNoaWxkID09PSBudWxsIHx8IGNoaWxkID09PSB1bmRlZmluZWQgfHwgY2hpbGQgPT09IGZhbHNlKSBjb250aW51ZTtcclxuICAgIGlmIChBcnJheS5pc0FycmF5KGNoaWxkKSkgYXBwZW5kKGVsLCBjaGlsZCk7XHJcbiAgICBlbHNlXHJcbiAgICAgIGVsLmFwcGVuZChcclxuICAgICAgICBjaGlsZCBpbnN0YW5jZW9mIE5vZGUgPyBjaGlsZCA6IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKFN0cmluZyhjaGlsZCkpLFxyXG4gICAgICApO1xyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHJlcGxhY2UoZWw6IEhUTUxFbGVtZW50LCAuLi5jaGlsZHJlbjogQ2hpbGRbXSk6IHZvaWQge1xyXG4gIGVsLnJlcGxhY2VDaGlsZHJlbigpO1xyXG4gIGFwcGVuZChlbCwgY2hpbGRyZW4pO1xyXG59XHJcbiIsICJjb25zdCBQQVRIUyA9IHtcclxuICBtYWlsOiAnPHJlY3QgeD1cIjNcIiB5PVwiNVwiIHdpZHRoPVwiMThcIiBoZWlnaHQ9XCIxNFwiIHJ4PVwiMi41XCIvPjxwYXRoIGQ9XCJNMy41IDdsOC41IDYgOC41LTZcIi8+JyxcclxuICBsb2NrOiAnPHJlY3QgeD1cIjVcIiB5PVwiMTAuNVwiIHdpZHRoPVwiMTRcIiBoZWlnaHQ9XCI5LjVcIiByeD1cIjIuNVwiLz48cGF0aCBkPVwiTTggMTAuNVY4YTQgNCAwIDAgMSA4IDB2Mi41XCIvPicsXHJcbiAgZHVtYmJlbGw6ICc8cGF0aCBkPVwiTTYuNSA2LjV2MTFNMTcuNSA2LjV2MTFNMyA5LjV2NU0yMSA5LjV2NU02LjUgMTJoMTFcIi8+JyxcclxuICBjYWxlbmRhcjpcclxuICAgICc8cmVjdCB4PVwiMy41XCIgeT1cIjVcIiB3aWR0aD1cIjE3XCIgaGVpZ2h0PVwiMTZcIiByeD1cIjIuNVwiLz48cGF0aCBkPVwiTTMuNSAxMGgxN004IDN2NE0xNiAzdjRcIi8+JyxcclxuICB0aWNrZXQ6XHJcbiAgICAnPHBhdGggZD1cIk00IDcuNWgxNlYxMWEyIDIgMCAwIDAgMCA0djMuNUg0VjE1YTIgMiAwIDAgMCAwLTR6XCIvPjxwYXRoIGQ9XCJNMTQuNSA3LjV2MTFcIiBzdHJva2UtZGFzaGFycmF5PVwiMi41IDNcIi8+JyxcclxuICB4OiAnPHBhdGggZD1cIk02IDZsMTIgMTJNMTggNkw2IDE4XCIvPicsXHJcbiAgcGx1czogJzxwYXRoIGQ9XCJNMTIgNXYxNE01IDEyaDE0XCIvPicsXHJcbiAgc2VhcmNoOiAnPGNpcmNsZSBjeD1cIjExXCIgY3k9XCIxMVwiIHI9XCI2LjVcIi8+PHBhdGggZD1cIk0yMCAyMGwtNC4yLTQuMlwiLz4nLFxyXG4gIGRvd25sb2FkOiAnPHBhdGggZD1cIk0xMiA0djEwLjVNNy41IDExbDQuNSA0LjVMMTYuNSAxMU00LjUgMTkuNWgxNVwiLz4nLFxyXG4gIGVkaXQ6ICc8cGF0aCBkPVwiTTQuNSAxOS41bDQtMUwxOSA4YTIuMSAyLjEgMCAwIDAtMy0zTDUuNSAxNS41elwiLz48cGF0aCBkPVwiTTEzLjUgNy41bDMgM1wiLz4nLFxyXG4gIHRyYXNoOlxyXG4gICAgJzxwYXRoIGQ9XCJNNC41IDdoMTVNOS41IDdWNC41aDVWN002LjUgN2wxIDEzaDlsMS0xM00xMCAxMXY1LjVNMTQgMTF2NS41XCIvPicsXHJcbiAgY2xvY2s6ICc8Y2lyY2xlIGN4PVwiMTJcIiBjeT1cIjEyXCIgcj1cIjguNVwiLz48cGF0aCBkPVwiTTEyIDcuNVYxMmwzIDJcIi8+JyxcclxuICBwaW46ICc8cGF0aCBkPVwiTTEyIDIxcy02LjUtNS4yLTYuNS0xMC41YTYuNSA2LjUgMCAwIDEgMTMgMEMxOC41IDE1LjggMTIgMjEgMTIgMjF6XCIvPjxjaXJjbGUgY3g9XCIxMlwiIGN5PVwiMTAuNVwiIHI9XCIyLjNcIi8+JyxcclxuICB1c2VyOiAnPGNpcmNsZSBjeD1cIjEyXCIgY3k9XCI4XCIgcj1cIjMuOFwiLz48cGF0aCBkPVwiTTQuNSAyMC41YzEuNC0zLjggNC42LTUuNSA3LjUtNS41czYuMSAxLjcgNy41IDUuNVwiLz4nLFxyXG4gIHVzZXJzOlxyXG4gICAgJzxjaXJjbGUgY3g9XCI5XCIgY3k9XCI4LjVcIiByPVwiMy4zXCIvPjxwYXRoIGQ9XCJNMi44IDE5LjVjMS4yLTMuMiAzLjktNC43IDYuMi00LjdzNSAxLjUgNi4yIDQuN1wiLz48cGF0aCBkPVwiTTE1LjUgNS42YTMuMyAzLjMgMCAwIDEgMCA1LjhNMTcuOCAxNS4yYzEuNi43IDIuOSAyLjEgMy41IDQuM1wiLz4nLFxyXG4gIGNoZWNrOiAnPHBhdGggZD1cIk01IDEyLjVsNC41IDQuNUwxOSA3LjVcIi8+JyxcclxuICBsb2dvdXQ6XHJcbiAgICAnPHBhdGggZD1cIk05IDIxSDVhMiAyIDAgMCAxLTItMlY1YTIgMiAwIDAgMSAyLTJoNFwiLz48cGF0aCBkPVwiTTE2IDE3bDUtNS01LTVNMjEgMTJIOVwiLz4nLFxyXG4gIGJvb2ttYXJrOiAnPHBhdGggZD1cIk02IDMuNWgxMlYyMWwtNi00LTYgNHpcIi8+JyxcclxuICBncmlkOiAnPHJlY3QgeD1cIjRcIiB5PVwiNFwiIHdpZHRoPVwiN1wiIGhlaWdodD1cIjdcIiByeD1cIjEuNVwiLz48cmVjdCB4PVwiMTNcIiB5PVwiNFwiIHdpZHRoPVwiN1wiIGhlaWdodD1cIjdcIiByeD1cIjEuNVwiLz48cmVjdCB4PVwiNFwiIHk9XCIxM1wiIHdpZHRoPVwiN1wiIGhlaWdodD1cIjdcIiByeD1cIjEuNVwiLz48cmVjdCB4PVwiMTNcIiB5PVwiMTNcIiB3aWR0aD1cIjdcIiBoZWlnaHQ9XCI3XCIgcng9XCIxLjVcIi8+JyxcclxuICBjaGFydDogJzxwYXRoIGQ9XCJNNCAyMGgxNlwiLz48cGF0aCBkPVwiTTcgMjB2LTZNMTIgMjBWNk0xNyAyMHYtOVwiLz4nLFxyXG4gIHN1bjogJzxjaXJjbGUgY3g9XCIxMlwiIGN5PVwiMTJcIiByPVwiNFwiLz48cGF0aCBkPVwiTTEyIDIuNXYyTTEyIDE5LjV2Mk0yLjUgMTJoMk0xOS41IDEyaDJNNSA1bDEuNCAxLjRNMTcuNiAxNy42TDE5IDE5TTE5IDVsLTEuNCAxLjRNNi40IDE3LjZMNSAxOVwiLz4nLFxyXG4gIG1vb246ICc8cGF0aCBkPVwiTTIwIDEzLjVBOCA4IDAgMCAxIDEwLjUgNGE4IDggMCAxIDAgOS41IDkuNXpcIi8+JyxcclxuICBcImFycm93LWxlZnRcIjogJzxwYXRoIGQ9XCJNMTkgMTJINU0xMSA2bC02IDYgNiA2XCIvPicsXHJcbiAgc2xpZGVyczpcclxuICAgICc8cGF0aCBkPVwiTTQgOGg5TTE3IDhoM000IDE2aDNNMTEgMTZoOVwiLz48Y2lyY2xlIGN4PVwiMTVcIiBjeT1cIjhcIiByPVwiMi4yXCIvPjxjaXJjbGUgY3g9XCI5XCIgY3k9XCIxNlwiIHI9XCIyLjJcIi8+JyxcclxufSBhcyBjb25zdDtcclxuXHJcbmV4cG9ydCB0eXBlIEljb25OYW1lID0ga2V5b2YgdHlwZW9mIFBBVEhTO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGljb24obmFtZTogSWNvbk5hbWUsIHNpemUgPSAyMCk6IFNWR1NWR0VsZW1lbnQge1xyXG4gIGNvbnN0IHRwbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJ0ZW1wbGF0ZVwiKTtcclxuICB0cGwuaW5uZXJIVE1MID0gYDxzdmcgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiIHdpZHRoPVwiJHtzaXplfVwiIGhlaWdodD1cIiR7c2l6ZX1cIiB2aWV3Qm94PVwiMCAwIDI0IDI0XCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2Utd2lkdGg9XCIxLjlcIiBzdHJva2UtbGluZWNhcD1cInJvdW5kXCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4ke1BBVEhTW25hbWVdfTwvc3ZnPmA7XHJcbiAgcmV0dXJuIHRwbC5jb250ZW50LmZpcnN0RWxlbWVudENoaWxkIGFzIFNWR1NWR0VsZW1lbnQ7XHJcbn1cclxuIiwgImltcG9ydCB7IGFkZERheXMsIGRheUtleSB9IGZyb20gXCIuLi9jb3JlL3J1bGVzXCI7XHJcbmltcG9ydCB0eXBlIHsgV29ya291dEtpbmQgfSBmcm9tIFwiLi4vY29yZS90eXBlc1wiO1xyXG5pbXBvcnQgeyBoIH0gZnJvbSBcIi4vZG9tXCI7XHJcblxyXG5leHBvcnQgY29uc3QgS0lORF9MQUJFTDogUmVjb3JkPFdvcmtvdXRLaW5kLCBzdHJpbmc+ID0ge1xyXG4gIHN0cmVuZ3RoOiBcIlx1MDQyMVx1MDQzOFx1MDQzQlx1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0RlwiLFxyXG4gIGNhcmRpbzogXCJcdTA0MUFcdTA0MzBcdTA0NDBcdTA0MzRcdTA0MzhcdTA0M0VcIixcclxuICB5b2dhOiBcIlx1MDQxOVx1MDQzRVx1MDQzM1x1MDQzMFwiLFxyXG4gIGNyb3NzZml0OiBcIlx1MDQxQVx1MDQ0MFx1MDQzRVx1MDQ0MVx1MDQ0MVx1MDQ0NFx1MDQzOFx1MDQ0MlwiLFxyXG4gIHN0cmV0Y2g6IFwiXHUwNDIxXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDQyXHUwNDQ3XHUwNDM4XHUwNDNEXHUwNDMzXCIsXHJcbn07XHJcblxyXG5leHBvcnQgY29uc3QgS0lORF9JTlRFTlNJVFk6IFJlY29yZDxcclxuICBXb3Jrb3V0S2luZCxcclxuICB7IGxhYmVsOiBzdHJpbmc7IGxldmVsOiAxIHwgMiB8IDMgfVxyXG4+ID0ge1xyXG4gIHN0cmVuZ3RoOiB7IGxhYmVsOiBcIlx1MDQxOFx1MDQzRFx1MDQ0Mlx1MDQzNVx1MDQzRFx1MDQ0MVx1MDQzOFx1MDQzMlx1MDQzRFx1MDQzMFx1MDQ0RlwiLCBsZXZlbDogMyB9LFxyXG4gIGNyb3NzZml0OiB7IGxhYmVsOiBcIlx1MDQxOFx1MDQzRFx1MDQ0Mlx1MDQzNVx1MDQzRFx1MDQ0MVx1MDQzOFx1MDQzMlx1MDQzRFx1MDQzMFx1MDQ0RlwiLCBsZXZlbDogMyB9LFxyXG4gIGNhcmRpbzogeyBsYWJlbDogXCJcdTA0MjFcdTA0NDBcdTA0MzVcdTA0MzRcdTA0M0RcdTA0NEZcdTA0NEZcIiwgbGV2ZWw6IDIgfSxcclxuICB5b2dhOiB7IGxhYmVsOiBcIlx1MDQyMVx1MDQzRlx1MDQzRVx1MDQzQVx1MDQzRVx1MDQzOVx1MDQzRFx1MDQzMFx1MDQ0RlwiLCBsZXZlbDogMSB9LFxyXG4gIHN0cmV0Y2g6IHsgbGFiZWw6IFwiXHUwNDIxXHUwNDNGXHUwNDNFXHUwNDNBXHUwNDNFXHUwNDM5XHUwNDNEXHUwNDMwXHUwNDRGXCIsIGxldmVsOiAxIH0sXHJcbn07XHJcblxyXG5jb25zdCB1bnNwbGFzaCA9IChpZDogc3RyaW5nLCB3OiBudW1iZXIpOiBzdHJpbmcgPT5cclxuICBgaHR0cHM6Ly9pbWFnZXMudW5zcGxhc2guY29tLyR7aWR9P2F1dG89Zm9ybWF0JmZpdD1jcm9wJnc9JHt3fSZxPTcwYDtcclxuXHJcbmV4cG9ydCBjb25zdCBLSU5EX1BIT1RPOiBSZWNvcmQ8V29ya291dEtpbmQsIHN0cmluZz4gPSB7XHJcbiAgc3RyZW5ndGg6IHVuc3BsYXNoKFwicGhvdG8tMTUyNjUwNjExODA4NS02MGNlODcxNGY4YzVcIiwgODAwKSxcclxuICBjYXJkaW86IHVuc3BsYXNoKFwicGhvdG8tMTQ3NjQ4MDg2MjEyNi0yMDliZmFhOGVkYzhcIiwgODAwKSxcclxuICB5b2dhOiB1bnNwbGFzaChcInBob3RvLTE1NDQzNjc1NjctMGYyZmNiMDA5ZTBiXCIsIDgwMCksXHJcbiAgY3Jvc3NmaXQ6IHVuc3BsYXNoKFwicGhvdG8tMTU0MTUzNDc0MTY4OC02MDc4YzZiZmI1YzVcIiwgODAwKSxcclxuICBzdHJldGNoOiB1bnNwbGFzaChcInBob3RvLTE1NTIxOTY1NjMtNTVjZDRlNDVlZmIzXCIsIDgwMCksXHJcbn07XHJcblxyXG5leHBvcnQgY29uc3QgS0lORF9HUkFESUVOVDogUmVjb3JkPFdvcmtvdXRLaW5kLCBzdHJpbmc+ID0ge1xyXG4gIHN0cmVuZ3RoOiBcImxpbmVhci1ncmFkaWVudCgxMzVkZWcsIzFlM2E4YSwjMmY2ZmVkKVwiLFxyXG4gIGNhcmRpbzogXCJsaW5lYXItZ3JhZGllbnQoMTM1ZGVnLCNiMzMwMGYsI2U0NTcyZSlcIixcclxuICB5b2dhOiBcImxpbmVhci1ncmFkaWVudCgxMzVkZWcsIzViMzRiOCwjOGI1Y2Y2KVwiLFxyXG4gIGNyb3NzZml0OiBcImxpbmVhci1ncmFkaWVudCgxMzVkZWcsIzdhNTIwMCwjYzk4YTBiKVwiLFxyXG4gIHN0cmV0Y2g6IFwibGluZWFyLWdyYWRpZW50KDEzNWRlZywjMGI2ZTZhLCMxMmE1YTApXCIsXHJcbn07XHJcblxyXG5leHBvcnQgY29uc3QgSEVST19QSE9UTyA9IHVuc3BsYXNoKFwicGhvdG8tMTU3MTkwMjk0MzIwMi01MDdlYzI2MThlOGZcIiwgMTQwMCk7XHJcbmV4cG9ydCBjb25zdCBBVVRIX1BIT1RPID0gdW5zcGxhc2goXCJwaG90by0xNTM0NDM4MzI3Mjc2LTE0ZTUzMDBjM2E0OFwiLCAxMjAwKTtcclxuZXhwb3J0IGNvbnN0IGNvdmVyVXJsID0gKGtpbmQ6IFdvcmtvdXRLaW5kKTogc3RyaW5nID0+IEtJTkRfUEhPVE9ba2luZF07XHJcblxyXG5jb25zdCB0aW1lRm10ID0gbmV3IEludGwuRGF0ZVRpbWVGb3JtYXQoXCJydS1SVVwiLCB7XHJcbiAgaG91cjogXCIyLWRpZ2l0XCIsXHJcbiAgbWludXRlOiBcIjItZGlnaXRcIixcclxufSk7XHJcbmNvbnN0IGRhdGVGbXQgPSBuZXcgSW50bC5EYXRlVGltZUZvcm1hdChcInJ1LVJVXCIsIHtcclxuICBkYXk6IFwibnVtZXJpY1wiLFxyXG4gIG1vbnRoOiBcInNob3J0XCIsXHJcbn0pO1xyXG5jb25zdCBmdWxsRm10ID0gbmV3IEludGwuRGF0ZVRpbWVGb3JtYXQoXCJydS1SVVwiLCB7XHJcbiAgd2Vla2RheTogXCJsb25nXCIsXHJcbiAgZGF5OiBcIm51bWVyaWNcIixcclxuICBtb250aDogXCJsb25nXCIsXHJcbn0pO1xyXG5jb25zdCB3ZWVrZGF5Rm10ID0gbmV3IEludGwuRGF0ZVRpbWVGb3JtYXQoXCJydS1SVVwiLCB7IHdlZWtkYXk6IFwic2hvcnRcIiB9KTtcclxuXHJcbmV4cG9ydCBjb25zdCBmbXRUaW1lID0gKGlzbzogc3RyaW5nKTogc3RyaW5nID0+IHRpbWVGbXQuZm9ybWF0KG5ldyBEYXRlKGlzbykpO1xyXG5leHBvcnQgY29uc3QgZm10RGF0ZSA9IChpc286IHN0cmluZyk6IHN0cmluZyA9PiBkYXRlRm10LmZvcm1hdChuZXcgRGF0ZShpc28pKTtcclxuZXhwb3J0IGNvbnN0IGZtdEZ1bGwgPSAoaXNvOiBzdHJpbmcpOiBzdHJpbmcgPT5cclxuICBgJHtmdWxsRm10LmZvcm1hdChuZXcgRGF0ZShpc28pKX0sICR7Zm10VGltZShpc28pfWA7XHJcbmV4cG9ydCBjb25zdCBmbXRFbmRUaW1lID0gKGlzbzogc3RyaW5nLCBkdXJhdGlvbk1pbjogbnVtYmVyKTogc3RyaW5nID0+XHJcbiAgZm10VGltZShuZXcgRGF0ZShEYXRlLnBhcnNlKGlzbykgKyBkdXJhdGlvbk1pbiAqIDYwXzAwMCkudG9JU09TdHJpbmcoKSk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZGF5TGFiZWwoXHJcbiAgb2Zmc2V0OiBudW1iZXIsXHJcbiAgbm93OiBEYXRlLFxyXG4pOiB7IHRvcDogc3RyaW5nOyBzdWI6IHN0cmluZyB9IHtcclxuICBjb25zdCBkID0gYWRkRGF5cyhub3csIG9mZnNldCk7XHJcbiAgY29uc3QgdG9wID1cclxuICAgIG9mZnNldCA9PT0gMCA/IFwiXHUwNDIxXHUwNDM1XHUwNDMzXHUwNDNFXHUwNDM0XHUwNDNEXHUwNDRGXCIgOiBvZmZzZXQgPT09IDEgPyBcIlx1MDQxN1x1MDQzMFx1MDQzMlx1MDQ0Mlx1MDQ0MFx1MDQzMFwiIDogd2Vla2RheUZtdC5mb3JtYXQoZCk7XHJcbiAgcmV0dXJuIHsgdG9wLCBzdWI6IGRhdGVGbXQuZm9ybWF0KGQpIH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiByZWxhdGl2ZURheShpc286IHN0cmluZywgbm93OiBEYXRlKTogc3RyaW5nIHtcclxuICBjb25zdCBrZXkgPSBkYXlLZXkoaXNvKTtcclxuICBpZiAoa2V5ID09PSBkYXlLZXkobm93KSkgcmV0dXJuIFwiXHUwNDIxXHUwNDM1XHUwNDMzXHUwNDNFXHUwNDM0XHUwNDNEXHUwNDRGXCI7XHJcbiAgaWYgKGtleSA9PT0gZGF5S2V5KGFkZERheXMobm93LCAxKSkpIHJldHVybiBcIlx1MDQxN1x1MDQzMFx1MDQzMlx1MDQ0Mlx1MDQ0MFx1MDQzMFwiO1xyXG4gIGlmIChrZXkgPT09IGRheUtleShhZGREYXlzKG5vdywgLTEpKSkgcmV0dXJuIFwiXHUwNDEyXHUwNDQ3XHUwNDM1XHUwNDQwXHUwNDMwXCI7XHJcbiAgcmV0dXJuIHdlZWtkYXlGbXQuZm9ybWF0KG5ldyBEYXRlKGlzbykpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGx1cmFsKG46IG51bWJlciwgZm9ybXM6IFtzdHJpbmcsIHN0cmluZywgc3RyaW5nXSk6IHN0cmluZyB7XHJcbiAgY29uc3QgYSA9IE1hdGguYWJzKG4pICUgMTAwO1xyXG4gIGNvbnN0IGIgPSBhICUgMTA7XHJcbiAgaWYgKGEgPiAxMCAmJiBhIDwgMjApIHJldHVybiBmb3Jtc1syXTtcclxuICBpZiAoYiA+IDEgJiYgYiA8IDUpIHJldHVybiBmb3Jtc1sxXTtcclxuICBpZiAoYiA9PT0gMSkgcmV0dXJuIGZvcm1zWzBdO1xyXG4gIHJldHVybiBmb3Jtc1syXTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVJbnB1dFZhbHVlKGlzbzogc3RyaW5nKTogc3RyaW5nIHtcclxuICBjb25zdCBkID0gbmV3IERhdGUoaXNvKTtcclxuICBjb25zdCBwID0gKG46IG51bWJlcik6IHN0cmluZyA9PiBTdHJpbmcobikucGFkU3RhcnQoMiwgXCIwXCIpO1xyXG4gIHJldHVybiBgJHtwKGQuZ2V0SG91cnMoKSl9OiR7cChkLmdldE1pbnV0ZXMoKSl9YDtcclxufVxyXG5cclxuZXhwb3J0IGNvbnN0IHRvQ3N2ID0gKHJvd3M6IChzdHJpbmcgfCBudW1iZXIpW11bXSk6IHN0cmluZyA9PlxyXG4gIHJvd3NcclxuICAgIC5tYXAoKHJvdykgPT5cclxuICAgICAgcm93Lm1hcCgoY2VsbCkgPT4gYFwiJHtTdHJpbmcoY2VsbCkucmVwbGFjZSgvXCIvZywgJ1wiXCInKX1cImApLmpvaW4oXCI7XCIpLFxyXG4gICAgKVxyXG4gICAgLmpvaW4oXCJcXHJcXG5cIik7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZG93bmxvYWRUZXh0KGZpbGVuYW1lOiBzdHJpbmcsIHRleHQ6IHN0cmluZyk6IHZvaWQge1xyXG4gIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoXHJcbiAgICBuZXcgQmxvYihbXCJcXHVGRUZGXCIgKyB0ZXh0XSwgeyB0eXBlOiBcInRleHQvY3N2O2NoYXJzZXQ9dXRmLThcIiB9KSxcclxuICApO1xyXG4gIGNvbnN0IGEgPSBoKFwiYVwiLCB7IGF0dHJzOiB7IGhyZWY6IHVybCwgZG93bmxvYWQ6IGZpbGVuYW1lIH0gfSk7XHJcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmQoYSk7XHJcbiAgYS5jbGljaygpO1xyXG4gIGEucmVtb3ZlKCk7XHJcbiAgd2luZG93LnNldFRpbWVvdXQoKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpLCAxMDAwKTtcclxufVxyXG4iLCAiaW1wb3J0IHR5cGUgeyBSb2xlLCBXb3Jrb3V0S2luZCB9IGZyb20gXCIuLi9jb3JlL3R5cGVzXCI7XHJcbmltcG9ydCB7IGgsIHR5cGUgQ2hpbGQgfSBmcm9tIFwiLi9kb21cIjtcclxuaW1wb3J0IHsgY292ZXJVcmwsIEtJTkRfR1JBRElFTlQsIEtJTkRfSU5URU5TSVRZLCBLSU5EX0xBQkVMIH0gZnJvbSBcIi4vZm9ybWF0XCI7XHJcbmltcG9ydCB7IGljb24sIHR5cGUgSWNvbk5hbWUgfSBmcm9tIFwiLi9pY29uc1wiO1xyXG5cclxuZXhwb3J0IHR5cGUgQnV0dG9uVG9uZSA9IFwicHJpbWFyeVwiIHwgXCJnaG9zdFwiIHwgXCJkYW5nZXJcIiB8IFwiZGFuZ2VyLWdob3N0XCIgfCBcIm9rXCI7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYnV0dG9uKG9wdHM6IHtcclxuICBsYWJlbDogc3RyaW5nO1xyXG4gIHRvbmU/OiBCdXR0b25Ub25lO1xyXG4gIGljb24/OiBJY29uTmFtZTtcclxuICBvbkNsaWNrPzogKGV2ZW50OiBNb3VzZUV2ZW50KSA9PiB2b2lkO1xyXG4gIGRpc2FibGVkPzogYm9vbGVhbjtcclxuICB3aWRlPzogYm9vbGVhbjtcclxuICBzbWFsbD86IGJvb2xlYW47XHJcbiAgdHlwZT86IFwiYnV0dG9uXCIgfCBcInN1Ym1pdFwiO1xyXG59KTogSFRNTEJ1dHRvbkVsZW1lbnQge1xyXG4gIGNvbnN0IGNscyA9IFtcclxuICAgIFwiYnRuXCIsXHJcbiAgICBgYnRuLSR7b3B0cy50b25lID8/IFwicHJpbWFyeVwifWAsXHJcbiAgICBvcHRzLndpZGUgPyBcImJ0bi13aWRlXCIgOiBcIlwiLFxyXG4gICAgb3B0cy5zbWFsbCA/IFwiYnRuLXNtYWxsXCIgOiBcIlwiLFxyXG4gIF1cclxuICAgIC5maWx0ZXIoQm9vbGVhbilcclxuICAgIC5qb2luKFwiIFwiKTtcclxuICByZXR1cm4gaChcclxuICAgIFwiYnV0dG9uXCIsXHJcbiAgICB7XHJcbiAgICAgIGNsYXNzOiBjbHMsXHJcbiAgICAgIGF0dHJzOiB7IHR5cGU6IG9wdHMudHlwZSA/PyBcImJ1dHRvblwiIH0sXHJcbiAgICAgIGRpc2FibGVkOiBvcHRzLmRpc2FibGVkLFxyXG4gICAgICBvbjogb3B0cy5vbkNsaWNrID8geyBjbGljazogb3B0cy5vbkNsaWNrIH0gOiB1bmRlZmluZWQsXHJcbiAgICB9LFxyXG4gICAgb3B0cy5pY29uID8gaWNvbihvcHRzLmljb24sIDE4KSA6IG51bGwsXHJcbiAgICBoKFwic3BhblwiLCB7IHRleHQ6IG9wdHMubGFiZWwgfSksXHJcbiAgKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGljb25CdXR0b24oXHJcbiAgbmFtZTogSWNvbk5hbWUsXHJcbiAgbGFiZWw6IHN0cmluZyxcclxuICBvbkNsaWNrOiAoZXZlbnQ6IE1vdXNlRXZlbnQpID0+IHZvaWQsXHJcbiAgb3B0cz86IHsgZGFuZ2VyPzogYm9vbGVhbjsgZGlzYWJsZWQ/OiBib29sZWFuIH0sXHJcbik6IEhUTUxCdXR0b25FbGVtZW50IHtcclxuICByZXR1cm4gaChcclxuICAgIFwiYnV0dG9uXCIsXHJcbiAgICB7XHJcbiAgICAgIGNsYXNzOiBgaWNvbi1idG4ke29wdHM/LmRhbmdlciA/IFwiIGRhbmdlclwiIDogXCJcIn1gLFxyXG4gICAgICBhdHRyczogeyB0eXBlOiBcImJ1dHRvblwiLCBcImFyaWEtbGFiZWxcIjogbGFiZWwsIHRpdGxlOiBsYWJlbCB9LFxyXG4gICAgICBkaXNhYmxlZDogb3B0cz8uZGlzYWJsZWQsXHJcbiAgICAgIG9uOiB7IGNsaWNrOiBvbkNsaWNrIH0sXHJcbiAgICB9LFxyXG4gICAgaWNvbihuYW1lLCAxOCksXHJcbiAgKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGNoaXAoXHJcbiAgbGFiZWw6IHN0cmluZyxcclxuICBhY3RpdmU6IGJvb2xlYW4sXHJcbiAgb25DbGljazogKCkgPT4gdm9pZCxcclxuKTogSFRNTEJ1dHRvbkVsZW1lbnQge1xyXG4gIHJldHVybiBoKFwiYnV0dG9uXCIsIHtcclxuICAgIGNsYXNzOiBgY2hpcC1idG4ke2FjdGl2ZSA/IFwiIGFjdGl2ZVwiIDogXCJcIn1gLFxyXG4gICAgYXR0cnM6IHsgdHlwZTogXCJidXR0b25cIiwgXCJhcmlhLXByZXNzZWRcIjogU3RyaW5nKGFjdGl2ZSkgfSxcclxuICAgIG9uOiB7IGNsaWNrOiBvbkNsaWNrIH0sXHJcbiAgICB0ZXh0OiBsYWJlbCxcclxuICB9KTtcclxufVxyXG5cclxuZXhwb3J0IGNvbnN0IGtpbmRCYWRnZSA9IChraW5kOiBXb3Jrb3V0S2luZCk6IEhUTUxFbGVtZW50ID0+XHJcbiAgaChcInNwYW5cIiwgeyBjbGFzczogYGNoaXAgay0ke2tpbmR9YCwgdGV4dDogS0lORF9MQUJFTFtraW5kXSB9KTtcclxuXHJcbmV4cG9ydCBjb25zdCBpbnRlbnNpdHlDaGlwID0gKGtpbmQ6IFdvcmtvdXRLaW5kKTogSFRNTEVsZW1lbnQgPT4ge1xyXG4gIGNvbnN0IG1ldGEgPSBLSU5EX0lOVEVOU0lUWVtraW5kXTtcclxuICByZXR1cm4gaChcInNwYW5cIiwge1xyXG4gICAgY2xhc3M6IGBpbnRlbnNpdHkgaS0ke21ldGEubGV2ZWx9YCxcclxuICAgIHRleHQ6IG1ldGEubGFiZWwsXHJcbiAgICBhdHRyczogeyB0aXRsZTogYFx1MDQxOFx1MDQzRFx1MDQ0Mlx1MDQzNVx1MDQzRFx1MDQ0MVx1MDQzOFx1MDQzMlx1MDQzRFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0QzogJHttZXRhLmxhYmVsLnRvTG93ZXJDYXNlKCl9YCB9LFxyXG4gIH0pO1xyXG59O1xyXG5cclxuLyoqIFx1MDQyNFx1MDQzRVx1MDQ0Mlx1MDQzRSBcdTA0NDEgZ3JhY2VmdWwtXHUwNDQ0XHUwNDNFXHUwNDNCXHUwNDMxXHUwNDREXHUwNDNBXHUwNDNFXHUwNDNDOiBcdTA0M0ZcdTA0NDBcdTA0MzggXHUwNDNFXHUwNDQ4XHUwNDM4XHUwNDMxXHUwNDNBXHUwNDM1IFx1MDQzN1x1MDQzMFx1MDQzM1x1MDQ0MFx1MDQ0M1x1MDQzN1x1MDQzQVx1MDQzOCBcdTIwMTQgXHUwNDMzXHUwNDQwXHUwNDMwXHUwNDM0XHUwNDM4XHUwNDM1XHUwNDNEXHUwNDQyXHUwNDNEXHUwNDMwXHUwNDRGIFx1MDQzRlx1MDQzQlx1MDQzMFx1MDQ0OFx1MDQzQVx1MDQzMCwgXHUwNDNEXHUwNDM1IFx1MDQzMVx1MDQzOFx1MDQ0Mlx1MDQzMFx1MDQ0RiBcdTA0M0FcdTA0MzBcdTA0NDBcdTA0NDJcdTA0MzhcdTA0M0RcdTA0M0FcdTA0MzAuICovXHJcbmV4cG9ydCBmdW5jdGlvbiByZW1vdGVJbWcoXHJcbiAgc3JjOiBzdHJpbmcsXHJcbiAgYWx0OiBzdHJpbmcsXHJcbiAgY2xzOiBzdHJpbmcsXHJcbiAgbWFrZUZhbGxiYWNrOiAoKSA9PiBIVE1MRWxlbWVudCxcclxuKTogSFRNTEltYWdlRWxlbWVudCB7XHJcbiAgY29uc3QgaW1nID0gaChcImltZ1wiLCB7XHJcbiAgICBjbGFzczogY2xzLFxyXG4gICAgYXR0cnM6IHtcclxuICAgICAgc3JjLFxyXG4gICAgICBhbHQsXHJcbiAgICAgIGxvYWRpbmc6IFwibGF6eVwiLFxyXG4gICAgICBkZWNvZGluZzogXCJhc3luY1wiLFxyXG4gICAgICByZWZlcnJlcnBvbGljeTogXCJuby1yZWZlcnJlclwiLFxyXG4gICAgfSxcclxuICB9KTtcclxuICBpbWcuYWRkRXZlbnRMaXN0ZW5lcihcclxuICAgIFwiZXJyb3JcIixcclxuICAgICgpID0+IHtcclxuICAgICAgaW1nLnJlcGxhY2VXaXRoKG1ha2VGYWxsYmFjaygpKTtcclxuICAgIH0sXHJcbiAgICB7IG9uY2U6IHRydWUgfSxcclxuICApO1xyXG4gIHJldHVybiBpbWc7XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBjb3ZlckltZyA9IChcclxuICBraW5kOiBXb3Jrb3V0S2luZCxcclxuICBjbHMgPSBcImNvdmVyLWltZ1wiLFxyXG4pOiBIVE1MSW1hZ2VFbGVtZW50ID0+XHJcbiAgcmVtb3RlSW1nKGNvdmVyVXJsKGtpbmQpLCBLSU5EX0xBQkVMW2tpbmRdLCBjbHMsICgpID0+XHJcbiAgICBoKFxyXG4gICAgICBcImRpdlwiLFxyXG4gICAgICB7IGNsYXNzOiBcImNvdmVyLWZhbGxiYWNrXCIsIHN0eWxlOiBgYmFja2dyb3VuZDoke0tJTkRfR1JBRElFTlRba2luZF19YCB9LFxyXG4gICAgICBoKFwic3BhblwiLCB7IHRleHQ6IEtJTkRfTEFCRUxba2luZF0gfSksXHJcbiAgICApLFxyXG4gICk7XHJcblxyXG5leHBvcnQgY29uc3QgbWluaUF2YXRhciA9IChuYW1lOiBzdHJpbmcpOiBIVE1MRWxlbWVudCA9PlxyXG4gIGgoXCJzcGFuXCIsIHtcclxuICAgIGNsYXNzOiBcIm1pbmktYXZhdGFyXCIsXHJcbiAgICB0ZXh0OiBuYW1lLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpLFxyXG4gICAgYXR0cnM6IHsgXCJhcmlhLWhpZGRlblwiOiBcInRydWVcIiB9LFxyXG4gIH0pO1xyXG5cclxuZXhwb3J0IGNvbnN0IHJvbGVCYWRnZSA9IChyb2xlOiBSb2xlKTogSFRNTEVsZW1lbnQgPT5cclxuICBoKFwic3BhblwiLCB7XHJcbiAgICBjbGFzczogYHJvbGUtYmFkZ2UgJHtyb2xlfWAsXHJcbiAgICB0ZXh0OiByb2xlID09PSBcImFkbWluXCIgPyBcIlx1MDQxMFx1MDQzNFx1MDQzQ1x1MDQzOFx1MDQzRFwiIDogXCJcdTA0MUFcdTA0M0JcdTA0MzhcdTA0MzVcdTA0M0RcdTA0NDJcIixcclxuICB9KTtcclxuXHJcbmV4cG9ydCBjb25zdCBhdmF0YXIgPSAobmFtZTogc3RyaW5nKTogSFRNTEVsZW1lbnQgPT5cclxuICBoKFwic3BhblwiLCB7IGNsYXNzOiBcImF2YXRhclwiLCB0ZXh0OiBuYW1lLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpIH0pO1xyXG5cclxuZXhwb3J0IGNvbnN0IGZpZWxkID0gKFxyXG4gIGxhYmVsOiBzdHJpbmcsXHJcbiAgaW5wdXQ6IEhUTUxFbGVtZW50LFxyXG4gIHdpZGUgPSBmYWxzZSxcclxuKTogSFRNTEVsZW1lbnQgPT5cclxuICBoKFxyXG4gICAgXCJsYWJlbFwiLFxyXG4gICAgeyBjbGFzczogYGZpZWxkJHt3aWRlID8gXCIgc3BhbjJcIiA6IFwiXCJ9YCB9LFxyXG4gICAgaChcInNwYW5cIiwgeyBjbGFzczogXCJmaWVsZC1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KSxcclxuICAgIGlucHV0LFxyXG4gICk7XHJcblxyXG5leHBvcnQgY29uc3QgdGV4dElucHV0ID0gKFxyXG4gIGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuPixcclxuICB2YWx1ZT86IHN0cmluZyxcclxuKTogSFRNTElucHV0RWxlbWVudCA9PiBoKFwiaW5wdXRcIiwgeyBjbGFzczogXCJpbnB1dFwiLCBhdHRycywgdmFsdWUgfSk7XHJcblxyXG5leHBvcnQgY29uc3Qgc2VsZWN0SW5wdXQgPSAoXHJcbiAgb3B0aW9uczogeyB2YWx1ZTogc3RyaW5nOyBsYWJlbDogc3RyaW5nIH1bXSxcclxuICB2YWx1ZTogc3RyaW5nLFxyXG4pOiBIVE1MU2VsZWN0RWxlbWVudCA9PlxyXG4gIGgoXHJcbiAgICBcInNlbGVjdFwiLFxyXG4gICAgeyBjbGFzczogXCJpbnB1dCBzZWxlY3RcIiwgdmFsdWUgfSxcclxuICAgIC4uLm9wdGlvbnMubWFwKChvKSA9PlxyXG4gICAgICBoKFwib3B0aW9uXCIsIHsgYXR0cnM6IHsgdmFsdWU6IG8udmFsdWUgfSwgdGV4dDogby5sYWJlbCB9KSxcclxuICAgICksXHJcbiAgKTtcclxuXHJcbmV4cG9ydCBjb25zdCBlbXB0eVN0YXRlID0gKFxyXG4gIHRleHQ6IHN0cmluZyxcclxuICBhY3Rpb24/OiBIVE1MRWxlbWVudCxcclxuICBpY29uTmFtZTogSWNvbk5hbWUgPSBcInNlYXJjaFwiLFxyXG4pOiBIVE1MRWxlbWVudCA9PlxyXG4gIGgoXHJcbiAgICBcImRpdlwiLFxyXG4gICAgeyBjbGFzczogXCJlbXB0eVwiIH0sXHJcbiAgICBpY29uKGljb25OYW1lLCAyOCksXHJcbiAgICBoKFwicFwiLCB7IHRleHQgfSksXHJcbiAgICBhY3Rpb24gPz8gbnVsbCxcclxuICApO1xyXG5cclxuZXhwb3J0IGNvbnN0IG9jY3VwYW5jeUJhciA9IChwY3Q6IG51bWJlcik6IEhUTUxFbGVtZW50ID0+XHJcbiAgaChcclxuICAgIFwic3BhblwiLFxyXG4gICAgeyBjbGFzczogYGJhciR7cGN0ID49IDEwMCA/IFwiIGZ1bGxcIiA6IFwiXCJ9YCB9LFxyXG4gICAgaChcInNwYW5cIiwgeyBzdHlsZTogYHdpZHRoOiR7TWF0aC5taW4oMTAwLCBNYXRoLm1heCgwLCBwY3QpKX0lYCB9KSxcclxuICApO1xyXG5cclxuZXhwb3J0IGNvbnN0IHN0YXRDYXJkID0gKHZhbHVlOiBzdHJpbmcgfCBudW1iZXIsIGxhYmVsOiBzdHJpbmcpOiBIVE1MRWxlbWVudCA9PlxyXG4gIGgoXHJcbiAgICBcImRpdlwiLFxyXG4gICAgeyBjbGFzczogXCJyLWNhcmRcIiB9LFxyXG4gICAgaChcInN0cm9uZ1wiLCB7IHRleHQ6IFN0cmluZyh2YWx1ZSkgfSksXHJcbiAgICBoKFwic3BhblwiLCB7IHRleHQ6IGxhYmVsIH0pLFxyXG4gICk7XHJcblxyXG5leHBvcnQgY29uc3QgcGFnZUhlYWQgPSAoXHJcbiAgdGl0bGU6IHN0cmluZyxcclxuICBzdWJ0aXRsZTogc3RyaW5nLFxyXG4gIGFjdGlvbnM/OiBIVE1MRWxlbWVudCxcclxuKTogSFRNTEVsZW1lbnQgPT5cclxuICBoKFxyXG4gICAgXCJzZWN0aW9uXCIsXHJcbiAgICB7IGNsYXNzOiBcImhlcm9cIiB9LFxyXG4gICAgaChcclxuICAgICAgXCJkaXZcIixcclxuICAgICAgeyBjbGFzczogXCJoZXJvLXRleHRcIiB9LFxyXG4gICAgICBoKFwiaDFcIiwgeyB0ZXh0OiB0aXRsZSB9KSxcclxuICAgICAgaChcInBcIiwgeyBjbGFzczogXCJtdXRlZFwiLCB0ZXh0OiBzdWJ0aXRsZSB9KSxcclxuICAgICksXHJcbiAgICBhY3Rpb25zID8/IG51bGwsXHJcbiAgKTtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgVGFibGVSb3cge1xyXG4gIGNsYXNzPzogc3RyaW5nO1xyXG4gIGNlbGxzOiBDaGlsZFtdO1xyXG4gIG9uQ2xpY2s/OiAoKSA9PiB2b2lkO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZGF0YVRhYmxlKGhlYWRlcnM6IENoaWxkW10sIHJvd3M6IFRhYmxlUm93W10pOiBIVE1MRWxlbWVudCB7XHJcbiAgY29uc3QgdG9DZWxsID0gKGM6IENoaWxkKTogSFRNTEVsZW1lbnQgPT5cclxuICAgIGMgaW5zdGFuY2VvZiBIVE1MRWxlbWVudCAmJiBjLnRhZ05hbWUgPT09IFwiVERcIiA/IGMgOiBoKFwidGRcIiwge30sIGMpO1xyXG4gIHJldHVybiBoKFxyXG4gICAgXCJkaXZcIixcclxuICAgIHsgY2xhc3M6IFwidGFibGUtd3JhcFwiIH0sXHJcbiAgICBoKFxyXG4gICAgICBcInRhYmxlXCIsXHJcbiAgICAgIHt9LFxyXG4gICAgICBoKFwidGhlYWRcIiwge30sIGgoXCJ0clwiLCB7fSwgLi4uaGVhZGVycy5tYXAoKGhlYWQpID0+IGgoXCJ0aFwiLCB7fSwgaGVhZCkpKSksXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJ0Ym9keVwiLFxyXG4gICAgICAgIHt9LFxyXG4gICAgICAgIC4uLnJvd3MubWFwKChyb3cpID0+XHJcbiAgICAgICAgICBoKFxyXG4gICAgICAgICAgICBcInRyXCIsXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAuLi4ocm93LmNsYXNzID8geyBjbGFzczogcm93LmNsYXNzIH0gOiB7fSksXHJcbiAgICAgICAgICAgICAgLi4uKHJvdy5vbkNsaWNrID8geyBvbjogeyBjbGljazogcm93Lm9uQ2xpY2sgfSB9IDoge30pLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAuLi5yb3cuY2VsbHMubWFwKHRvQ2VsbCksXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgICksXHJcbiAgICAgICksXHJcbiAgICApLFxyXG4gICk7XHJcbn1cclxuIiwgImV4cG9ydCB0eXBlIFRoZW1lID0gXCJsaWdodFwiIHwgXCJkYXJrXCI7XHJcbmNvbnN0IEtFWSA9IFwiYXRsZXQ6dGhlbWVcIjtcclxuXHJcbmZ1bmN0aW9uIHN5c3RlbSgpOiBUaGVtZSB7XHJcbiAgcmV0dXJuIG1hdGNoTWVkaWEoXCIocHJlZmVycy1jb2xvci1zY2hlbWU6IGxpZ2h0KVwiKS5tYXRjaGVzID8gXCJsaWdodFwiIDogXCJkYXJrXCI7XHJcbn1cclxuZnVuY3Rpb24gc3RvcmVkKCk6IFRoZW1lIHwgbnVsbCB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHYgPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShLRVkpO1xyXG4gICAgcmV0dXJuIHYgPT09IFwibGlnaHRcIiB8fCB2ID09PSBcImRhcmtcIiA/IHYgOiBudWxsO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfVxyXG59XHJcbmZ1bmN0aW9uIGFwcGx5KHRoZW1lOiBUaGVtZSk6IHZvaWQge1xyXG4gIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5kYXRhc2V0LnRoZW1lID0gdGhlbWU7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpbml0VGhlbWUoKTogVGhlbWUge1xyXG4gIGNvbnN0IHRoZW1lID0gc3RvcmVkKCkgPz8gc3lzdGVtKCk7XHJcbiAgYXBwbHkodGhlbWUpO1xyXG4gIG1hdGNoTWVkaWEoXCIocHJlZmVycy1jb2xvci1zY2hlbWU6IGxpZ2h0KVwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsICgpID0+IHtcclxuICAgIGlmICghc3RvcmVkKCkpIGFwcGx5KHN5c3RlbSgpKTtcclxuICB9KTtcclxuICByZXR1cm4gdGhlbWU7XHJcbn1cclxuZXhwb3J0IGZ1bmN0aW9uIGN1cnJlbnRUaGVtZSgpOiBUaGVtZSB7XHJcbiAgcmV0dXJuIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5kYXRhc2V0LnRoZW1lID09PSBcImxpZ2h0XCIgPyBcImxpZ2h0XCIgOiBcImRhcmtcIjtcclxufVxyXG5leHBvcnQgZnVuY3Rpb24gdG9nZ2xlVGhlbWUoKTogVGhlbWUge1xyXG4gIGNvbnN0IG5leHQ6IFRoZW1lID0gY3VycmVudFRoZW1lKCkgPT09IFwiZGFya1wiID8gXCJsaWdodFwiIDogXCJkYXJrXCI7XHJcbiAgdHJ5IHtcclxuICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKEtFWSwgbmV4dCk7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICAvKiBwcml2YXRlIG1vZGUgKi9cclxuICB9XHJcbiAgYXBwbHkobmV4dCk7XHJcbiAgcmV0dXJuIG5leHQ7XHJcbn1cclxuIiwgImltcG9ydCB7IGlzRmluaXNoZWQgfSBmcm9tIFwiLi4vY29yZS9ydWxlc1wiO1xyXG5pbXBvcnQgdHlwZSB7IFVzZXIgfSBmcm9tIFwiLi4vY29yZS90eXBlc1wiO1xyXG5pbXBvcnQgdHlwZSB7IEFwcENvbnRleHQsIFJvdXRlIH0gZnJvbSBcIi4vY29udGV4dFwiO1xyXG5pbXBvcnQgeyBoLCByZXBsYWNlIH0gZnJvbSBcIi4uL3VpL2RvbVwiO1xyXG5pbXBvcnQgeyBpY29uIH0gZnJvbSBcIi4uL3VpL2ljb25zXCI7XHJcbmltcG9ydCB7IGF2YXRhciwgYnV0dG9uLCBpY29uQnV0dG9uIH0gZnJvbSBcIi4uL3VpL2NvbnRyb2xzXCI7XHJcbmltcG9ydCB7IGN1cnJlbnRUaGVtZSwgaW5pdFRoZW1lLCB0b2dnbGVUaGVtZSB9IGZyb20gXCIuLi91aS90aGVtZVwiO1xyXG5cclxuZXhwb3J0IGNsYXNzIEFwcFNoZWxsIHtcclxuICByZWFkb25seSBjb250ZW50OiBIVE1MRWxlbWVudDtcclxuICBwcml2YXRlIHJlYWRvbmx5IGhlYWRlcjogSFRNTEVsZW1lbnQ7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBmb290ZXI6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbW9iaWxlTmF2OiBIVE1MRWxlbWVudDtcclxuICBwcml2YXRlIHJlYWRvbmx5IGJhbm5lcjogSFRNTEVsZW1lbnQ7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBiYW5uZXJUZXh0OiBIVE1MRWxlbWVudDtcclxuICBwcml2YXRlIHJvdXRlOiBSb3V0ZSA9IFwiaG9tZVwiO1xyXG5cclxuICBjb25zdHJ1Y3RvcihcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3R4OiBBcHBDb250ZXh0LFxyXG4gICAgcm9vdDogSFRNTEVsZW1lbnQsXHJcbiAgKSB7XHJcbiAgICBpbml0VGhlbWUoKTtcclxuXHJcbiAgICB0aGlzLmJhbm5lclRleHQgPSBoKFwic3BhblwiLCB7XHJcbiAgICAgIHRleHQ6IFwiXHUwNDFEXHUwNDM1XHUwNDQyIFx1MDQ0MVx1MDQzRVx1MDQzNVx1MDQzNFx1MDQzOFx1MDQzRFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0RiBcdTIwMTQgXHUwNDNGXHUwNDNFXHUwNDNBXHUwNDMwXHUwNDM3XHUwNDMwXHUwNDNEXHUwNDRCIFx1MDQ0MVx1MDQzRVx1MDQ0NVx1MDQ0MFx1MDQzMFx1MDQzRFx1MDQ1MVx1MDQzRFx1MDQzRFx1MDQ0Qlx1MDQzNSBcdTA0MzRcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzVcIixcclxuICAgIH0pO1xyXG4gICAgdGhpcy5iYW5uZXIgPSBoKFxyXG4gICAgICBcImRpdlwiLFxyXG4gICAgICB7IGNsYXNzOiBcIm5ldC1iYW5uZXJcIiwgYXR0cnM6IHsgcm9sZTogXCJhbGVydFwiIH0gfSxcclxuICAgICAgdGhpcy5iYW5uZXJUZXh0LFxyXG4gICAgICBidXR0b24oe1xyXG4gICAgICAgIGxhYmVsOiBcIlx1MDQxRlx1MDQzRVx1MDQzMlx1MDQ0Mlx1MDQzRVx1MDQ0MFx1MDQzOFx1MDQ0Mlx1MDQ0Q1wiLFxyXG4gICAgICAgIHRvbmU6IFwiZ2hvc3RcIixcclxuICAgICAgICBzbWFsbDogdHJ1ZSxcclxuICAgICAgICBvbkNsaWNrOiAoKSA9PiB7XHJcbiAgICAgICAgICB2b2lkIHRoaXMuY3R4LnN0YXRlLnJlZnJlc2goKTtcclxuICAgICAgICB9LFxyXG4gICAgICB9KSxcclxuICAgICk7XHJcblxyXG4gICAgdGhpcy5oZWFkZXIgPSBoKFwiaGVhZGVyXCIsIHsgY2xhc3M6IFwidG9wXCIgfSk7XHJcbiAgICB0aGlzLmNvbnRlbnQgPSBoKFwibWFpblwiLCB7IGNsYXNzOiBcIm1haW5cIiB9KTtcclxuICAgIHRoaXMuZm9vdGVyID0gaChcclxuICAgICAgXCJmb290ZXJcIixcclxuICAgICAgeyBjbGFzczogXCJmb290XCIgfSxcclxuICAgICAgaChcInNwYW5cIiwgeyB0ZXh0OiBcIlx1MDQxMFx1MDQyMlx1MDQxQlx1MDQxNVx1MDQyMiBcdTAwQjcgXHUwNDQzXHUwNDQ3XHUwNDM1XHUwNDMxXHUwNDNEXHUwNDRCXHUwNDM5IFx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQzNVx1MDQzQVx1MDQ0MiBcdTAwQjcgXHUwNDM0XHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQzRFx1MDQzMCBcdTA0NDFcdTA0MzVcdTA0NDBcdTA0MzJcdTA0MzVcdTA0NDBcdTA0MzVcIiB9KSxcclxuICAgICk7XHJcbiAgICB0aGlzLm1vYmlsZU5hdiA9IGgoXCJuYXZcIiwge1xyXG4gICAgICBjbGFzczogXCJtb2ItbmF2XCIsXHJcbiAgICAgIGF0dHJzOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlx1MDQxQ1x1MDQzRVx1MDQzMVx1MDQzOFx1MDQzQlx1MDQ0Q1x1MDQzRFx1MDQzMFx1MDQ0RiBcdTA0M0RcdTA0MzBcdTA0MzJcdTA0MzhcdTA0MzNcdTA0MzBcdTA0NDZcdTA0MzhcdTA0NEZcIiB9LFxyXG4gICAgfSk7XHJcbiAgICByb290LmFwcGVuZChcclxuICAgICAgdGhpcy5iYW5uZXIsXHJcbiAgICAgIHRoaXMuaGVhZGVyLFxyXG4gICAgICB0aGlzLmNvbnRlbnQsXHJcbiAgICAgIHRoaXMuZm9vdGVyLFxyXG4gICAgICB0aGlzLm1vYmlsZU5hdixcclxuICAgICk7XHJcblxyXG4gICAgdGhpcy5jdHguYnVzLm9uKFwiYXV0aFwiLCAoKSA9PiB0aGlzLnN5bmModGhpcy5yb3V0ZSkpO1xyXG4gICAgdGhpcy5jdHguYnVzLm9uKFwidXNlcnNcIiwgKCkgPT4gdGhpcy5yZW5kZXJIZWFkZXIoKSk7XHJcbiAgICB0aGlzLmN0eC5idXMub24oXCJib29raW5nc1wiLCAoKSA9PiB0aGlzLnJlbmRlckhlYWRlcigpKTtcclxuICAgIHRoaXMuY3R4LmJ1cy5vbihcInNlc3Npb25zXCIsICgpID0+IHRoaXMucmVuZGVySGVhZGVyKCkpO1xyXG4gICAgdGhpcy5jdHguYnVzLm9uKFwic3luY1wiLCAoKSA9PiB0aGlzLnN5bmNCYW5uZXIoKSk7XHJcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcIm9ubGluZVwiLCAoKSA9PiB0aGlzLm5ldHdvcmtDaGFuZ2VkKHRydWUpKTtcclxuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwib2ZmbGluZVwiLCAoKSA9PiB0aGlzLm5ldHdvcmtDaGFuZ2VkKGZhbHNlKSk7XHJcbiAgICB0aGlzLnN5bmNCYW5uZXIoKTtcclxuICB9XHJcblxyXG4gIHN5bmMocm91dGU6IFJvdXRlKTogdm9pZCB7XHJcbiAgICB0aGlzLnJvdXRlID0gcm91dGU7XHJcbiAgICB0aGlzLmNvbnRlbnQuY2xhc3NOYW1lID1cclxuICAgICAgXCJtYWluIFwiICtcclxuICAgICAgKHJvdXRlID09PSBcImhvbWVcIlxyXG4gICAgICAgID8gXCJtYWluLWxhbmRpbmdcIlxyXG4gICAgICAgIDogcm91dGUgPT09IFwiYWRtaW5cIlxyXG4gICAgICAgICAgPyBcIm1haW4tYWRtaW5cIlxyXG4gICAgICAgICAgOiBcIm1haW4tYXBwXCIpO1xyXG4gICAgdGhpcy5mb290ZXIuaGlkZGVuID0gcm91dGUgPT09IFwiaG9tZVwiIHx8IHJvdXRlID09PSBcImF1dGhcIjtcclxuICAgIHRoaXMucmVuZGVySGVhZGVyKCk7XHJcbiAgICB0aGlzLnJlbmRlck1vYmlsZU5hdigpO1xyXG4gICAgdGhpcy5zeW5jQmFubmVyKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHRoZW1lQnV0dG9uKCk6IEhUTUxCdXR0b25FbGVtZW50IHtcclxuICAgIGNvbnN0IGJ0biA9IGljb25CdXR0b24oXHJcbiAgICAgIGN1cnJlbnRUaGVtZSgpID09PSBcImRhcmtcIiA/IFwic3VuXCIgOiBcIm1vb25cIixcclxuICAgICAgXCJcdTA0MjFcdTA0M0NcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDJcdTA0NEMgXHUwNDQyXHUwNDM1XHUwNDNDXHUwNDQzXCIsXHJcbiAgICAgICgpID0+IHtcclxuICAgICAgICBjb25zdCBuZXh0ID0gdG9nZ2xlVGhlbWUoKTtcclxuICAgICAgICByZXBsYWNlKGJ0biwgaWNvbihuZXh0ID09PSBcImRhcmtcIiA/IFwic3VuXCIgOiBcIm1vb25cIiwgMTgpKTtcclxuICAgICAgfSxcclxuICAgICk7XHJcbiAgICByZXR1cm4gYnRuO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBicmFuZChzdWZmaXggPSBcIlwiKTogSFRNTEVsZW1lbnQge1xyXG4gICAgcmV0dXJuIGgoXHJcbiAgICAgIFwiYnV0dG9uXCIsXHJcbiAgICAgIHtcclxuICAgICAgICBjbGFzczogXCJicmFuZFwiLFxyXG4gICAgICAgIGF0dHJzOiB7IHR5cGU6IFwiYnV0dG9uXCIsIFwiYXJpYS1sYWJlbFwiOiBcIlx1MDQxMFx1MDQyMlx1MDQxQlx1MDQxNVx1MDQyMiBcdTIwMTQgXHUwNDNEXHUwNDMwIFx1MDQzM1x1MDQzQlx1MDQzMFx1MDQzMlx1MDQzRFx1MDQ0M1x1MDQ0RVwiIH0sXHJcbiAgICAgICAgb246IHsgY2xpY2s6ICgpID0+IHRoaXMuY3R4Lm5hdmlnYXRlKFwiaG9tZVwiKSB9LFxyXG4gICAgICB9LFxyXG4gICAgICBoKFwic3BhblwiLCB7IGNsYXNzOiBcImxvZ28tbWFya1wiIH0sIGljb24oXCJkdW1iYmVsbFwiLCAyMikpLFxyXG4gICAgICBoKFwic3BhblwiLCB7XHJcbiAgICAgICAgY2xhc3M6IFwiYnJhbmQtbmFtZVwiLFxyXG4gICAgICAgIHRleHQ6IHN1ZmZpeCA/IGBcdTA0MTBcdTA0MjJcdTA0MUJcdTA0MTVcdTA0MjIgJHtzdWZmaXh9YCA6IFwiXHUwNDEwXHUwNDIyXHUwNDFCXHUwNDE1XHUwNDIyXCIsXHJcbiAgICAgIH0pLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmVuZGVySGVhZGVyKCk6IHZvaWQge1xyXG4gICAgY29uc3QgdXNlciA9IHRoaXMuY3R4LmF1dGguY3VycmVudFVzZXIoKTtcclxuICAgIGxldCB2YXJpYW50OiBzdHJpbmc7XHJcbiAgICBsZXQgaXRlbXM6IEhUTUxFbGVtZW50W107XHJcblxyXG4gICAgaWYgKHRoaXMucm91dGUgPT09IFwiYXV0aFwiKSB7XHJcbiAgICAgIHZhcmlhbnQgPSBcInRvcC1wdWJsaWNcIjtcclxuICAgICAgaXRlbXMgPSBbXHJcbiAgICAgICAgdGhpcy5icmFuZCgpLFxyXG4gICAgICAgIGgoXHJcbiAgICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgICAgeyBjbGFzczogXCJ0b3AtYWN0aW9uc1wiIH0sXHJcbiAgICAgICAgICBidXR0b24oe1xyXG4gICAgICAgICAgICBsYWJlbDogXCJcdTA0MURcdTA0MzAgXHUwNDMzXHUwNDNCXHUwNDMwXHUwNDMyXHUwNDNEXHUwNDQzXHUwNDRFXCIsXHJcbiAgICAgICAgICAgIHRvbmU6IFwiZ2hvc3RcIixcclxuICAgICAgICAgICAgc21hbGw6IHRydWUsXHJcbiAgICAgICAgICAgIGljb246IFwiYXJyb3ctbGVmdFwiLFxyXG4gICAgICAgICAgICBvbkNsaWNrOiAoKSA9PiB0aGlzLmN0eC5uYXZpZ2F0ZShcImhvbWVcIiksXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICAgIHRoaXMudGhlbWVCdXR0b24oKSxcclxuICAgICAgICApLFxyXG4gICAgICBdO1xyXG4gICAgfSBlbHNlIGlmICh0aGlzLnJvdXRlID09PSBcImhvbWVcIikge1xyXG4gICAgICB2YXJpYW50ID0gXCJ0b3AtcHVibGljXCI7XHJcbiAgICAgIGNvbnN0IGFuY2hvciA9IChpZDogc3RyaW5nLCBsYWJlbDogc3RyaW5nKTogSFRNTEVsZW1lbnQgPT5cclxuICAgICAgICBoKFwiYnV0dG9uXCIsIHtcclxuICAgICAgICAgIGNsYXNzOiBcIm5hdi1saW5rXCIsXHJcbiAgICAgICAgICBhdHRyczogeyB0eXBlOiBcImJ1dHRvblwiIH0sXHJcbiAgICAgICAgICB0ZXh0OiBsYWJlbCxcclxuICAgICAgICAgIG9uOiB7XHJcbiAgICAgICAgICAgIGNsaWNrOiAoKSA9PlxyXG4gICAgICAgICAgICAgIGRvY3VtZW50XHJcbiAgICAgICAgICAgICAgICAuZ2V0RWxlbWVudEJ5SWQoaWQpXHJcbiAgICAgICAgICAgICAgICA/LnNjcm9sbEludG9WaWV3KHsgYmVoYXZpb3I6IFwic21vb3RoXCIsIGJsb2NrOiBcInN0YXJ0XCIgfSksXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pO1xyXG4gICAgICBpdGVtcyA9IFtcclxuICAgICAgICB0aGlzLmJyYW5kKCksXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwibmF2XCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcIm5hdiBuYXYtcHVibGljXCIsIGF0dHJzOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlx1MDQyMFx1MDQzMFx1MDQzN1x1MDQzNFx1MDQzNVx1MDQzQlx1MDQ0QlwiIH0gfSxcclxuICAgICAgICAgIGFuY2hvcihcImRpcmVjdGlvbnNcIiwgXCJcdTA0MURcdTA0MzBcdTA0M0ZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NEZcIiksXHJcbiAgICAgICAgICBhbmNob3IoXCJ0cmFpbmVyc1wiLCBcIlx1MDQyMlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzNVx1MDQ0MFx1MDQ0QlwiKSxcclxuICAgICAgICAgIGFuY2hvcihcInByaWNpbmdcIiwgXCJcdTA0MjZcdTA0MzVcdTA0M0RcdTA0NEJcIiksXHJcbiAgICAgICAgKSxcclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJkaXZcIixcclxuICAgICAgICAgIHsgY2xhc3M6IFwidG9wLWFjdGlvbnNcIiB9LFxyXG4gICAgICAgICAgYnV0dG9uKHtcclxuICAgICAgICAgICAgbGFiZWw6IHVzZXIgPyBcIlx1MDQxMiBcdTA0NDBcdTA0MzBcdTA0NDFcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzBcdTA0M0RcdTA0MzhcdTA0MzVcIiA6IFwiXHUwNDEyXHUwNDNFXHUwNDM5XHUwNDQyXHUwNDM4XCIsXHJcbiAgICAgICAgICAgIHRvbmU6IFwicHJpbWFyeVwiLFxyXG4gICAgICAgICAgICBzbWFsbDogdHJ1ZSxcclxuICAgICAgICAgICAgb25DbGljazogKCkgPT4gdGhpcy5jdHgubmF2aWdhdGUodXNlciA/IFwic2NoZWR1bGVcIiA6IFwiYXV0aFwiKSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgdGhpcy50aGVtZUJ1dHRvbigpLFxyXG4gICAgICAgICksXHJcbiAgICAgIF07XHJcbiAgICB9IGVsc2UgaWYgKHRoaXMucm91dGUgPT09IFwiYWRtaW5cIiAmJiB1c2VyKSB7XHJcbiAgICAgIHZhcmlhbnQgPSBcInRvcC1hZG1pblwiO1xyXG4gICAgICBpdGVtcyA9IFtcclxuICAgICAgICB0aGlzLmJyYW5kKFwiQURNSU5cIiksXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcInRvcC1hY3Rpb25zXCIgfSxcclxuICAgICAgICAgIGJ1dHRvbih7XHJcbiAgICAgICAgICAgIGxhYmVsOiBcIlx1MDQxRFx1MDQzMCBcdTA0NDFcdTA0MzBcdTA0MzlcdTA0NDJcIixcclxuICAgICAgICAgICAgdG9uZTogXCJnaG9zdFwiLFxyXG4gICAgICAgICAgICBzbWFsbDogdHJ1ZSxcclxuICAgICAgICAgICAgaWNvbjogXCJhcnJvdy1sZWZ0XCIsXHJcbiAgICAgICAgICAgIG9uQ2xpY2s6ICgpID0+IHRoaXMuY3R4Lm5hdmlnYXRlKFwic2NoZWR1bGVcIiksXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICAgIHRoaXMudGhlbWVCdXR0b24oKSxcclxuICAgICAgICAgIHRoaXMudXNlckNoaXAodXNlciksXHJcbiAgICAgICAgKSxcclxuICAgICAgXTtcclxuICAgIH0gZWxzZSBpZiAodXNlcikge1xyXG4gICAgICB2YXJpYW50ID0gXCJ0b3AtYXBwXCI7XHJcbiAgICAgIGNvbnN0IHVwY29taW5nID0gdGhpcy51cGNvbWluZ0NvdW50KCk7XHJcbiAgICAgIGNvbnN0IG5hdkJ0biA9IChcclxuICAgICAgICByb3V0ZTogUm91dGUsXHJcbiAgICAgICAgbGFiZWw6IHN0cmluZyxcclxuICAgICAgICBuYW1lOiBcImNhbGVuZGFyXCIgfCBcInRpY2tldFwiLFxyXG4gICAgICAgIGJhZGdlID0gMCxcclxuICAgICAgKTogSFRNTEVsZW1lbnQgPT5cclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJidXR0b25cIixcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgY2xhc3M6IGBuYXYtYnRuJHt0aGlzLnJvdXRlID09PSByb3V0ZSA/IFwiIGFjdGl2ZVwiIDogXCJcIn1gLFxyXG4gICAgICAgICAgICBhdHRyczoge1xyXG4gICAgICAgICAgICAgIHR5cGU6IFwiYnV0dG9uXCIsXHJcbiAgICAgICAgICAgICAgLi4uKHRoaXMucm91dGUgPT09IHJvdXRlID8geyBcImFyaWEtY3VycmVudFwiOiBcInBhZ2VcIiB9IDoge30pLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBvbjogeyBjbGljazogKCkgPT4gdGhpcy5jdHgubmF2aWdhdGUocm91dGUpIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgaWNvbihuYW1lLCAyMCksXHJcbiAgICAgICAgICBoKFwic3BhblwiLCB7IHRleHQ6IGxhYmVsIH0pLFxyXG4gICAgICAgICAgYmFkZ2UgPiAwID8gaChcImVtXCIsIHsgY2xhc3M6IFwiYmFkZ2VcIiwgdGV4dDogU3RyaW5nKGJhZGdlKSB9KSA6IG51bGwsXHJcbiAgICAgICAgKTtcclxuICAgICAgaXRlbXMgPSBbXHJcbiAgICAgICAgdGhpcy5icmFuZCgpLFxyXG4gICAgICAgIGgoXHJcbiAgICAgICAgICBcIm5hdlwiLFxyXG4gICAgICAgICAgeyBjbGFzczogXCJuYXZcIiwgYXR0cnM6IHsgXCJhcmlhLWxhYmVsXCI6IFwiXHUwNDFFXHUwNDQxXHUwNDNEXHUwNDNFXHUwNDMyXHUwNDNEXHUwNDMwXHUwNDRGIFx1MDQzRFx1MDQzMFx1MDQzMlx1MDQzOFx1MDQzM1x1MDQzMFx1MDQ0Nlx1MDQzOFx1MDQ0RlwiIH0gfSxcclxuICAgICAgICAgIG5hdkJ0bihcInNjaGVkdWxlXCIsIFwiXHUwNDIwXHUwNDMwXHUwNDQxXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDM1XCIsIFwiY2FsZW5kYXJcIiksXHJcbiAgICAgICAgICBuYXZCdG4oXCJib29raW5nc1wiLCBcIlx1MDQxQ1x1MDQzRVx1MDQzOCBcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzhcIiwgXCJ0aWNrZXRcIiwgdXBjb21pbmcpLFxyXG4gICAgICAgICksXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcInRvcC1hY3Rpb25zXCIgfSxcclxuICAgICAgICAgIHRoaXMudGhlbWVCdXR0b24oKSxcclxuICAgICAgICAgIHRoaXMudXNlckNoaXAodXNlciksXHJcbiAgICAgICAgKSxcclxuICAgICAgXTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHZhcmlhbnQgPSBcInRvcC1wdWJsaWNcIjtcclxuICAgICAgaXRlbXMgPSBbXHJcbiAgICAgICAgdGhpcy5icmFuZCgpLFxyXG4gICAgICAgIGgoXCJkaXZcIiwgeyBjbGFzczogXCJ0b3AtYWN0aW9uc1wiIH0sIHRoaXMudGhlbWVCdXR0b24oKSksXHJcbiAgICAgIF07XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5oZWFkZXIuY2xhc3NOYW1lID0gYHRvcCAke3ZhcmlhbnR9YDtcclxuICAgIHJlcGxhY2UodGhpcy5oZWFkZXIsIGgoXCJkaXZcIiwgeyBjbGFzczogXCJ0b3AtaW5uZXJcIiB9LCAuLi5pdGVtcykpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSB1c2VyQ2hpcCh1c2VyOiBVc2VyKTogSFRNTEVsZW1lbnQge1xyXG4gICAgcmV0dXJuIGgoXHJcbiAgICAgIFwiZGl2XCIsXHJcbiAgICAgIHsgY2xhc3M6IFwidXNlci1jaGlwXCIgfSxcclxuICAgICAgYXZhdGFyKHVzZXIubmFtZSksXHJcbiAgICAgIGgoXCJzcGFuXCIsIHsgY2xhc3M6IFwidXNlci1uYW1lXCIsIHRleHQ6IHVzZXIubmFtZSB9KSxcclxuICAgICAgaWNvbkJ1dHRvbihcImxvZ291dFwiLCBcIlx1MDQxMlx1MDQ0Qlx1MDQzOVx1MDQ0Mlx1MDQzOFwiLCAoKSA9PiB7XHJcbiAgICAgICAgdm9pZCB0aGlzLmN0eC5hdXRoLmxvZ291dCgpO1xyXG4gICAgICB9KSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHVwY29taW5nQ291bnQoKTogbnVtYmVyIHtcclxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgICByZXR1cm4gdGhpcy5jdHguYm9va2luZy5vZkN1cnJlbnRVc2VyKCkuZmlsdGVyKChiKSA9PiB7XHJcbiAgICAgIGNvbnN0IHMgPSB0aGlzLmN0eC5zdGF0ZS5zZXNzaW9uQnlJZChiLnNlc3Npb25JZCk7XHJcbiAgICAgIHJldHVybiBzICE9PSB1bmRlZmluZWQgJiYgIWlzRmluaXNoZWQocywgbm93KTtcclxuICAgIH0pLmxlbmd0aDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgbmV0d29ya0NoYW5nZWQob25saW5lOiBib29sZWFuKTogdm9pZCB7XHJcbiAgICB0aGlzLnN5bmNCYW5uZXIoKTtcclxuICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KFxyXG4gICAgICBvbmxpbmUgPyBcIlx1MDQyMVx1MDQzRVx1MDQzNVx1MDQzNFx1MDQzOFx1MDQzRFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQzNSBcdTA0MzJcdTA0M0VcdTA0NDFcdTA0NDFcdTA0NDJcdTA0MzBcdTA0M0RcdTA0M0VcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0M0VcIiA6IFwiXHUwNDIxXHUwNDNFXHUwNDM1XHUwNDM0XHUwNDM4XHUwNDNEXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM1IFx1MDQzRlx1MDQzRVx1MDQ0Mlx1MDQzNVx1MDQ0MFx1MDQ0Rlx1MDQzRFx1MDQzRVwiLFxyXG4gICAgICBvbmxpbmUgPyBcIm9rXCIgOiBcImVyclwiLFxyXG4gICAgKTtcclxuICAgIGlmIChvbmxpbmUpIHZvaWQgdGhpcy5jdHguc3RhdGUucmVmcmVzaCgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzeW5jQmFubmVyKCk6IHZvaWQge1xyXG4gICAgY29uc3Qgb2ZmbGluZSA9ICFuYXZpZ2F0b3Iub25MaW5lO1xyXG4gICAgY29uc3Qgc2VydmVyRG93biA9IG5hdmlnYXRvci5vbkxpbmUgJiYgIXRoaXMuY3R4LnN0YXRlLmlzU3luY09rO1xyXG4gICAgdGhpcy5iYW5uZXIuaGlkZGVuID0gKCFvZmZsaW5lICYmICFzZXJ2ZXJEb3duKSB8fCB0aGlzLnJvdXRlID09PSBcImF1dGhcIjtcclxuICAgIHRoaXMuYmFubmVyVGV4dC50ZXh0Q29udGVudCA9IG9mZmxpbmVcclxuICAgICAgPyBcIlx1MDQxRFx1MDQzNVx1MDQ0MiBcdTA0NDFcdTA0M0VcdTA0MzVcdTA0MzRcdTA0MzhcdTA0M0RcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NEYgXHUyMDE0IFx1MDQzRlx1MDQzRVx1MDQzQVx1MDQzMFx1MDQzN1x1MDQzMFx1MDQzRFx1MDQ0QiBcdTA0NDFcdTA0M0VcdTA0NDVcdTA0NDBcdTA0MzBcdTA0M0RcdTA0NTFcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDM0XHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1XCJcclxuICAgICAgOiBcIlx1MDQyMVx1MDQzNVx1MDQ0MFx1MDQzMlx1MDQzNVx1MDQ0MCBcdTA0M0RcdTA0MzVcdTA0MzRcdTA0M0VcdTA0NDFcdTA0NDJcdTA0NDNcdTA0M0ZcdTA0MzVcdTA0M0QgXHUyMDE0IFx1MDQzRlx1MDQzRVx1MDQzQVx1MDQzMFx1MDQzN1x1MDQzMFx1MDQzRFx1MDQ0QiBcdTA0NDFcdTA0M0VcdTA0NDVcdTA0NDBcdTA0MzBcdTA0M0RcdTA0NTFcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDM0XHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1XCI7XHJcbiAgfVxyXG4gIHByaXZhdGUgcmVuZGVyTW9iaWxlTmF2KCk6IHZvaWQge1xyXG4gICAgY29uc3QgdXNlciA9IHRoaXMuY3R4LmF1dGguY3VycmVudFVzZXIoKTtcclxuICAgIGlmIChcclxuICAgICAgIXVzZXIgfHxcclxuICAgICAgdGhpcy5yb3V0ZSA9PT0gXCJob21lXCIgfHxcclxuICAgICAgdGhpcy5yb3V0ZSA9PT0gXCJhdXRoXCIgfHxcclxuICAgICAgdGhpcy5yb3V0ZSA9PT0gXCJhZG1pblwiXHJcbiAgICApIHtcclxuICAgICAgdGhpcy5tb2JpbGVOYXYucmVwbGFjZUNoaWxkcmVuKCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IHVwY29taW5nID0gdGhpcy51cGNvbWluZ0NvdW50KCk7XHJcbiAgICBjb25zdCBidG4gPSAoXHJcbiAgICAgIHJvdXRlOiBSb3V0ZSxcclxuICAgICAgbGFiZWw6IHN0cmluZyxcclxuICAgICAgbmFtZTogXCJjYWxlbmRhclwiIHwgXCJ0aWNrZXRcIixcclxuICAgICAgYmFkZ2UgPSAwLFxyXG4gICAgKTogSFRNTEVsZW1lbnQgPT5cclxuICAgICAgaChcclxuICAgICAgICBcImJ1dHRvblwiLFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIGNsYXNzOiBgbW9iLW5hdi1idG4ke3RoaXMucm91dGUgPT09IHJvdXRlID8gXCIgYWN0aXZlXCIgOiBcIlwifWAsXHJcbiAgICAgICAgICBhdHRyczoge1xyXG4gICAgICAgICAgICB0eXBlOiBcImJ1dHRvblwiLFxyXG4gICAgICAgICAgICAuLi4odGhpcy5yb3V0ZSA9PT0gcm91dGUgPyB7IFwiYXJpYS1jdXJyZW50XCI6IFwicGFnZVwiIH0gOiB7fSksXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgb246IHsgY2xpY2s6ICgpID0+IHRoaXMuY3R4Lm5hdmlnYXRlKHJvdXRlKSB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaWNvbihuYW1lLCAyMiksXHJcbiAgICAgICAgaChcInNwYW5cIiwgeyB0ZXh0OiBsYWJlbCB9KSxcclxuICAgICAgICBiYWRnZSA+IDAgPyBoKFwiZW1cIiwgeyBjbGFzczogXCJiYWRnZVwiLCB0ZXh0OiBTdHJpbmcoYmFkZ2UpIH0pIDogbnVsbCxcclxuICAgICAgKTtcclxuICAgIHJlcGxhY2UoXHJcbiAgICAgIHRoaXMubW9iaWxlTmF2LFxyXG4gICAgICBidG4oXCJzY2hlZHVsZVwiLCBcIlx1MDQyMFx1MDQzMFx1MDQ0MVx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzMFx1MDQzRFx1MDQzOFx1MDQzNVwiLCBcImNhbGVuZGFyXCIpLFxyXG4gICAgICBidG4oXCJib29raW5nc1wiLCBcIlx1MDQxN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzOFwiLCBcInRpY2tldFwiLCB1cGNvbWluZyksXHJcbiAgICApO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHR5cGUgeyBBcHBDb250ZXh0LCBSb3V0ZSB9IGZyb20gXCIuL2NvbnRleHRcIjtcclxuaW1wb3J0IHR5cGUgeyBWaWV3IH0gZnJvbSBcIi4uL3ZpZXdzL3ZpZXdcIjtcclxuXHJcbmV4cG9ydCB0eXBlIFZpZXdGYWN0b3J5ID0gKCkgPT4gVmlldztcclxuY29uc3QgUk9VVEVTOiByZWFkb25seSBSb3V0ZVtdID0gW1xyXG4gIFwiaG9tZVwiLFxyXG4gIFwiYXV0aFwiLFxyXG4gIFwic2NoZWR1bGVcIixcclxuICBcImJvb2tpbmdzXCIsXHJcbiAgXCJhZG1pblwiLFxyXG5dO1xyXG5cclxuZXhwb3J0IGNsYXNzIFJvdXRlciB7XHJcbiAgcHJpdmF0ZSBjdXJyZW50OiBWaWV3IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBjdXJyZW50Um91dGU6IFJvdXRlIHwgbnVsbCA9IG51bGw7XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBjdHg6IEFwcENvbnRleHQsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGhvc3Q6IEhUTUxFbGVtZW50LFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBmYWN0b3JpZXM6IFJlY29yZDxSb3V0ZSwgVmlld0ZhY3Rvcnk+LFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBvblJvdXRlOiAocm91dGU6IFJvdXRlKSA9PiB2b2lkLFxyXG4gICkge31cclxuXHJcbiAgc3RhcnQoKTogdm9pZCB7XHJcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcImhhc2hjaGFuZ2VcIiwgKCkgPT4gdGhpcy5yZXNvbHZlKCkpO1xyXG4gICAgdGhpcy5jdHguYnVzLm9uKFwiYXV0aFwiLCAoKSA9PiB0aGlzLnJlc29sdmUoKSk7XHJcbiAgICB0aGlzLmN0eC5idXMub24oXCJ1c2Vyc1wiLCAoKSA9PiB0aGlzLnJlc29sdmUoKSk7XHJcbiAgICB0aGlzLnJlc29sdmUoKTtcclxuICB9XHJcblxyXG4gIG5hdmlnYXRlKHJvdXRlOiBSb3V0ZSk6IHZvaWQge1xyXG4gICAgY29uc3QgaGFzaCA9IGAjLyR7cm91dGV9YDtcclxuICAgIGlmIChsb2NhdGlvbi5oYXNoID09PSBoYXNoKSB0aGlzLnJlc29sdmUoKTtcclxuICAgIGVsc2UgbG9jYXRpb24uaGFzaCA9IGhhc2g7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJlc29sdmUoKTogdm9pZCB7XHJcbiAgICBjb25zdCByb3V0ZSA9IHRoaXMuZ3VhcmQodGhpcy5wYXJzZSgpKTtcclxuICAgIGNvbnN0IGNhbm9uaWNhbCA9IGAjLyR7cm91dGV9YDtcclxuICAgIGlmIChsb2NhdGlvbi5oYXNoICE9PSBjYW5vbmljYWwpIGhpc3RvcnkucmVwbGFjZVN0YXRlKG51bGwsIFwiXCIsIGNhbm9uaWNhbCk7XHJcbiAgICB0aGlzLm9uUm91dGUocm91dGUpO1xyXG4gICAgaWYgKHJvdXRlID09PSB0aGlzLmN1cnJlbnRSb3V0ZSAmJiB0aGlzLmN1cnJlbnQpIHJldHVybjtcclxuICAgIHRoaXMuY3VycmVudD8uZGVzdHJveSgpO1xyXG4gICAgdGhpcy5jdXJyZW50Um91dGUgPSByb3V0ZTtcclxuICAgIHRoaXMuY3VycmVudCA9IHRoaXMuZmFjdG9yaWVzW3JvdXRlXSgpO1xyXG4gICAgdGhpcy5ob3N0LnJlcGxhY2VDaGlsZHJlbigpO1xyXG4gICAgdGhpcy5jdXJyZW50Lm1vdW50KHRoaXMuaG9zdCk7XHJcbiAgICB3aW5kb3cuc2Nyb2xsVG8oeyB0b3A6IDAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHBhcnNlKCk6IFJvdXRlIHtcclxuICAgIGNvbnN0IHJhdyA9IGxvY2F0aW9uLmhhc2gucmVwbGFjZSgvXiNcXC8/LywgXCJcIik7XHJcbiAgICByZXR1cm4gKFJPVVRFUyBhcyByZWFkb25seSBzdHJpbmdbXSkuaW5jbHVkZXMocmF3KVxyXG4gICAgICA/IChyYXcgYXMgUm91dGUpXHJcbiAgICAgIDogXCJob21lXCI7XHJcbiAgfVxyXG5cclxuICAvKiogXHUwNDFCXHUwNDM1XHUwNDNEXHUwNDM0XHUwNDM4XHUwNDNEXHUwNDMzIFx1MDQzNFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0M1x1MDQzRlx1MDQzNVx1MDQzRCBcdTA0MzJcdTA0NDFcdTA0MzVcdTA0M0MuIFx1MDQxN1x1MDQzMFx1MDQzQVx1MDQ0MFx1MDQ0Qlx1MDQ0Mlx1MDQ0QiBcdTA0NDJcdTA0M0VcdTA0M0JcdTA0NENcdTA0M0FcdTA0M0UgYXV0aCBcdTA0MzRcdTA0M0JcdTA0NEYgXHUwNDMwXHUwNDMyXHUwNDQyXHUwNDNFXHUwNDQwXHUwNDM4XHUwNDM3XHUwNDNFXHUwNDMyXHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDQ1IFx1MDQzOCBhZG1pbiBcdTA0MzRcdTA0M0JcdTA0NEYgXHUwNDNEXHUwNDM1LVx1MDQzMFx1MDQzNFx1MDQzQ1x1MDQzOFx1MDQzRFx1MDQzRVx1MDQzMi4gKi9cclxuICBwcml2YXRlIGd1YXJkKHJlcXVlc3RlZDogUm91dGUpOiBSb3V0ZSB7XHJcbiAgICBjb25zdCB1c2VyID0gdGhpcy5jdHguYXV0aC5jdXJyZW50VXNlcigpO1xyXG4gICAgaWYgKCF1c2VyKSByZXR1cm4gcmVxdWVzdGVkID09PSBcImF1dGhcIiA/IFwiYXV0aFwiIDogXCJob21lXCI7XHJcbiAgICBpZiAocmVxdWVzdGVkID09PSBcImF1dGhcIilcclxuICAgICAgcmV0dXJuIHVzZXIucm9sZSA9PT0gXCJhZG1pblwiID8gXCJhZG1pblwiIDogXCJzY2hlZHVsZVwiO1xyXG4gICAgaWYgKHJlcXVlc3RlZCA9PT0gXCJhZG1pblwiICYmIHVzZXIucm9sZSAhPT0gXCJhZG1pblwiKSByZXR1cm4gXCJzY2hlZHVsZVwiO1xyXG4gICAgcmV0dXJuIHJlcXVlc3RlZDtcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB0eXBlIHsgU2NoZWR1bGVGaWx0ZXJzIH0gZnJvbSBcIi4uL2NvcmUvdHlwZXNcIjtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgRmlsdGVyUHJlc2V0IHtcclxuICBpZDogc3RyaW5nO1xyXG4gIG5hbWU6IHN0cmluZztcclxuICBmaWx0ZXJzOiBTY2hlZHVsZUZpbHRlcnM7XHJcbn1cclxuXHJcbmNvbnN0IEtFWSA9IFwiYXRsZXQ6cHJlc2V0czp2MVwiO1xyXG5cclxuZXhwb3J0IGNsYXNzIFNhdmVkVmlld3NTdG9yZSB7XHJcbiAgYWxsKCk6IEZpbHRlclByZXNldFtdIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJhdyA9IGxvY2FsU3RvcmFnZS5nZXRJdGVtKEtFWSk7XHJcbiAgICAgIGNvbnN0IHBhcnNlZDogdW5rbm93biA9IHJhdyA/IEpTT04ucGFyc2UocmF3KSA6IFtdO1xyXG4gICAgICByZXR1cm4gQXJyYXkuaXNBcnJheShwYXJzZWQpID8gKHBhcnNlZCBhcyBGaWx0ZXJQcmVzZXRbXSkgOiBbXTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcbiAgfVxyXG4gIHNhdmUobmFtZTogc3RyaW5nLCBmaWx0ZXJzOiBTY2hlZHVsZUZpbHRlcnMpOiB2b2lkIHtcclxuICAgIGNvbnN0IHByZXNldDogRmlsdGVyUHJlc2V0ID0ge1xyXG4gICAgICBpZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcclxuICAgICAgbmFtZSxcclxuICAgICAgZmlsdGVyczogeyAuLi5maWx0ZXJzIH0sXHJcbiAgICB9O1xyXG4gICAgdHJ5IHtcclxuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oS0VZLCBKU09OLnN0cmluZ2lmeShbLi4udGhpcy5hbGwoKSwgcHJlc2V0XSkpO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgIC8qIG5vb3AgKi9cclxuICAgIH1cclxuICB9XHJcbiAgcmVtb3ZlKGlkOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxyXG4gICAgICAgIEtFWSxcclxuICAgICAgICBKU09OLnN0cmluZ2lmeSh0aGlzLmFsbCgpLmZpbHRlcigocCkgPT4gcC5pZCAhPT0gaWQpKSxcclxuICAgICAgKTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICAvKiBub29wICovXHJcbiAgICB9XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgdHlwZSB7IEFwaSB9IGZyb20gXCIuLi9hcGkvY2xpZW50XCI7XHJcbmltcG9ydCB0eXBlIHsgRG9tYWluRXJyb3IgfSBmcm9tIFwiLi4vY29yZS9lcnJvcnNcIjtcclxuaW1wb3J0IHsgZmFpbCwgb2ssIHR5cGUgUmVzdWx0IH0gZnJvbSBcIi4uL2NvcmUvcmVzdWx0XCI7XHJcbmltcG9ydCB0eXBlIHsgQm9va2luZywgVXNlciwgV29ya291dFNlc3Npb24gfSBmcm9tIFwiLi4vY29yZS90eXBlc1wiO1xyXG5cclxuZXhwb3J0IHR5cGUgQXBwRXZlbnQgPSBcImF1dGhcIiB8IFwic2Vzc2lvbnNcIiB8IFwiYm9va2luZ3NcIiB8IFwidXNlcnNcIiB8IFwic3luY1wiO1xyXG5cclxuZXhwb3J0IGNsYXNzIEV2ZW50QnVzIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IGxpc3RlbmVycyA9IG5ldyBNYXA8QXBwRXZlbnQsIFNldDwoKSA9PiB2b2lkPj4oKTtcclxuICBvbihldmVudDogQXBwRXZlbnQsIGZuOiAoKSA9PiB2b2lkKTogKCkgPT4gdm9pZCB7XHJcbiAgICBjb25zdCBzZXQgPSB0aGlzLmxpc3RlbmVycy5nZXQoZXZlbnQpID8/IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKTtcclxuICAgIHNldC5hZGQoZm4pO1xyXG4gICAgdGhpcy5saXN0ZW5lcnMuc2V0KGV2ZW50LCBzZXQpO1xyXG4gICAgcmV0dXJuICgpID0+IHNldC5kZWxldGUoZm4pO1xyXG4gIH1cclxuICBlbWl0KGV2ZW50OiBBcHBFdmVudCk6IHZvaWQge1xyXG4gICAgZm9yIChjb25zdCBmbiBvZiBbLi4uKHRoaXMubGlzdGVuZXJzLmdldChldmVudCkgPz8gW10pXSkgZm4oKTtcclxuICB9XHJcbn1cclxuXHJcbmNvbnN0IFNOQVBTSE9UX0tFWSA9IFwiYXRsZXQ6c25hcHNob3Q6djFcIjtcclxuXHJcbmV4cG9ydCBjbGFzcyBBcHBTdGF0ZSB7XHJcbiAgcHJpdmF0ZSB1c2VyOiBVc2VyIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSB1c2VyczogVXNlcltdID0gW107XHJcbiAgcHJpdmF0ZSBzZXNzaW9uczogV29ya291dFNlc3Npb25bXSA9IFtdO1xyXG4gIHByaXZhdGUgYm9va2luZ3M6IEJvb2tpbmdbXSA9IFtdO1xyXG4gIHByaXZhdGUgc3luY09rID0gdHJ1ZTtcclxuICBwcml2YXRlIHN5bmNFcnJvckhhbmRsZXI6ICgoZTogRG9tYWluRXJyb3IpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBhcGk6IEFwaSxcclxuICAgIHJlYWRvbmx5IGJ1czogRXZlbnRCdXMsXHJcbiAgKSB7fVxyXG5cclxuICBnZXQgbWUoKTogVXNlciB8IG51bGwge1xyXG4gICAgcmV0dXJuIHRoaXMudXNlcjtcclxuICB9XHJcbiAgZ2V0IGlzU3luY09rKCk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIHRoaXMuc3luY09rO1xyXG4gIH1cclxuICBvblN5bmNFcnJvcihmbjogKGU6IERvbWFpbkVycm9yKSA9PiB2b2lkKTogdm9pZCB7XHJcbiAgICB0aGlzLnN5bmNFcnJvckhhbmRsZXIgPSBmbjtcclxuICB9XHJcbiAgbWFya1N5bmNGYWlsZWQoKTogdm9pZCB7XHJcbiAgICB0aGlzLnN5bmNPayA9IGZhbHNlO1xyXG4gICAgdGhpcy5idXMuZW1pdChcInN5bmNcIik7XHJcbiAgfVxyXG4gIHNldE1lKHVzZXI6IFVzZXIgfCBudWxsKTogdm9pZCB7XHJcbiAgICB0aGlzLnVzZXIgPSB1c2VyO1xyXG4gICAgaWYgKCF1c2VyKSB7XHJcbiAgICAgIHRoaXMudXNlcnMgPSBbXTtcclxuICAgICAgdGhpcy5zZXNzaW9ucyA9IFtdO1xyXG4gICAgICB0aGlzLmJvb2tpbmdzID0gW107XHJcbiAgICB9XHJcbiAgICB0aGlzLmJ1cy5lbWl0KFwiYXV0aFwiKTtcclxuICB9XHJcblxyXG4gIGFsbFVzZXJzKCk6IHJlYWRvbmx5IFVzZXJbXSB7XHJcbiAgICByZXR1cm4gdGhpcy51c2VycztcclxuICB9XHJcbiAgYWxsU2Vzc2lvbnMoKTogcmVhZG9ubHkgV29ya291dFNlc3Npb25bXSB7XHJcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9ucztcclxuICB9XHJcbiAgYWxsQm9va2luZ3MoKTogcmVhZG9ubHkgQm9va2luZ1tdIHtcclxuICAgIHJldHVybiB0aGlzLmJvb2tpbmdzO1xyXG4gIH1cclxuICB1c2VyQnlJZChpZDogc3RyaW5nKTogVXNlciB8IHVuZGVmaW5lZCB7XHJcbiAgICByZXR1cm4gdGhpcy51c2Vycy5maW5kKCh1KSA9PiB1LmlkID09PSBpZCk7XHJcbiAgfVxyXG4gIHNlc3Npb25CeUlkKGlkOiBzdHJpbmcpOiBXb3Jrb3V0U2Vzc2lvbiB8IHVuZGVmaW5lZCB7XHJcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9ucy5maW5kKChzKSA9PiBzLmlkID09PSBpZCk7XHJcbiAgfVxyXG4gIGJvb2tpbmdCeUlkKGlkOiBzdHJpbmcpOiBCb29raW5nIHwgdW5kZWZpbmVkIHtcclxuICAgIHJldHVybiB0aGlzLmJvb2tpbmdzLmZpbmQoKGIpID0+IGIuaWQgPT09IGlkKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlZnJlc2goKTogUHJvbWlzZTxSZXN1bHQ8dm9pZCwgRG9tYWluRXJyb3I+PiB7XHJcbiAgICBjb25zdCByID0gYXdhaXQgdGhpcy5hcGkuc3RhdGUoKTtcclxuICAgIGlmICghci5vaykge1xyXG4gICAgICBjb25zdCBjb2RlID0gci5lcnJvci5jb2RlO1xyXG4gICAgICAvLyBcdTA0MTFcdTA0MzBcdTA0M0RcdTA0M0RcdTA0MzVcdTA0NDAgXHUwMEFCXHUwNDIxXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDM1XHUwNDQwIFx1MDQzRFx1MDQzNVx1MDQzNFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0M1x1MDQzRlx1MDQzNVx1MDQzRFx1MDBCQiBcdTIwMTQgXHUwNDQyXHUwNDNFXHUwNDNCXHUwNDRDXHUwNDNBXHUwNDNFIFx1MDQzQVx1MDQzRVx1MDQzM1x1MDQzNFx1MDQzMCBcdTA0M0RcdTA0MzVcdTA0NDIgXHUwNDQxXHUwNDM1XHUwNDQyXHUwNDM1XHUwNDMyXHUwNDNFXHUwNDMzXHUwNDNFIFx1MDQzRVx1MDQ0Mlx1MDQzMlx1MDQzNVx1MDQ0Mlx1MDQzMC5cclxuICAgICAgdGhpcy5zeW5jT2sgPSBjb2RlICE9PSBcIm5ldHdvcmtcIjtcclxuICAgICAgaWYgKGNvZGUgPT09IFwidW5hdXRob3JpemVkXCIpIHRoaXMuc2V0TWUobnVsbCk7XHJcbiAgICAgIGVsc2UgdGhpcy5zeW5jRXJyb3JIYW5kbGVyPy4oci5lcnJvcik7XHJcbiAgICAgIHRoaXMuYnVzLmVtaXQoXCJzeW5jXCIpO1xyXG4gICAgICByZXR1cm4gcjtcclxuICAgIH1cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHsgc2Vzc2lvbnMsIGJvb2tpbmdzLCB1c2VycyB9ID0gci52YWx1ZTtcclxuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHNlc3Npb25zKSB8fCAhQXJyYXkuaXNBcnJheShib29raW5ncykpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzdGF0ZTogXHUwNDNFXHUwNDM2XHUwNDM4XHUwNDM0XHUwNDMwXHUwNDRFXHUwNDQyXHUwNDQxXHUwNDRGIFx1MDQzQ1x1MDQzMFx1MDQ0MVx1MDQ0MVx1MDQzOFx1MDQzMlx1MDQ0QiBzZXNzaW9ucy9ib29raW5nc1wiKTtcclxuICAgICAgfVxyXG4gICAgICB0aGlzLnNlc3Npb25zID0gc2Vzc2lvbnM7XHJcbiAgICAgIHRoaXMuYm9va2luZ3MgPSBib29raW5ncztcclxuICAgICAgdGhpcy51c2VycyA9IEFycmF5LmlzQXJyYXkodXNlcnMpID8gdXNlcnMgOiBbXTtcclxuICAgICAgdGhpcy5zeW5jT2sgPSB0cnVlO1xyXG4gICAgICB0aGlzLnBlcnNpc3QoKTtcclxuICAgICAgdGhpcy5idXMuZW1pdChcInNlc3Npb25zXCIpO1xyXG4gICAgICB0aGlzLmJ1cy5lbWl0KFwiYm9va2luZ3NcIik7XHJcbiAgICAgIHRoaXMuYnVzLmVtaXQoXCJ1c2Vyc1wiKTtcclxuICAgICAgdGhpcy5idXMuZW1pdChcInN5bmNcIik7XHJcbiAgICAgIHJldHVybiBvayh1bmRlZmluZWQpO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgIC8vIFx1MDQyMlx1MDQzNVx1MDQzQlx1MDQzRSAyMDAsIFx1MDQzRFx1MDQzRSBcdTA0M0RcdTA0MzUgXHUwNDNGXHUwNDNFIFx1MDQzQVx1MDQzRVx1MDQzRFx1MDQ0Mlx1MDQ0MFx1MDQzMFx1MDQzQVx1MDQ0Mlx1MDQ0MzogXHUwNDQxXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDM1XHUwNDQwIFx1MDQzNlx1MDQzOFx1MDQzMiwgXHUwNDMxXHUwNDMwXHUwNDNEXHUwNDNEXHUwNDM1XHUwNDQwIFx1MDQxRFx1MDQxNSBcdTA0MzJcdTA0MzVcdTA0NDhcdTA0MzBcdTA0MzVcdTA0M0MsIFx1MDQ0OFx1MDQzOFx1MDQzRlx1MDQzOFx1MDQzQyBcdTA0MzIgXHUwNDQyXHUwNDNFXHUwNDQxXHUwNDQyLlxyXG4gICAgICB0aGlzLnN5bmNPayA9IHRydWU7XHJcbiAgICAgIHRoaXMuc3luY0Vycm9ySGFuZGxlcj8uKHtcclxuICAgICAgICBjb2RlOiBcImNvbnRyYWN0XCIsXHJcbiAgICAgICAgbWVzc2FnZTogXCJcdTA0MTRcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDQxXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDMwIFx1MDQzRFx1MDQzNSBcdTA0NDFcdTA0M0VcdTA0M0VcdTA0NDJcdTA0MzJcdTA0MzVcdTA0NDJcdTA0NDFcdTA0NDJcdTA0MzJcdTA0NDNcdTA0NEVcdTA0NDIgXHUwNDQ0XHUwNDNFXHUwNDQwXHUwNDNDXHUwNDMwXHUwNDQyXHUwNDQzXCIsXHJcbiAgICAgIH0pO1xyXG4gICAgICB0aGlzLmJ1cy5lbWl0KFwic3luY1wiKTtcclxuICAgICAgcmV0dXJuIGZhaWwoeyBjb2RlOiBcImNvbnRyYWN0XCIsIG1lc3NhZ2U6IFwiXHUwNDFEXHUwNDM1XHUwNDNBXHUwNDNFXHUwNDQwXHUwNDQwXHUwNDM1XHUwNDNBXHUwNDQyXHUwNDNEXHUwNDRCXHUwNDM5IFx1MDQ0NFx1MDQzRVx1MDQ0MFx1MDQzQ1x1MDQzMFx1MDQ0MiBcdTA0MzRcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0NDVcIiB9KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGxvYWRTbmFwc2hvdCgpOiBib29sZWFuIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJhdyA9IGxvY2FsU3RvcmFnZS5nZXRJdGVtKFNOQVBTSE9UX0tFWSk7XHJcbiAgICAgIGlmICghcmF3KSByZXR1cm4gZmFsc2U7XHJcbiAgICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKHJhdykgYXMge1xyXG4gICAgICAgIHNlc3Npb25zOiBXb3Jrb3V0U2Vzc2lvbltdO1xyXG4gICAgICAgIGJvb2tpbmdzOiBCb29raW5nW107XHJcbiAgICAgICAgdXNlcnM6IFVzZXJbXTtcclxuICAgICAgfTtcclxuICAgICAgdGhpcy5zZXNzaW9ucyA9IGRhdGEuc2Vzc2lvbnMgPz8gW107XHJcbiAgICAgIHRoaXMuYm9va2luZ3MgPSBkYXRhLmJvb2tpbmdzID8/IFtdO1xyXG4gICAgICB0aGlzLnVzZXJzID0gZGF0YS51c2VycyA/PyBbXTtcclxuICAgICAgcmV0dXJuIHRoaXMuc2Vzc2lvbnMubGVuZ3RoID4gMDtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHBlcnNpc3QoKTogdm9pZCB7XHJcbiAgICB0cnkge1xyXG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcclxuICAgICAgICBTTkFQU0hPVF9LRVksXHJcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgc2Vzc2lvbnM6IHRoaXMuc2Vzc2lvbnMsXHJcbiAgICAgICAgICBib29raW5nczogdGhpcy5ib29raW5ncyxcclxuICAgICAgICAgIHVzZXJzOiB0aGlzLnVzZXJzLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICApO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgIC8qIHF1b3RhIC8gcHJpdmF0ZSBtb2RlICovXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhZGRCb29raW5nKGI6IEJvb2tpbmcpOiB2b2lkIHtcclxuICAgIHRoaXMuYm9va2luZ3MgPSBbLi4udGhpcy5ib29raW5ncywgYl07XHJcbiAgICB0aGlzLmJ1cy5lbWl0KFwiYm9va2luZ3NcIik7XHJcbiAgfVxyXG4gIHJlbW92ZUJvb2tpbmcoaWQ6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgdGhpcy5ib29raW5ncyA9IHRoaXMuYm9va2luZ3MuZmlsdGVyKChiKSA9PiBiLmlkICE9PSBpZCk7XHJcbiAgICB0aGlzLmJ1cy5lbWl0KFwiYm9va2luZ3NcIik7XHJcbiAgfVxyXG4gIHJlcGxhY2VCb29raW5nKHRlbXBJZDogc3RyaW5nLCByZWFsOiBCb29raW5nKTogdm9pZCB7XHJcbiAgICB0aGlzLmJvb2tpbmdzID0gdGhpcy5ib29raW5ncy5tYXAoKGIpID0+IChiLmlkID09PSB0ZW1wSWQgPyByZWFsIDogYikpO1xyXG4gICAgdGhpcy5idXMuZW1pdChcImJvb2tpbmdzXCIpO1xyXG4gIH1cclxuXHJcbiAgdXBzZXJ0U2Vzc2lvbihzOiBXb3Jrb3V0U2Vzc2lvbik6IHZvaWQge1xyXG4gICAgY29uc3QgaSA9IHRoaXMuc2Vzc2lvbnMuZmluZEluZGV4KCh4KSA9PiB4LmlkID09PSBzLmlkKTtcclxuICAgIHRoaXMuc2Vzc2lvbnMgPVxyXG4gICAgICBpID49IDBcclxuICAgICAgICA/IHRoaXMuc2Vzc2lvbnMubWFwKCh4KSA9PiAoeC5pZCA9PT0gcy5pZCA/IHMgOiB4KSlcclxuICAgICAgICA6IFsuLi50aGlzLnNlc3Npb25zLCBzXTtcclxuICAgIHRoaXMuYnVzLmVtaXQoXCJzZXNzaW9uc1wiKTtcclxuICB9XHJcbiAgcmVtb3ZlU2Vzc2lvbihpZDogc3RyaW5nKTogdm9pZCB7XHJcbiAgICB0aGlzLnNlc3Npb25zID0gdGhpcy5zZXNzaW9ucy5maWx0ZXIoKHMpID0+IHMuaWQgIT09IGlkKTtcclxuICAgIHRoaXMuYm9va2luZ3MgPSB0aGlzLmJvb2tpbmdzLmZpbHRlcigoYikgPT4gYi5zZXNzaW9uSWQgIT09IGlkKTtcclxuICAgIHRoaXMuYnVzLmVtaXQoXCJzZXNzaW9uc1wiKTtcclxuICAgIHRoaXMuYnVzLmVtaXQoXCJib29raW5nc1wiKTtcclxuICB9XHJcblxyXG4gIHVwc2VydFVzZXIodTogVXNlcik6IHZvaWQge1xyXG4gICAgY29uc3QgaSA9IHRoaXMudXNlcnMuZmluZEluZGV4KCh4KSA9PiB4LmlkID09PSB1LmlkKTtcclxuICAgIHRoaXMudXNlcnMgPVxyXG4gICAgICBpID49IDBcclxuICAgICAgICA/IHRoaXMudXNlcnMubWFwKCh4KSA9PiAoeC5pZCA9PT0gdS5pZCA/IHUgOiB4KSlcclxuICAgICAgICA6IFsuLi50aGlzLnVzZXJzLCB1XTtcclxuICAgIHRoaXMuYnVzLmVtaXQoXCJ1c2Vyc1wiKTtcclxuICB9XHJcbiAgcmVtb3ZlVXNlcihpZDogc3RyaW5nKTogdm9pZCB7XHJcbiAgICB0aGlzLnVzZXJzID0gdGhpcy51c2Vycy5maWx0ZXIoKHUpID0+IHUuaWQgIT09IGlkKTtcclxuICAgIHRoaXMuYm9va2luZ3MgPSB0aGlzLmJvb2tpbmdzLmZpbHRlcigoYikgPT4gYi51c2VySWQgIT09IGlkKTtcclxuICAgIHRoaXMuYnVzLmVtaXQoXCJ1c2Vyc1wiKTtcclxuICAgIHRoaXMuYnVzLmVtaXQoXCJib29raW5nc1wiKTtcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB0eXBlIHsgRG9tYWluRXJyb3IgfSBmcm9tIFwiLi4vY29yZS9lcnJvcnNcIjtcclxuXHJcbmNvbnN0IEZBTExCQUNLOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xyXG4gIHZhbGlkYXRpb246IFwiXHUwNDFGXHUwNDQwXHUwNDNFXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDRDXHUwNDQyXHUwNDM1IFx1MDQzMlx1MDQzMlx1MDQzNVx1MDQzNFx1MDQ1MVx1MDQzRFx1MDQzRFx1MDQ0Qlx1MDQzNSBcdTA0MzRcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzVcIixcclxuICBcIm5vdC1mb3VuZFwiOiBcIlx1MDQxNFx1MDQzMFx1MDQzRFx1MDQzRFx1MDQ0Qlx1MDQzNSBcdTA0M0RcdTA0MzUgXHUwNDNEXHUwNDMwXHUwNDM5XHUwNDM0XHUwNDM1XHUwNDNEXHUwNDRCXCIsXHJcbiAgZm9yYmlkZGVuOiBcIlx1MDQxRFx1MDQzNVx1MDQzNFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQ0Mlx1MDQzRVx1MDQ0N1x1MDQzRFx1MDQzRSBcdTA0M0ZcdTA0NDBcdTA0MzBcdTA0MzIgXHUwNDM0XHUwNDNCXHUwNDRGIFx1MDQ0RFx1MDQ0Mlx1MDQzRVx1MDQzM1x1MDQzRSBcdTA0MzRcdTA0MzVcdTA0MzlcdTA0NDFcdTA0NDJcdTA0MzJcdTA0MzhcdTA0NEZcIixcclxuICBcImludmFsaWQtY3JlZGVudGlhbHNcIjogXCJcdTA0MURcdTA0MzVcdTA0MzJcdTA0MzVcdTA0NDBcdTA0M0RcdTA0NEJcdTA0MzkgZW1haWwgXHUwNDM4XHUwNDNCXHUwNDM4IFx1MDQzRlx1MDQzMFx1MDQ0MFx1MDQzRVx1MDQzQlx1MDQ0Q1wiLFxyXG4gIFwiZW1haWwtdGFrZW5cIjogXCJcdTA0MkRcdTA0NDJcdTA0M0VcdTA0NDIgZW1haWwgXHUwNDQzXHUwNDM2XHUwNDM1IFx1MDQzN1x1MDQzMFx1MDQzRFx1MDQ0Rlx1MDQ0MlwiLFxyXG4gIFwic2Vzc2lvbi1mdWxsXCI6IFwiXHUwNDIxXHUwNDMyXHUwNDNFXHUwNDMxXHUwNDNFXHUwNDM0XHUwNDNEXHUwNDRCXHUwNDQ1IFx1MDQzQ1x1MDQzNVx1MDQ0MVx1MDQ0MiBcdTA0M0RcdTA0MzUgXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDMwXHUwNDNCXHUwNDNFXHUwNDQxXHUwNDRDXCIsXHJcbiAgXCJhbHJlYWR5LWJvb2tlZFwiOiBcIlx1MDQxMlx1MDQ0QiBcdTA0NDNcdTA0MzZcdTA0MzUgXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDNEXHUwNDRCIFx1MDQzRFx1MDQzMCBcdTA0NERcdTA0NDJcdTA0NDMgXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDQzXCIsXHJcbiAgXCJzZXNzaW9uLXN0YXJ0ZWRcIjogXCJcdTA0MjJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0MzAgXHUwNDQzXHUwNDM2XHUwNDM1IFx1MDQzRFx1MDQzMFx1MDQ0N1x1MDQzMFx1MDQzQlx1MDQzMFx1MDQ0MVx1MDQ0QyBcdTA0MzhcdTA0M0JcdTA0MzggXHUwNDM3XHUwNDMwXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDQ4XHUwNDM4XHUwNDNCXHUwNDMwXHUwNDQxXHUwNDRDXCIsXHJcbiAgXCJjYXBhY2l0eS1iZWxvdy1ib29rZWRcIjogXCJcdTA0MTJcdTA0M0NcdTA0MzVcdTA0NDFcdTA0NDJcdTA0MzhcdTA0M0NcdTA0M0VcdTA0NDFcdTA0NDJcdTA0NEMgXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDRDXHUwNDQ4XHUwNDM1IFx1MDQ0N1x1MDQzOFx1MDQ0MVx1MDQzQlx1MDQzMCBcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzVcdTA0MzlcIixcclxuICBcInNlbGYtZGVsZXRlXCI6IFwiXHUwNDFEXHUwNDM1XHUwNDNCXHUwNDRDXHUwNDM3XHUwNDRGIFx1MDQ0M1x1MDQzNFx1MDQzMFx1MDQzQlx1MDQzOFx1MDQ0Mlx1MDQ0QyBcdTA0NDFcdTA0M0VcdTA0MzFcdTA0NDFcdTA0NDJcdTA0MzJcdTA0MzVcdTA0M0RcdTA0M0RcdTA0NDNcdTA0NEUgXHUwNDQzXHUwNDQ3XHUwNDUxXHUwNDQyXHUwNDNEXHUwNDQzXHUwNDRFIFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQ0Q1wiLFxyXG4gIG5ldHdvcms6IFwiXHUwNDIxXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDM1XHUwNDQwIFx1MDQzRFx1MDQzNVx1MDQzNFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0M1x1MDQzRlx1MDQzNVx1MDQzRFwiLFxyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGVycm9yTWVzc2FnZShlcnJvcjogRG9tYWluRXJyb3IpOiBzdHJpbmcge1xyXG4gIGNvbnN0IG1lc3NhZ2UgPSBlcnJvci5tZXNzYWdlPy50cmltKCk7XHJcbiAgaWYgKG1lc3NhZ2UpIHJldHVybiBtZXNzYWdlO1xyXG4gIHJldHVybiBGQUxMQkFDS1tlcnJvci5jb2RlXSA/PyBcIlx1MDQxRFx1MDQzNVx1MDQzOFx1MDQzN1x1MDQzMlx1MDQzNVx1MDQ0MVx1MDQ0Mlx1MDQzRFx1MDQzMFx1MDQ0RiBcdTA0M0VcdTA0NDhcdTA0MzhcdTA0MzFcdTA0M0FcdTA0MzBcIjtcclxufVxyXG4iLCAiaW1wb3J0IHsgaCB9IGZyb20gXCIuL2RvbVwiO1xyXG5pbXBvcnQgeyBidXR0b24gfSBmcm9tIFwiLi9jb250cm9sc1wiO1xyXG5cclxudHlwZSBWYXJpYW50ID0gXCJtb2RhbFwiIHwgXCJkcmF3ZXJcIjtcclxuXHJcbmludGVyZmFjZSBFbnRyeSB7XHJcbiAgc2NyaW06IEhUTUxFbGVtZW50O1xyXG4gIHBhbmVsOiBIVE1MRWxlbWVudDtcclxuICBwcmV2aW91c0ZvY3VzOiBIVE1MRWxlbWVudCB8IG51bGw7XHJcbiAgY2xvc2U6ICgpID0+IHZvaWQ7XHJcbn1cclxuXHJcbmNvbnN0IEZPQ1VTQUJMRSA9XHJcbiAgJ2FbaHJlZl0sIGJ1dHRvbjpub3QoW2Rpc2FibGVkXSksIGlucHV0Om5vdChbZGlzYWJsZWRdKSwgc2VsZWN0Om5vdChbZGlzYWJsZWRdKSwgdGV4dGFyZWE6bm90KFtkaXNhYmxlZF0pLCBbdGFiaW5kZXhdOm5vdChbdGFiaW5kZXg9XCItMVwiXSknO1xyXG5cclxuZXhwb3J0IGNsYXNzIE92ZXJsYXlIb3N0IHtcclxuICBwcml2YXRlIHJlYWRvbmx5IHN0YWNrOiBFbnRyeVtdID0gW107XHJcblxyXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgaG9zdDogSFRNTEVsZW1lbnQpIHtcclxuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChlKSA9PiB7XHJcbiAgICAgIGNvbnN0IHRvcCA9IHRoaXMuc3RhY2tbdGhpcy5zdGFjay5sZW5ndGggLSAxXTtcclxuICAgICAgaWYgKCF0b3ApIHJldHVybjtcclxuICAgICAgaWYgKGUua2V5ID09PSBcIkVzY2FwZVwiKSB0b3AuY2xvc2UoKTtcclxuICAgICAgZWxzZSBpZiAoZS5rZXkgPT09IFwiVGFiXCIpIHRoaXMudHJhcEZvY3VzKGUsIHRvcC5wYW5lbCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIG9wZW4oXHJcbiAgICBjb250ZW50OiBIVE1MRWxlbWVudCxcclxuICAgIHZhcmlhbnQ6IFZhcmlhbnQgPSBcIm1vZGFsXCIsXHJcbiAgICBvbkNsb3NlPzogKCkgPT4gdm9pZCxcclxuICApOiAoKSA9PiB2b2lkIHtcclxuICAgIGNvbnN0IHByZXZpb3VzRm9jdXMgPVxyXG4gICAgICBkb2N1bWVudC5hY3RpdmVFbGVtZW50IGluc3RhbmNlb2YgSFRNTEVsZW1lbnRcclxuICAgICAgICA/IGRvY3VtZW50LmFjdGl2ZUVsZW1lbnRcclxuICAgICAgICA6IG51bGw7XHJcbiAgICBjb25zdCBwYW5lbCA9IGgoXHJcbiAgICAgIFwiZGl2XCIsXHJcbiAgICAgIHtcclxuICAgICAgICBjbGFzczogYHBhbmVsIHBhbmVsLSR7dmFyaWFudH1gLFxyXG4gICAgICAgIGF0dHJzOiB7IHJvbGU6IFwiZGlhbG9nXCIsIFwiYXJpYS1tb2RhbFwiOiBcInRydWVcIiwgdGFiaW5kZXg6IFwiLTFcIiB9LFxyXG4gICAgICB9LFxyXG4gICAgICBjb250ZW50LFxyXG4gICAgKTtcclxuICAgIGNvbnN0IHNjcmltID0gaChcImRpdlwiLCB7IGNsYXNzOiBgc2NyaW0gc2NyaW0tJHt2YXJpYW50fWAgfSwgcGFuZWwpO1xyXG4gICAgc2NyaW0uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiB7XHJcbiAgICAgIGlmIChlLnRhcmdldCA9PT0gc2NyaW0pIGNsb3NlKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBlbnRyeTogRW50cnkgPSB7IHNjcmltLCBwYW5lbCwgcHJldmlvdXNGb2N1cywgY2xvc2U6ICgpID0+IHt9IH07XHJcbiAgICBjb25zdCBjbG9zZSA9ICgpOiB2b2lkID0+IHtcclxuICAgICAgY29uc3QgaWR4ID0gdGhpcy5zdGFjay5pbmRleE9mKGVudHJ5KTtcclxuICAgICAgaWYgKGlkeCA8IDApIHJldHVybjtcclxuICAgICAgdGhpcy5zdGFjay5zcGxpY2UoaWR4LCAxKTtcclxuICAgICAgc2NyaW0uY2xhc3NMaXN0LnJlbW92ZShcIm9wZW5cIik7XHJcbiAgICAgIHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHNjcmltLnJlbW92ZSgpLCAyMjApO1xyXG4gICAgICBpZiAodGhpcy5zdGFjay5sZW5ndGggPT09IDApIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LnJlbW92ZShcIm5vLXNjcm9sbFwiKTtcclxuICAgICAgY29uc3QgYmVsb3cgPSB0aGlzLnN0YWNrW3RoaXMuc3RhY2subGVuZ3RoIC0gMV07XHJcbiAgICAgIGlmIChiZWxvdykgYmVsb3cucGFuZWwuZm9jdXMoKTtcclxuICAgICAgZWxzZSBwcmV2aW91c0ZvY3VzPy5mb2N1cygpO1xyXG4gICAgICBvbkNsb3NlPy4oKTtcclxuICAgIH07XHJcbiAgICBlbnRyeS5jbG9zZSA9IGNsb3NlO1xyXG5cclxuICAgIHRoaXMuc3RhY2sucHVzaChlbnRyeSk7XHJcbiAgICB0aGlzLmhvc3QuYXBwZW5kKHNjcmltKTtcclxuICAgIGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LmFkZChcIm5vLXNjcm9sbFwiKTtcclxuICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiBzY3JpbS5jbGFzc0xpc3QuYWRkKFwib3BlblwiKSk7XHJcbiAgICAocGFuZWwucXVlcnlTZWxlY3RvcjxIVE1MRWxlbWVudD4oRk9DVVNBQkxFKSA/PyBwYW5lbCkuZm9jdXMoKTtcclxuICAgIHJldHVybiBjbG9zZTtcclxuICB9XHJcblxyXG4gIGNsb3NlQWN0aXZlKCk6IHZvaWQge1xyXG4gICAgdGhpcy5zdGFja1t0aGlzLnN0YWNrLmxlbmd0aCAtIDFdPy5jbG9zZSgpO1xyXG4gIH1cclxuXHJcbiAgY2xvc2VBbGwoKTogdm9pZCB7XHJcbiAgICB3aGlsZSAodGhpcy5zdGFjay5sZW5ndGggPiAwKSB0aGlzLnN0YWNrW3RoaXMuc3RhY2subGVuZ3RoIC0gMV0uY2xvc2UoKTtcclxuICB9XHJcblxyXG4gIGNvbmZpcm0ob3B0czoge1xyXG4gICAgdGl0bGU6IHN0cmluZztcclxuICAgIHRleHQ6IHN0cmluZztcclxuICAgIG9rTGFiZWw/OiBzdHJpbmc7XHJcbiAgfSk6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XHJcbiAgICAgIGxldCBzZXR0bGVkID0gZmFsc2U7XHJcbiAgICAgIGNvbnN0IGRvbmUgPSAodjogYm9vbGVhbik6IHZvaWQgPT4ge1xyXG4gICAgICAgIGlmICghc2V0dGxlZCkge1xyXG4gICAgICAgICAgc2V0dGxlZCA9IHRydWU7XHJcbiAgICAgICAgICByZXNvbHZlKHYpO1xyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuICAgICAgY29uc3QgYm9keSA9IGgoXHJcbiAgICAgICAgXCJkaXZcIixcclxuICAgICAgICB7IGNsYXNzOiBcImNvbmZpcm1cIiB9LFxyXG4gICAgICAgIGgoXCJoM1wiLCB7IHRleHQ6IG9wdHMudGl0bGUgfSksXHJcbiAgICAgICAgaChcInBcIiwgeyBjbGFzczogXCJtdXRlZFwiLCB0ZXh0OiBvcHRzLnRleHQgfSksXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcIm1vZGFsLWFjdGlvbnNcIiB9LFxyXG4gICAgICAgICAgYnV0dG9uKHsgbGFiZWw6IFwiXHUwNDFFXHUwNDQyXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDMwXCIsIHRvbmU6IFwiZ2hvc3RcIiwgb25DbGljazogKCkgPT4gY2xvc2UoKSB9KSxcclxuICAgICAgICAgIGJ1dHRvbih7XHJcbiAgICAgICAgICAgIGxhYmVsOiBvcHRzLm9rTGFiZWwgPz8gXCJcdTA0MjNcdTA0MzRcdTA0MzBcdTA0M0JcdTA0MzhcdTA0NDJcdTA0NENcIixcclxuICAgICAgICAgICAgdG9uZTogXCJkYW5nZXJcIixcclxuICAgICAgICAgICAgb25DbGljazogKCkgPT4ge1xyXG4gICAgICAgICAgICAgIGRvbmUodHJ1ZSk7XHJcbiAgICAgICAgICAgICAgY2xvc2UoKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICksXHJcbiAgICAgICk7XHJcbiAgICAgIGNvbnN0IGNsb3NlID0gdGhpcy5vcGVuKGJvZHksIFwibW9kYWxcIiwgKCkgPT4gZG9uZShmYWxzZSkpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHRyYXBGb2N1cyhlOiBLZXlib2FyZEV2ZW50LCBwYW5lbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcclxuICAgIGNvbnN0IGl0ZW1zID0gWy4uLnBhbmVsLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KEZPQ1VTQUJMRSldLmZpbHRlcihcclxuICAgICAgKGVsKSA9PiBlbC5nZXRDbGllbnRSZWN0cygpLmxlbmd0aCA+IDAsXHJcbiAgICApO1xyXG4gICAgaWYgKGl0ZW1zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgIHBhbmVsLmZvY3VzKCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IGZpcnN0ID0gaXRlbXNbMF07XHJcbiAgICBjb25zdCBsYXN0ID0gaXRlbXNbaXRlbXMubGVuZ3RoIC0gMV07XHJcbiAgICBjb25zdCBjdXJyZW50ID0gZG9jdW1lbnQuYWN0aXZlRWxlbWVudDtcclxuICAgIGlmIChlLnNoaWZ0S2V5ICYmIChjdXJyZW50ID09PSBmaXJzdCB8fCBjdXJyZW50ID09PSBwYW5lbCkpIHtcclxuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBsYXN0LmZvY3VzKCk7XHJcbiAgICB9IGVsc2UgaWYgKCFlLnNoaWZ0S2V5ICYmIGN1cnJlbnQgPT09IGxhc3QpIHtcclxuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBmaXJzdC5mb2N1cygpO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgaCB9IGZyb20gXCIuL2RvbVwiO1xyXG5cclxuZXhwb3J0IHR5cGUgVG9hc3RUb25lID0gXCJva1wiIHwgXCJlcnJcIiB8IFwiaW5mb1wiO1xyXG5leHBvcnQgaW50ZXJmYWNlIFRvYXN0QWN0aW9uIHtcclxuICBsYWJlbDogc3RyaW5nO1xyXG4gIHJ1bjogKCkgPT4gdm9pZDtcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIFRvYXN0Q2VudGVyIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IHJvb3Q6IEhUTUxFbGVtZW50O1xyXG4gIGNvbnN0cnVjdG9yKGhvc3Q6IEhUTUxFbGVtZW50KSB7XHJcbiAgICB0aGlzLnJvb3QgPSBoKFwiZGl2XCIsIHsgY2xhc3M6IFwidG9hc3RzXCIsIGF0dHJzOiB7IFwiYXJpYS1saXZlXCI6IFwicG9saXRlXCIgfSB9KTtcclxuICAgIGhvc3QuYXBwZW5kKHRoaXMucm9vdCk7XHJcbiAgfVxyXG4gIHNob3cobWVzc2FnZTogc3RyaW5nLCB0b25lOiBUb2FzdFRvbmUgPSBcImluZm9cIiwgYWN0aW9uPzogVG9hc3RBY3Rpb24pOiB2b2lkIHtcclxuICAgIGNvbnN0IHRvYXN0ID0gaChcclxuICAgICAgXCJkaXZcIixcclxuICAgICAgeyBjbGFzczogYHRvYXN0IHRvYXN0LSR7dG9uZX1gLCBhdHRyczogeyByb2xlOiBcInN0YXR1c1wiIH0gfSxcclxuICAgICAgaChcInNwYW5cIiwgeyBjbGFzczogXCJ0b2FzdC1tc2dcIiwgdGV4dDogbWVzc2FnZSB9KSxcclxuICAgICAgYWN0aW9uXHJcbiAgICAgICAgPyBoKFwiYnV0dG9uXCIsIHtcclxuICAgICAgICAgICAgY2xhc3M6IFwidG9hc3QtYWN0XCIsXHJcbiAgICAgICAgICAgIGF0dHJzOiB7IHR5cGU6IFwiYnV0dG9uXCIgfSxcclxuICAgICAgICAgICAgdGV4dDogYWN0aW9uLmxhYmVsLFxyXG4gICAgICAgICAgICBvbjoge1xyXG4gICAgICAgICAgICAgIGNsaWNrOiAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBhY3Rpb24ucnVuKCk7XHJcbiAgICAgICAgICAgICAgICBkaXNtaXNzKCk7XHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgOiBudWxsLFxyXG4gICAgICBoKFwiYnV0dG9uXCIsIHtcclxuICAgICAgICBjbGFzczogXCJ0b2FzdC14XCIsXHJcbiAgICAgICAgYXR0cnM6IHsgdHlwZTogXCJidXR0b25cIiwgXCJhcmlhLWxhYmVsXCI6IFwiXHUwNDE3XHUwNDMwXHUwNDNBXHUwNDQwXHUwNDRCXHUwNDQyXHUwNDRDXCIgfSxcclxuICAgICAgICB0ZXh0OiBcIlx1MDBEN1wiLFxyXG4gICAgICAgIG9uOiB7IGNsaWNrOiAoKSA9PiBkaXNtaXNzKCkgfSxcclxuICAgICAgfSksXHJcbiAgICApO1xyXG4gICAgbGV0IHRpbWVyID0gMDtcclxuICAgIGNvbnN0IGRpc21pc3MgPSAoKTogdm9pZCA9PiB7XHJcbiAgICAgIHdpbmRvdy5jbGVhclRpbWVvdXQodGltZXIpO1xyXG4gICAgICB0b2FzdC5jbGFzc0xpc3QuYWRkKFwib3V0XCIpO1xyXG4gICAgICB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB0b2FzdC5yZW1vdmUoKSwgMjAwKTtcclxuICAgIH07XHJcbiAgICB0aW1lciA9IHdpbmRvdy5zZXRUaW1lb3V0KGRpc21pc3MsIGFjdGlvbiA/IDcwMDAgOiA0MjAwKTtcclxuICAgIHRoaXMucm9vdC5hcHBlbmQodG9hc3QpO1xyXG4gICAgd2hpbGUgKHRoaXMucm9vdC5jaGlsZHJlbi5sZW5ndGggPiA0KSB0aGlzLnJvb3QuZmlyc3RFbGVtZW50Q2hpbGQ/LnJlbW92ZSgpO1xyXG4gIH1cclxufVxyXG4iLCAiZXhwb3J0IHR5cGUgUm9sZSA9IFwiY2xpZW50XCIgfCBcImFkbWluXCI7XHJcblxyXG5leHBvcnQgY29uc3QgV09SS09VVF9LSU5EUyA9IFtcclxuICBcInN0cmVuZ3RoXCIsXHJcbiAgXCJjYXJkaW9cIixcclxuICBcInlvZ2FcIixcclxuICBcImNyb3NzZml0XCIsXHJcbiAgXCJzdHJldGNoXCIsXHJcbl0gYXMgY29uc3Q7XHJcbmV4cG9ydCB0eXBlIFdvcmtvdXRLaW5kID0gKHR5cGVvZiBXT1JLT1VUX0tJTkRTKVtudW1iZXJdO1xyXG5cclxuZXhwb3J0IHR5cGUgVGltZU9mRGF5ID0gXCJtb3JuaW5nXCIgfCBcImRheVwiIHwgXCJldmVuaW5nXCI7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFVzZXIge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgbmFtZTogc3RyaW5nO1xyXG4gIGVtYWlsOiBzdHJpbmc7XHJcbiAgcm9sZTogUm9sZTtcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBXb3Jrb3V0U2Vzc2lvbiB7XHJcbiAgaWQ6IHN0cmluZztcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIGtpbmQ6IFdvcmtvdXRLaW5kO1xyXG4gIHRyYWluZXI6IHN0cmluZztcclxuICByb29tOiBzdHJpbmc7XHJcbiAgc3RhcnRzQXQ6IHN0cmluZztcclxuICBkdXJhdGlvbk1pbjogbnVtYmVyO1xyXG4gIGNhcGFjaXR5OiBudW1iZXI7XHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgQm9va2luZyB7XHJcbiAgaWQ6IHN0cmluZztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICBzZXNzaW9uSWQ6IHN0cmluZztcclxuICBjcmVhdGVkQXQ6IHN0cmluZztcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBTZXNzaW9uRHJhZnQge1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAga2luZDogV29ya291dEtpbmQ7XHJcbiAgdHJhaW5lcjogc3RyaW5nO1xyXG4gIHJvb206IHN0cmluZztcclxuICBkYXRlOiBzdHJpbmc7XHJcbiAgdGltZTogc3RyaW5nO1xyXG4gIGR1cmF0aW9uTWluOiBudW1iZXI7XHJcbiAgY2FwYWNpdHk6IG51bWJlcjtcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBVc2VyUGF0Y2gge1xyXG4gIG5hbWU6IHN0cmluZztcclxuICBlbWFpbDogc3RyaW5nO1xyXG4gIHJvbGU6IFJvbGU7XHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgU2NoZWR1bGVGaWx0ZXJzIHtcclxuICBkYXlPZmZzZXQ6IG51bWJlcjtcclxuICBraW5kOiBXb3Jrb3V0S2luZCB8IFwiYWxsXCI7XHJcbiAgdGltZTogVGltZU9mRGF5IHwgXCJhbGxcIjtcclxuICBxdWVyeTogc3RyaW5nO1xyXG4gIHNvcnQ6IFwidGltZVwiIHwgXCJzZWF0c1wiO1xyXG59XHJcblxyXG5leHBvcnQgY29uc3QgREVGQVVMVF9GSUxURVJTOiBTY2hlZHVsZUZpbHRlcnMgPSB7XHJcbiAgZGF5T2Zmc2V0OiAwLFxyXG4gIGtpbmQ6IFwiYWxsXCIsXHJcbiAgdGltZTogXCJhbGxcIixcclxuICBxdWVyeTogXCJcIixcclxuICBzb3J0OiBcInRpbWVcIixcclxufTtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgUmVwb3J0Um93IHtcclxuICBzZXNzaW9uOiBXb3Jrb3V0U2Vzc2lvbjtcclxuICBib29rZWQ6IG51bWJlcjtcclxuICBvY2N1cGFuY3k6IG51bWJlcjtcclxufVxyXG5leHBvcnQgaW50ZXJmYWNlIFJlcG9ydCB7XHJcbiAgcm93czogUmVwb3J0Um93W107XHJcbiAgdG90YWxTZXNzaW9uczogbnVtYmVyO1xyXG4gIHRvdGFsQm9va2luZ3M6IG51bWJlcjtcclxuICBhY3RpdmVDbGllbnRzOiBudW1iZXI7XHJcbiAgb2NjdXBhbmN5OiBudW1iZXI7XHJcbiAgdG9wS2luZDogV29ya291dEtpbmQgfCBudWxsO1xyXG59XHJcbiIsICJpbXBvcnQgdHlwZSB7IEFwcENvbnRleHQgfSBmcm9tIFwiLi4vYXBwL2NvbnRleHRcIjtcclxuaW1wb3J0IHR5cGUgeyBBcHBFdmVudCB9IGZyb20gXCIuLi9zdGF0ZS9hcHAtc3RhdGVcIjtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgVmlldyB7XHJcbiAgbW91bnQoY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQ7XHJcbiAgZGVzdHJveSgpOiB2b2lkO1xyXG59XHJcblxyXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZVZpZXcgaW1wbGVtZW50cyBWaWV3IHtcclxuICBwcm90ZWN0ZWQgcm9vdCE6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcclxuICBwcml2YXRlIHJlYWRvbmx5IHVuc3Vic2NyaWJlcnM6ICgoKSA9PiB2b2lkKVtdID0gW107XHJcblxyXG4gIGNvbnN0cnVjdG9yKHByb3RlY3RlZCByZWFkb25seSBjdHg6IEFwcENvbnRleHQpIHt9XHJcblxyXG4gIG1vdW50KGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpOiB2b2lkIHtcclxuICAgIHRoaXMucm9vdCA9IGNvbnRhaW5lcjtcclxuICAgIHRoaXMuaW5pdCgpO1xyXG4gICAgdGhpcy5yZW5kZXIoKTtcclxuICB9XHJcblxyXG4gIGRlc3Ryb3koKTogdm9pZCB7XHJcbiAgICB0aGlzLmNvbnRyb2xsZXIuYWJvcnQoKTtcclxuICAgIGZvciAoY29uc3QgdW4gb2YgdGhpcy51bnN1YnNjcmliZXJzLnNwbGljZSgwKSkgdW4oKTtcclxuICAgIHRoaXMub25EZXN0cm95KCk7XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgaW5pdCgpOiB2b2lkIHt9XHJcbiAgcHJvdGVjdGVkIG9uRGVzdHJveSgpOiB2b2lkIHt9XHJcbiAgcHJvdGVjdGVkIGFic3RyYWN0IHJlbmRlcigpOiB2b2lkO1xyXG5cclxuICBwcm90ZWN0ZWQgd2F0Y2goZXZlbnQ6IEFwcEV2ZW50LCBmbjogKCkgPT4gdm9pZCk6IHZvaWQge1xyXG4gICAgdGhpcy51bnN1YnNjcmliZXJzLnB1c2godGhpcy5jdHguYnVzLm9uKGV2ZW50LCBmbikpO1xyXG4gIH1cclxuXHJcbiAgcHJvdGVjdGVkIGxpc3RlbjxLIGV4dGVuZHMga2V5b2YgSFRNTEVsZW1lbnRFdmVudE1hcD4oXHJcbiAgICB0YXJnZXQ6IEhUTUxFbGVtZW50IHwgRG9jdW1lbnQgfCBXaW5kb3csXHJcbiAgICB0eXBlOiBLLFxyXG4gICAgZm46IChlOiBIVE1MRWxlbWVudEV2ZW50TWFwW0tdKSA9PiB2b2lkLFxyXG4gICk6IHZvaWQge1xyXG4gICAgdGFyZ2V0LmFkZEV2ZW50TGlzdGVuZXIodHlwZSwgZm4gYXMgRXZlbnRMaXN0ZW5lciwge1xyXG4gICAgICBzaWduYWw6IHRoaXMuY29udHJvbGxlci5zaWduYWwsXHJcbiAgICB9KTtcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB7XHJcbiAgYWRkRGF5cyxcclxuICBidWlsZFJlcG9ydCxcclxuICBkYXlLZXksXHJcbiAgaXNGaW5pc2hlZCxcclxuICBvY2N1cGFuY3lQY3QsXHJcbiAgc2VhdHNUYWtlbixcclxufSBmcm9tIFwiLi4vY29yZS9ydWxlc1wiO1xyXG5pbXBvcnQge1xyXG4gIFdPUktPVVRfS0lORFMsXHJcbiAgdHlwZSBCb29raW5nLFxyXG4gIHR5cGUgU2Vzc2lvbkRyYWZ0LFxyXG4gIHR5cGUgVXNlcixcclxuICB0eXBlIFdvcmtvdXRTZXNzaW9uLFxyXG59IGZyb20gXCIuLi9jb3JlL3R5cGVzXCI7XHJcbmltcG9ydCB0eXBlIHsgQXBwQ29udGV4dCB9IGZyb20gXCIuLi9hcHAvY29udGV4dFwiO1xyXG5pbXBvcnQgeyBoLCByZXBsYWNlLCB0eXBlIENoaWxkIH0gZnJvbSBcIi4uL3VpL2RvbVwiO1xyXG5pbXBvcnQge1xyXG4gIGRvd25sb2FkVGV4dCxcclxuICBmbXREYXRlLFxyXG4gIGZtdEZ1bGwsXHJcbiAgZm10VGltZSxcclxuICBLSU5EX0xBQkVMLFxyXG4gIHJlbGF0aXZlRGF5LFxyXG4gIHRpbWVJbnB1dFZhbHVlLFxyXG4gIHRvQ3N2LFxyXG59IGZyb20gXCIuLi91aS9mb3JtYXRcIjtcclxuaW1wb3J0IHsgaWNvbiwgdHlwZSBJY29uTmFtZSB9IGZyb20gXCIuLi91aS9pY29uc1wiO1xyXG5pbXBvcnQgeyBlcnJvck1lc3NhZ2UgfSBmcm9tIFwiLi4vdWkvbWVzc2FnZXNcIjtcclxuaW1wb3J0IHsgQmFzZVZpZXcgfSBmcm9tIFwiLi92aWV3XCI7XHJcbmltcG9ydCB7XHJcbiAgYXZhdGFyLFxyXG4gIGJ1dHRvbixcclxuICBjaGlwLFxyXG4gIGRhdGFUYWJsZSxcclxuICBlbXB0eVN0YXRlLFxyXG4gIGZpZWxkLFxyXG4gIGljb25CdXR0b24sXHJcbiAga2luZEJhZGdlLFxyXG4gIG9jY3VwYW5jeUJhcixcclxuICBwYWdlSGVhZCxcclxuICByb2xlQmFkZ2UsXHJcbiAgc2VsZWN0SW5wdXQsXHJcbiAgc3RhdENhcmQsXHJcbiAgdGV4dElucHV0LFxyXG59IGZyb20gXCIuLi91aS9jb250cm9sc1wiO1xyXG5cclxudHlwZSBTZWN0aW9uID0gXCJvdmVydmlld1wiIHwgXCJzY2hlZHVsZVwiIHwgXCJjbGllbnRzXCIgfCBcInJlcG9ydHNcIjtcclxuXHJcbmV4cG9ydCBjbGFzcyBBZG1pblZpZXcgZXh0ZW5kcyBCYXNlVmlldyB7XHJcbiAgcHJpdmF0ZSBzZWN0aW9uOiBTZWN0aW9uID0gXCJvdmVydmlld1wiO1xyXG4gIHByaXZhdGUgZGF5RmlsdGVyOiBudW1iZXIgfCBcImFsbFwiID0gXCJhbGxcIjtcclxuICBwcml2YXRlIHNlc3Npb25RdWVyeSA9IFwiXCI7XHJcbiAgcHJpdmF0ZSBjbGllbnRRdWVyeSA9IFwiXCI7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBzZWxlY3Rpb24gPSBuZXcgU2V0PHN0cmluZz4oKTtcclxuICBwcml2YXRlIHNlY3Rpb25FbCE6IEhUTUxFbGVtZW50O1xyXG5cclxuICBjb25zdHJ1Y3RvcihjdHg6IEFwcENvbnRleHQpIHtcclxuICAgIHN1cGVyKGN0eCk7XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgaW5pdCgpOiB2b2lkIHtcclxuICAgIHRoaXMud2F0Y2goXCJzZXNzaW9uc1wiLCAoKSA9PiB0aGlzLnJlbmRlclNlY3Rpb24oKSk7XHJcbiAgICB0aGlzLndhdGNoKFwiYm9va2luZ3NcIiwgKCkgPT4gdGhpcy5yZW5kZXJTZWN0aW9uKCkpO1xyXG4gICAgdGhpcy53YXRjaChcInVzZXJzXCIsICgpID0+IHRoaXMucmVuZGVyU2VjdGlvbigpKTtcclxuICB9XHJcblxyXG4gIHByb3RlY3RlZCByZW5kZXIoKTogdm9pZCB7XHJcbiAgICB0aGlzLnNlY3Rpb25FbCA9IGgoXCJkaXZcIiwgeyBjbGFzczogXCJhZG1pbi1jb250ZW50XCIgfSk7XHJcbiAgICByZXBsYWNlKFxyXG4gICAgICB0aGlzLnJvb3QsXHJcbiAgICAgIGgoXCJkaXZcIiwgeyBjbGFzczogXCJhZG1pblwiIH0sIHRoaXMuc2lkZWJhcigpLCB0aGlzLnNlY3Rpb25FbCksXHJcbiAgICApO1xyXG4gICAgdGhpcy5yZW5kZXJTZWN0aW9uKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHNpZGViYXIoKTogSFRNTEVsZW1lbnQge1xyXG4gICAgY29uc3QgaXRlbSA9IChpZDogU2VjdGlvbiwgbGFiZWw6IHN0cmluZywgbmFtZTogSWNvbk5hbWUpOiBIVE1MRWxlbWVudCA9PlxyXG4gICAgICBoKFxyXG4gICAgICAgIFwiYnV0dG9uXCIsXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgY2xhc3M6IGBzaWRlLWJ0biR7dGhpcy5zZWN0aW9uID09PSBpZCA/IFwiIGFjdGl2ZVwiIDogXCJcIn1gLFxyXG4gICAgICAgICAgYXR0cnM6IHtcclxuICAgICAgICAgICAgdHlwZTogXCJidXR0b25cIixcclxuICAgICAgICAgICAgXCJhcmlhLWN1cnJlbnRcIjogdGhpcy5zZWN0aW9uID09PSBpZCA/IFwicGFnZVwiIDogXCJmYWxzZVwiLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIG9uOiB7XHJcbiAgICAgICAgICAgIGNsaWNrOiAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgdGhpcy5zZWN0aW9uID0gaWQ7XHJcbiAgICAgICAgICAgICAgdGhpcy5zZWxlY3Rpb24uY2xlYXIoKTtcclxuICAgICAgICAgICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIGljb24obmFtZSwgMTgpLFxyXG4gICAgICAgIGgoXCJzcGFuXCIsIHsgdGV4dDogbGFiZWwgfSksXHJcbiAgICAgICk7XHJcbiAgICByZXR1cm4gaChcclxuICAgICAgXCJhc2lkZVwiLFxyXG4gICAgICB7IGNsYXNzOiBcInNpZGVcIiB9LFxyXG4gICAgICBoKFwic3BhblwiLCB7IGNsYXNzOiBcInNpZGUtdGl0bGVcIiwgdGV4dDogXCJcdTA0MjNcdTA0M0ZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzhcdTA0MzVcIiB9KSxcclxuICAgICAgaXRlbShcIm92ZXJ2aWV3XCIsIFwiXHUwNDFFXHUwNDMxXHUwNDM3XHUwNDNFXHUwNDQwXCIsIFwiZ3JpZFwiKSxcclxuICAgICAgaXRlbShcInNjaGVkdWxlXCIsIFwiXHUwNDIwXHUwNDMwXHUwNDQxXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDM1XCIsIFwiY2FsZW5kYXJcIiksXHJcbiAgICAgIGl0ZW0oXCJjbGllbnRzXCIsIFwiXHUwNDFBXHUwNDNCXHUwNDM4XHUwNDM1XHUwNDNEXHUwNDQyXHUwNDRCXCIsIFwidXNlcnNcIiksXHJcbiAgICAgIGl0ZW0oXCJyZXBvcnRzXCIsIFwiXHUwNDFFXHUwNDQyXHUwNDQ3XHUwNDUxXHUwNDQyXHUwNDRCXCIsIFwiY2hhcnRcIiksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZW5kZXJTZWN0aW9uKCk6IHZvaWQge1xyXG4gICAgdGhpcy5wcnVuZVNlbGVjdGlvbigpO1xyXG4gICAgaWYgKHRoaXMuc2VjdGlvbiA9PT0gXCJvdmVydmlld1wiKSB0aGlzLnJlbmRlck92ZXJ2aWV3KCk7XHJcbiAgICBlbHNlIGlmICh0aGlzLnNlY3Rpb24gPT09IFwic2NoZWR1bGVcIikgdGhpcy5yZW5kZXJTY2hlZHVsZSgpO1xyXG4gICAgZWxzZSBpZiAodGhpcy5zZWN0aW9uID09PSBcImNsaWVudHNcIikgdGhpcy5yZW5kZXJDbGllbnRzKCk7XHJcbiAgICBlbHNlIHRoaXMucmVuZGVyUmVwb3J0cygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBwcnVuZVNlbGVjdGlvbigpOiB2b2lkIHtcclxuICAgIGNvbnN0IGlkcyA9IG5ldyBTZXQoXHJcbiAgICAgIHRoaXMuc2VjdGlvbiA9PT0gXCJzY2hlZHVsZVwiXHJcbiAgICAgICAgPyB0aGlzLmN0eC5zdGF0ZS5hbGxTZXNzaW9ucygpLm1hcCgocykgPT4gcy5pZClcclxuICAgICAgICA6IHRoaXMuc2VjdGlvbiA9PT0gXCJjbGllbnRzXCJcclxuICAgICAgICAgID8gdGhpcy5jdHguc3RhdGUuYWxsVXNlcnMoKS5tYXAoKHUpID0+IHUuaWQpXHJcbiAgICAgICAgICA6IFtdLFxyXG4gICAgKTtcclxuICAgIGZvciAoY29uc3QgaWQgb2YgWy4uLnRoaXMuc2VsZWN0aW9uXSlcclxuICAgICAgaWYgKCFpZHMuaGFzKGlkKSkgdGhpcy5zZWxlY3Rpb24uZGVsZXRlKGlkKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2Vzc2lvbnMoKTogV29ya291dFNlc3Npb25bXSB7XHJcbiAgICByZXR1cm4gWy4uLnRoaXMuY3R4LnN0YXRlLmFsbFNlc3Npb25zKCldLnNvcnQoKGEsIGIpID0+XHJcbiAgICAgIGEuc3RhcnRzQXQubG9jYWxlQ29tcGFyZShiLnN0YXJ0c0F0KSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHNlYXJjaEJveChcclxuICAgIHBsYWNlaG9sZGVyOiBzdHJpbmcsXHJcbiAgICB2YWx1ZTogc3RyaW5nLFxyXG4gICAgb25JbnB1dDogKHY6IHN0cmluZykgPT4gdm9pZCxcclxuICApOiBIVE1MRWxlbWVudCB7XHJcbiAgICBjb25zdCBpbnB1dCA9IGgoXCJpbnB1dFwiLCB7XHJcbiAgICAgIGNsYXNzOiBcInNlYXJjaC1pbnB1dFwiLFxyXG4gICAgICBhdHRyczoge1xyXG4gICAgICAgIHR5cGU6IFwic2VhcmNoXCIsXHJcbiAgICAgICAgcGxhY2Vob2xkZXIsXHJcbiAgICAgICAgXCJhcmlhLWxhYmVsXCI6IHBsYWNlaG9sZGVyLFxyXG4gICAgICAgIGF1dG9jb21wbGV0ZTogXCJvZmZcIixcclxuICAgICAgfSxcclxuICAgICAgdmFsdWUsXHJcbiAgICAgIG9uOiB7IGlucHV0OiAoKSA9PiBvbklucHV0KGlucHV0LnZhbHVlKSB9LFxyXG4gICAgfSk7XHJcbiAgICByZXR1cm4gaChcclxuICAgICAgXCJkaXZcIixcclxuICAgICAgeyBjbGFzczogXCJ0b29sYmFyXCIgfSxcclxuICAgICAgaChcImxhYmVsXCIsIHsgY2xhc3M6IFwic2VhcmNoXCIgfSwgaWNvbihcInNlYXJjaFwiLCAxOCksIGlucHV0KSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGJ1bGtCYXIob25EZWxldGU6ICgpID0+IHZvaWQpOiBIVE1MRWxlbWVudCB7XHJcbiAgICByZXR1cm4gaChcclxuICAgICAgXCJkaXZcIixcclxuICAgICAgeyBjbGFzczogXCJidWxrLWJhclwiIH0sXHJcbiAgICAgIGgoXCJzcGFuXCIsIHsgdGV4dDogYFx1MDQxMlx1MDQ0Qlx1MDQzMVx1MDQ0MFx1MDQzMFx1MDQzRFx1MDQzRTogJHt0aGlzLnNlbGVjdGlvbi5zaXplfWAgfSksXHJcbiAgICAgIGJ1dHRvbih7XHJcbiAgICAgICAgbGFiZWw6IFwiXHUwNDIzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDM4XHUwNDQyXHUwNDRDXCIsXHJcbiAgICAgICAgdG9uZTogXCJkYW5nZXJcIixcclxuICAgICAgICBzbWFsbDogdHJ1ZSxcclxuICAgICAgICBpY29uOiBcInRyYXNoXCIsXHJcbiAgICAgICAgb25DbGljazogb25EZWxldGUsXHJcbiAgICAgIH0pLFxyXG4gICAgICBidXR0b24oe1xyXG4gICAgICAgIGxhYmVsOiBcIlx1MDQyMVx1MDQzRFx1MDQ0Rlx1MDQ0Mlx1MDQ0Q1wiLFxyXG4gICAgICAgIHRvbmU6IFwiZ2hvc3RcIixcclxuICAgICAgICBzbWFsbDogdHJ1ZSxcclxuICAgICAgICBvbkNsaWNrOiAoKSA9PiB7XHJcbiAgICAgICAgICB0aGlzLnNlbGVjdGlvbi5jbGVhcigpO1xyXG4gICAgICAgICAgdGhpcy5yZW5kZXJTZWN0aW9uKCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgfSksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgLy8gLS0tLS0tLS0tLSBcdTA0MUVcdTA0MzFcdTA0MzdcdTA0M0VcdTA0NDAgLS0tLS0tLS0tLVxyXG4gIHByaXZhdGUgcmVuZGVyT3ZlcnZpZXcoKTogdm9pZCB7XHJcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xyXG4gICAgY29uc3Qgc2Vzc2lvbnMgPSB0aGlzLnNlc3Npb25zKCk7XHJcbiAgICBjb25zdCBib29raW5ncyA9IHRoaXMuY3R4LnN0YXRlLmFsbEJvb2tpbmdzKCk7XHJcbiAgICBjb25zdCB1c2VycyA9IHRoaXMuY3R4LnN0YXRlLmFsbFVzZXJzKCk7XHJcbiAgICBjb25zdCB0b2RheSA9IGRheUtleShub3cpO1xyXG4gICAgY29uc3QgdG9kYXlTZXNzaW9ucyA9IHNlc3Npb25zLmZpbHRlcigocykgPT4gZGF5S2V5KHMuc3RhcnRzQXQpID09PSB0b2RheSk7XHJcbiAgICBjb25zdCB0b2RheUJvb2tpbmdzID0gYm9va2luZ3MuZmlsdGVyKChiKSA9PiB7XHJcbiAgICAgIGNvbnN0IHMgPSB0aGlzLmN0eC5zdGF0ZS5zZXNzaW9uQnlJZChiLnNlc3Npb25JZCk7XHJcbiAgICAgIHJldHVybiBzICE9PSB1bmRlZmluZWQgJiYgZGF5S2V5KHMuc3RhcnRzQXQpID09PSB0b2RheTtcclxuICAgIH0pO1xyXG4gICAgY29uc3Qgd2Vla0VuZCA9IGFkZERheXMobm93LCA3KS5nZXRUaW1lKCk7XHJcbiAgICBjb25zdCB3ZWVrID0gc2Vzc2lvbnMuZmlsdGVyKChzKSA9PiB7XHJcbiAgICAgIGNvbnN0IHQgPSBEYXRlLnBhcnNlKHMuc3RhcnRzQXQpO1xyXG4gICAgICByZXR1cm4gdCA+PSBub3cuZ2V0VGltZSgpICYmIHQgPCB3ZWVrRW5kO1xyXG4gICAgfSk7XHJcbiAgICBjb25zdCB3ZWVrQ2FwID0gd2Vlay5yZWR1Y2UoKG4sIHMpID0+IG4gKyBzLmNhcGFjaXR5LCAwKTtcclxuICAgIGNvbnN0IHdlZWtCb29rZWQgPSB3ZWVrLnJlZHVjZSgobiwgcykgPT4gbiArIHNlYXRzVGFrZW4oYm9va2luZ3MsIHMuaWQpLCAwKTtcclxuICAgIGNvbnN0IHdlZWtQY3QgPSB3ZWVrQ2FwID8gTWF0aC5yb3VuZCgod2Vla0Jvb2tlZCAvIHdlZWtDYXApICogMTAwKSA6IDA7XHJcbiAgICBjb25zdCB1cGNvbWluZyA9IHNlc3Npb25zXHJcbiAgICAgIC5maWx0ZXIoKHMpID0+IERhdGUucGFyc2Uocy5zdGFydHNBdCkgPiBub3cuZ2V0VGltZSgpKVxyXG4gICAgICAuc2xpY2UoMCwgNSk7XHJcbiAgICBjb25zdCBhdHRlbnRpb24gPSB1cGNvbWluZy5maWx0ZXIoXHJcbiAgICAgIChzKSA9PlxyXG4gICAgICAgIERhdGUucGFyc2Uocy5zdGFydHNBdCkgPCBub3cuZ2V0VGltZSgpICsgNDggKiAzXzYwMF8wMDAgJiZcclxuICAgICAgICBvY2N1cGFuY3lQY3QocywgYm9va2luZ3MpIDwgMzAsXHJcbiAgICApO1xyXG5cclxuICAgIHJlcGxhY2UoXHJcbiAgICAgIHRoaXMuc2VjdGlvbkVsLFxyXG4gICAgICBwYWdlSGVhZChcIlx1MDQxRVx1MDQzMVx1MDQzN1x1MDQzRVx1MDQ0MFwiLCBcIlx1MDQyMVx1MDQzMlx1MDQzRVx1MDQzNFx1MDQzQVx1MDQzMCBcdTA0M0ZcdTA0M0UgXHUwNDQ2XHUwNDM1XHUwNDNEXHUwNDQyXHUwNDQwXHUwNDQzIFx1MDQzRFx1MDQzMCBcdTA0NDFcdTA0MzVcdTA0MzNcdTA0M0VcdTA0MzRcdTA0M0RcdTA0NEZcIiksXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJkaXZcIixcclxuICAgICAgICB7IGNsYXNzOiBcInJlcG9ydC1jYXJkc1wiIH0sXHJcbiAgICAgICAgc3RhdENhcmQodG9kYXlTZXNzaW9ucy5sZW5ndGgsIFwiXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNFXHUwNDNBIFx1MDQ0MVx1MDQzNVx1MDQzM1x1MDQzRVx1MDQzNFx1MDQzRFx1MDQ0RlwiKSxcclxuICAgICAgICBzdGF0Q2FyZCh0b2RheUJvb2tpbmdzLmxlbmd0aCwgXCJcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzVcdTA0MzkgXHUwNDQxXHUwNDM1XHUwNDMzXHUwNDNFXHUwNDM0XHUwNDNEXHUwNDRGXCIpLFxyXG4gICAgICAgIHN0YXRDYXJkKHVzZXJzLmZpbHRlcigodSkgPT4gdS5yb2xlID09PSBcImNsaWVudFwiKS5sZW5ndGgsIFwiXHUwNDNBXHUwNDNCXHUwNDM4XHUwNDM1XHUwNDNEXHUwNDQyXHUwNDNFXHUwNDMyXCIpLFxyXG4gICAgICAgIHN0YXRDYXJkKGAke3dlZWtQY3R9JWAsIFwiXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDNEXHUwNDRGXHUwNDM1XHUwNDNDXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDIFx1MDQzRFx1MDQzNVx1MDQzNFx1MDQzNVx1MDQzQlx1MDQzOFwiKSxcclxuICAgICAgKSxcclxuICAgICAgYXR0ZW50aW9uLmxlbmd0aCA+IDBcclxuICAgICAgICA/IHRoaXMuYXR0ZW50aW9uUGFuZWwoYXR0ZW50aW9uLCBib29raW5ncywgbm93KVxyXG4gICAgICAgIDogbnVsbCxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwiZ3JpZDJcIiB9LFxyXG4gICAgICAgIHRoaXMudXBjb21pbmdQYW5lbCh1cGNvbWluZywgYm9va2luZ3MsIG5vdyksXHJcbiAgICAgICAgdGhpcy5sb2FkUGFuZWwoc2Vzc2lvbnMsIGJvb2tpbmdzLCBub3cpLFxyXG4gICAgICApLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXR0ZW50aW9uUGFuZWwoXHJcbiAgICBsaXN0OiBXb3Jrb3V0U2Vzc2lvbltdLFxyXG4gICAgYm9va2luZ3M6IHJlYWRvbmx5IEJvb2tpbmdbXSxcclxuICAgIG5vdzogRGF0ZSxcclxuICApOiBIVE1MRWxlbWVudCB7XHJcbiAgICBjb25zdCBpdGVtcyA9IGxpc3QubWFwKChzKSA9PlxyXG4gICAgICBoKFxyXG4gICAgICAgIFwiYnV0dG9uXCIsXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgY2xhc3M6IFwiYXR0bi1pdGVtXCIsXHJcbiAgICAgICAgICBhdHRyczogeyB0eXBlOiBcImJ1dHRvblwiIH0sXHJcbiAgICAgICAgICBvbjogeyBjbGljazogKCkgPT4gdGhpcy5vcGVuUm9zdGVyKHMpIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICBoKFwic3Ryb25nXCIsIHtcclxuICAgICAgICAgIHRleHQ6IGAke3JlbGF0aXZlRGF5KHMuc3RhcnRzQXQsIG5vdyl9ICR7Zm10VGltZShzLnN0YXJ0c0F0KX1gLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGgoXCJzcGFuXCIsIHsgdGV4dDogcy50aXRsZSB9KSxcclxuICAgICAgICBoKFwic3BhblwiLCB7IGNsYXNzOiBcIm11dGVkXCIsIHRleHQ6IGAke29jY3VwYW5jeVBjdChzLCBib29raW5ncyl9JWAgfSksXHJcbiAgICAgICksXHJcbiAgICApO1xyXG4gICAgcmV0dXJuIGgoXHJcbiAgICAgIFwiZGl2XCIsXHJcbiAgICAgIHsgY2xhc3M6IFwicGFuZWwtY2FyZCBhdHRuXCIgfSxcclxuICAgICAgaChcImgzXCIsIHt9LCBpY29uKFwiY2xvY2tcIiwgMTgpLCBcIiBcdTA0MjJcdTA0NDBcdTA0MzVcdTA0MzFcdTA0NDNcdTA0NEVcdTA0NDIgXHUwNDMyXHUwNDNEXHUwNDM4XHUwNDNDXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDRGXCIpLFxyXG4gICAgICBoKFwicFwiLCB7XHJcbiAgICAgICAgY2xhc3M6IFwibXV0ZWRcIixcclxuICAgICAgICB0ZXh0OiBcIlx1MDQyMVx1MDQ0Mlx1MDQzMFx1MDQ0MFx1MDQ0Mlx1MDQ0M1x1MDQ0RVx1MDQ0MiBcdTA0MzIgXHUwNDMxXHUwNDNCXHUwNDM4XHUwNDM2XHUwNDMwXHUwNDM5XHUwNDQ4XHUwNDM4XHUwNDM1IDQ4IFx1MDQ0N1x1MDQzMFx1MDQ0MVx1MDQzRVx1MDQzMiwgXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDNEXHUwNDM1XHUwNDNEXHUwNDRCIFx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQ0Q1x1MDQ0OFx1MDQzNSBcdTA0NDdcdTA0MzVcdTA0M0MgXHUwNDNEXHUwNDMwIDMwJS5cIixcclxuICAgICAgfSksXHJcbiAgICAgIGgoXCJkaXZcIiwgeyBjbGFzczogXCJhdHRuLWxpc3RcIiB9LCAuLi5pdGVtcyksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSB1cGNvbWluZ1BhbmVsKFxyXG4gICAgbGlzdDogV29ya291dFNlc3Npb25bXSxcclxuICAgIGJvb2tpbmdzOiByZWFkb25seSBCb29raW5nW10sXHJcbiAgICBub3c6IERhdGUsXHJcbiAgKTogSFRNTEVsZW1lbnQge1xyXG4gICAgY29uc3Qgcm93cyA9IGxpc3QubWFwKChzKSA9PlxyXG4gICAgICBoKFxyXG4gICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJtaW5pLXJvd1wiIH0sXHJcbiAgICAgICAgaChcInNwYW5cIiwge1xyXG4gICAgICAgICAgY2xhc3M6IFwibWluaS10aW1lXCIsXHJcbiAgICAgICAgICB0ZXh0OiBgJHtyZWxhdGl2ZURheShzLnN0YXJ0c0F0LCBub3cpfSAke2ZtdFRpbWUocy5zdGFydHNBdCl9YCxcclxuICAgICAgICB9KSxcclxuICAgICAgICBoKFwic3BhblwiLCB7IGNsYXNzOiBcIm1pbmktdGl0bGVcIiwgdGV4dDogcy50aXRsZSB9KSxcclxuICAgICAgICBvY2N1cGFuY3lCYXIob2NjdXBhbmN5UGN0KHMsIGJvb2tpbmdzKSksXHJcbiAgICAgICAgaWNvbkJ1dHRvbihcInVzZXJzXCIsIFwiXHUwNDIxXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDMwXHUwNDMyIFx1MDQzM1x1MDQ0MFx1MDQ0M1x1MDQzRlx1MDQzRlx1MDQ0QlwiLCAoKSA9PiB0aGlzLm9wZW5Sb3N0ZXIocykpLFxyXG4gICAgICApLFxyXG4gICAgKTtcclxuICAgIHJldHVybiBoKFxyXG4gICAgICBcImRpdlwiLFxyXG4gICAgICB7IGNsYXNzOiBcInBhbmVsLWNhcmRcIiB9LFxyXG4gICAgICBoKFwiaDNcIiwgeyB0ZXh0OiBcIlx1MDQxMVx1MDQzQlx1MDQzOFx1MDQzNlx1MDQzMFx1MDQzOVx1MDQ0OFx1MDQzOFx1MDQzNSBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0MzhcIiB9KSxcclxuICAgICAgbGlzdC5sZW5ndGggPT09IDBcclxuICAgICAgICA/IGgoXCJwXCIsIHsgY2xhc3M6IFwibXV0ZWRcIiwgdGV4dDogXCJcdTA0MURcdTA0MzVcdTA0NDIgXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDNCXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDQ1IFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzRVx1MDQzQS5cIiB9KVxyXG4gICAgICAgIDogaChcImRpdlwiLCB7IGNsYXNzOiBcIm1pbmktbGlzdFwiIH0sIC4uLnJvd3MpLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgbG9hZFBhbmVsKFxyXG4gICAgc2Vzc2lvbnM6IFdvcmtvdXRTZXNzaW9uW10sXHJcbiAgICBib29raW5nczogcmVhZG9ubHkgQm9va2luZ1tdLFxyXG4gICAgbm93OiBEYXRlLFxyXG4gICk6IEhUTUxFbGVtZW50IHtcclxuICAgIGNvbnN0IHJvd3MgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiA3IH0sIChfLCBpKSA9PiB7XHJcbiAgICAgIGNvbnN0IGRheSA9IGFkZERheXMobm93LCBpKTtcclxuICAgICAgY29uc3Qga2V5ID0gZGF5S2V5KGRheSk7XHJcbiAgICAgIGNvbnN0IGRheVNlc3Npb25zID0gc2Vzc2lvbnMuZmlsdGVyKChzKSA9PiBkYXlLZXkocy5zdGFydHNBdCkgPT09IGtleSk7XHJcbiAgICAgIGNvbnN0IGNhcCA9IGRheVNlc3Npb25zLnJlZHVjZSgobiwgcykgPT4gbiArIHMuY2FwYWNpdHksIDApO1xyXG4gICAgICBjb25zdCBib29rZWQgPSBkYXlTZXNzaW9ucy5yZWR1Y2UoXHJcbiAgICAgICAgKG4sIHMpID0+IG4gKyBzZWF0c1Rha2VuKGJvb2tpbmdzLCBzLmlkKSxcclxuICAgICAgICAwLFxyXG4gICAgICApO1xyXG4gICAgICBjb25zdCBwY3QgPSBjYXAgPyBNYXRoLnJvdW5kKChib29rZWQgLyBjYXApICogMTAwKSA6IDA7XHJcbiAgICAgIHJldHVybiBoKFxyXG4gICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJjaGFydC1yb3dcIiB9LFxyXG4gICAgICAgIGgoXCJzcGFuXCIsIHtcclxuICAgICAgICAgIGNsYXNzOiBcImNoYXJ0LWxhYmVsXCIsXHJcbiAgICAgICAgICB0ZXh0OiByZWxhdGl2ZURheShkYXkudG9JU09TdHJpbmcoKSwgbm93KSxcclxuICAgICAgICB9KSxcclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJzcGFuXCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcImNoYXJ0LWJhclwiIH0sXHJcbiAgICAgICAgICBoKFwic3BhblwiLCB7IHN0eWxlOiBgd2lkdGg6JHtwY3R9JWAgfSksXHJcbiAgICAgICAgKSxcclxuICAgICAgICBoKFwic3BhblwiLCB7IGNsYXNzOiBcImNoYXJ0LXZhbHVlXCIsIHRleHQ6IGNhcCA/IGAke3BjdH0lYCA6IFwiXHUyMDE0XCIgfSksXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBoKFxyXG4gICAgICBcImRpdlwiLFxyXG4gICAgICB7IGNsYXNzOiBcInBhbmVsLWNhcmRcIiB9LFxyXG4gICAgICBoKFwiaDNcIiwgeyB0ZXh0OiBcIlx1MDQxN1x1MDQzMFx1MDQzM1x1MDQ0MFx1MDQ0M1x1MDQzN1x1MDQzQVx1MDQzMCBcdTA0M0ZcdTA0M0UgXHUwNDM0XHUwNDNEXHUwNDRGXHUwNDNDXCIgfSksXHJcbiAgICAgIGgoXCJkaXZcIiwgeyBjbGFzczogXCJjaGFydFwiIH0sIC4uLnJvd3MpLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIC8vIC0tLS0tLS0tLS0gXHUwNDIwXHUwNDMwXHUwNDQxXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDM1IC0tLS0tLS0tLS1cclxuICBwcml2YXRlIHJlbmRlclNjaGVkdWxlKCk6IHZvaWQge1xyXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgIGNvbnN0IHJlc3VsdHNFbCA9IGgoXCJkaXZcIiwgeyBjbGFzczogXCJkYXktZ3JvdXBzXCIgfSk7XHJcbiAgICBjb25zdCByZW5kZXJSZXN1bHRzID0gKCk6IHZvaWQgPT4ge1xyXG4gICAgICByZXBsYWNlKHJlc3VsdHNFbCwgLi4udGhpcy5zY2hlZHVsZUdyb3VwcygpKTtcclxuICAgIH07XHJcbiAgICByZXBsYWNlKFxyXG4gICAgICB0aGlzLnNlY3Rpb25FbCxcclxuICAgICAgcGFnZUhlYWQoXHJcbiAgICAgICAgXCJcdTA0MjBcdTA0MzBcdTA0NDFcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzBcdTA0M0RcdTA0MzhcdTA0MzVcIixcclxuICAgICAgICBcIlx1MDQyM1x1MDQzRlx1MDQ0MFx1MDQzMFx1MDQzMlx1MDQzQlx1MDQzNVx1MDQzRFx1MDQzOFx1MDQzNSBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0MzBcdTA0M0NcdTA0MzggXHUwNDM4IFx1MDQ0MVx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQzMlx1MDQzRVx1MDQzQyBcdTA0MzNcdTA0NDBcdTA0NDNcdTA0M0ZcdTA0M0ZcIixcclxuICAgICAgICBidXR0b24oe1xyXG4gICAgICAgICAgbGFiZWw6IFwiXHUwNDFEXHUwNDNFXHUwNDMyXHUwNDMwXHUwNDRGIFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzQVx1MDQzMFwiLFxyXG4gICAgICAgICAgaWNvbjogXCJwbHVzXCIsXHJcbiAgICAgICAgICBvbkNsaWNrOiAoKSA9PiB0aGlzLm9wZW5TZXNzaW9uRm9ybSgpLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICApLFxyXG4gICAgICB0aGlzLnNlbGVjdGlvbi5zaXplID4gMFxyXG4gICAgICAgID8gdGhpcy5idWxrQmFyKCgpID0+IHtcclxuICAgICAgICAgICAgdm9pZCB0aGlzLmRlbGV0ZVNlbGVjdGVkU2Vzc2lvbnMoKTtcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgOiBudWxsLFxyXG4gICAgICBoKFxyXG4gICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJjaGlwc1wiIH0sXHJcbiAgICAgICAgY2hpcChcIlx1MDQxMlx1MDQ0MVx1MDQzNSBcdTA0MzRcdTA0M0RcdTA0MzhcIiwgdGhpcy5kYXlGaWx0ZXIgPT09IFwiYWxsXCIsICgpID0+IHtcclxuICAgICAgICAgIHRoaXMuZGF5RmlsdGVyID0gXCJhbGxcIjtcclxuICAgICAgICAgIHRoaXMucmVuZGVyU2VjdGlvbigpO1xyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIC4uLkFycmF5LmZyb20oeyBsZW5ndGg6IDcgfSwgKF8sIGkpID0+XHJcbiAgICAgICAgICBjaGlwKFxyXG4gICAgICAgICAgICByZWxhdGl2ZURheShhZGREYXlzKG5vdywgaSkudG9JU09TdHJpbmcoKSwgbm93KSxcclxuICAgICAgICAgICAgdGhpcy5kYXlGaWx0ZXIgPT09IGksXHJcbiAgICAgICAgICAgICgpID0+IHtcclxuICAgICAgICAgICAgICB0aGlzLmRheUZpbHRlciA9IGk7XHJcbiAgICAgICAgICAgICAgdGhpcy5yZW5kZXJTZWN0aW9uKCk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgICksXHJcbiAgICAgICksXHJcbiAgICAgIHRoaXMuc2VhcmNoQm94KFxyXG4gICAgICAgIFwiXHUwNDFGXHUwNDNFXHUwNDM4XHUwNDQxXHUwNDNBIFx1MDQzRlx1MDQzRSBcdTA0M0RcdTA0MzBcdTA0MzdcdTA0MzJcdTA0MzBcdTA0M0RcdTA0MzhcdTA0NEUsIFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzNVx1MDQ0MFx1MDQ0MywgXHUwNDM3XHUwNDMwXHUwNDNCXHUwNDQzXHUyMDI2XCIsXHJcbiAgICAgICAgdGhpcy5zZXNzaW9uUXVlcnksXHJcbiAgICAgICAgKHYpID0+IHtcclxuICAgICAgICAgIHRoaXMuc2Vzc2lvblF1ZXJ5ID0gdjtcclxuICAgICAgICAgIHJlbmRlclJlc3VsdHMoKTtcclxuICAgICAgICB9LFxyXG4gICAgICApLFxyXG4gICAgICByZXN1bHRzRWwsXHJcbiAgICApO1xyXG4gICAgcmVuZGVyUmVzdWx0cygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzY2hlZHVsZUdyb3VwcygpOiBDaGlsZFtdIHtcclxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgICBjb25zdCBib29raW5ncyA9IHRoaXMuY3R4LnN0YXRlLmFsbEJvb2tpbmdzKCk7XHJcbiAgICBjb25zdCBxID0gdGhpcy5zZXNzaW9uUXVlcnkudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBsZXQgbGlzdCA9IHRoaXMuc2Vzc2lvbnMoKTtcclxuICAgIGlmICh0aGlzLmRheUZpbHRlciAhPT0gXCJhbGxcIikge1xyXG4gICAgICBjb25zdCBrZXkgPSBkYXlLZXkoYWRkRGF5cyhub3csIHRoaXMuZGF5RmlsdGVyKSk7XHJcbiAgICAgIGxpc3QgPSBsaXN0LmZpbHRlcigocykgPT4gZGF5S2V5KHMuc3RhcnRzQXQpID09PSBrZXkpO1xyXG4gICAgfVxyXG4gICAgaWYgKHEpXHJcbiAgICAgIGxpc3QgPSBsaXN0LmZpbHRlcigocykgPT5cclxuICAgICAgICBgJHtzLnRpdGxlfSAke3MudHJhaW5lcn0gJHtzLnJvb219YC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHEpLFxyXG4gICAgICApO1xyXG4gICAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gW2VtcHR5U3RhdGUoXCJcdTA0MjJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0VcdTA0M0EgXHUwNDNEXHUwNDM1IFx1MDQzRFx1MDQzMFx1MDQzOVx1MDQzNFx1MDQzNVx1MDQzRFx1MDQzRS5cIildO1xyXG4gICAgY29uc3QgZ3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIFdvcmtvdXRTZXNzaW9uW10+KCk7XHJcbiAgICBmb3IgKGNvbnN0IHMgb2YgbGlzdCkge1xyXG4gICAgICBjb25zdCBrZXkgPSBkYXlLZXkocy5zdGFydHNBdCk7XHJcbiAgICAgIGNvbnN0IGJ1Y2tldCA9IGdyb3Vwcy5nZXQoa2V5KSA/PyBbXTtcclxuICAgICAgYnVja2V0LnB1c2gocyk7XHJcbiAgICAgIGdyb3Vwcy5zZXQoa2V5LCBidWNrZXQpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIFsuLi5ncm91cHMudmFsdWVzKCldLm1hcCgoZGF5U2Vzc2lvbnMpID0+XHJcbiAgICAgIHRoaXMuZGF5R3JvdXAoZGF5U2Vzc2lvbnMsIGJvb2tpbmdzLCBub3cpLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZGF5R3JvdXAoXHJcbiAgICBkYXlTZXNzaW9uczogV29ya291dFNlc3Npb25bXSxcclxuICAgIGJvb2tpbmdzOiByZWFkb25seSBCb29raW5nW10sXHJcbiAgICBub3c6IERhdGUsXHJcbiAgKTogSFRNTEVsZW1lbnQge1xyXG4gICAgY29uc3QgZmlyc3QgPSBkYXlTZXNzaW9uc1swXTtcclxuICAgIGNvbnN0IGFsbENoZWNrZWQgPSBkYXlTZXNzaW9ucy5ldmVyeSgocykgPT4gdGhpcy5zZWxlY3Rpb24uaGFzKHMuaWQpKTtcclxuICAgIGNvbnN0IG1hc3RlciA9IGgoXCJpbnB1dFwiLCB7XHJcbiAgICAgIGF0dHJzOiB7IHR5cGU6IFwiY2hlY2tib3hcIiwgXCJhcmlhLWxhYmVsXCI6IFwiXHUwNDEyXHUwNDRCXHUwNDMxXHUwNDQwXHUwNDMwXHUwNDQyXHUwNDRDIFx1MDQzNFx1MDQzNVx1MDQzRFx1MDQ0Q1wiIH0sXHJcbiAgICAgIGNoZWNrZWQ6IGFsbENoZWNrZWQsXHJcbiAgICB9KTtcclxuICAgIG1hc3Rlci5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsICgpID0+IHtcclxuICAgICAgaWYgKG1hc3Rlci5jaGVja2VkKSBkYXlTZXNzaW9ucy5mb3JFYWNoKChzKSA9PiB0aGlzLnNlbGVjdGlvbi5hZGQocy5pZCkpO1xyXG4gICAgICBlbHNlIGRheVNlc3Npb25zLmZvckVhY2goKHMpID0+IHRoaXMuc2VsZWN0aW9uLmRlbGV0ZShzLmlkKSk7XHJcbiAgICAgIHRoaXMucmVuZGVyU2VjdGlvbigpO1xyXG4gICAgfSk7XHJcbiAgICBjb25zdCBoZWFkID0gaChcclxuICAgICAgXCJoM1wiLFxyXG4gICAgICB7IGNsYXNzOiBcImRheS1ncm91cC1oZWFkXCIgfSxcclxuICAgICAgbWFzdGVyLFxyXG4gICAgICBoKFwic3BhblwiLCB7XHJcbiAgICAgICAgdGV4dDogYCR7cmVsYXRpdmVEYXkoZmlyc3Quc3RhcnRzQXQsIG5vdyl9LCAke2ZtdERhdGUoZmlyc3Quc3RhcnRzQXQpfWAsXHJcbiAgICAgIH0pLFxyXG4gICAgICBoKFwiZW1cIiwgeyBjbGFzczogXCJjb3VudC1waWxsXCIsIHRleHQ6IFN0cmluZyhkYXlTZXNzaW9ucy5sZW5ndGgpIH0pLFxyXG4gICAgKTtcclxuICAgIGNvbnN0IHRhYmxlID0gaChcclxuICAgICAgXCJ0YWJsZVwiLFxyXG4gICAgICB7fSxcclxuICAgICAgaChcclxuICAgICAgICBcInRoZWFkXCIsXHJcbiAgICAgICAge30sXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwidHJcIixcclxuICAgICAgICAgIHt9LFxyXG4gICAgICAgICAgaChcInRoXCIsIHsgdGV4dDogXCJcIiB9KSxcclxuICAgICAgICAgIGgoXCJ0aFwiLCB7IHRleHQ6IFwiXHUwNDEyXHUwNDQwXHUwNDM1XHUwNDNDXHUwNDRGXCIgfSksXHJcbiAgICAgICAgICBoKFwidGhcIiwgeyB0ZXh0OiBcIlx1MDQyMlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzQVx1MDQzMFwiIH0pLFxyXG4gICAgICAgICAgaChcInRoXCIsIHsgdGV4dDogXCJcdTA0MjJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzVcdTA0NDAgLyBcdTA0MzdcdTA0MzBcdTA0M0JcIiB9KSxcclxuICAgICAgICAgIGgoXCJ0aFwiLCB7IHRleHQ6IFwiXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDNEXHUwNDM1XHUwNDNEXHUwNDNFXCIgfSksXHJcbiAgICAgICAgICBoKFwidGhcIiwgeyB0ZXh0OiBcIlwiIH0pLFxyXG4gICAgICAgICksXHJcbiAgICAgICksXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJ0Ym9keVwiLFxyXG4gICAgICAgIHt9LFxyXG4gICAgICAgIC4uLmRheVNlc3Npb25zLm1hcCgocykgPT4gdGhpcy5zZXNzaW9uUm93KHMsIGJvb2tpbmdzLCBub3cpKSxcclxuICAgICAgKSxcclxuICAgICk7XHJcbiAgICByZXR1cm4gaChcclxuICAgICAgXCJzZWN0aW9uXCIsXHJcbiAgICAgIHsgY2xhc3M6IFwiZGF5LWdyb3VwXCIgfSxcclxuICAgICAgaGVhZCxcclxuICAgICAgaChcImRpdlwiLCB7IGNsYXNzOiBcInRhYmxlLXdyYXBcIiB9LCB0YWJsZSksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzZXNzaW9uUm93KFxyXG4gICAgczogV29ya291dFNlc3Npb24sXHJcbiAgICBib29raW5nczogcmVhZG9ubHkgQm9va2luZ1tdLFxyXG4gICAgbm93OiBEYXRlLFxyXG4gICk6IEhUTUxFbGVtZW50IHtcclxuICAgIGNvbnN0IHRha2VuID0gc2VhdHNUYWtlbihib29raW5ncywgcy5pZCk7XHJcbiAgICBjb25zdCBwY3QgPSBvY2N1cGFuY3lQY3QocywgYm9va2luZ3MpO1xyXG4gICAgY29uc3QgYm94ID0gaChcImlucHV0XCIsIHtcclxuICAgICAgYXR0cnM6IHsgdHlwZTogXCJjaGVja2JveFwiLCBcImFyaWEtbGFiZWxcIjogYFx1MDQxMlx1MDQ0Qlx1MDQzMVx1MDQ0MFx1MDQzMFx1MDQ0Mlx1MDQ0QyAke3MudGl0bGV9YCB9LFxyXG4gICAgICBjaGVja2VkOiB0aGlzLnNlbGVjdGlvbi5oYXMocy5pZCksXHJcbiAgICB9KTtcclxuICAgIGJveC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsICgpID0+IHtcclxuICAgICAgaWYgKGJveC5jaGVja2VkKSB0aGlzLnNlbGVjdGlvbi5hZGQocy5pZCk7XHJcbiAgICAgIGVsc2UgdGhpcy5zZWxlY3Rpb24uZGVsZXRlKHMuaWQpO1xyXG4gICAgICB0aGlzLnJlbmRlclNlY3Rpb24oKTtcclxuICAgIH0pO1xyXG4gICAgY29uc3QgYWN0aW9ucyA9IGgoXHJcbiAgICAgIFwic3BhblwiLFxyXG4gICAgICB7IGNsYXNzOiBcInJvdy1hY3Rpb25zXCIgfSxcclxuICAgICAgaWNvbkJ1dHRvbihcInVzZXJzXCIsIFwiXHUwNDIxXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDMwXHUwNDMyIFx1MDQzM1x1MDQ0MFx1MDQ0M1x1MDQzRlx1MDQzRlx1MDQ0QlwiLCAoKSA9PiB0aGlzLm9wZW5Sb3N0ZXIocykpLFxyXG4gICAgICBpY29uQnV0dG9uKFwiZWRpdFwiLCBcIlx1MDQyMFx1MDQzNVx1MDQzNFx1MDQzMFx1MDQzQVx1MDQ0Mlx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQ0Q1wiLCAoKSA9PiB0aGlzLm9wZW5TZXNzaW9uRm9ybShzKSksXHJcbiAgICAgIGljb25CdXR0b24oXHJcbiAgICAgICAgXCJ0cmFzaFwiLFxyXG4gICAgICAgIFwiXHUwNDIzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDM4XHUwNDQyXHUwNDRDXCIsXHJcbiAgICAgICAgKCkgPT4ge1xyXG4gICAgICAgICAgdm9pZCB0aGlzLmRlbGV0ZVNlc3Npb24ocyk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICB7IGRhbmdlcjogdHJ1ZSB9LFxyXG4gICAgICApLFxyXG4gICAgKTtcclxuICAgIHJldHVybiBoKFxyXG4gICAgICBcInRyXCIsXHJcbiAgICAgIHsgY2xhc3M6IGlzRmluaXNoZWQocywgbm93KSA/IFwicGFzdFwiIDogXCJcIiB9LFxyXG4gICAgICBoKFwidGRcIiwge30sIGJveCksXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJ0ZFwiLFxyXG4gICAgICAgIHt9LFxyXG4gICAgICAgIGgoXCJzdHJvbmdcIiwgeyB0ZXh0OiBmbXRUaW1lKHMuc3RhcnRzQXQpIH0pLFxyXG4gICAgICAgIGgoXCJzbWFsbFwiLCB7IGNsYXNzOiBcIm11dGVkXCIsIHRleHQ6IGAgJHtzLmR1cmF0aW9uTWlufSBcdTA0M0NcdTA0MzhcdTA0M0RgIH0pLFxyXG4gICAgICApLFxyXG4gICAgICBoKFxyXG4gICAgICAgIFwidGRcIixcclxuICAgICAgICB7fSxcclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJzcGFuXCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcImNlbGwtdGl0bGVcIiB9LFxyXG4gICAgICAgICAgaChcInNwYW5cIiwgeyB0ZXh0OiBzLnRpdGxlIH0pLFxyXG4gICAgICAgICAga2luZEJhZGdlKHMua2luZCksXHJcbiAgICAgICAgKSxcclxuICAgICAgKSxcclxuICAgICAgaChcInRkXCIsIHsgY2xhc3M6IFwibXV0ZWRcIiwgdGV4dDogYCR7cy50cmFpbmVyfSBcdTAwQjcgJHtzLnJvb219YCB9KSxcclxuICAgICAgaChcclxuICAgICAgICBcInRkXCIsXHJcbiAgICAgICAge30sXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwic3BhblwiLFxyXG4gICAgICAgICAgeyBjbGFzczogXCJvY2MtY2VsbFwiIH0sXHJcbiAgICAgICAgICBvY2N1cGFuY3lCYXIocGN0KSxcclxuICAgICAgICAgIGgoXCJzcGFuXCIsIHsgdGV4dDogYCR7dGFrZW59LyR7cy5jYXBhY2l0eX1gIH0pLFxyXG4gICAgICAgICksXHJcbiAgICAgICksXHJcbiAgICAgIGgoXCJ0ZFwiLCB7fSwgYWN0aW9ucyksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvcGVuUm9zdGVyKHM6IFdvcmtvdXRTZXNzaW9uKTogdm9pZCB7XHJcbiAgICBjb25zdCBjb250ZW50ID0gaChcImRpdlwiLCB7IGNsYXNzOiBcImRyYXdlci1ib2R5XCIgfSk7XHJcbiAgICBjb25zdCBjbG9zZSA9IHRoaXMuY3R4Lm92ZXJsYXlzLm9wZW4oY29udGVudCwgXCJkcmF3ZXJcIik7XHJcbiAgICBjb25zdCBmaWxsID0gKCk6IHZvaWQgPT4ge1xyXG4gICAgICBjb25zdCBib29raW5ncyA9IHRoaXMuY3R4LnN0YXRlXHJcbiAgICAgICAgLmFsbEJvb2tpbmdzKClcclxuICAgICAgICAuZmlsdGVyKChiKSA9PiBiLnNlc3Npb25JZCA9PT0gcy5pZCk7XHJcbiAgICAgIGNvbnN0IHBjdCA9IG9jY3VwYW5jeVBjdChzLCB0aGlzLmN0eC5zdGF0ZS5hbGxCb29raW5ncygpKTtcclxuICAgICAgY29uc3Qgcm93cyA9IGJvb2tpbmdzLm1hcCgoYikgPT4ge1xyXG4gICAgICAgIGNvbnN0IHUgPSB0aGlzLmN0eC5zdGF0ZS51c2VyQnlJZChiLnVzZXJJZCk7XHJcbiAgICAgICAgcmV0dXJuIGgoXHJcbiAgICAgICAgICBcImxpXCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcInJvc3Rlci1yb3dcIiB9LFxyXG4gICAgICAgICAgYXZhdGFyKHU/Lm5hbWUgPz8gXCI/XCIpLFxyXG4gICAgICAgICAgaChcclxuICAgICAgICAgICAgXCJzcGFuXCIsXHJcbiAgICAgICAgICAgIHsgY2xhc3M6IFwicm9zdGVyLW5hbWVcIiB9LFxyXG4gICAgICAgICAgICBoKFwic3Ryb25nXCIsIHsgdGV4dDogdT8ubmFtZSA/PyBcIlx1MDQyM1x1MDQzNFx1MDQzMFx1MDQzQlx1MDQ1MVx1MDQzRFx1MDQzRFx1MDQ0Qlx1MDQzOSBcdTA0M0ZcdTA0M0VcdTA0M0JcdTA0NENcdTA0MzdcdTA0M0VcdTA0MzJcdTA0MzBcdTA0NDJcdTA0MzVcdTA0M0JcdTA0NENcIiB9KSxcclxuICAgICAgICAgICAgaChcInNtYWxsXCIsIHsgY2xhc3M6IFwibXV0ZWRcIiwgdGV4dDogdT8uZW1haWwgPz8gXCJcIiB9KSxcclxuICAgICAgICAgICksXHJcbiAgICAgICAgICBpY29uQnV0dG9uKFxyXG4gICAgICAgICAgICBcInRyYXNoXCIsXHJcbiAgICAgICAgICAgIFwiXHUwNDFFXHUwNDQyXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQ0QyBcdTA0M0FcdTA0M0JcdTA0MzhcdTA0MzVcdTA0M0RcdTA0NDJcdTA0MzBcIixcclxuICAgICAgICAgICAgKCkgPT4ge1xyXG4gICAgICAgICAgICAgIHZvaWQgdGhpcy5jYW5jZWxGb3IoYiwgZmlsbCk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHsgZGFuZ2VyOiB0cnVlIH0sXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgICk7XHJcbiAgICAgIH0pO1xyXG4gICAgICByZXBsYWNlKFxyXG4gICAgICAgIGNvbnRlbnQsXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcImRyYXdlci1oZWFkXCIgfSxcclxuICAgICAgICAgIGtpbmRCYWRnZShzLmtpbmQpLFxyXG4gICAgICAgICAgaWNvbkJ1dHRvbihcInhcIiwgXCJcdTA0MTdcdTA0MzBcdTA0M0FcdTA0NDBcdTA0NEJcdTA0NDJcdTA0NENcIiwgKCkgPT4gY2xvc2UoKSksXHJcbiAgICAgICAgKSxcclxuICAgICAgICBoKFwiaDJcIiwgeyB0ZXh0OiBzLnRpdGxlIH0pLFxyXG4gICAgICAgIGgoXCJwXCIsIHtcclxuICAgICAgICAgIGNsYXNzOiBcIm11dGVkXCIsXHJcbiAgICAgICAgICB0ZXh0OiBgJHtmbXRGdWxsKHMuc3RhcnRzQXQpfSBcdTAwQjcgJHtzLnRyYWluZXJ9IFx1MDBCNyAke3Mucm9vbX1gLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGgoXHJcbiAgICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgICAgeyBjbGFzczogXCJvY2NcIiB9LFxyXG4gICAgICAgICAgaChcImRpdlwiLCB7IGNsYXNzOiBcIm9jYy1iYXJcIiB9LCBoKFwic3BhblwiLCB7IHN0eWxlOiBgd2lkdGg6JHtwY3R9JWAgfSkpLFxyXG4gICAgICAgICAgaChcInBcIiwge1xyXG4gICAgICAgICAgICBjbGFzczogXCJtdXRlZFwiLFxyXG4gICAgICAgICAgICB0ZXh0OiBgXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDNEXHUwNDNFICR7Ym9va2luZ3MubGVuZ3RofSBcdTA0MzhcdTA0MzcgJHtzLmNhcGFjaXR5fWAsXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICApLFxyXG4gICAgICAgIGgoXCJoNFwiLCB7IHRleHQ6IGBcdTA0MjFcdTA0M0VcdTA0NDFcdTA0NDJcdTA0MzBcdTA0MzIgXHUwNDMzXHUwNDQwXHUwNDQzXHUwNDNGXHUwNDNGXHUwNDRCICgke2Jvb2tpbmdzLmxlbmd0aH0pYCB9KSxcclxuICAgICAgICBib29raW5ncy5sZW5ndGggPT09IDBcclxuICAgICAgICAgID8gaChcInBcIiwgeyBjbGFzczogXCJtdXRlZFwiLCB0ZXh0OiBcIlx1MDQxRlx1MDQzRVx1MDQzQVx1MDQzMCBcdTA0M0RcdTA0MzhcdTA0M0FcdTA0NDJcdTA0M0UgXHUwNDNEXHUwNDM1IFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzMFx1MDQzRC5cIiB9KVxyXG4gICAgICAgICAgOiBoKFwidWxcIiwgeyBjbGFzczogXCJyb3N0ZXJcIiB9LCAuLi5yb3dzKSxcclxuICAgICAgKTtcclxuICAgIH07XHJcbiAgICBmaWxsKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGNhbmNlbEZvcihiOiBCb29raW5nLCByZWZyZXNoOiAoKSA9PiB2b2lkKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB1ID0gdGhpcy5jdHguc3RhdGUudXNlckJ5SWQoYi51c2VySWQpO1xyXG4gICAgY29uc3QgY29uZmlybWVkID0gYXdhaXQgdGhpcy5jdHgub3ZlcmxheXMuY29uZmlybSh7XHJcbiAgICAgIHRpdGxlOiBcIlx1MDQxRVx1MDQ0Mlx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0Mlx1MDQ0QyBcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0NEM/XCIsXHJcbiAgICAgIHRleHQ6IGBcdTA0MTdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0NEMgXHUwNDNBXHUwNDNCXHUwNDM4XHUwNDM1XHUwNDNEXHUwNDQyXHUwNDMwICR7dT8ubmFtZSA/PyBcIlwifSBcdTA0MzFcdTA0NDNcdTA0MzRcdTA0MzVcdTA0NDIgXHUwNDNFXHUwNDQyXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDM1XHUwNDNEXHUwNDMwLmAsXHJcbiAgICAgIG9rTGFiZWw6IFwiXHUwNDFFXHUwNDQyXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQ0Q1wiLFxyXG4gICAgfSk7XHJcbiAgICBpZiAoIWNvbmZpcm1lZCkgcmV0dXJuO1xyXG4gICAgY29uc3QgciA9IGF3YWl0IHRoaXMuY3R4LmJvb2tpbmcuY2FuY2VsKGIuaWQpO1xyXG4gICAgaWYgKCFyLm9rKSB7XHJcbiAgICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KGVycm9yTWVzc2FnZShyLmVycm9yKSwgXCJlcnJcIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KFwiXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDRDIFx1MDQzQVx1MDQzQlx1MDQzOFx1MDQzNVx1MDQzRFx1MDQ0Mlx1MDQzMCBcdTA0M0VcdTA0NDJcdTA0M0NcdTA0MzVcdTA0M0RcdTA0MzVcdTA0M0RcdTA0MzBcIiwgXCJpbmZvXCIpO1xyXG4gICAgcmVmcmVzaCgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBkZWxldGVTZXNzaW9uKHM6IFdvcmtvdXRTZXNzaW9uKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBjb25maXJtZWQgPSBhd2FpdCB0aGlzLmN0eC5vdmVybGF5cy5jb25maXJtKHtcclxuICAgICAgdGl0bGU6IFwiXHUwNDIzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzQVx1MDQ0Mz9cIixcclxuICAgICAgdGV4dDogYFx1MDBBQiR7cy50aXRsZX1cdTAwQkIgXHUwNDM4IFx1MDQzMlx1MDQ0MVx1MDQzNSBcdTA0MzVcdTA0NTEgXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDM4IFx1MDQzMVx1MDQ0M1x1MDQzNFx1MDQ0M1x1MDQ0MiBcdTA0NDNcdTA0MzRcdTA0MzBcdTA0M0JcdTA0MzVcdTA0M0RcdTA0NEIuYCxcclxuICAgIH0pO1xyXG4gICAgaWYgKCFjb25maXJtZWQpIHJldHVybjtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmN0eC5jYXRhbG9nLnJlbW92ZShzLmlkKTtcclxuICAgIGlmICghci5vaykge1xyXG4gICAgICB0aGlzLmN0eC50b2FzdHMuc2hvdyhlcnJvck1lc3NhZ2Uoci5lcnJvciksIFwiZXJyXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCB0b2tlbiA9IHIudmFsdWUudW5kb1Rva2VuO1xyXG4gICAgdGhpcy5jdHgudG9hc3RzLnNob3coYFx1MDBBQiR7cy50aXRsZX1cdTAwQkIgXHUwNDQzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDM1XHUwNDNEXHUwNDMwYCwgXCJpbmZvXCIsIHtcclxuICAgICAgbGFiZWw6IFwiXHUwNDEyXHUwNDM1XHUwNDQwXHUwNDNEXHUwNDQzXHUwNDQyXHUwNDRDXCIsXHJcbiAgICAgIHJ1bjogKCkgPT4ge1xyXG4gICAgICAgIHZvaWQgdGhpcy5yZXN0b3JlU2Vzc2lvbih0b2tlbik7XHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZGVsZXRlU2VsZWN0ZWRTZXNzaW9ucygpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGNvdW50ID0gdGhpcy5zZWxlY3Rpb24uc2l6ZTtcclxuICAgIGNvbnN0IGNvbmZpcm1lZCA9IGF3YWl0IHRoaXMuY3R4Lm92ZXJsYXlzLmNvbmZpcm0oe1xyXG4gICAgICB0aXRsZTogYFx1MDQyM1x1MDQzNFx1MDQzMFx1MDQzQlx1MDQzOFx1MDQ0Mlx1MDQ0QyBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0MzggKCR7Y291bnR9KT9gLFxyXG4gICAgICB0ZXh0OiBcIlx1MDQxMlx1MDQ0MVx1MDQzNSBcdTA0NDFcdTA0MzJcdTA0NEZcdTA0MzdcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDM4IFx1MDQzMVx1MDQ0M1x1MDQzNFx1MDQ0M1x1MDQ0MiBcdTA0NDNcdTA0MzRcdTA0MzBcdTA0M0JcdTA0MzVcdTA0M0RcdTA0NEIuXCIsXHJcbiAgICB9KTtcclxuICAgIGlmICghY29uZmlybWVkKSByZXR1cm47XHJcbiAgICBjb25zdCB0b2tlbnM6IHN0cmluZ1tdID0gW107XHJcbiAgICBmb3IgKGNvbnN0IGlkIG9mIFsuLi50aGlzLnNlbGVjdGlvbl0pIHtcclxuICAgICAgY29uc3QgciA9IGF3YWl0IHRoaXMuY3R4LmNhdGFsb2cucmVtb3ZlKGlkKTtcclxuICAgICAgaWYgKHIub2spIHRva2Vucy5wdXNoKHIudmFsdWUudW5kb1Rva2VuKTtcclxuICAgIH1cclxuICAgIHRoaXMuc2VsZWN0aW9uLmNsZWFyKCk7XHJcbiAgICB0aGlzLmN0eC50b2FzdHMuc2hvdyhgXHUwNDIzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDM1XHUwNDNEXHUwNDNFOiAke3Rva2Vucy5sZW5ndGh9YCwgXCJpbmZvXCIsIHtcclxuICAgICAgbGFiZWw6IFwiXHUwNDEyXHUwNDM1XHUwNDQwXHUwNDNEXHUwNDQzXHUwNDQyXHUwNDRDXCIsXHJcbiAgICAgIHJ1bjogKCkgPT4ge1xyXG4gICAgICAgIHZvaWQgdGhpcy5yZXN0b3JlU2Vzc2lvbnModG9rZW5zKTtcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZXN0b3JlU2Vzc2lvbih0b2tlbjogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCByID0gYXdhaXQgdGhpcy5jdHguY2F0YWxvZy5yZXN0b3JlKHRva2VuKTtcclxuICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KFxyXG4gICAgICByLm9rID8gXCJcdTA0MjJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0MzAgXHUwNDMyXHUwNDNFXHUwNDQxXHUwNDQxXHUwNDQyXHUwNDMwXHUwNDNEXHUwNDNFXHUwNDMyXHUwNDNCXHUwNDM1XHUwNDNEXHUwNDMwXCIgOiBlcnJvck1lc3NhZ2Uoci5lcnJvciksXHJcbiAgICAgIHIub2sgPyBcIm9rXCIgOiBcImVyclwiLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVzdG9yZVNlc3Npb25zKHRva2Vuczogc3RyaW5nW10pOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGZvciAoY29uc3QgdCBvZiB0b2tlbnMpIGF3YWl0IHRoaXMuY3R4LmNhdGFsb2cucmVzdG9yZSh0KTtcclxuICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KFwiXHUwNDIyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDM4IFx1MDQzMlx1MDQzRVx1MDQ0MVx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQzRFx1MDQzRVx1MDQzMlx1MDQzQlx1MDQzNVx1MDQzRFx1MDQ0QlwiLCBcIm9rXCIpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvcGVuU2Vzc2lvbkZvcm0oZXhpc3Rpbmc/OiBXb3Jrb3V0U2Vzc2lvbik6IHZvaWQge1xyXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgIGNvbnN0IHRpdGxlID0gdGV4dElucHV0KFxyXG4gICAgICB7XHJcbiAgICAgICAgdHlwZTogXCJ0ZXh0XCIsXHJcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXHJcbiAgICAgICAgbWF4bGVuZ3RoOiA2MCxcclxuICAgICAgICBwbGFjZWhvbGRlcjogXCJcdTA0MjFcdTA0MzhcdTA0M0JcdTA0M0VcdTA0MzJcdTA0MzBcdTA0NEYgXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDMwXCIsXHJcbiAgICAgIH0sXHJcbiAgICAgIGV4aXN0aW5nPy50aXRsZSA/PyBcIlwiLFxyXG4gICAgKTtcclxuICAgIGNvbnN0IGtpbmQgPSBzZWxlY3RJbnB1dChcclxuICAgICAgV09SS09VVF9LSU5EUy5tYXAoKGspID0+ICh7IHZhbHVlOiBrLCBsYWJlbDogS0lORF9MQUJFTFtrXSB9KSksXHJcbiAgICAgIGV4aXN0aW5nPy5raW5kID8/IFwic3RyZW5ndGhcIixcclxuICAgICk7XHJcbiAgICBjb25zdCB0cmFpbmVyID0gdGV4dElucHV0KFxyXG4gICAgICB7IHR5cGU6IFwidGV4dFwiLCByZXF1aXJlZDogdHJ1ZSwgcGxhY2Vob2xkZXI6IFwiXHUwNDI0XHUwNDMwXHUwNDNDXHUwNDM4XHUwNDNCXHUwNDM4XHUwNDRGIFx1MDQxOFx1MDQzQ1x1MDQ0RlwiIH0sXHJcbiAgICAgIGV4aXN0aW5nPy50cmFpbmVyID8/IFwiXCIsXHJcbiAgICApO1xyXG4gICAgY29uc3Qgcm9vbSA9IHRleHRJbnB1dChcclxuICAgICAgeyB0eXBlOiBcInRleHRcIiwgcmVxdWlyZWQ6IHRydWUgfSxcclxuICAgICAgZXhpc3Rpbmc/LnJvb20gPz8gXCJcdTA0MTdcdTA0MzBcdTA0M0IgMVwiLFxyXG4gICAgKTtcclxuICAgIGNvbnN0IGRhdGUgPSB0ZXh0SW5wdXQoXHJcbiAgICAgIHsgdHlwZTogXCJkYXRlXCIsIHJlcXVpcmVkOiB0cnVlIH0sXHJcbiAgICAgIGV4aXN0aW5nID8gZGF5S2V5KGV4aXN0aW5nLnN0YXJ0c0F0KSA6IGRheUtleShhZGREYXlzKG5vdywgMSkpLFxyXG4gICAgKTtcclxuICAgIGNvbnN0IHRpbWUgPSB0ZXh0SW5wdXQoXHJcbiAgICAgIHsgdHlwZTogXCJ0aW1lXCIsIHJlcXVpcmVkOiB0cnVlIH0sXHJcbiAgICAgIGV4aXN0aW5nID8gdGltZUlucHV0VmFsdWUoZXhpc3Rpbmcuc3RhcnRzQXQpIDogXCIxODowMFwiLFxyXG4gICAgKTtcclxuICAgIGNvbnN0IGR1cmF0aW9uID0gdGV4dElucHV0KFxyXG4gICAgICB7IHR5cGU6IFwibnVtYmVyXCIsIG1pbjogMTUsIG1heDogMTgwLCBzdGVwOiA1LCByZXF1aXJlZDogdHJ1ZSB9LFxyXG4gICAgICBTdHJpbmcoZXhpc3Rpbmc/LmR1cmF0aW9uTWluID8/IDYwKSxcclxuICAgICk7XHJcbiAgICBjb25zdCBjYXBhY2l0eSA9IHRleHRJbnB1dChcclxuICAgICAgeyB0eXBlOiBcIm51bWJlclwiLCBtaW46IDEsIG1heDogMTAwLCByZXF1aXJlZDogdHJ1ZSB9LFxyXG4gICAgICBTdHJpbmcoZXhpc3Rpbmc/LmNhcGFjaXR5ID8/IDEyKSxcclxuICAgICk7XHJcblxyXG4gICAgY29uc3Qgc3VibWl0ID0gYXN5bmMgKCk6IFByb21pc2U8dm9pZD4gPT4ge1xyXG4gICAgICBjb25zdCBkcmFmdDogU2Vzc2lvbkRyYWZ0ID0ge1xyXG4gICAgICAgIHRpdGxlOiB0aXRsZS52YWx1ZSxcclxuICAgICAgICBraW5kOiBXT1JLT1VUX0tJTkRTLmZpbmQoKGspID0+IGsgPT09IGtpbmQudmFsdWUpID8/IFwic3RyZW5ndGhcIixcclxuICAgICAgICB0cmFpbmVyOiB0cmFpbmVyLnZhbHVlLFxyXG4gICAgICAgIHJvb206IHJvb20udmFsdWUsXHJcbiAgICAgICAgZGF0ZTogZGF0ZS52YWx1ZSxcclxuICAgICAgICB0aW1lOiB0aW1lLnZhbHVlLFxyXG4gICAgICAgIGR1cmF0aW9uTWluOiBOdW1iZXIoZHVyYXRpb24udmFsdWUpLFxyXG4gICAgICAgIGNhcGFjaXR5OiBOdW1iZXIoY2FwYWNpdHkudmFsdWUpLFxyXG4gICAgICB9O1xyXG4gICAgICBjb25zdCByID0gZXhpc3RpbmdcclxuICAgICAgICA/IGF3YWl0IHRoaXMuY3R4LmNhdGFsb2cudXBkYXRlKGV4aXN0aW5nLmlkLCBkcmFmdClcclxuICAgICAgICA6IGF3YWl0IHRoaXMuY3R4LmNhdGFsb2cuY3JlYXRlKGRyYWZ0KTtcclxuICAgICAgaWYgKCFyLm9rKSB7XHJcbiAgICAgICAgdGhpcy5jdHgudG9hc3RzLnNob3coZXJyb3JNZXNzYWdlKHIuZXJyb3IpLCBcImVyclwiKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY2xvc2UoKTtcclxuICAgICAgdGhpcy5jdHgudG9hc3RzLnNob3coXHJcbiAgICAgICAgZXhpc3RpbmcgPyBcIlx1MDQyMlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzQVx1MDQzMCBcdTA0M0VcdTA0MzFcdTA0M0RcdTA0M0VcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzBcIiA6IFwiXHUwNDIyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDMwIFx1MDQzNFx1MDQzRVx1MDQzMVx1MDQzMFx1MDQzMlx1MDQzQlx1MDQzNVx1MDQzRFx1MDQzMFwiLFxyXG4gICAgICAgIFwib2tcIixcclxuICAgICAgKTtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgZm9ybSA9IGgoXHJcbiAgICAgIFwiZm9ybVwiLFxyXG4gICAgICB7XHJcbiAgICAgICAgY2xhc3M6IFwiZm9ybS1ncmlkXCIsXHJcbiAgICAgICAgb246IHtcclxuICAgICAgICAgIHN1Ym1pdDogKGUpID0+IHtcclxuICAgICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgICAgICB2b2lkIHN1Ym1pdCgpO1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgICBmaWVsZChcIlx1MDQxRFx1MDQzMFx1MDQzN1x1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQzNVwiLCB0aXRsZSwgdHJ1ZSksXHJcbiAgICAgIGZpZWxkKFwiXHUwNDIyXHUwNDM4XHUwNDNGXCIsIGtpbmQpLFxyXG4gICAgICBmaWVsZChcIlx1MDQyMlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzNVx1MDQ0MFwiLCB0cmFpbmVyKSxcclxuICAgICAgZmllbGQoXCJcdTA0MTdcdTA0MzBcdTA0M0JcIiwgcm9vbSksXHJcbiAgICAgIGZpZWxkKFwiXHUwNDE0XHUwNDMwXHUwNDQyXHUwNDMwXCIsIGRhdGUpLFxyXG4gICAgICBmaWVsZChcIlx1MDQxMlx1MDQ0MFx1MDQzNVx1MDQzQ1x1MDQ0RlwiLCB0aW1lKSxcclxuICAgICAgZmllbGQoXCJcdTA0MTRcdTA0M0JcdTA0MzhcdTA0NDJcdTA0MzVcdTA0M0JcdTA0NENcdTA0M0RcdTA0M0VcdTA0NDFcdTA0NDJcdTA0NEMsIFx1MDQzQ1x1MDQzOFx1MDQzRFwiLCBkdXJhdGlvbiksXHJcbiAgICAgIGZpZWxkKFwiXHUwNDEyXHUwNDNDXHUwNDM1XHUwNDQxXHUwNDQyXHUwNDM4XHUwNDNDXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDXCIsIGNhcGFjaXR5KSxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwibW9kYWwtYWN0aW9ucyBzcGFuMlwiIH0sXHJcbiAgICAgICAgYnV0dG9uKHsgbGFiZWw6IFwiXHUwNDFFXHUwNDQyXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDMwXCIsIHRvbmU6IFwiZ2hvc3RcIiwgb25DbGljazogKCkgPT4gY2xvc2UoKSB9KSxcclxuICAgICAgICBidXR0b24oeyBsYWJlbDogXCJcdTA0MjFcdTA0M0VcdTA0NDVcdTA0NDBcdTA0MzBcdTA0M0RcdTA0MzhcdTA0NDJcdTA0NENcIiwgdHlwZTogXCJzdWJtaXRcIiB9KSxcclxuICAgICAgKSxcclxuICAgICk7XHJcbiAgICBjb25zdCBjbG9zZSA9IHRoaXMuY3R4Lm92ZXJsYXlzLm9wZW4oXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJkaXZcIixcclxuICAgICAgICB7fSxcclxuICAgICAgICBoKFwiaDNcIiwge1xyXG4gICAgICAgICAgdGV4dDogZXhpc3RpbmcgPyBcIlx1MDQyMFx1MDQzNVx1MDQzNFx1MDQzMFx1MDQzQVx1MDQ0Mlx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQ0QyBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0NDNcIiA6IFwiXHUwNDFEXHUwNDNFXHUwNDMyXHUwNDMwXHUwNDRGIFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzQVx1MDQzMFwiLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGZvcm0sXHJcbiAgICAgICksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgLy8gLS0tLS0tLS0tLSBcdTA0MUFcdTA0M0JcdTA0MzhcdTA0MzVcdTA0M0RcdTA0NDJcdTA0NEIgLS0tLS0tLS0tLVxyXG4gIHByaXZhdGUgcmVuZGVyQ2xpZW50cygpOiB2b2lkIHtcclxuICAgIGNvbnN0IHJlc3VsdHNFbCA9IGgoXCJkaXZcIiwge30pO1xyXG4gICAgY29uc3QgcmVuZGVyUmVzdWx0cyA9ICgpOiB2b2lkID0+IHtcclxuICAgICAgcmVwbGFjZShyZXN1bHRzRWwsIHRoaXMuY2xpZW50c1RhYmxlKCkpO1xyXG4gICAgfTtcclxuICAgIHJlcGxhY2UoXHJcbiAgICAgIHRoaXMuc2VjdGlvbkVsLFxyXG4gICAgICBwYWdlSGVhZChcIlx1MDQxQVx1MDQzQlx1MDQzOFx1MDQzNVx1MDQzRFx1MDQ0Mlx1MDQ0QlwiLCBcIlx1MDQxRlx1MDQzRVx1MDQzOFx1MDQ0MVx1MDQzQSwgXHUwNDM0XHUwNDNFXHUwNDQxXHUwNDRDXHUwNDM1IFx1MDQzOCBcdTA0NDNcdTA0M0ZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzhcdTA0MzUgXHUwNDQwXHUwNDNFXHUwNDNCXHUwNDRGXHUwNDNDXHUwNDM4XCIpLFxyXG4gICAgICB0aGlzLnNlbGVjdGlvbi5zaXplID4gMFxyXG4gICAgICAgID8gdGhpcy5idWxrQmFyKCgpID0+IHtcclxuICAgICAgICAgICAgdm9pZCB0aGlzLmRlbGV0ZVNlbGVjdGVkVXNlcnMoKTtcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgOiBudWxsLFxyXG4gICAgICB0aGlzLnNlYXJjaEJveChcIlx1MDQxOFx1MDQzQ1x1MDQ0RiBcdTA0MzhcdTA0M0JcdTA0MzggZW1haWxcdTIwMjZcIiwgdGhpcy5jbGllbnRRdWVyeSwgKHYpID0+IHtcclxuICAgICAgICB0aGlzLmNsaWVudFF1ZXJ5ID0gdjtcclxuICAgICAgICByZW5kZXJSZXN1bHRzKCk7XHJcbiAgICAgIH0pLFxyXG4gICAgICByZXN1bHRzRWwsXHJcbiAgICApO1xyXG4gICAgcmVuZGVyUmVzdWx0cygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjbGllbnRzVGFibGUoKTogSFRNTEVsZW1lbnQge1xyXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgIGNvbnN0IGJvb2tpbmdzID0gdGhpcy5jdHguc3RhdGUuYWxsQm9va2luZ3MoKTtcclxuICAgIGNvbnN0IHEgPSB0aGlzLmNsaWVudFF1ZXJ5LnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgY29uc3QgdXNlcnMgPSB0aGlzLmN0eC5zdGF0ZVxyXG4gICAgICAuYWxsVXNlcnMoKVxyXG4gICAgICAuZmlsdGVyKCh1KSA9PiAhcSB8fCBgJHt1Lm5hbWV9ICR7dS5lbWFpbH1gLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocSkpO1xyXG4gICAgaWYgKHVzZXJzLmxlbmd0aCA9PT0gMClcclxuICAgICAgcmV0dXJuIGVtcHR5U3RhdGUoXCJcdTA0MURcdTA0MzhcdTA0M0FcdTA0M0VcdTA0MzNcdTA0M0UgXHUwNDNEXHUwNDM1IFx1MDQzRFx1MDQzMFx1MDQzOVx1MDQzNFx1MDQzNVx1MDQzRFx1MDQzRS5cIiwgdW5kZWZpbmVkLCBcInVzZXJzXCIpO1xyXG4gICAgY29uc3Qgc2VsZklkID0gdGhpcy5jdHguYXV0aC5jdXJyZW50VXNlcigpPy5pZDtcclxuICAgIGNvbnN0IHJvd3MgPSB1c2Vycy5tYXAoKHUpID0+IHtcclxuICAgICAgY29uc3QgbWluZSA9IGJvb2tpbmdzLmZpbHRlcigoYikgPT4gYi51c2VySWQgPT09IHUuaWQpO1xyXG4gICAgICBjb25zdCB1cGNvbWluZyA9IG1pbmUuZmlsdGVyKChiKSA9PiB7XHJcbiAgICAgICAgY29uc3QgcyA9IHRoaXMuY3R4LnN0YXRlLnNlc3Npb25CeUlkKGIuc2Vzc2lvbklkKTtcclxuICAgICAgICByZXR1cm4gcyAhPT0gdW5kZWZpbmVkICYmICFpc0ZpbmlzaGVkKHMsIG5vdyk7XHJcbiAgICAgIH0pLmxlbmd0aDtcclxuICAgICAgY29uc3QgYm94ID0gaChcImlucHV0XCIsIHtcclxuICAgICAgICBhdHRyczogeyB0eXBlOiBcImNoZWNrYm94XCIsIFwiYXJpYS1sYWJlbFwiOiBgXHUwNDEyXHUwNDRCXHUwNDMxXHUwNDQwXHUwNDMwXHUwNDQyXHUwNDRDICR7dS5uYW1lfWAgfSxcclxuICAgICAgICBjaGVja2VkOiB0aGlzLnNlbGVjdGlvbi5oYXModS5pZCksXHJcbiAgICAgICAgZGlzYWJsZWQ6IHUuaWQgPT09IHNlbGZJZCxcclxuICAgICAgfSk7XHJcbiAgICAgIGJveC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IGUuc3RvcFByb3BhZ2F0aW9uKCkpO1xyXG4gICAgICBib3guYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XHJcbiAgICAgICAgaWYgKGJveC5jaGVja2VkKSB0aGlzLnNlbGVjdGlvbi5hZGQodS5pZCk7XHJcbiAgICAgICAgZWxzZSB0aGlzLnNlbGVjdGlvbi5kZWxldGUodS5pZCk7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJTZWN0aW9uKCk7XHJcbiAgICAgIH0pO1xyXG4gICAgICBjb25zdCBhY3Rpb25zID0gaChcclxuICAgICAgICBcInNwYW5cIixcclxuICAgICAgICB7IGNsYXNzOiBcInJvdy1hY3Rpb25zXCIgfSxcclxuICAgICAgICBpY29uQnV0dG9uKFwiZWRpdFwiLCBcIlx1MDQyMFx1MDQzNVx1MDQzNFx1MDQzMFx1MDQzQVx1MDQ0Mlx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQ0Q1wiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgIHRoaXMub3BlblVzZXJGb3JtKHUpO1xyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGljb25CdXR0b24oXHJcbiAgICAgICAgICBcInRyYXNoXCIsXHJcbiAgICAgICAgICBcIlx1MDQyM1x1MDQzNFx1MDQzMFx1MDQzQlx1MDQzOFx1MDQ0Mlx1MDQ0Q1wiLFxyXG4gICAgICAgICAgKGUpID0+IHtcclxuICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICAgICAgdm9pZCB0aGlzLmRlbGV0ZVVzZXIodSk7XHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgeyBkYW5nZXI6IHRydWUsIGRpc2FibGVkOiB1LmlkID09PSBzZWxmSWQgfSxcclxuICAgICAgICApLFxyXG4gICAgICApO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIGNsYXNzOiBcImNsaWNrYWJsZVwiLFxyXG4gICAgICAgIG9uQ2xpY2s6ICgpID0+IHRoaXMub3BlbkNsaWVudCh1KSxcclxuICAgICAgICBjZWxsczogW1xyXG4gICAgICAgICAgYm94LFxyXG4gICAgICAgICAgaChcclxuICAgICAgICAgICAgXCJzcGFuXCIsXHJcbiAgICAgICAgICAgIHsgY2xhc3M6IFwiY2VsbC11c2VyXCIgfSxcclxuICAgICAgICAgICAgYXZhdGFyKHUubmFtZSksXHJcbiAgICAgICAgICAgIGgoXCJzdHJvbmdcIiwgeyB0ZXh0OiB1Lm5hbWUgfSksXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgICAgaChcInNwYW5cIiwgeyBjbGFzczogXCJtdXRlZFwiLCB0ZXh0OiB1LmVtYWlsIH0pLFxyXG4gICAgICAgICAgcm9sZUJhZGdlKHUucm9sZSksXHJcbiAgICAgICAgICBTdHJpbmcobWluZS5sZW5ndGgpLFxyXG4gICAgICAgICAgU3RyaW5nKHVwY29taW5nKSxcclxuICAgICAgICAgIGFjdGlvbnMsXHJcbiAgICAgICAgXSBhcyBDaGlsZFtdLFxyXG4gICAgICB9O1xyXG4gICAgfSk7XHJcbiAgICByZXR1cm4gZGF0YVRhYmxlKFxyXG4gICAgICBbXCJcIiwgXCJcdTA0MThcdTA0M0NcdTA0NEZcIiwgXCJFbWFpbFwiLCBcIlx1MDQyMFx1MDQzRVx1MDQzQlx1MDQ0Q1wiLCBcIlx1MDQxN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzNVx1MDQzOVwiLCBcIlx1MDQxRlx1MDQ0MFx1MDQzNVx1MDQzNFx1MDQ0MVx1MDQ0Mlx1MDQzRVx1MDQzOFx1MDQ0MlwiLCBcIlwiXSxcclxuICAgICAgcm93cyxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIG9wZW5DbGllbnQodTogVXNlcik6IHZvaWQge1xyXG4gICAgY29uc3QgY29udGVudCA9IGgoXCJkaXZcIiwgeyBjbGFzczogXCJkcmF3ZXItYm9keVwiIH0pO1xyXG4gICAgY29uc3QgY2xvc2UgPSB0aGlzLmN0eC5vdmVybGF5cy5vcGVuKGNvbnRlbnQsIFwiZHJhd2VyXCIpO1xyXG4gICAgY29uc3QgZmlsbCA9ICgpOiB2b2lkID0+IHtcclxuICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgICAgY29uc3QgbWluZSA9IHRoaXMuY3R4LnN0YXRlXHJcbiAgICAgICAgLmFsbEJvb2tpbmdzKClcclxuICAgICAgICAuZmlsdGVyKChiKSA9PiBiLnVzZXJJZCA9PT0gdS5pZClcclxuICAgICAgICAubWFwKChiKSA9PiAoeyBiLCBzOiB0aGlzLmN0eC5zdGF0ZS5zZXNzaW9uQnlJZChiLnNlc3Npb25JZCkgfSkpXHJcbiAgICAgICAgLmZpbHRlcihcclxuICAgICAgICAgICh4KTogeCBpcyB7IGI6IEJvb2tpbmc7IHM6IFdvcmtvdXRTZXNzaW9uIH0gPT4geC5zICE9PSB1bmRlZmluZWQsXHJcbiAgICAgICAgKVxyXG4gICAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnMuc3RhcnRzQXQubG9jYWxlQ29tcGFyZShhLnMuc3RhcnRzQXQpKTtcclxuICAgICAgY29uc3QgdXBjb21pbmcgPSBtaW5lLmZpbHRlcigoeCkgPT4gIWlzRmluaXNoZWQoeC5zLCBub3cpKTtcclxuICAgICAgY29uc3Qgcm93cyA9IG1pbmUubWFwKCh7IGIsIHMgfSkgPT5cclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJsaVwiLFxyXG4gICAgICAgICAgeyBjbGFzczogYHJvc3Rlci1yb3cke2lzRmluaXNoZWQocywgbm93KSA/IFwiIHBhc3RcIiA6IFwiXCJ9YCB9LFxyXG4gICAgICAgICAgaChcclxuICAgICAgICAgICAgXCJzcGFuXCIsXHJcbiAgICAgICAgICAgIHsgY2xhc3M6IFwicm9zdGVyLW5hbWVcIiB9LFxyXG4gICAgICAgICAgICBoKFwic3Ryb25nXCIsIHsgdGV4dDogcy50aXRsZSB9KSxcclxuICAgICAgICAgICAgaChcInNtYWxsXCIsIHtcclxuICAgICAgICAgICAgICBjbGFzczogXCJtdXRlZFwiLFxyXG4gICAgICAgICAgICAgIHRleHQ6IGAke2ZtdERhdGUocy5zdGFydHNBdCl9ICR7Zm10VGltZShzLnN0YXJ0c0F0KX0gXHUwMEI3ICR7cy50cmFpbmVyfWAsXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgKSxcclxuICAgICAgICAgIGlzRmluaXNoZWQocywgbm93KVxyXG4gICAgICAgICAgICA/IGgoXCJzcGFuXCIsIHsgY2xhc3M6IFwic3RhdHVzLWNoaXAgZG9uZVwiLCB0ZXh0OiBcIlx1MDQxN1x1MDQzMFx1MDQzMlx1MDQzNVx1MDQ0MFx1MDQ0OFx1MDQzNVx1MDQzRFx1MDQzMFwiIH0pXHJcbiAgICAgICAgICAgIDogaWNvbkJ1dHRvbihcclxuICAgICAgICAgICAgICAgIFwidHJhc2hcIixcclxuICAgICAgICAgICAgICAgIFwiXHUwNDFFXHUwNDQyXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQ0Q1wiLFxyXG4gICAgICAgICAgICAgICAgKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICB2b2lkIHRoaXMuY2FuY2VsRm9yKGIsIGZpbGwpO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHsgZGFuZ2VyOiB0cnVlIH0sXHJcbiAgICAgICAgICAgICAgKSxcclxuICAgICAgICApLFxyXG4gICAgICApO1xyXG4gICAgICByZXBsYWNlKFxyXG4gICAgICAgIGNvbnRlbnQsXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcImRyYXdlci1oZWFkXCIgfSxcclxuICAgICAgICAgIHJvbGVCYWRnZSh1LnJvbGUpLFxyXG4gICAgICAgICAgaWNvbkJ1dHRvbihcInhcIiwgXCJcdTA0MTdcdTA0MzBcdTA0M0FcdTA0NDBcdTA0NEJcdTA0NDJcdTA0NENcIiwgKCkgPT4gY2xvc2UoKSksXHJcbiAgICAgICAgKSxcclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJkaXZcIixcclxuICAgICAgICAgIHsgY2xhc3M6IFwiY2xpZW50LWhlYWRcIiB9LFxyXG4gICAgICAgICAgYXZhdGFyKHUubmFtZSksXHJcbiAgICAgICAgICBoKFxyXG4gICAgICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgICAgICB7fSxcclxuICAgICAgICAgICAgaChcImgyXCIsIHsgdGV4dDogdS5uYW1lIH0pLFxyXG4gICAgICAgICAgICBoKFwicFwiLCB7IGNsYXNzOiBcIm11dGVkXCIsIHRleHQ6IHUuZW1haWwgfSksXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgICksXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcInJlcG9ydC1jYXJkcyB0d29cIiB9LFxyXG4gICAgICAgICAgc3RhdENhcmQobWluZS5sZW5ndGgsIFwiXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDM1XHUwNDM5IFx1MDQzMlx1MDQ0MVx1MDQzNVx1MDQzM1x1MDQzRVwiKSxcclxuICAgICAgICAgIHN0YXRDYXJkKHVwY29taW5nLmxlbmd0aCwgXCJcdTA0M0ZcdTA0NDBcdTA0MzVcdTA0MzRcdTA0NDFcdTA0NDJcdTA0M0VcdTA0MzhcdTA0NDJcIiksXHJcbiAgICAgICAgKSxcclxuICAgICAgICBoKFwiaDRcIiwgeyB0ZXh0OiBcIlx1MDQxN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzOFwiIH0pLFxyXG4gICAgICAgIG1pbmUubGVuZ3RoID09PSAwXHJcbiAgICAgICAgICA/IGgoXCJwXCIsIHsgY2xhc3M6IFwibXV0ZWRcIiwgdGV4dDogXCJcdTA0MTdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzVcdTA0MzkgXHUwNDNEXHUwNDM1XHUwNDQyLlwiIH0pXHJcbiAgICAgICAgICA6IGgoXCJ1bFwiLCB7IGNsYXNzOiBcInJvc3RlclwiIH0sIC4uLnJvd3MpLFxyXG4gICAgICApO1xyXG4gICAgfTtcclxuICAgIGZpbGwoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZGVsZXRlVXNlcih1OiBVc2VyKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBjb25maXJtZWQgPSBhd2FpdCB0aGlzLmN0eC5vdmVybGF5cy5jb25maXJtKHtcclxuICAgICAgdGl0bGU6IFwiXHUwNDIzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQzRlx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzN1x1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQzNVx1MDQzQlx1MDQ0Rj9cIixcclxuICAgICAgdGV4dDogYCR7dS5uYW1lfSBcdTA0MzggXHUwNDMyXHUwNDQxXHUwNDM1IFx1MDQzNVx1MDQzM1x1MDQzRSBcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzggXHUwNDMxXHUwNDQzXHUwNDM0XHUwNDQzXHUwNDQyIFx1MDQ0M1x1MDQzNFx1MDQzMFx1MDQzQlx1MDQzNVx1MDQzRFx1MDQ0Qi5gLFxyXG4gICAgfSk7XHJcbiAgICBpZiAoIWNvbmZpcm1lZCkgcmV0dXJuO1xyXG4gICAgY29uc3QgciA9IGF3YWl0IHRoaXMuY3R4LmFjY291bnRzLnJlbW92ZSh1LmlkKTtcclxuICAgIGlmICghci5vaykge1xyXG4gICAgICB0aGlzLmN0eC50b2FzdHMuc2hvdyhlcnJvck1lc3NhZ2Uoci5lcnJvciksIFwiZXJyXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCB0b2tlbiA9IHIudmFsdWUudW5kb1Rva2VuO1xyXG4gICAgdGhpcy5jdHgudG9hc3RzLnNob3coYCR7dS5uYW1lfSBcdTA0NDNcdTA0MzRcdTA0MzBcdTA0M0JcdTA0NTFcdTA0M0RgLCBcImluZm9cIiwge1xyXG4gICAgICBsYWJlbDogXCJcdTA0MTJcdTA0MzVcdTA0NDBcdTA0M0RcdTA0NDNcdTA0NDJcdTA0NENcIixcclxuICAgICAgcnVuOiAoKSA9PiB7XHJcbiAgICAgICAgdm9pZCB0aGlzLnJlc3RvcmVVc2VyKHRva2VuKTtcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBkZWxldGVTZWxlY3RlZFVzZXJzKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgY291bnQgPSB0aGlzLnNlbGVjdGlvbi5zaXplO1xyXG4gICAgY29uc3QgY29uZmlybWVkID0gYXdhaXQgdGhpcy5jdHgub3ZlcmxheXMuY29uZmlybSh7XHJcbiAgICAgIHRpdGxlOiBgXHUwNDIzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQzRlx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzN1x1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQzNVx1MDQzQlx1MDQzNVx1MDQzOSAoJHtjb3VudH0pP2AsXHJcbiAgICAgIHRleHQ6IFwiXHUwNDEyXHUwNDQxXHUwNDM1IFx1MDQzOFx1MDQ0NSBcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzggXHUwNDMxXHUwNDQzXHUwNDM0XHUwNDQzXHUwNDQyIFx1MDQ0M1x1MDQzNFx1MDQzMFx1MDQzQlx1MDQzNVx1MDQzRFx1MDQ0Qi5cIixcclxuICAgIH0pO1xyXG4gICAgaWYgKCFjb25maXJtZWQpIHJldHVybjtcclxuICAgIGNvbnN0IHRva2Vuczogc3RyaW5nW10gPSBbXTtcclxuICAgIGZvciAoY29uc3QgaWQgb2YgWy4uLnRoaXMuc2VsZWN0aW9uXSkge1xyXG4gICAgICBjb25zdCByID0gYXdhaXQgdGhpcy5jdHguYWNjb3VudHMucmVtb3ZlKGlkKTtcclxuICAgICAgaWYgKHIub2spIHRva2Vucy5wdXNoKHIudmFsdWUudW5kb1Rva2VuKTtcclxuICAgIH1cclxuICAgIHRoaXMuc2VsZWN0aW9uLmNsZWFyKCk7XHJcbiAgICB0aGlzLmN0eC50b2FzdHMuc2hvdyhgXHUwNDIzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDM1XHUwNDNEXHUwNDNFOiAke3Rva2Vucy5sZW5ndGh9YCwgXCJpbmZvXCIsIHtcclxuICAgICAgbGFiZWw6IFwiXHUwNDEyXHUwNDM1XHUwNDQwXHUwNDNEXHUwNDQzXHUwNDQyXHUwNDRDXCIsXHJcbiAgICAgIHJ1bjogKCkgPT4ge1xyXG4gICAgICAgIHZvaWQgdGhpcy5yZXN0b3JlVXNlcnModG9rZW5zKTtcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZXN0b3JlVXNlcih0b2tlbjogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCByID0gYXdhaXQgdGhpcy5jdHguYWNjb3VudHMucmVzdG9yZSh0b2tlbik7XHJcbiAgICB0aGlzLmN0eC50b2FzdHMuc2hvdyhcclxuICAgICAgci5vayA/IFwiXHUwNDFGXHUwNDNFXHUwNDNCXHUwNDRDXHUwNDM3XHUwNDNFXHUwNDMyXHUwNDMwXHUwNDQyXHUwNDM1XHUwNDNCXHUwNDRDIFx1MDQzMlx1MDQzRVx1MDQ0MVx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQzRFx1MDQzRVx1MDQzMlx1MDQzQlx1MDQzNVx1MDQzRFwiIDogZXJyb3JNZXNzYWdlKHIuZXJyb3IpLFxyXG4gICAgICByLm9rID8gXCJva1wiIDogXCJlcnJcIixcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlc3RvcmVVc2Vycyh0b2tlbnM6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBmb3IgKGNvbnN0IHQgb2YgdG9rZW5zKSBhd2FpdCB0aGlzLmN0eC5hY2NvdW50cy5yZXN0b3JlKHQpO1xyXG4gICAgdGhpcy5jdHgudG9hc3RzLnNob3coXCJcdTA0MUZcdTA0M0VcdTA0M0JcdTA0NENcdTA0MzdcdTA0M0VcdTA0MzJcdTA0MzBcdTA0NDJcdTA0MzVcdTA0M0JcdTA0MzggXHUwNDMyXHUwNDNFXHUwNDQxXHUwNDQxXHUwNDQyXHUwNDMwXHUwNDNEXHUwNDNFXHUwNDMyXHUwNDNCXHUwNDM1XHUwNDNEXHUwNDRCXCIsIFwib2tcIik7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIG9wZW5Vc2VyRm9ybSh1OiBVc2VyKTogdm9pZCB7XHJcbiAgICBjb25zdCBuYW1lID0gdGV4dElucHV0KFxyXG4gICAgICB7IHR5cGU6IFwidGV4dFwiLCByZXF1aXJlZDogdHJ1ZSwgbWlubGVuZ3RoOiAyIH0sXHJcbiAgICAgIHUubmFtZSxcclxuICAgICk7XHJcbiAgICBjb25zdCBlbWFpbCA9IHRleHRJbnB1dCh7IHR5cGU6IFwiZW1haWxcIiwgcmVxdWlyZWQ6IHRydWUgfSwgdS5lbWFpbCk7XHJcbiAgICBjb25zdCByb2xlID0gc2VsZWN0SW5wdXQoXHJcbiAgICAgIFtcclxuICAgICAgICB7IHZhbHVlOiBcImNsaWVudFwiLCBsYWJlbDogXCJcdTA0MUFcdTA0M0JcdTA0MzhcdTA0MzVcdTA0M0RcdTA0NDJcIiB9LFxyXG4gICAgICAgIHsgdmFsdWU6IFwiYWRtaW5cIiwgbGFiZWw6IFwiXHUwNDEwXHUwNDM0XHUwNDNDXHUwNDM4XHUwNDNEXCIgfSxcclxuICAgICAgXSxcclxuICAgICAgdS5yb2xlLFxyXG4gICAgKTtcclxuICAgIGNvbnN0IHN1Ym1pdCA9IGFzeW5jICgpOiBQcm9taXNlPHZvaWQ+ID0+IHtcclxuICAgICAgY29uc3QgciA9IGF3YWl0IHRoaXMuY3R4LmFjY291bnRzLnVwZGF0ZSh1LmlkLCB7XHJcbiAgICAgICAgbmFtZTogbmFtZS52YWx1ZSxcclxuICAgICAgICBlbWFpbDogZW1haWwudmFsdWUsXHJcbiAgICAgICAgcm9sZTogcm9sZS52YWx1ZSA9PT0gXCJhZG1pblwiID8gXCJhZG1pblwiIDogXCJjbGllbnRcIixcclxuICAgICAgfSk7XHJcbiAgICAgIGlmICghci5vaykge1xyXG4gICAgICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KGVycm9yTWVzc2FnZShyLmVycm9yKSwgXCJlcnJcIik7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIGNsb3NlKCk7XHJcbiAgICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KFwiXHUwNDE0XHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQzRlx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzN1x1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQzNVx1MDQzQlx1MDQ0RiBcdTA0M0VcdTA0MzFcdTA0M0RcdTA0M0VcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0NEJcIiwgXCJva1wiKTtcclxuICAgIH07XHJcbiAgICBjb25zdCBmb3JtID0gaChcclxuICAgICAgXCJmb3JtXCIsXHJcbiAgICAgIHtcclxuICAgICAgICBjbGFzczogXCJmb3JtLWdyaWRcIixcclxuICAgICAgICBvbjoge1xyXG4gICAgICAgICAgc3VibWl0OiAoZSkgPT4ge1xyXG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICAgIHZvaWQgc3VibWl0KCk7XHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICAgIGZpZWxkKFwiXHUwNDE4XHUwNDNDXHUwNDRGXCIsIG5hbWUsIHRydWUpLFxyXG4gICAgICBmaWVsZChcIkVtYWlsXCIsIGVtYWlsLCB0cnVlKSxcclxuICAgICAgZmllbGQoXCJcdTA0MjBcdTA0M0VcdTA0M0JcdTA0NENcIiwgcm9sZSwgdHJ1ZSksXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJkaXZcIixcclxuICAgICAgICB7IGNsYXNzOiBcIm1vZGFsLWFjdGlvbnMgc3BhbjJcIiB9LFxyXG4gICAgICAgIGJ1dHRvbih7IGxhYmVsOiBcIlx1MDQxRVx1MDQ0Mlx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzMFwiLCB0b25lOiBcImdob3N0XCIsIG9uQ2xpY2s6ICgpID0+IGNsb3NlKCkgfSksXHJcbiAgICAgICAgYnV0dG9uKHsgbGFiZWw6IFwiXHUwNDIxXHUwNDNFXHUwNDQ1XHUwNDQwXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDQyXHUwNDRDXCIsIHR5cGU6IFwic3VibWl0XCIgfSksXHJcbiAgICAgICksXHJcbiAgICApO1xyXG4gICAgY29uc3QgY2xvc2UgPSB0aGlzLmN0eC5vdmVybGF5cy5vcGVuKFxyXG4gICAgICBoKFwiZGl2XCIsIHt9LCBoKFwiaDNcIiwgeyB0ZXh0OiBcIlx1MDQxRlx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzN1x1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQzNVx1MDQzQlx1MDQ0Q1wiIH0pLCBmb3JtKSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICAvLyAtLS0tLS0tLS0tIFx1MDQxRVx1MDQ0Mlx1MDQ0N1x1MDQ1MVx1MDQ0Mlx1MDQ0QiAtLS0tLS0tLS0tXHJcbiAgcHJpdmF0ZSByZW5kZXJSZXBvcnRzKCk6IHZvaWQge1xyXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgIGNvbnN0IHJlcG9ydCA9IGJ1aWxkUmVwb3J0KFxyXG4gICAgICB0aGlzLmN0eC5zdGF0ZS5hbGxTZXNzaW9ucygpLFxyXG4gICAgICB0aGlzLmN0eC5zdGF0ZS5hbGxCb29raW5ncygpLFxyXG4gICAgICB0aGlzLmN0eC5zdGF0ZS5hbGxVc2VycygpLFxyXG4gICAgKTtcclxuICAgIGNvbnN0IGJ5S2luZCA9IFdPUktPVVRfS0lORFMubWFwKChraW5kKSA9PiB7XHJcbiAgICAgIGNvbnN0IGlkcyA9IG5ldyBTZXQoXHJcbiAgICAgICAgcmVwb3J0LnJvd3NcclxuICAgICAgICAgIC5maWx0ZXIoKHIpID0+IHIuc2Vzc2lvbi5raW5kID09PSBraW5kKVxyXG4gICAgICAgICAgLm1hcCgocikgPT4gci5zZXNzaW9uLmlkKSxcclxuICAgICAgKTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBraW5kLFxyXG4gICAgICAgIGNvdW50OiB0aGlzLmN0eC5zdGF0ZS5hbGxCb29raW5ncygpLmZpbHRlcigoYikgPT4gaWRzLmhhcyhiLnNlc3Npb25JZCkpXHJcbiAgICAgICAgICAubGVuZ3RoLFxyXG4gICAgICB9O1xyXG4gICAgfSk7XHJcbiAgICBjb25zdCBtYXhLaW5kID0gTWF0aC5tYXgoMSwgLi4uYnlLaW5kLm1hcCgoeCkgPT4geC5jb3VudCkpO1xyXG4gICAgY29uc3Qga2luZFJvd3MgPSBieUtpbmQubWFwKCh4KSA9PlxyXG4gICAgICBoKFxyXG4gICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJjaGFydC1yb3dcIiB9LFxyXG4gICAgICAgIGgoXCJzcGFuXCIsIHsgY2xhc3M6IFwiY2hhcnQtbGFiZWxcIiwgdGV4dDogS0lORF9MQUJFTFt4LmtpbmRdIH0pLFxyXG4gICAgICAgIGgoXHJcbiAgICAgICAgICBcInNwYW5cIixcclxuICAgICAgICAgIHsgY2xhc3M6IFwiY2hhcnQtYmFyXCIgfSxcclxuICAgICAgICAgIGgoXCJzcGFuXCIsIHtcclxuICAgICAgICAgICAgY2xhc3M6IGBrLSR7eC5raW5kfWAsXHJcbiAgICAgICAgICAgIHN0eWxlOiBgd2lkdGg6JHtNYXRoLnJvdW5kKCh4LmNvdW50IC8gbWF4S2luZCkgKiAxMDApfSVgLFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgKSxcclxuICAgICAgICBoKFwic3BhblwiLCB7IGNsYXNzOiBcImNoYXJ0LXZhbHVlXCIsIHRleHQ6IFN0cmluZyh4LmNvdW50KSB9KSxcclxuICAgICAgKSxcclxuICAgICk7XHJcbiAgICBjb25zdCB0YWJsZSA9IGRhdGFUYWJsZShcclxuICAgICAgW1wiXHUwNDIyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDMwXCIsIFwiXHUwNDE0XHUwNDMwXHUwNDQyXHUwNDMwXCIsIFwiXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDNEXHUwNDNFXCIsIFwiXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDNEXHUwNDRGXHUwNDM1XHUwNDNDXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDXCJdLFxyXG4gICAgICByZXBvcnQucm93cy5tYXAoKHIpID0+ICh7XHJcbiAgICAgICAgY2xhc3M6IGlzRmluaXNoZWQoci5zZXNzaW9uLCBub3cpID8gXCJwYXN0XCIgOiBcIlwiLFxyXG4gICAgICAgIGNlbGxzOiBbXHJcbiAgICAgICAgICBoKFxyXG4gICAgICAgICAgICBcInNwYW5cIixcclxuICAgICAgICAgICAgeyBjbGFzczogXCJjZWxsLXRpdGxlXCIgfSxcclxuICAgICAgICAgICAgaChcInNwYW5cIiwgeyB0ZXh0OiByLnNlc3Npb24udGl0bGUgfSksXHJcbiAgICAgICAgICAgIGtpbmRCYWRnZShyLnNlc3Npb24ua2luZCksXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgICAgYCR7Zm10RGF0ZShyLnNlc3Npb24uc3RhcnRzQXQpfSAke2ZtdFRpbWUoci5zZXNzaW9uLnN0YXJ0c0F0KX1gLFxyXG4gICAgICAgICAgYCR7ci5ib29rZWR9LyR7ci5zZXNzaW9uLmNhcGFjaXR5fWAsXHJcbiAgICAgICAgICBoKFxyXG4gICAgICAgICAgICBcInNwYW5cIixcclxuICAgICAgICAgICAgeyBjbGFzczogXCJvY2MtY2VsbFwiIH0sXHJcbiAgICAgICAgICAgIG9jY3VwYW5jeUJhcihyLm9jY3VwYW5jeSksXHJcbiAgICAgICAgICAgIGgoXCJzcGFuXCIsIHsgdGV4dDogYCR7ci5vY2N1cGFuY3l9JWAgfSksXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgIF0gYXMgQ2hpbGRbXSxcclxuICAgICAgfSkpLFxyXG4gICAgKTtcclxuICAgIHJlcGxhY2UoXHJcbiAgICAgIHRoaXMuc2VjdGlvbkVsLFxyXG4gICAgICBwYWdlSGVhZChcclxuICAgICAgICBcIlx1MDQxRVx1MDQ0Mlx1MDQ0N1x1MDQ1MVx1MDQ0Mlx1MDQ0QlwiLFxyXG4gICAgICAgIFwiXHUwNDI0XHUwNDNFXHUwNDQwXHUwNDNDXHUwNDM4XHUwNDQwXHUwNDQzXHUwNDRFXHUwNDQyXHUwNDQxXHUwNDRGIFx1MDQzQ1x1MDQzM1x1MDQzRFx1MDQzRVx1MDQzMlx1MDQzNVx1MDQzRFx1MDQzRFx1MDQzRSBcdTA0MzhcdTA0MzcgXHUwNDM3XHUwNDMwXHUwNDMzXHUwNDQwXHUwNDQzXHUwNDM2XHUwNDM1XHUwNDNEXHUwNDNEXHUwNDRCXHUwNDQ1IFx1MDQzNFx1MDQzMFx1MDQzRFx1MDQzRFx1MDQ0Qlx1MDQ0NVwiLFxyXG4gICAgICAgIGJ1dHRvbih7XHJcbiAgICAgICAgICBsYWJlbDogXCJcdTA0MjFcdTA0M0FcdTA0MzBcdTA0NDdcdTA0MzBcdTA0NDJcdTA0NEMgQ1NWXCIsXHJcbiAgICAgICAgICB0b25lOiBcImdob3N0XCIsXHJcbiAgICAgICAgICBpY29uOiBcImRvd25sb2FkXCIsXHJcbiAgICAgICAgICBvbkNsaWNrOiAoKSA9PiB0aGlzLmV4cG9ydENzdihyZXBvcnQucm93cyksXHJcbiAgICAgICAgfSksXHJcbiAgICAgICksXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJkaXZcIixcclxuICAgICAgICB7IGNsYXNzOiBcInJlcG9ydC1jYXJkc1wiIH0sXHJcbiAgICAgICAgc3RhdENhcmQocmVwb3J0LnRvdGFsU2Vzc2lvbnMsIFwiXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNFXHUwNDNBXCIpLFxyXG4gICAgICAgIHN0YXRDYXJkKHJlcG9ydC50b3RhbEJvb2tpbmdzLCBcIlx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzNVx1MDQzOVwiKSxcclxuICAgICAgICBzdGF0Q2FyZChyZXBvcnQuYWN0aXZlQ2xpZW50cywgXCJcdTA0M0FcdTA0M0JcdTA0MzhcdTA0MzVcdTA0M0RcdTA0NDJcdTA0M0VcdTA0MzJcIiksXHJcbiAgICAgICAgc3RhdENhcmQoYCR7cmVwb3J0Lm9jY3VwYW5jeX0lYCwgXCJcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0M0VcdTA0M0JcdTA0M0RcdTA0NEZcdTA0MzVcdTA0M0NcdTA0M0VcdTA0NDFcdTA0NDJcdTA0NENcIiksXHJcbiAgICAgICksXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJkaXZcIixcclxuICAgICAgICB7IGNsYXNzOiBcInBhbmVsLWNhcmRcIiB9LFxyXG4gICAgICAgIGgoXCJoM1wiLCB7IHRleHQ6IFwiXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDM4IFx1MDQzRlx1MDQzRSBcdTA0M0RcdTA0MzBcdTA0M0ZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NEZcdTA0M0NcIiB9KSxcclxuICAgICAgICBoKFwiZGl2XCIsIHsgY2xhc3M6IFwiY2hhcnRcIiB9LCAuLi5raW5kUm93cyksXHJcbiAgICAgICksXHJcbiAgICAgIHRhYmxlLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZXhwb3J0Q3N2KFxyXG4gICAgcm93czogeyBzZXNzaW9uOiBXb3Jrb3V0U2Vzc2lvbjsgYm9va2VkOiBudW1iZXI7IG9jY3VwYW5jeTogbnVtYmVyIH1bXSxcclxuICApOiB2b2lkIHtcclxuICAgIGNvbnN0IGRhdGE6IChzdHJpbmcgfCBudW1iZXIpW11bXSA9IFtcclxuICAgICAgW1xyXG4gICAgICAgIFwiXHUwNDIyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDMwXCIsXHJcbiAgICAgICAgXCJcdTA0MjJcdTA0MzhcdTA0M0ZcIixcclxuICAgICAgICBcIlx1MDQxNFx1MDQzMFx1MDQ0Mlx1MDQzMFwiLFxyXG4gICAgICAgIFwiXHUwNDEyXHUwNDQwXHUwNDM1XHUwNDNDXHUwNDRGXCIsXHJcbiAgICAgICAgXCJcdTA0MjJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzVcdTA0NDBcIixcclxuICAgICAgICBcIlx1MDQxN1x1MDQzMFx1MDQzQlwiLFxyXG4gICAgICAgIFwiXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDNEXHUwNDNFXCIsXHJcbiAgICAgICAgXCJcdTA0MTJcdTA0M0NcdTA0MzVcdTA0NDFcdTA0NDJcdTA0MzhcdTA0M0NcdTA0M0VcdTA0NDFcdTA0NDJcdTA0NENcIixcclxuICAgICAgICBcIlx1MDQxN1x1MDQzMFx1MDQzRlx1MDQzRVx1MDQzQlx1MDQzRFx1MDQ0Rlx1MDQzNVx1MDQzQ1x1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0QyAlXCIsXHJcbiAgICAgIF0sXHJcbiAgICAgIC4uLnJvd3MubWFwKChyKSA9PiBbXHJcbiAgICAgICAgci5zZXNzaW9uLnRpdGxlLFxyXG4gICAgICAgIEtJTkRfTEFCRUxbci5zZXNzaW9uLmtpbmRdLFxyXG4gICAgICAgIGZtdERhdGUoci5zZXNzaW9uLnN0YXJ0c0F0KSxcclxuICAgICAgICBmbXRUaW1lKHIuc2Vzc2lvbi5zdGFydHNBdCksXHJcbiAgICAgICAgci5zZXNzaW9uLnRyYWluZXIsXHJcbiAgICAgICAgci5zZXNzaW9uLnJvb20sXHJcbiAgICAgICAgci5ib29rZWQsXHJcbiAgICAgICAgci5zZXNzaW9uLmNhcGFjaXR5LFxyXG4gICAgICAgIHIub2NjdXBhbmN5LFxyXG4gICAgICBdKSxcclxuICAgIF07XHJcbiAgICBkb3dubG9hZFRleHQoYGF0bGV0LXJlcG9ydC0ke2RheUtleShuZXcgRGF0ZSgpKX0uY3N2YCwgdG9Dc3YoZGF0YSkpO1xyXG4gICAgdGhpcy5jdHgudG9hc3RzLnNob3coXCJcdTA0MUVcdTA0NDJcdTA0NDdcdTA0NTFcdTA0NDIgXHUwNDMyXHUwNDRCXHUwNDMzXHUwNDQwXHUwNDQzXHUwNDM2XHUwNDM1XHUwNDNEIFx1MDQzMiBDU1ZcIiwgXCJva1wiKTtcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB0eXBlIHsgQXBwQ29udGV4dCB9IGZyb20gXCIuLi9hcHAvY29udGV4dFwiO1xyXG5pbXBvcnQgeyBoLCByZXBsYWNlIH0gZnJvbSBcIi4uL3VpL2RvbVwiO1xyXG5pbXBvcnQgeyBpY29uLCB0eXBlIEljb25OYW1lIH0gZnJvbSBcIi4uL3VpL2ljb25zXCI7XHJcbmltcG9ydCB7IGVycm9yTWVzc2FnZSB9IGZyb20gXCIuLi91aS9tZXNzYWdlc1wiO1xyXG5pbXBvcnQgeyBBVVRIX1BIT1RPIH0gZnJvbSBcIi4uL3VpL2Zvcm1hdFwiO1xyXG5pbXBvcnQgeyBCYXNlVmlldyB9IGZyb20gXCIuL3ZpZXdcIjtcclxuaW1wb3J0IHsgYnV0dG9uLCBpY29uQnV0dG9uLCByZW1vdGVJbWcsIHRleHRJbnB1dCB9IGZyb20gXCIuLi91aS9jb250cm9sc1wiO1xyXG5pbXBvcnQgeyBjdXJyZW50VGhlbWUsIHRvZ2dsZVRoZW1lIH0gZnJvbSBcIi4uL3VpL3RoZW1lXCI7XHJcblxyXG50eXBlIFRhYiA9IFwibG9naW5cIiB8IFwicmVnaXN0ZXJcIjtcclxuXHJcbmxldCByZXF1ZXN0ZWRUYWI6IFRhYiB8IG51bGwgPSBudWxsO1xyXG5leHBvcnQgZnVuY3Rpb24gcmVxdWVzdEF1dGhUYWIodGFiOiBUYWIpOiB2b2lkIHtcclxuICByZXF1ZXN0ZWRUYWIgPSB0YWI7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBBdXRoVmlldyBleHRlbmRzIEJhc2VWaWV3IHtcclxuICBwcml2YXRlIHRhYjogVGFiID0gXCJsb2dpblwiO1xyXG4gIHByaXZhdGUgYnVzeSA9IGZhbHNlO1xyXG5cclxuICBjb25zdHJ1Y3RvcihjdHg6IEFwcENvbnRleHQpIHtcclxuICAgIHN1cGVyKGN0eCk7XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgaW5pdCgpOiB2b2lkIHtcclxuICAgIGlmIChyZXF1ZXN0ZWRUYWIpIHtcclxuICAgICAgdGhpcy50YWIgPSByZXF1ZXN0ZWRUYWI7XHJcbiAgICAgIHJlcXVlc3RlZFRhYiA9IG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgcmVuZGVyKCk6IHZvaWQge1xyXG4gICAgcmVwbGFjZShcclxuICAgICAgdGhpcy5yb290LFxyXG4gICAgICBoKFwiZGl2XCIsIHsgY2xhc3M6IFwiYXV0aC13cmFwXCIgfSwgdGhpcy5hcnQoKSwgdGhpcy5jYXJkKCkpLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXJ0KCk6IEhUTUxFbGVtZW50IHtcclxuICAgIHJldHVybiBoKFxyXG4gICAgICBcInNlY3Rpb25cIixcclxuICAgICAgeyBjbGFzczogXCJhdXRoLWFydFwiIH0sXHJcbiAgICAgIHJlbW90ZUltZyhBVVRIX1BIT1RPLCBcIlx1MDQxN1x1MDQzMFx1MDQzQiBcdTA0MTBcdTA0MjJcdTA0MUJcdTA0MTVcdTA0MjJcIiwgXCJhdXRoLXBob3RvXCIsICgpID0+XHJcbiAgICAgICAgaChcImRpdlwiLCB7IGNsYXNzOiBcImF1dGgtcGhvdG8tZmFsbGJhY2tcIiB9KSxcclxuICAgICAgKSxcclxuICAgICAgaChcInNwYW5cIiwgeyBjbGFzczogXCJsb2dvLW1hcmtcIiB9LCBpY29uKFwiZHVtYmJlbGxcIiwgMjIpKSxcclxuICAgICAgaChcImgxXCIsIHsgY2xhc3M6IFwiYXV0aC1zbG9nYW5cIiwgdGV4dDogXCJcdTA0MjJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0NDNcdTA0MzlcdTA0NDFcdTA0NEYgXHUwNDNGXHUwNDNFIFx1MDQ0MFx1MDQzMFx1MDQ0MVx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0RS5cIiB9KSxcclxuICAgICAgaChcInBcIiwge1xyXG4gICAgICAgIGNsYXNzOiBcImF1dGgtYXJ0LW5vdGVcIixcclxuICAgICAgICB0ZXh0OiBcIlx1MDQxRlx1MDQ0Rlx1MDQ0Mlx1MDQ0QyBcdTA0M0RcdTA0MzBcdTA0M0ZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzhcdTA0MzksIFx1MDQzNFx1MDQzMlx1MDQzMCBcdTA0MzdcdTA0MzBcdTA0M0JcdTA0MzAgXHUwNDM4IFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzNVx1MDQ0MFx1MDQ0QiwgXHUwNDNBXHUwNDNFXHUwNDQyXHUwNDNFXHUwNDQwXHUwNDRCXHUwNDM1IFx1MDQzNFx1MDQzRVx1MDQzMlx1MDQzRVx1MDQzNFx1MDQ0Rlx1MDQ0MiBcdTA0MzRcdTA0M0UgXHUwNDQwXHUwNDM1XHUwNDM3XHUwNDQzXHUwNDNCXHUwNDRDXHUwNDQyXHUwNDMwXHUwNDQyXHUwNDMwLlwiLFxyXG4gICAgICB9KSxcclxuICAgICAgaChcclxuICAgICAgICBcInVsXCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJhdXRoLXBvaW50c1wiIH0sXHJcbiAgICAgICAgaChcImxpXCIsIHt9LCBpY29uKFwiY2hlY2tcIiwgMTYpLCBcIlx1MDQxRlx1MDQzNVx1MDQ0MFx1MDQzMlx1MDQzMFx1MDQ0RiBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0MzAgXHUyMDE0IFx1MDQzMVx1MDQzNVx1MDQ0MVx1MDQzRlx1MDQzQlx1MDQzMFx1MDQ0Mlx1MDQzRFx1MDQzRVwiKSxcclxuICAgICAgICBoKFwibGlcIiwge30sIGljb24oXCJjaGVja1wiLCAxNiksIFwiXHUwNDFFXHUwNDQyXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDMwIFx1MDQzOCBcdTA0MzJcdTA0M0VcdTA0MzdcdTA0MzJcdTA0NDBcdTA0MzBcdTA0NDIgXHUyMDE0IFx1MDQzMiBcdTA0M0VcdTA0MzRcdTA0M0RcdTA0M0UgXHUwNDNBXHUwNDMwXHUwNDQxXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDM1XCIpLFxyXG4gICAgICAgIGgoXCJsaVwiLCB7fSwgaWNvbihcImNoZWNrXCIsIDE2KSwgXCJcdTA0MjBcdTA0MzBcdTA0MzFcdTA0M0VcdTA0NDJcdTA0MzBcdTA0MzVcdTA0NDIgXHUwNDQxIFx1MDQ0Mlx1MDQzNVx1MDQzQlx1MDQzNVx1MDQ0NFx1MDQzRVx1MDQzRFx1MDQzMCBcdTA0MzggXHUwNDNBXHUwNDNFXHUwNDNDXHUwNDNGXHUwNDRDXHUwNDRFXHUwNDQyXHUwNDM1XHUwNDQwXHUwNDMwXCIpLFxyXG4gICAgICApLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgdGhlbWVCdXR0b24oKTogSFRNTEJ1dHRvbkVsZW1lbnQge1xyXG4gICAgY29uc3QgYnRuID0gaWNvbkJ1dHRvbihcclxuICAgICAgY3VycmVudFRoZW1lKCkgPT09IFwiZGFya1wiID8gXCJzdW5cIiA6IFwibW9vblwiLFxyXG4gICAgICBcIlx1MDQyMVx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0Mlx1MDQ0QyBcdTA0NDJcdTA0MzVcdTA0M0NcdTA0NDNcIixcclxuICAgICAgKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IG5leHQgPSB0b2dnbGVUaGVtZSgpO1xyXG4gICAgICAgIHJlcGxhY2UoYnRuLCBpY29uKG5leHQgPT09IFwiZGFya1wiID8gXCJzdW5cIiA6IFwibW9vblwiLCAxOCkpO1xyXG4gICAgICB9LFxyXG4gICAgKTtcclxuICAgIHJldHVybiBidG47XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNhcmQoKTogSFRNTEVsZW1lbnQge1xyXG4gICAgcmV0dXJuIGgoXHJcbiAgICAgIFwic2VjdGlvblwiLFxyXG4gICAgICB7IGNsYXNzOiBcImF1dGgtY2FyZFwiIH0sXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJkaXZcIixcclxuICAgICAgICB7IGNsYXNzOiBcImF1dGgtdG9wXCIgfSxcclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJidXR0b25cIixcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgY2xhc3M6IFwiYXV0aC1iYWNrXCIsXHJcbiAgICAgICAgICAgIGF0dHJzOiB7IHR5cGU6IFwiYnV0dG9uXCIgfSxcclxuICAgICAgICAgICAgb246IHsgY2xpY2s6ICgpID0+IHRoaXMuY3R4Lm5hdmlnYXRlKFwiaG9tZVwiKSB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIGljb24oXCJhcnJvdy1sZWZ0XCIsIDE2KSxcclxuICAgICAgICAgIFwiXHUwNDFEXHUwNDMwIFx1MDQzM1x1MDQzQlx1MDQzMFx1MDQzMlx1MDQzRFx1MDQ0M1x1MDQ0RVwiLFxyXG4gICAgICAgICksXHJcbiAgICAgICAgdGhpcy50aGVtZUJ1dHRvbigpLFxyXG4gICAgICApLFxyXG4gICAgICBoKFxyXG4gICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJhdXRoLWhlYWRcIiB9LFxyXG4gICAgICAgIGgoXCJoMlwiLCB7IHRleHQ6IHRoaXMudGFiID09PSBcImxvZ2luXCIgPyBcIlx1MDQxMlx1MDQ0NVx1MDQzRVx1MDQzNFwiIDogXCJcdTA0MjBcdTA0MzVcdTA0MzNcdTA0MzhcdTA0NDFcdTA0NDJcdTA0NDBcdTA0MzBcdTA0NDZcdTA0MzhcdTA0NEZcIiB9KSxcclxuICAgICAgICBoKFwicFwiLCB7XHJcbiAgICAgICAgICBjbGFzczogXCJtdXRlZFwiLFxyXG4gICAgICAgICAgdGV4dDpcclxuICAgICAgICAgICAgdGhpcy50YWIgPT09IFwibG9naW5cIlxyXG4gICAgICAgICAgICAgID8gXCJcdTA0MjEgXHUwNDMyXHUwNDNFXHUwNDM3XHUwNDMyXHUwNDQwXHUwNDMwXHUwNDQ5XHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM1XHUwNDNDLiBcdTA0MUZcdTA0NDBcdTA0M0VcdTA0MzRcdTA0M0VcdTA0M0JcdTA0MzZcdTA0MzggXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDM4LlwiXHJcbiAgICAgICAgICAgICAgOiBcIlx1MDQxMFx1MDQzQVx1MDQzQVx1MDQzMFx1MDQ0M1x1MDQzRFx1MDQ0MiBcdTA0MzdcdTA0MzAgMjAgXHUwNDQxXHUwNDM1XHUwNDNBXHUwNDQzXHUwNDNEXHUwNDM0IFx1MjAxNCBcdTA0MzFcdTA0MzVcdTA0MzcgXHUwNDMwXHUwNDNEXHUwNDNBXHUwNDM1XHUwNDQyXHUwNDRCIFx1MDQzOCBcdTA0MzdcdTA0MzJcdTA0M0VcdTA0M0RcdTA0M0FcdTA0M0VcdTA0MzIuXCIsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICksXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJkaXZcIixcclxuICAgICAgICB7IGNsYXNzOiBcImF1dGgtdGFic1wiLCBhdHRyczogeyByb2xlOiBcInRhYmxpc3RcIiB9IH0sXHJcbiAgICAgICAgdGhpcy50YWJCdXR0b24oXCJsb2dpblwiLCBcIlx1MDQxMlx1MDQ0NVx1MDQzRVx1MDQzNFwiKSxcclxuICAgICAgICB0aGlzLnRhYkJ1dHRvbihcInJlZ2lzdGVyXCIsIFwiXHUwNDIwXHUwNDM1XHUwNDMzXHUwNDM4XHUwNDQxXHUwNDQyXHUwNDQwXHUwNDMwXHUwNDQ2XHUwNDM4XHUwNDRGXCIpLFxyXG4gICAgICApLFxyXG4gICAgICB0aGlzLnRhYiA9PT0gXCJsb2dpblwiID8gdGhpcy5sb2dpbkZvcm0oKSA6IHRoaXMucmVnaXN0ZXJGb3JtKCksXHJcbiAgICAgIGgoXCJkaXZcIiwgeyBjbGFzczogXCJhdXRoLWRpdmlkZXJcIiB9LCBcIlx1MDQzNFx1MDQzNVx1MDQzQ1x1MDQzRS1cdTA0MzRcdTA0M0VcdTA0NDFcdTA0NDJcdTA0NDNcdTA0M0ZcIiksXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJkaXZcIixcclxuICAgICAgICB7IGNsYXNzOiBcImF1dGgtZGVtb1wiIH0sXHJcbiAgICAgICAgYnV0dG9uKHtcclxuICAgICAgICAgIGxhYmVsOiBcIlx1MDQxQVx1MDQzQlx1MDQzOFx1MDQzNVx1MDQzRFx1MDQ0MlwiLFxyXG4gICAgICAgICAgdG9uZTogXCJnaG9zdFwiLFxyXG4gICAgICAgICAgc21hbGw6IHRydWUsXHJcbiAgICAgICAgICBvbkNsaWNrOiAoKSA9PiB7XHJcbiAgICAgICAgICAgIHZvaWQgdGhpcy5zdWJtaXQoXCJjbGllbnRAYXRsZXQua3pcIiwgXCJjbGllbnQxMjNcIik7XHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGJ1dHRvbih7XHJcbiAgICAgICAgICBsYWJlbDogXCJcdTA0MTBcdTA0MzRcdTA0M0NcdTA0MzhcdTA0M0RcIixcclxuICAgICAgICAgIHRvbmU6IFwiZ2hvc3RcIixcclxuICAgICAgICAgIHNtYWxsOiB0cnVlLFxyXG4gICAgICAgICAgb25DbGljazogKCkgPT4ge1xyXG4gICAgICAgICAgICB2b2lkIHRoaXMuc3VibWl0KFwiYWRtaW5AYXRsZXQua3pcIiwgXCJhZG1pbjEyM1wiKTtcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSksXHJcbiAgICAgICksXHJcbiAgICAgIGgoXCJwXCIsIHtcclxuICAgICAgICBjbGFzczogXCJhdXRoLWhpbnRcIixcclxuICAgICAgICB0ZXh0OiBcImFkbWluQGF0bGV0Lmt6IC8gYWRtaW4xMjMgXHUwMEI3IGNsaWVudEBhdGxldC5reiAvIGNsaWVudDEyM1wiLFxyXG4gICAgICB9KSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHRhYkJ1dHRvbih0YWI6IFRhYiwgbGFiZWw6IHN0cmluZyk6IEhUTUxFbGVtZW50IHtcclxuICAgIHJldHVybiBoKFwiYnV0dG9uXCIsIHtcclxuICAgICAgY2xhc3M6IGBhdXRoLXRhYiR7dGhpcy50YWIgPT09IHRhYiA/IFwiIGFjdGl2ZVwiIDogXCJcIn1gLFxyXG4gICAgICBhdHRyczoge1xyXG4gICAgICAgIHR5cGU6IFwiYnV0dG9uXCIsXHJcbiAgICAgICAgcm9sZTogXCJ0YWJcIixcclxuICAgICAgICBcImFyaWEtc2VsZWN0ZWRcIjogU3RyaW5nKHRoaXMudGFiID09PSB0YWIpLFxyXG4gICAgICB9LFxyXG4gICAgICB0ZXh0OiBsYWJlbCxcclxuICAgICAgb246IHtcclxuICAgICAgICBjbGljazogKCkgPT4ge1xyXG4gICAgICAgICAgdGhpcy50YWIgPSB0YWI7XHJcbiAgICAgICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgaWNvbkZpZWxkKFxyXG4gICAgbGFiZWw6IHN0cmluZyxcclxuICAgIGljb25OYW1lOiBJY29uTmFtZSxcclxuICAgIGlucHV0OiBIVE1MRWxlbWVudCxcclxuICApOiBIVE1MRWxlbWVudCB7XHJcbiAgICByZXR1cm4gaChcclxuICAgICAgXCJsYWJlbFwiLFxyXG4gICAgICB7IGNsYXNzOiBcImF1dGgtZmllbGRcIiB9LFxyXG4gICAgICBoKFwic3BhblwiLCB7IHRleHQ6IGxhYmVsIH0pLFxyXG4gICAgICBoKFwiZGl2XCIsIHsgY2xhc3M6IFwiYXV0aC1pbnB1dC13cmFwXCIgfSwgaWNvbihpY29uTmFtZSwgMTgpLCBpbnB1dCksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBsb2dpbkZvcm0oKTogSFRNTEVsZW1lbnQge1xyXG4gICAgY29uc3QgZW1haWwgPSB0ZXh0SW5wdXQoe1xyXG4gICAgICB0eXBlOiBcImVtYWlsXCIsXHJcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxyXG4gICAgICBhdXRvY29tcGxldGU6IFwiZW1haWxcIixcclxuICAgICAgcGxhY2Vob2xkZXI6IFwieW91QG1haWwua3pcIixcclxuICAgIH0pO1xyXG4gICAgY29uc3QgcGFzc3dvcmQgPSB0ZXh0SW5wdXQoe1xyXG4gICAgICB0eXBlOiBcInBhc3N3b3JkXCIsXHJcbiAgICAgIHJlcXVpcmVkOiB0cnVlLFxyXG4gICAgICBhdXRvY29tcGxldGU6IFwiY3VycmVudC1wYXNzd29yZFwiLFxyXG4gICAgICBwbGFjZWhvbGRlcjogXCJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcdTIwMjJcIixcclxuICAgIH0pO1xyXG4gICAgY29uc3Qgc3VibWl0ID0gYnV0dG9uKHsgbGFiZWw6IFwiXHUwNDEyXHUwNDNFXHUwNDM5XHUwNDQyXHUwNDM4XCIsIHR5cGU6IFwic3VibWl0XCIsIHdpZGU6IHRydWUgfSk7XHJcbiAgICByZXR1cm4gaChcclxuICAgICAgXCJmb3JtXCIsXHJcbiAgICAgIHtcclxuICAgICAgICBjbGFzczogXCJhdXRoLWZvcm1cIixcclxuICAgICAgICBvbjoge1xyXG4gICAgICAgICAgc3VibWl0OiAoZSkgPT4ge1xyXG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICAgIHZvaWQgdGhpcy5zdWJtaXQoZW1haWwudmFsdWUsIHBhc3N3b3JkLnZhbHVlLCBzdWJtaXQpO1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgICB0aGlzLmljb25GaWVsZChcIkVtYWlsXCIsIFwibWFpbFwiLCBlbWFpbCksXHJcbiAgICAgIHRoaXMuaWNvbkZpZWxkKFwiXHUwNDFGXHUwNDMwXHUwNDQwXHUwNDNFXHUwNDNCXHUwNDRDXCIsIFwibG9ja1wiLCBwYXNzd29yZCksXHJcbiAgICAgIGgoXCJkaXZcIiwgeyBjbGFzczogXCJhdXRoLXN1Ym1pdFwiIH0sIHN1Ym1pdCksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZWdpc3RlckZvcm0oKTogSFRNTEVsZW1lbnQge1xyXG4gICAgY29uc3QgbmFtZSA9IHRleHRJbnB1dCh7XHJcbiAgICAgIHR5cGU6IFwidGV4dFwiLFxyXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcclxuICAgICAgbWlubGVuZ3RoOiAyLFxyXG4gICAgICBhdXRvY29tcGxldGU6IFwibmFtZVwiLFxyXG4gICAgICBwbGFjZWhvbGRlcjogXCJcdTA0MTBcdTA0M0JcdTA0MzhcdTA0NEYgXHUwNDIxXHUwNDM1XHUwNDQwXHUwNDM4XHUwNDNBXHUwNDNFXHUwNDMyXHUwNDMwXCIsXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IGVtYWlsID0gdGV4dElucHV0KHtcclxuICAgICAgdHlwZTogXCJlbWFpbFwiLFxyXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcclxuICAgICAgYXV0b2NvbXBsZXRlOiBcImVtYWlsXCIsXHJcbiAgICAgIHBsYWNlaG9sZGVyOiBcInlvdUBtYWlsLmt6XCIsXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IHBhc3N3b3JkID0gdGV4dElucHV0KHtcclxuICAgICAgdHlwZTogXCJwYXNzd29yZFwiLFxyXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcclxuICAgICAgbWlubGVuZ3RoOiA2LFxyXG4gICAgICBhdXRvY29tcGxldGU6IFwibmV3LXBhc3N3b3JkXCIsXHJcbiAgICAgIHBsYWNlaG9sZGVyOiBcIlx1MDQxQ1x1MDQzOFx1MDQzRFx1MDQzOFx1MDQzQ1x1MDQ0M1x1MDQzQyA2IFx1MDQ0MVx1MDQzOFx1MDQzQ1x1MDQzMlx1MDQzRVx1MDQzQlx1MDQzRVx1MDQzMlwiLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCBzdWJtaXQgPSBidXR0b24oe1xyXG4gICAgICBsYWJlbDogXCJcdTA0MjFcdTA0M0VcdTA0MzdcdTA0MzRcdTA0MzBcdTA0NDJcdTA0NEMgXHUwNDMwXHUwNDNBXHUwNDNBXHUwNDMwXHUwNDQzXHUwNDNEXHUwNDQyXCIsXHJcbiAgICAgIHR5cGU6IFwic3VibWl0XCIsXHJcbiAgICAgIHdpZGU6IHRydWUsXHJcbiAgICB9KTtcclxuICAgIHJldHVybiBoKFxyXG4gICAgICBcImZvcm1cIixcclxuICAgICAge1xyXG4gICAgICAgIGNsYXNzOiBcImF1dGgtZm9ybVwiLFxyXG4gICAgICAgIG9uOiB7XHJcbiAgICAgICAgICBzdWJtaXQ6IChlKSA9PiB7XHJcbiAgICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICAgICAgdm9pZCB0aGlzLnJlZ2lzdGVyKG5hbWUudmFsdWUsIGVtYWlsLnZhbHVlLCBwYXNzd29yZC52YWx1ZSwgc3VibWl0KTtcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgfSxcclxuICAgICAgdGhpcy5pY29uRmllbGQoXCJcdTA0MThcdTA0M0NcdTA0NEYgXHUwNDM4IFx1MDQ0NFx1MDQzMFx1MDQzQ1x1MDQzOFx1MDQzQlx1MDQzOFx1MDQ0RlwiLCBcInVzZXJcIiwgbmFtZSksXHJcbiAgICAgIHRoaXMuaWNvbkZpZWxkKFwiRW1haWxcIiwgXCJtYWlsXCIsIGVtYWlsKSxcclxuICAgICAgdGhpcy5pY29uRmllbGQoXCJcdTA0MUZcdTA0MzBcdTA0NDBcdTA0M0VcdTA0M0JcdTA0NENcIiwgXCJsb2NrXCIsIHBhc3N3b3JkKSxcclxuICAgICAgaChcImRpdlwiLCB7IGNsYXNzOiBcImF1dGgtc3VibWl0XCIgfSwgc3VibWl0KSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHN1Ym1pdChcclxuICAgIGVtYWlsOiBzdHJpbmcsXHJcbiAgICBwYXNzd29yZDogc3RyaW5nLFxyXG4gICAgYnRuPzogSFRNTEJ1dHRvbkVsZW1lbnQsXHJcbiAgKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAodGhpcy5idXN5KSByZXR1cm47XHJcbiAgICB0aGlzLmJ1c3kgPSB0cnVlO1xyXG4gICAgaWYgKGJ0bikgYnRuLmRpc2FibGVkID0gdHJ1ZTtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmN0eC5hdXRoLmxvZ2luKGVtYWlsLCBwYXNzd29yZCk7XHJcbiAgICB0aGlzLmJ1c3kgPSBmYWxzZTtcclxuICAgIGlmICghci5vaykge1xyXG4gICAgICBpZiAoYnRuKSBidG4uZGlzYWJsZWQgPSBmYWxzZTtcclxuICAgICAgdGhpcy5jdHgudG9hc3RzLnNob3coZXJyb3JNZXNzYWdlKHIuZXJyb3IpLCBcImVyclwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgdGhpcy5jdHgudG9hc3RzLnNob3coXHJcbiAgICAgIGBcdTA0MjEgXHUwNDMyXHUwNDNFXHUwNDM3XHUwNDMyXHUwNDQwXHUwNDMwXHUwNDQ5XHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM1XHUwNDNDLCAke3IudmFsdWUubmFtZS5zcGxpdChcIiBcIilbMF19IWAsXHJcbiAgICAgIFwib2tcIixcclxuICAgICk7XHJcbiAgICB0aGlzLmN0eC5uYXZpZ2F0ZShyLnZhbHVlLnJvbGUgPT09IFwiYWRtaW5cIiA/IFwiYWRtaW5cIiA6IFwic2NoZWR1bGVcIik7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlZ2lzdGVyKFxyXG4gICAgbmFtZTogc3RyaW5nLFxyXG4gICAgZW1haWw6IHN0cmluZyxcclxuICAgIHBhc3N3b3JkOiBzdHJpbmcsXHJcbiAgICBidG46IEhUTUxCdXR0b25FbGVtZW50LFxyXG4gICk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKHRoaXMuYnVzeSkgcmV0dXJuO1xyXG4gICAgdGhpcy5idXN5ID0gdHJ1ZTtcclxuICAgIGJ0bi5kaXNhYmxlZCA9IHRydWU7XHJcbiAgICBjb25zdCByID0gYXdhaXQgdGhpcy5jdHguYXV0aC5yZWdpc3RlcihuYW1lLCBlbWFpbCwgcGFzc3dvcmQpO1xyXG4gICAgdGhpcy5idXN5ID0gZmFsc2U7XHJcbiAgICBpZiAoIXIub2spIHtcclxuICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7XHJcbiAgICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KGVycm9yTWVzc2FnZShyLmVycm9yKSwgXCJlcnJcIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KFwiXHUwNDEwXHUwNDNBXHUwNDNBXHUwNDMwXHUwNDQzXHUwNDNEXHUwNDQyIFx1MDQ0MVx1MDQzRVx1MDQzN1x1MDQzNFx1MDQzMFx1MDQzRC4gXHUwNDE0XHUwNDNFXHUwNDMxXHUwNDQwXHUwNDNFIFx1MDQzRlx1MDQzRVx1MDQzNlx1MDQzMFx1MDQzQlx1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQ0QyFcIiwgXCJva1wiKTtcclxuICAgIHRoaXMuY3R4Lm5hdmlnYXRlKFwic2NoZWR1bGVcIik7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBpc0ZpbmlzaGVkIH0gZnJvbSBcIi4uL2NvcmUvcnVsZXNcIjtcclxuaW1wb3J0IHR5cGUgeyBCb29raW5nLCBXb3Jrb3V0U2Vzc2lvbiB9IGZyb20gXCIuLi9jb3JlL3R5cGVzXCI7XHJcbmltcG9ydCB0eXBlIHsgQXBwQ29udGV4dCB9IGZyb20gXCIuLi9hcHAvY29udGV4dFwiO1xyXG5pbXBvcnQgeyBoLCByZXBsYWNlIH0gZnJvbSBcIi4uL3VpL2RvbVwiO1xyXG5pbXBvcnQgeyBmbXREYXRlLCBmbXRUaW1lLCByZWxhdGl2ZURheSB9IGZyb20gXCIuLi91aS9mb3JtYXRcIjtcclxuaW1wb3J0IHsgaWNvbiB9IGZyb20gXCIuLi91aS9pY29uc1wiO1xyXG5pbXBvcnQgeyBlcnJvck1lc3NhZ2UgfSBmcm9tIFwiLi4vdWkvbWVzc2FnZXNcIjtcclxuaW1wb3J0IHsgQmFzZVZpZXcgfSBmcm9tIFwiLi92aWV3XCI7XHJcbmltcG9ydCB7XHJcbiAgYnV0dG9uLFxyXG4gIGNvdmVySW1nLFxyXG4gIGVtcHR5U3RhdGUsXHJcbiAgaW50ZW5zaXR5Q2hpcCxcclxuICBraW5kQmFkZ2UsXHJcbiAgcGFnZUhlYWQsXHJcbn0gZnJvbSBcIi4uL3VpL2NvbnRyb2xzXCI7XHJcblxyXG5pbnRlcmZhY2UgSXRlbSB7XHJcbiAgYm9va2luZzogQm9va2luZztcclxuICBzZXNzaW9uOiBXb3Jrb3V0U2Vzc2lvbjtcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIEJvb2tpbmdzVmlldyBleHRlbmRzIEJhc2VWaWV3IHtcclxuICBjb25zdHJ1Y3RvcihjdHg6IEFwcENvbnRleHQpIHtcclxuICAgIHN1cGVyKGN0eCk7XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgaW5pdCgpOiB2b2lkIHtcclxuICAgIHRoaXMud2F0Y2goXCJib29raW5nc1wiLCAoKSA9PiB0aGlzLnJlbmRlcigpKTtcclxuICAgIHRoaXMud2F0Y2goXCJzZXNzaW9uc1wiLCAoKSA9PiB0aGlzLnJlbmRlcigpKTtcclxuICB9XHJcblxyXG4gIHByb3RlY3RlZCByZW5kZXIoKTogdm9pZCB7XHJcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xyXG4gICAgY29uc3QgaXRlbXM6IEl0ZW1bXSA9IHRoaXMuY3R4LmJvb2tpbmdcclxuICAgICAgLm9mQ3VycmVudFVzZXIoKVxyXG4gICAgICAubWFwKChib29raW5nKSA9PiAoe1xyXG4gICAgICAgIGJvb2tpbmcsXHJcbiAgICAgICAgc2Vzc2lvbjogdGhpcy5jdHguc3RhdGUuc2Vzc2lvbkJ5SWQoYm9va2luZy5zZXNzaW9uSWQpLFxyXG4gICAgICB9KSlcclxuICAgICAgLmZpbHRlcigoeCk6IHggaXMgSXRlbSA9PiB4LnNlc3Npb24gIT09IHVuZGVmaW5lZCk7XHJcbiAgICBjb25zdCB1cGNvbWluZyA9IGl0ZW1zXHJcbiAgICAgIC5maWx0ZXIoKHgpID0+ICFpc0ZpbmlzaGVkKHguc2Vzc2lvbiwgbm93KSlcclxuICAgICAgLnNvcnQoKGEsIGIpID0+IGEuc2Vzc2lvbi5zdGFydHNBdC5sb2NhbGVDb21wYXJlKGIuc2Vzc2lvbi5zdGFydHNBdCkpO1xyXG4gICAgY29uc3QgaGlzdG9yeSA9IGl0ZW1zXHJcbiAgICAgIC5maWx0ZXIoKHgpID0+IGlzRmluaXNoZWQoeC5zZXNzaW9uLCBub3cpKVxyXG4gICAgICAuc29ydCgoYSwgYikgPT4gYi5zZXNzaW9uLnN0YXJ0c0F0LmxvY2FsZUNvbXBhcmUoYS5zZXNzaW9uLnN0YXJ0c0F0KSk7XHJcblxyXG4gICAgcmVwbGFjZShcclxuICAgICAgdGhpcy5yb290LFxyXG4gICAgICBwYWdlSGVhZChcclxuICAgICAgICBcIlx1MDQxQ1x1MDQzRVx1MDQzOCBcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzhcIixcclxuICAgICAgICBcIlx1MDQxRVx1MDQ0Mlx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzMCBcdTIwMTQgXHUwNDMyIFx1MDQzRVx1MDQzNFx1MDQzRFx1MDQzRSBcdTA0M0FcdTA0MzBcdTA0NDFcdTA0MzBcdTA0M0RcdTA0MzhcdTA0MzUsIFx1MDQzMlx1MDQzNVx1MDQ0MFx1MDQzRFx1MDQ0M1x1MDQ0Mlx1MDQ0QyBcdTA0M0NcdTA0M0VcdTA0MzZcdTA0M0RcdTA0M0UgXHUwNDQxXHUwNDQwXHUwNDMwXHUwNDM3XHUwNDQzIFx1MDQzOFx1MDQzNyBcdTA0NDNcdTA0MzJcdTA0MzVcdTA0MzRcdTA0M0VcdTA0M0NcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NEYuXCIsXHJcbiAgICAgICksXHJcbiAgICAgIGl0ZW1zLmxlbmd0aCA9PT0gMFxyXG4gICAgICAgID8gZW1wdHlTdGF0ZShcclxuICAgICAgICAgICAgXCJcdTA0MjMgXHUwNDMyXHUwNDMwXHUwNDQxIFx1MDQzRlx1MDQzRVx1MDQzQVx1MDQzMCBcdTA0M0RcdTA0MzVcdTA0NDIgXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDM1XHUwNDM5LlwiLFxyXG4gICAgICAgICAgICBidXR0b24oe1xyXG4gICAgICAgICAgICAgIGxhYmVsOiBcIlx1MDQxQSBcdTA0NDBcdTA0MzBcdTA0NDFcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzBcdTA0M0RcdTA0MzhcdTA0NEVcIixcclxuICAgICAgICAgICAgICBvbkNsaWNrOiAoKSA9PiB0aGlzLmN0eC5uYXZpZ2F0ZShcInNjaGVkdWxlXCIpLFxyXG4gICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgXCJ0aWNrZXRcIixcclxuICAgICAgICAgIClcclxuICAgICAgICA6IGgoXHJcbiAgICAgICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgICAgIHt9LFxyXG4gICAgICAgICAgICBoKFxyXG4gICAgICAgICAgICAgIFwiaDJcIixcclxuICAgICAgICAgICAgICB7IGNsYXNzOiBcInNlY3Rpb24tdGl0bGVcIiB9LFxyXG4gICAgICAgICAgICAgIFwiXHUwNDFGXHUwNDQwXHUwNDM1XHUwNDM0XHUwNDQxXHUwNDQyXHUwNDNFXHUwNDRGXHUwNDQ5XHUwNDM4XHUwNDM1IFwiLFxyXG4gICAgICAgICAgICAgIGgoXCJlbVwiLCB7IGNsYXNzOiBcImNvdW50LXBpbGxcIiwgdGV4dDogU3RyaW5nKHVwY29taW5nLmxlbmd0aCkgfSksXHJcbiAgICAgICAgICAgICksXHJcbiAgICAgICAgICAgIGgoXHJcbiAgICAgICAgICAgICAgXCJkaXZcIixcclxuICAgICAgICAgICAgICB7IGNsYXNzOiBcInNlc3Npb24tbGlzdFwiIH0sXHJcbiAgICAgICAgICAgICAgdXBjb21pbmcubGVuZ3RoID4gMFxyXG4gICAgICAgICAgICAgICAgPyB1cGNvbWluZy5tYXAoKHgsIGkpID0+IHRoaXMuY2FyZCh4LCBpLCBmYWxzZSkpXHJcbiAgICAgICAgICAgICAgICA6IGgoXCJwXCIsIHsgY2xhc3M6IFwibXV0ZWRcIiwgdGV4dDogXCJcdTA0MURcdTA0MzVcdTA0NDIgXHUwNDNGXHUwNDQwXHUwNDM1XHUwNDM0XHUwNDQxXHUwNDQyXHUwNDNFXHUwNDRGXHUwNDQ5XHUwNDM4XHUwNDQ1IFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzNVx1MDQzOS5cIiB9KSxcclxuICAgICAgICAgICAgKSxcclxuICAgICAgICAgICAgaGlzdG9yeS5sZW5ndGggPiAwXHJcbiAgICAgICAgICAgICAgPyBoKFxyXG4gICAgICAgICAgICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgICAgICAgICAgICB7fSxcclxuICAgICAgICAgICAgICAgICAgaChcclxuICAgICAgICAgICAgICAgICAgICBcImgyXCIsXHJcbiAgICAgICAgICAgICAgICAgICAgeyBjbGFzczogXCJzZWN0aW9uLXRpdGxlXCIgfSxcclxuICAgICAgICAgICAgICAgICAgICBcIlx1MDQxOFx1MDQ0MVx1MDQ0Mlx1MDQzRVx1MDQ0MFx1MDQzOFx1MDQ0RiBcIixcclxuICAgICAgICAgICAgICAgICAgICBoKFwiZW1cIiwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgY2xhc3M6IFwiY291bnQtcGlsbFwiLFxyXG4gICAgICAgICAgICAgICAgICAgICAgdGV4dDogU3RyaW5nKGhpc3RvcnkubGVuZ3RoKSxcclxuICAgICAgICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgICAgICAgKSxcclxuICAgICAgICAgICAgICAgICAgaChcclxuICAgICAgICAgICAgICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgICAgICAgICAgICAgIHsgY2xhc3M6IFwic2Vzc2lvbi1saXN0XCIgfSxcclxuICAgICAgICAgICAgICAgICAgICAuLi5oaXN0b3J5Lm1hcCgoeCwgaSkgPT4gdGhpcy5jYXJkKHgsIGksIHRydWUpKSxcclxuICAgICAgICAgICAgICAgICAgKSxcclxuICAgICAgICAgICAgICAgIClcclxuICAgICAgICAgICAgICA6IG51bGwsXHJcbiAgICAgICAgICApLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY2FyZChpdGVtOiBJdGVtLCBpbmRleDogbnVtYmVyLCBwYXN0OiBib29sZWFuKTogSFRNTEVsZW1lbnQge1xyXG4gICAgY29uc3QgeyBib29raW5nLCBzZXNzaW9uIH0gPSBpdGVtO1xyXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgIGNvbnN0IGNvdmVyID0gaChcclxuICAgICAgXCJkaXZcIixcclxuICAgICAgeyBjbGFzczogXCJjYXJkLWNvdmVyXCIgfSxcclxuICAgICAgY292ZXJJbWcoc2Vzc2lvbi5raW5kKSxcclxuICAgICAgaChcInNwYW5cIiwgeyBjbGFzczogXCJjb3Zlci10aW1lXCIsIHRleHQ6IGZtdFRpbWUoc2Vzc2lvbi5zdGFydHNBdCkgfSksXHJcbiAgICApO1xyXG4gICAgY29uc3QgaW5mbyA9IGgoXHJcbiAgICAgIFwiZGl2XCIsXHJcbiAgICAgIHsgY2xhc3M6IFwic2Vzc2lvbi1pbmZvXCIgfSxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwic2Vzc2lvbi10b3BcIiB9LFxyXG4gICAgICAgIGgoXCJoM1wiLCB7IHRleHQ6IHNlc3Npb24udGl0bGUgfSksXHJcbiAgICAgICAga2luZEJhZGdlKHNlc3Npb24ua2luZCksXHJcbiAgICAgICAgaW50ZW5zaXR5Q2hpcChzZXNzaW9uLmtpbmQpLFxyXG4gICAgICApLFxyXG4gICAgICBoKFxyXG4gICAgICAgIFwicFwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwibXV0ZWQgc2Vzc2lvbi1tZXRhXCIgfSxcclxuICAgICAgICBpY29uKFwiY2FsZW5kYXJcIiwgMTYpLFxyXG4gICAgICAgIGgoXCJzcGFuXCIsIHtcclxuICAgICAgICAgIHRleHQ6IGAke2ZtdERhdGUoc2Vzc2lvbi5zdGFydHNBdCl9LCAke3JlbGF0aXZlRGF5KHNlc3Npb24uc3RhcnRzQXQsIG5vdyl9IFx1MDBCNyAke3Nlc3Npb24udHJhaW5lcn0gXHUwMEI3ICR7c2Vzc2lvbi5yb29tfWAsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICksXHJcbiAgICApO1xyXG4gICAgY29uc3Qgc2lkZSA9IGgoXHJcbiAgICAgIFwiZGl2XCIsXHJcbiAgICAgIHsgY2xhc3M6IFwic2Vzc2lvbi1zaWRlXCIgfSxcclxuICAgICAgcGFzdFxyXG4gICAgICAgID8gaChcInNwYW5cIiwgeyBjbGFzczogXCJzdGF0dXMtY2hpcCBkb25lXCIsIHRleHQ6IFwiXHUwNDE3XHUwNDMwXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDQ4XHUwNDM1XHUwNDNEXHUwNDMwXCIgfSlcclxuICAgICAgICA6IGgoXHJcbiAgICAgICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgICAgIHsgY2xhc3M6IFwic2lkZS1zdGFja1wiIH0sXHJcbiAgICAgICAgICAgIGgoXCJzcGFuXCIsIHsgY2xhc3M6IFwic3RhdHVzLWNoaXAgdXBjb21pbmdcIiwgdGV4dDogXCJcdTA0MUZcdTA0NDBcdTA0MzVcdTA0MzRcdTA0NDFcdTA0NDJcdTA0M0VcdTA0MzhcdTA0NDJcIiB9KSxcclxuICAgICAgICAgICAgYnV0dG9uKHtcclxuICAgICAgICAgICAgICBsYWJlbDogXCJcdTA0MUVcdTA0NDJcdTA0M0NcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDJcdTA0NENcIixcclxuICAgICAgICAgICAgICB0b25lOiBcImRhbmdlci1naG9zdFwiLFxyXG4gICAgICAgICAgICAgIHNtYWxsOiB0cnVlLFxyXG4gICAgICAgICAgICAgIG9uQ2xpY2s6ICgpID0+IHtcclxuICAgICAgICAgICAgICAgIHZvaWQgdGhpcy5jYW5jZWwoYm9va2luZyk7XHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICApLFxyXG4gICAgKTtcclxuICAgIHJldHVybiBoKFxyXG4gICAgICBcImFydGljbGVcIixcclxuICAgICAge1xyXG4gICAgICAgIGNsYXNzOiBgYm9va2luZy1jYXJkJHtwYXN0ID8gXCIgcGFzdFwiIDogXCJcIn1gLFxyXG4gICAgICAgIHN0eWxlOiBgYW5pbWF0aW9uLWRlbGF5OiR7TWF0aC5taW4oaW5kZXggKiA0MCwgMjQwKX1tc2AsXHJcbiAgICAgIH0sXHJcbiAgICAgIGNvdmVyLFxyXG4gICAgICBpbmZvLFxyXG4gICAgICBzaWRlLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgY2FuY2VsKGJvb2tpbmc6IEJvb2tpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmN0eC5ib29raW5nLmNhbmNlbChib29raW5nLmlkKTtcclxuICAgIGlmICghci5vaykge1xyXG4gICAgICB0aGlzLmN0eC50b2FzdHMuc2hvdyhlcnJvck1lc3NhZ2Uoci5lcnJvciksIFwiZXJyXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICB0aGlzLmN0eC50b2FzdHMuc2hvdyhcIlx1MDQxN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQ0QyBcdTA0M0VcdTA0NDJcdTA0M0NcdTA0MzVcdTA0M0RcdTA0MzVcdTA0M0RcdTA0MzBcIiwgXCJpbmZvXCIsIHtcclxuICAgICAgbGFiZWw6IFwiXHUwNDEyXHUwNDM1XHUwNDQwXHUwNDNEXHUwNDQzXHUwNDQyXHUwNDRDXCIsXHJcbiAgICAgIHJ1bjogKCkgPT4ge1xyXG4gICAgICAgIHZvaWQgdGhpcy5yZXN0b3JlKGJvb2tpbmcpO1xyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlc3RvcmUoYm9va2luZzogQm9va2luZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgciA9IGF3YWl0IHRoaXMuY3R4LmJvb2tpbmcuYm9vayhib29raW5nLnNlc3Npb25JZCk7XHJcbiAgICB0aGlzLmN0eC50b2FzdHMuc2hvdyhcclxuICAgICAgci5vayA/IFwiXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDRDIFx1MDQzMlx1MDQzRVx1MDQ0MVx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQzRFx1MDQzRVx1MDQzMlx1MDQzQlx1MDQzNVx1MDQzRFx1MDQzMFwiIDogZXJyb3JNZXNzYWdlKHIuZXJyb3IpLFxyXG4gICAgICByLm9rID8gXCJva1wiIDogXCJlcnJcIixcclxuICAgICk7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgdHlwZSB7IFdvcmtvdXRLaW5kIH0gZnJvbSBcIi4uL2NvcmUvdHlwZXNcIjtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgUGxhbiB7XHJcbiAgaWQ6IHN0cmluZztcclxuICBuYW1lOiBzdHJpbmc7XHJcbiAgcHJpY2U6IG51bWJlcjtcclxuICBwZXJpb2Q6IHN0cmluZztcclxuICB0YWdsaW5lOiBzdHJpbmc7XHJcbiAgZmVhdHVyZXM6IHN0cmluZ1tdO1xyXG4gIHBvcHVsYXI/OiBib29sZWFuO1xyXG4gIGJhZGdlPzogc3RyaW5nO1xyXG59XHJcblxyXG5leHBvcnQgY29uc3QgUExBTlM6IFBsYW5bXSA9IFtcclxuICB7XHJcbiAgICBpZDogXCJzaW5nbGVcIixcclxuICAgIG5hbWU6IFwiXHUwNDIwXHUwNDMwXHUwNDM3XHUwNDNFXHUwNDMyXHUwNDMwXHUwNDRGXCIsXHJcbiAgICBwcmljZTogMjUwMCxcclxuICAgIHBlcmlvZDogXCJcdTA0MzdcdTA0MzAgXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDQzXCIsXHJcbiAgICB0YWdsaW5lOiBcIlx1MDQxRlx1MDQzRVx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQzMVx1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQ0QyBcdTA0MzFcdTA0MzVcdTA0MzcgXHUwNDNFXHUwNDMxXHUwNDRGXHUwNDM3XHUwNDMwXHUwNDQyXHUwNDM1XHUwNDNCXHUwNDRDXHUwNDQxXHUwNDQyXHUwNDMyXCIsXHJcbiAgICBmZWF0dXJlczogW1xyXG4gICAgICBcIlx1MDQxQlx1MDQ0RVx1MDQzMVx1MDQzMFx1MDQ0RiBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0MzAgXHUwNDM4XHUwNDM3IFx1MDQ0MFx1MDQzMFx1MDQ0MVx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0RlwiLFxyXG4gICAgICBcIlx1MDQxRVx1MDQ0Mlx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzMCBcdTA0MzFcdTA0MzVcdTA0MzcgXHUwNDQ4XHUwNDQyXHUwNDQwXHUwNDMwXHUwNDQ0XHUwNDMwIFx1MDQzN1x1MDQzMCAyIFx1MDQ0N1x1MDQzMFx1MDQ0MVx1MDQzMFwiLFxyXG4gICAgICBcIlx1MDQxRlx1MDQzRVx1MDQzQlx1MDQzRVx1MDQ0Mlx1MDQzNVx1MDQzRFx1MDQ0Nlx1MDQzNSBcdTA0MzggXHUwNDMyXHUwNDNFXHUwNDM0XHUwNDMwIFx1MDQzMlx1MDQzQVx1MDQzQlx1MDQ0RVx1MDQ0N1x1MDQzNVx1MDQzRFx1MDQ0QlwiLFxyXG4gICAgXSxcclxuICB9LFxyXG4gIHtcclxuICAgIGlkOiBcIm1vbnRoXCIsXHJcbiAgICBuYW1lOiBcIlx1MDQxMVx1MDQzNVx1MDQzN1x1MDQzQlx1MDQzOFx1MDQzQ1x1MDQzOFx1MDQ0MlwiLFxyXG4gICAgcHJpY2U6IDE5OTAwLFxyXG4gICAgcGVyaW9kOiBcIlx1MDQzMiBcdTA0M0NcdTA0MzVcdTA0NDFcdTA0NEZcdTA0NDZcIixcclxuICAgIHRhZ2xpbmU6IFwiXHUwNDIyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDQzXHUwNDM5XHUwNDQxXHUwNDRGIFx1MDQ0MVx1MDQzQVx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzQVx1MDQzRSBcdTA0NDVcdTA0M0VcdTA0NDdcdTA0MzVcdTA0NDhcdTA0NENcIixcclxuICAgIHBvcHVsYXI6IHRydWUsXHJcbiAgICBiYWRnZTogXCJcdTA0MTJcdTA0NEJcdTA0MzFcdTA0M0VcdTA0NDAgXHUwNDNBXHUwNDNCXHUwNDM4XHUwNDM1XHUwNDNEXHUwNDQyXHUwNDNFXHUwNDMyXCIsXHJcbiAgICBmZWF0dXJlczogW1xyXG4gICAgICBcIlx1MDQxMlx1MDQ0MVx1MDQzNSBcdTA0M0RcdTA0MzBcdTA0M0ZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NEYgXHUwNDMxXHUwNDM1XHUwNDM3IFx1MDQzRVx1MDQzM1x1MDQ0MFx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0N1x1MDQzNVx1MDQzRFx1MDQzOFx1MDQzOVwiLFxyXG4gICAgICBcIlx1MDQxN1x1MDQzMFx1MDQzQ1x1MDQzRVx1MDQ0MFx1MDQzRVx1MDQzN1x1MDQzQVx1MDQzMCBcdTA0MzRcdTA0M0UgNyBcdTA0MzRcdTA0M0RcdTA0MzVcdTA0MzlcIixcclxuICAgICAgXCJcdTA0MUZcdTA0NDBcdTA0MzhcdTA0M0VcdTA0NDBcdTA0MzhcdTA0NDJcdTA0MzVcdTA0NDJcdTA0M0RcdTA0MzBcdTA0NEYgXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDRDIFx1MDQzRFx1MDQzMCBcdTA0MzJcdTA0MzVcdTA0NDdcdTA0MzVcdTA0NDBcIixcclxuICAgICAgXCJcdTA0MTNcdTA0M0VcdTA0NDFcdTA0NDJcdTA0MzVcdTA0MzJcdTA0M0VcdTA0MzkgXHUwNDMyXHUwNDM4XHUwNDM3XHUwNDM4XHUwNDQyIFx1MDQzNFx1MDQzQlx1MDQ0RiBcdTA0MzRcdTA0NDBcdTA0NDNcdTA0MzNcdTA0MzBcIixcclxuICAgIF0sXHJcbiAgfSxcclxuICB7XHJcbiAgICBpZDogXCJ5ZWFyXCIsXHJcbiAgICBuYW1lOiBcIlx1MDQxM1x1MDQzRVx1MDQzNFwiLFxyXG4gICAgcHJpY2U6IDE0OTkwMCxcclxuICAgIHBlcmlvZDogXCJcdTA0MzIgXHUwNDMzXHUwNDNFXHUwNDM0XCIsXHJcbiAgICB0YWdsaW5lOiBcIlx1MDQxQ1x1MDQzMFx1MDQzQVx1MDQ0MVx1MDQzOFx1MDQzQ1x1MDQzMFx1MDQzQlx1MDQ0Q1x1MDQzRFx1MDQzMFx1MDQ0RiBcdTA0MzJcdTA0NEJcdTA0MzNcdTA0M0VcdTA0MzRcdTA0MzBcIixcclxuICAgIGJhZGdlOiBcIlx1MDQxMlx1MDQ0Qlx1MDQzM1x1MDQzRVx1MDQzNFx1MDQzMCAzNyVcIixcclxuICAgIGZlYXR1cmVzOiBbXHJcbiAgICAgIFwiXHUwNDEyXHUwNDQxXHUwNDUxIFx1MDQzOFx1MDQzNyBcdTAwQUJcdTA0MTFcdTA0MzVcdTA0MzdcdTA0M0JcdTA0MzhcdTA0M0NcdTA0MzhcdTA0NDJcdTA0MzBcdTAwQkJcIixcclxuICAgICAgXCIyIFx1MDQzRlx1MDQzNVx1MDQ0MFx1MDQ0MVx1MDQzRVx1MDQzRFx1MDQzMFx1MDQzQlx1MDQ0Q1x1MDQzRFx1MDQ0Qlx1MDQzNSBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0MzhcIixcclxuICAgICAgXCJcdTA0MTdcdTA0MzBcdTA0M0NcdTA0M0VcdTA0NDBcdTA0M0VcdTA0MzdcdTA0M0FcdTA0MzAgXHUwNDM0XHUwNDNFIDMwIFx1MDQzNFx1MDQzRFx1MDQzNVx1MDQzOVwiLFxyXG4gICAgICBcIlx1MDQyNlx1MDQzNVx1MDQzRFx1MDQzMCBcdTA0MzdcdTA0MzBcdTA0NDRcdTA0MzhcdTA0M0FcdTA0NDFcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0MzBcdTA0M0RcdTA0MzAgXHUwNDNEXHUwNDMwIFx1MDQzM1x1MDQzRVx1MDQzNFwiLFxyXG4gICAgXSxcclxuICB9LFxyXG5dO1xyXG5cclxuZXhwb3J0IGNvbnN0IGZvcm1hdFByaWNlID0gKHZhbHVlOiBudW1iZXIpOiBzdHJpbmcgPT5cclxuICBgJHt2YWx1ZS50b0xvY2FsZVN0cmluZyhcInJ1LVJVXCIpfSBcdTIwQjhgO1xyXG5cclxuY29uc3QgcG9ydHJhaXQgPSAoaWQ6IHN0cmluZyk6IHN0cmluZyA9PlxyXG4gIGBodHRwczovL2ltYWdlcy51bnNwbGFzaC5jb20vJHtpZH0/YXV0bz1mb3JtYXQmZml0PWNyb3Amdz00MDAmcT03MGA7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFRyYWluZXIge1xyXG4gIG5hbWU6IHN0cmluZztcclxuICBraW5kOiBXb3Jrb3V0S2luZDtcclxuICByb2xlOiBzdHJpbmc7XHJcbiAgZXhwZXJpZW5jZTogc3RyaW5nO1xyXG4gIHF1b3RlOiBzdHJpbmc7XHJcbiAgcGhvdG86IHN0cmluZztcclxufVxyXG5leHBvcnQgY29uc3QgVFJBSU5FUlM6IFRyYWluZXJbXSA9IFtcclxuICB7XHJcbiAgICBuYW1lOiBcIlx1MDQxNFx1MDQzQ1x1MDQzOFx1MDQ0Mlx1MDQ0MFx1MDQzOFx1MDQzOSBcdTA0MUFcdTA0MzhcdTA0M0NcIixcclxuICAgIGtpbmQ6IFwic3RyZW5ndGhcIixcclxuICAgIHJvbGU6IFwiXHUwNDIxXHUwNDM4XHUwNDNCXHUwNDNFXHUwNDMyXHUwNDNFXHUwNDM5IFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQzRFx1MDQzM1wiLFxyXG4gICAgZXhwZXJpZW5jZTogXCI4IFx1MDQzQlx1MDQzNVx1MDQ0MiBcdTA0M0VcdTA0M0ZcdTA0NEJcdTA0NDJcdTA0MzBcIixcclxuICAgIHF1b3RlOiBcIlx1MDQyMlx1MDQzNVx1MDQ0NVx1MDQzRFx1MDQzOFx1MDQzQVx1MDQzMCBcdTA0M0ZcdTA0NDBcdTA0MzVcdTA0MzZcdTA0MzRcdTA0MzUgXHUwNDMyXHUwNDQxXHUwNDM1XHUwNDMzXHUwNDNFLiBcdTA0MjFcdTA0MzhcdTA0M0JcdTA0MzAgXHUwNDNGXHUwNDQwXHUwNDM4XHUwNDQ1XHUwNDNFXHUwNDM0XHUwNDM4XHUwNDQyIFx1MDQ0MVx1MDQzQlx1MDQzNVx1MDQzNFx1MDQzRVx1MDQzQy5cIixcclxuICAgIHBob3RvOiBwb3J0cmFpdChcInBob3RvLTE1MDcwMDMyMTExNjktMGExZGQ3MjI4ZjJkXCIpLFxyXG4gIH0sXHJcbiAge1xyXG4gICAgbmFtZTogXCJcdTA0MUNcdTA0MzBcdTA0NDBcdTA0MzBcdTA0NDIgXHUwNDEwXHUwNDMxXHUwNDM0XHUwNDQwXHUwNDMwXHUwNDQ1XHUwNDNDXHUwNDMwXHUwNDNEXHUwNDNFXHUwNDMyXCIsXHJcbiAgICBraW5kOiBcImNhcmRpb1wiLFxyXG4gICAgcm9sZTogXCJcdTA0MUFcdTA0MzBcdTA0NDBcdTA0MzRcdTA0MzhcdTA0M0UgXHUwNDM4IFx1MDQzMlx1MDQ0Qlx1MDQzRFx1MDQzRVx1MDQ0MVx1MDQzQlx1MDQzOFx1MDQzMlx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0Q1wiLFxyXG4gICAgZXhwZXJpZW5jZTogXCI2IFx1MDQzQlx1MDQzNVx1MDQ0MiBcdTA0M0VcdTA0M0ZcdTA0NEJcdTA0NDJcdTA0MzBcIixcclxuICAgIHF1b3RlOiBcIlx1MDQxRlx1MDQ0M1x1MDQzQlx1MDQ0Q1x1MDQ0MSBcdTIwMTQgXHUwNDQyXHUwNDMyXHUwNDNFXHUwNDM5IFx1MDQ0N1x1MDQzNVx1MDQ0MVx1MDQ0Mlx1MDQzRFx1MDQ0Qlx1MDQzOSBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzVcdTA0NDAuIFx1MDQyMVx1MDQzQlx1MDQ0M1x1MDQ0OFx1MDQzMFx1MDQzOSBcdTA0MzVcdTA0MzNcdTA0M0UuXCIsXHJcbiAgICBwaG90bzogcG9ydHJhaXQoXCJwaG90by0xNTAwNjQ4NzY3NzkxLTAwZGNjOTk0YTQzZVwiKSxcclxuICB9LFxyXG4gIHtcclxuICAgIG5hbWU6IFwiXHUwNDEwXHUwNDM5XHUwNDMzXHUwNDM1XHUwNDQwXHUwNDM4XHUwNDNDIFx1MDQyMVx1MDQzMFx1MDQzRlx1MDQzMFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzMFwiLFxyXG4gICAga2luZDogXCJ5b2dhXCIsXHJcbiAgICByb2xlOiBcIlx1MDQxOVx1MDQzRVx1MDQzM1x1MDQzMCBcdTA0MzggXHUwNDNFXHUwNDQxXHUwNDMwXHUwNDNEXHUwNDNBXHUwNDMwXCIsXHJcbiAgICBleHBlcmllbmNlOiBcIjcgXHUwNDNCXHUwNDM1XHUwNDQyIFx1MDQzRVx1MDQzRlx1MDQ0Qlx1MDQ0Mlx1MDQzMFwiLFxyXG4gICAgcXVvdGU6IFwiXHUwNDEzXHUwNDM4XHUwNDMxXHUwNDNBXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDIFx1MjAxNCBcdTA0NERcdTA0NDJcdTA0M0UgXHUwNDQxXHUwNDMyXHUwNDNFXHUwNDMxXHUwNDNFXHUwNDM0XHUwNDMwIFx1MDQzNFx1MDQzMlx1MDQzOFx1MDQzNlx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0RiBcdTA0MzIgXHUwNDNCXHUwNDRFXHUwNDMxXHUwNDNFXHUwNDNDIFx1MDQzMlx1MDQzRVx1MDQzN1x1MDQ0MFx1MDQzMFx1MDQ0MVx1MDQ0Mlx1MDQzNS5cIixcclxuICAgIHBob3RvOiBwb3J0cmFpdChcInBob3RvLTE1NDQwMDUzMTMtOTRkZGYwMjg2ZGYyXCIpLFxyXG4gIH0sXHJcbiAge1xyXG4gICAgbmFtZTogXCJcdTA0MjFcdTA0MzVcdTA0NDBcdTA0MzNcdTA0MzVcdTA0MzkgXHUwNDFCXHUwNDM4XCIsXHJcbiAgICBraW5kOiBcImNyb3NzZml0XCIsXHJcbiAgICByb2xlOiBcIlx1MDQxQVx1MDQ0MFx1MDQzRVx1MDQ0MVx1MDQ0MVx1MDQ0NFx1MDQzOFx1MDQ0MiBcdTA0MzggXHUwNDQ0XHUwNDQzXHUwNDNEXHUwNDNBXHUwNDQ2XHUwNDM4XHUwNDNFXHUwNDNEXHUwNDMwXHUwNDNCXHUwNDNBXHUwNDMwXCIsXHJcbiAgICBleHBlcmllbmNlOiBcIjUgXHUwNDNCXHUwNDM1XHUwNDQyIFx1MDQzRVx1MDQzRlx1MDQ0Qlx1MDQ0Mlx1MDQzMFwiLFxyXG4gICAgcXVvdGU6IFwiXHUwNDFBXHUwNDMwXHUwNDM2XHUwNDM0XHUwNDRCXHUwNDM5IFx1MDQ0MFx1MDQzMFx1MDQ0M1x1MDQzRFx1MDQzNCBcdTIwMTQgXHUwNDNDXHUwNDMwXHUwNDNCXHUwNDM1XHUwNDNEXHUwNDRDXHUwNDNBXHUwNDMwXHUwNDRGIFx1MDQzRlx1MDQzRVx1MDQzMVx1MDQzNVx1MDQzNFx1MDQzMCBcdTA0M0RcdTA0MzBcdTA0MzQgXHUwNDQxXHUwNDNFXHUwNDMxXHUwNDNFXHUwNDM5LlwiLFxyXG4gICAgcGhvdG86IHBvcnRyYWl0KFwicGhvdG8tMTUwNjc5NDc3ODIwMi1jYWQ4NGNmNDVmMWRcIiksXHJcbiAgfSxcclxuICB7XHJcbiAgICBuYW1lOiBcIlx1MDQxMFx1MDQzQlx1MDQzOFx1MDQzRFx1MDQzMCBcdTA0MUFcdTA0MzhcdTA0M0NcIixcclxuICAgIGtpbmQ6IFwic3RyZXRjaFwiLFxyXG4gICAgcm9sZTogXCJcdTA0MjFcdTA0NDJcdTA0NDBcdTA0MzVcdTA0NDJcdTA0NDdcdTA0MzhcdTA0M0RcdTA0MzMgXHUwNDM4IFx1MDQzQ1x1MDQzRVx1MDQzMVx1MDQzOFx1MDQzQlx1MDQ0Q1x1MDQzRFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0Q1wiLFxyXG4gICAgZXhwZXJpZW5jZTogXCI0IFx1MDQzM1x1MDQzRVx1MDQzNFx1MDQzMCBcdTA0M0VcdTA0M0ZcdTA0NEJcdTA0NDJcdTA0MzBcIixcclxuICAgIHF1b3RlOiBcIlx1MDQyMlx1MDQzNVx1MDQzQlx1MDQzRSBcdTA0NDFcdTA0M0FcdTA0MzBcdTA0MzZcdTA0MzVcdTA0NDIgXHUwNDQxXHUwNDNGXHUwNDMwXHUwNDQxXHUwNDM4XHUwNDMxXHUwNDNFIFx1MDQ0M1x1MDQzNlx1MDQzNSBcdTA0M0ZcdTA0M0VcdTA0NDFcdTA0M0JcdTA0MzUgXHUwNDNGXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDNFXHUwNDMzXHUwNDNFIFx1MDQzN1x1MDQzMFx1MDQzRFx1MDQ0Rlx1MDQ0Mlx1MDQzOFx1MDQ0Ri5cIixcclxuICAgIHBob3RvOiBwb3J0cmFpdChcInBob3RvLTE1NzM0OTYzNTkxNDItYjhkODc3MzRhNWEyXCIpLFxyXG4gIH0sXHJcbl07XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIERpcmVjdGlvbiB7XHJcbiAga2luZDogV29ya291dEtpbmQ7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xyXG4gIGR1cmF0aW9uOiBzdHJpbmc7XHJcbn1cclxuZXhwb3J0IGNvbnN0IERJUkVDVElPTlM6IERpcmVjdGlvbltdID0gW1xyXG4gIHtcclxuICAgIGtpbmQ6IFwic3RyZW5ndGhcIixcclxuICAgIHRpdGxlOiBcIlx1MDQyMVx1MDQzOFx1MDQzQlx1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0RlwiLFxyXG4gICAgZGVzY3JpcHRpb246XHJcbiAgICAgIFwiXHUwNDIxXHUwNDMyXHUwNDNFXHUwNDMxXHUwNDNFXHUwNDM0XHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQzMlx1MDQzNVx1MDQ0MVx1MDQzMCBcdTA0MzggXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDMwXHUwNDM2XHUwNDUxXHUwNDQwXHUwNDRCLiBcdTA0MUNcdTA0NEJcdTA0NDhcdTA0NDZcdTA0NEIsIFx1MDQ0MVx1MDQzOFx1MDQzQlx1MDQzMCBcdTA0MzggXHUwNDQzXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDM1XHUwNDNEXHUwNDNEXHUwNDMwXHUwNDRGIFx1MDQ0Mlx1MDQzNVx1MDQ0NVx1MDQzRFx1MDQzOFx1MDQzQVx1MDQzMCBcdTA0M0ZcdTA0M0VcdTA0MzQgXHUwNDNBXHUwNDNFXHUwNDNEXHUwNDQyXHUwNDQwXHUwNDNFXHUwNDNCXHUwNDM1XHUwNDNDIFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzNVx1MDQ0MFx1MDQzMC5cIixcclxuICAgIGR1cmF0aW9uOiBcIjYwIFx1MDQzQ1x1MDQzOFx1MDQzRFwiLFxyXG4gIH0sXHJcbiAge1xyXG4gICAga2luZDogXCJjYXJkaW9cIixcclxuICAgIHRpdGxlOiBcIlx1MDQxQVx1MDQzMFx1MDQ0MFx1MDQzNFx1MDQzOFx1MDQzRVwiLFxyXG4gICAgZGVzY3JpcHRpb246XHJcbiAgICAgIFwiXHUwNDE4XHUwNDNEXHUwNDQyXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDMwXHUwNDNCXHUwNDRCLCBcdTA0M0FcdTA0M0VcdTA0NDJcdTA0M0VcdTA0NDBcdTA0NEJcdTA0MzUgXHUwNDQwXHUwNDMwXHUwNDM3XHUwNDMzXHUwNDNFXHUwNDNEXHUwNDRGXHUwNDRFXHUwNDQyIFx1MDQzRlx1MDQ0M1x1MDQzQlx1MDQ0Q1x1MDQ0MSBcdTA0MzggXHUwNDQxXHUwNDM2XHUwNDM4XHUwNDMzXHUwNDMwXHUwNDRFXHUwNDQyIFx1MDQzQVx1MDQzMFx1MDQzQlx1MDQzRVx1MDQ0MFx1MDQzOFx1MDQzOC4gXHUwNDExXHUwNDRCXHUwNDQxXHUwNDQyXHUwNDQwXHUwNDNFLCBcdTA0MzJcdTA0MzVcdTA0NDFcdTA0MzVcdTA0M0JcdTA0M0UsIFx1MDQ0RFx1MDQ0NFx1MDQ0NFx1MDQzNVx1MDQzQVx1MDQ0Mlx1MDQzOFx1MDQzMlx1MDQzRFx1MDQzRS5cIixcclxuICAgIGR1cmF0aW9uOiBcIjQ1IFx1MDQzQ1x1MDQzOFx1MDQzRFwiLFxyXG4gIH0sXHJcbiAge1xyXG4gICAga2luZDogXCJ5b2dhXCIsXHJcbiAgICB0aXRsZTogXCJcdTA0MTlcdTA0M0VcdTA0MzNcdTA0MzBcIixcclxuICAgIGRlc2NyaXB0aW9uOlxyXG4gICAgICBcIlx1MDQxNFx1MDQ0Qlx1MDQ0NVx1MDQzMFx1MDQzRFx1MDQzOFx1MDQzNSwgXHUwNDMxXHUwNDMwXHUwNDNCXHUwNDMwXHUwNDNEXHUwNDQxIFx1MDQzOCBcdTA0NDFcdTA0M0ZcdTA0M0VcdTA0M0FcdTA0M0VcdTA0MzlcdTA0M0RcdTA0MzBcdTA0NEYgXHUwNDQxXHUwNDM4XHUwNDNCXHUwNDMwLiBcdTA0MUZcdTA0M0VcdTA0MzRcdTA0NDVcdTA0M0VcdTA0MzRcdTA0MzhcdTA0NDIgXHUwNDNEXHUwNDNFXHUwNDMyXHUwNDM4XHUwNDQ3XHUwNDNBXHUwNDMwXHUwNDNDIFx1MDQzOCBcdTA0NDJcdTA0MzVcdTA0M0MsIFx1MDQzQVx1MDQzRVx1MDQzQ1x1MDQ0MyBcdTA0MzdcdTA0MzAgNjAuXCIsXHJcbiAgICBkdXJhdGlvbjogXCI3NSBcdTA0M0NcdTA0MzhcdTA0M0RcIixcclxuICB9LFxyXG4gIHtcclxuICAgIGtpbmQ6IFwiY3Jvc3NmaXRcIixcclxuICAgIHRpdGxlOiBcIlx1MDQxQVx1MDQ0MFx1MDQzRVx1MDQ0MVx1MDQ0MVx1MDQ0NFx1MDQzOFx1MDQ0MlwiLFxyXG4gICAgZGVzY3JpcHRpb246XHJcbiAgICAgIFwiXHUwNDI0XHUwNDQzXHUwNDNEXHUwNDNBXHUwNDQ2XHUwNDM4XHUwNDNFXHUwNDNEXHUwNDMwXHUwNDNCXHUwNDRDXHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQzQVx1MDQzRVx1MDQzQ1x1MDQzRlx1MDQzQlx1MDQzNVx1MDQzQVx1MDQ0MVx1MDQ0QiBcdTA0MzIgXHUwNDNBXHUwNDNFXHUwNDNDXHUwNDMwXHUwNDNEXHUwNDM0XHUwNDM1LiBcdTA0MjVcdTA0MzBcdTA0NDBcdTA0MzBcdTA0M0FcdTA0NDJcdTA0MzVcdTA0NDAgXHUwNDM3XHUwNDMwXHUwNDNBXHUwNDMwXHUwNDNCXHUwNDRGXHUwNDM1XHUwNDQyXHUwNDQxXHUwNDRGIFx1MDQzN1x1MDQzNFx1MDQzNVx1MDQ0MVx1MDQ0Qy5cIixcclxuICAgIGR1cmF0aW9uOiBcIjUwIFx1MDQzQ1x1MDQzOFx1MDQzRFwiLFxyXG4gIH0sXHJcbiAge1xyXG4gICAga2luZDogXCJzdHJldGNoXCIsXHJcbiAgICB0aXRsZTogXCJcdTA0MjFcdTA0NDJcdTA0NDBcdTA0MzVcdTA0NDJcdTA0NDdcdTA0MzhcdTA0M0RcdTA0MzNcIixcclxuICAgIGRlc2NyaXB0aW9uOlxyXG4gICAgICBcIlx1MDQyMFx1MDQzMFx1MDQ0MVx1MDQ0Mlx1MDQ0Rlx1MDQzNlx1MDQzQVx1MDQzMCBcdTA0MzggXHUwNDNDXHUwNDNFXHUwNDMxXHUwNDM4XHUwNDNCXHUwNDRDXHUwNDNEXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDIFx1MDQ0MVx1MDQ0M1x1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQzMlx1MDQzRVx1MDQzMi4gXHUwNDFCXHUwNDUxXHUwNDMzXHUwNDNBXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDIFx1MDQzMiBcdTA0NDJcdTA0MzVcdTA0M0JcdTA0MzUgXHUwNDMxXHUwNDM1XHUwNDM3IFx1MDQ0M1x1MDQzNFx1MDQzMFx1MDQ0MFx1MDQzRFx1MDQ0Qlx1MDQ0NSBcdTA0M0RcdTA0MzBcdTA0MzNcdTA0NDBcdTA0NDNcdTA0MzdcdTA0M0VcdTA0M0EuXCIsXHJcbiAgICBkdXJhdGlvbjogXCI2MCBcdTA0M0NcdTA0MzhcdTA0M0RcIixcclxuICB9LFxyXG5dO1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBSZXZpZXcge1xyXG4gIG5hbWU6IHN0cmluZztcclxuICB0ZXh0OiBzdHJpbmc7XHJcbiAgc3RhcnM6IG51bWJlcjtcclxufVxyXG5leHBvcnQgY29uc3QgUkVWSUVXUzogUmV2aWV3W10gPSBbXHJcbiAge1xyXG4gICAgbmFtZTogXCJcdTA0MTBcdTA0NDBcdTA0NDNcdTA0MzZcdTA0MzBcdTA0M0QgXHUwNDExXHUwNDM1XHUwNDNBXHUwNDNFXHUwNDMyXHUwNDMwXCIsXHJcbiAgICBzdGFyczogNSxcclxuICAgIHRleHQ6IFwiXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDNCXHUwNDMwXHUwNDQxXHUwNDRDIFx1MDQzRFx1MDQzMCBcdTA0MzlcdTA0M0VcdTA0MzNcdTA0NDMgXHUwNDQ3XHUwNDM1XHUwNDQwXHUwNDM1XHUwNDM3IFx1MDQ0Mlx1MDQzNVx1MDQzQlx1MDQzNVx1MDQ0NFx1MDQzRVx1MDQzRCBcdTA0MzdcdTA0MzAgXHUwNDNDXHUwNDM4XHUwNDNEXHUwNDQzXHUwNDQyXHUwNDQzLiBcdTA0MjdcdTA0MzVcdTA0NDBcdTA0MzVcdTA0MzcgXHUwNDNDXHUwNDM1XHUwNDQxXHUwNDRGXHUwNDQ2IFx1MDQ0MVx1MDQzRlx1MDQzOFx1MDQzRFx1MDQzMCBcdTA0M0ZcdTA0MzVcdTA0NDBcdTA0MzVcdTA0NDFcdTA0NDJcdTA0MzBcdTA0M0JcdTA0MzAgXHUwNDMxXHUwNDNFXHUwNDNCXHUwNDM1XHUwNDQyXHUwNDRDIFx1MjAxNCBcdTA0NDJcdTA0MzVcdTA0M0ZcdTA0MzVcdTA0NDBcdTA0NEMgXHUwNDQ1XHUwNDNFXHUwNDM2XHUwNDQzIFx1MDQ0Mlx1MDQ0MFx1MDQzOCBcdTA0NDBcdTA0MzBcdTA0MzdcdTA0MzAgXHUwNDMyIFx1MDQzRFx1MDQzNVx1MDQzNFx1MDQzNVx1MDQzQlx1MDQ0RS5cIixcclxuICB9LFxyXG4gIHtcclxuICAgIG5hbWU6IFwiXHUwNDFEXHUwNDM4XHUwNDNBXHUwNDM4XHUwNDQyXHUwNDMwIFx1MDQxMlx1MDQzRVx1MDQzQlx1MDQzQVx1MDQzRVx1MDQzMlwiLFxyXG4gICAgc3RhcnM6IDUsXHJcbiAgICB0ZXh0OiBcIlx1MDQxQVx1MDQ0MFx1MDQzRVx1MDQ0MVx1MDQ0MVx1MDQ0NFx1MDQzOFx1MDQ0MiBcdTA0NDMgXHUwNDIxXHUwNDM1XHUwNDQwXHUwNDMzXHUwNDM1XHUwNDRGIFx1MjAxNCBcdTA0M0JcdTA0NDNcdTA0NDdcdTA0NDhcdTA0MzVcdTA0MzUsIFx1MDQ0N1x1MDQ0Mlx1MDQzRSBcdTA0NDFcdTA0M0JcdTA0NDNcdTA0NDdcdTA0MzBcdTA0M0JcdTA0M0VcdTA0NDFcdTA0NEMgXHUwNDQxIFx1MDQzQ1x1MDQzRVx1MDQzNVx1MDQzOSBcdTA0NDRcdTA0M0VcdTA0NDBcdTA0M0NcdTA0M0VcdTA0MzkuIFx1MDQxQ1x1MDQzOFx1MDQzRFx1MDQ0M1x1MDQ0MSA4IFx1MDQzQVx1MDQzMyBcdTA0MzdcdTA0MzAgXHUwNDQyXHUwNDQwXHUwNDM4IFx1MDQzQ1x1MDQzNVx1MDQ0MVx1MDQ0Rlx1MDQ0Nlx1MDQzMCwgXHUwNDM4IFx1MDQ0RFx1MDQ0Mlx1MDQzRSBcdTA0MzFcdTA0MzVcdTA0MzcgXHUwNDM0XHUwNDM4XHUwNDM1XHUwNDQyLlwiLFxyXG4gIH0sXHJcbiAge1xyXG4gICAgbmFtZTogXCJcdTA0MTVcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzAgXHUwNDI2XHUwNDNFXHUwNDM5XCIsXHJcbiAgICBzdGFyczogNSxcclxuICAgIHRleHQ6IFwiXHUwNDFDXHUwNDNEXHUwNDM1IDU4LCBcdTA0MzFcdTA0M0VcdTA0NEZcdTA0M0JcdTA0MzBcdTA0NDFcdTA0NEMsIFx1MDQ0N1x1MDQ0Mlx1MDQzRSBcdTA0MzFcdTA0NDNcdTA0MzRcdTA0MzVcdTA0NDIgXHUwNDNGXHUwNDNFXHUwNDM3XHUwNDM0XHUwNDNEXHUwNDNFLiBcdTA0MjFcdTA0NDJcdTA0NDBcdTA0MzVcdTA0NDJcdTA0NDdcdTA0MzhcdTA0M0RcdTA0MzMgXHUwNDQxIFx1MDQxMFx1MDQzQlx1MDQzOFx1MDQzRFx1MDQzRVx1MDQzOSBcdTIwMTQgXHUwNDMxXHUwNDM1XHUwNDQwXHUwNDM1XHUwNDM2XHUwNDNEXHUwNDNFIFx1MDQzOCBcdTA0MzJcdTA0M0RcdTA0MzhcdTA0M0NcdTA0MzBcdTA0NDJcdTA0MzVcdTA0M0JcdTA0NENcdTA0M0RcdTA0M0UuIFx1MDQyN1x1MDQ0M1x1MDQzMlx1MDQ0MVx1MDQ0Mlx1MDQzMlx1MDQ0M1x1MDQ0RSBcdTA0NDFcdTA0MzVcdTA0MzFcdTA0NEYgXHUwNDNEXHUwNDMwIDIwIFx1MDQzQlx1MDQzNVx1MDQ0MiBcdTA0M0NcdTA0M0VcdTA0M0JcdTA0M0VcdTA0MzZcdTA0MzUuXCIsXHJcbiAgfSxcclxuXTtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgRmFxSXRlbSB7XHJcbiAgcTogc3RyaW5nO1xyXG4gIGE6IHN0cmluZztcclxufVxyXG5leHBvcnQgY29uc3QgRkFROiBGYXFJdGVtW10gPSBbXHJcbiAge1xyXG4gICAgcTogXCJcdTA0MURcdTA0NDNcdTA0MzZcdTA0M0RcdTA0MzAgXHUwNDNCXHUwNDM4IFx1MDQzRlx1MDQzRVx1MDQzNFx1MDQzM1x1MDQzRVx1MDQ0Mlx1MDQzRVx1MDQzMlx1MDQzQVx1MDQzMCBcdTA0MzRcdTA0M0JcdTA0NEYgXHUwNDNGXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDNFXHUwNDMzXHUwNDNFIFx1MDQzN1x1MDQzMFx1MDQzRFx1MDQ0Rlx1MDQ0Mlx1MDQzOFx1MDQ0Rj9cIixcclxuICAgIGE6IFwiXHUwNDFEXHUwNDM1XHUwNDQyLiBcdTA0MjJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzVcdTA0NDAgXHUwNDNGXHUwNDNFXHUwNDM0XHUwNDMxXHUwNDM1XHUwNDQwXHUwNDUxXHUwNDQyIFx1MDQzRFx1MDQzMFx1MDQzM1x1MDQ0MFx1MDQ0M1x1MDQzN1x1MDQzQVx1MDQ0MyBcdTA0M0ZcdTA0M0VcdTA0MzQgXHUwNDQyXHUwNDMyXHUwNDNFXHUwNDM5IFx1MDQ0M1x1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzNVx1MDQzRFx1MDQ0Qy4gXHUwNDE5XHUwNDNFXHUwNDMzXHUwNDMwIFx1MDQzOCBcdTA0NDFcdTA0NDJcdTA0NDBcdTA0MzVcdTA0NDJcdTA0NDdcdTA0MzhcdTA0M0RcdTA0MzMgXHUwNDNGXHUwNDNFXHUwNDM0XHUwNDQ1XHUwNDNFXHUwNDM0XHUwNDRGXHUwNDQyIFx1MDQzNFx1MDQzMFx1MDQzNlx1MDQzNSBcdTA0MzFcdTA0MzVcdTA0MzcgXHUwNDNFXHUwNDNGXHUwNDRCXHUwNDQyXHUwNDMwLlwiLFxyXG4gIH0sXHJcbiAge1xyXG4gICAgcTogXCJcdTA0MjdcdTA0NDJcdTA0M0UgXHUwNDMyXHUwNDM3XHUwNDRGXHUwNDQyXHUwNDRDIFx1MDQ0MSBcdTA0NDFcdTA0M0VcdTA0MzFcdTA0M0VcdTA0Mzk/XCIsXHJcbiAgICBhOiBcIlx1MDQyMVx1MDQzRlx1MDQzRVx1MDQ0MFx1MDQ0Mlx1MDQzOFx1MDQzMlx1MDQzRFx1MDQ0M1x1MDQ0RSBcdTA0NDRcdTA0M0VcdTA0NDBcdTA0M0NcdTA0NDMsIFx1MDQ0MVx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzRFx1MDQ0M1x1MDQ0RSBcdTA0M0VcdTA0MzFcdTA0NDNcdTA0MzJcdTA0NEMgXHUwNDM4IFx1MDQzMVx1MDQ0M1x1MDQ0Mlx1MDQ0Qlx1MDQzQlx1MDQzQVx1MDQ0MyBcdTA0MzJcdTA0M0VcdTA0MzRcdTA0NEIuIFx1MDQxRlx1MDQzRVx1MDQzQlx1MDQzRVx1MDQ0Mlx1MDQzNVx1MDQzRFx1MDQ0Nlx1MDQzNSwgXHUwNDNBXHUwNDNFXHUwNDMyXHUwNDQwXHUwNDM4XHUwNDNBXHUwNDM4IFx1MDQzOCBcdTA0MzhcdTA0M0RcdTA0MzJcdTA0MzVcdTA0M0RcdTA0NDJcdTA0MzBcdTA0NDBcdTA0NEMgXHUyMDE0IFx1MDQzRFx1MDQzMFx1MDQ0OFx1MDQzOC5cIixcclxuICB9LFxyXG4gIHtcclxuICAgIHE6IFwiXHUwNDFDXHUwNDNFXHUwNDM2XHUwNDNEXHUwNDNFIFx1MDQzQlx1MDQzOCBcdTA0M0VcdTA0NDJcdTA0M0NcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDJcdTA0NEMgXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDRDP1wiLFxyXG4gICAgYTogXCJcdTA0MTRcdTA0MzAsIFx1MDQzMiBcdTA0M0VcdTA0MzRcdTA0MzhcdTA0M0QgXHUwNDNBXHUwNDNCXHUwNDM4XHUwNDNBIFx1MDQzMiBcdTA0NDBcdTA0MzBcdTA0MzdcdTA0MzRcdTA0MzVcdTA0M0JcdTA0MzUgXHUwMEFCXHUwNDFDXHUwNDNFXHUwNDM4IFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzOFx1MDBCQi4gXHUwNDExXHUwNDM1XHUwNDM3IFx1MDQ0OFx1MDQ0Mlx1MDQ0MFx1MDQzMFx1MDQ0NFx1MDQzRVx1MDQzMiBcdTA0MzggXHUwNDM3XHUwNDMyXHUwNDNFXHUwNDNEXHUwNDNBXHUwNDNFXHUwNDMyIFx1MjAxNCBcdTA0M0NcdTA0MzVcdTA0NDFcdTA0NDJcdTA0M0UgXHUwNDQxXHUwNDQwXHUwNDMwXHUwNDM3XHUwNDQzIFx1MDQzRVx1MDQ0MVx1MDQzMlx1MDQzRVx1MDQzMVx1MDQzRVx1MDQzNlx1MDQzNFx1MDQzMFx1MDQzNVx1MDQ0Mlx1MDQ0MVx1MDQ0Ri5cIixcclxuICB9LFxyXG4gIHtcclxuICAgIHE6IFwiXHUwNDIxIFx1MDQzQVx1MDQzMFx1MDQzQVx1MDQzRVx1MDQzM1x1MDQzRSBcdTA0MzJcdTA0M0VcdTA0MzdcdTA0NDBcdTA0MzBcdTA0NDFcdTA0NDJcdTA0MzAgXHUwNDNDXHUwNDNFXHUwNDM2XHUwNDNEXHUwNDNFIFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQ0Q1x1MDQ0MVx1MDQ0Rj9cIixcclxuICAgIGE6IFwiXHUwNDIxIDE2IFx1MDQzQlx1MDQzNVx1MDQ0MiBcdTA0M0RcdTA0MzAgXHUwNDMyXHUwNDQxXHUwNDM1IFx1MDQzRFx1MDQzMFx1MDQzRlx1MDQ0MFx1MDQzMFx1MDQzMlx1MDQzQlx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0Ri4gXHUwNDEyXHUwNDM1XHUwNDQwXHUwNDQ1XHUwNDNEXHUwNDM1XHUwNDM5IFx1MDQzM1x1MDQ0MFx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0Nlx1MDQ0QiBcdTA0M0RcdTA0MzVcdTA0NDI6IFx1MDQ0MyBcdTA0M0RcdTA0MzBcdTA0NDEgXHUwNDM3XHUwNDMwXHUwNDNEXHUwNDM4XHUwNDNDXHUwNDMwXHUwNDRFXHUwNDQyXHUwNDQxXHUwNDRGIFx1MDQzOCBcdTA0MzIgNjArLCBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzVcdTA0NDAgXHUwNDMwXHUwNDM0XHUwNDMwXHUwNDNGXHUwNDQyXHUwNDM4XHUwNDQwXHUwNDQzXHUwNDM1XHUwNDQyIFx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQzM1x1MDQ0MFx1MDQzMFx1MDQzQ1x1MDQzQ1x1MDQ0My5cIixcclxuICB9LFxyXG5dO1xyXG5cclxuZXhwb3J0IGNvbnN0IENMVUJfSU5GTyA9IHtcclxuICBjaXR5OiBcIlx1MDQxQVx1MDQzMFx1MDQ0MFx1MDQzMFx1MDQzM1x1MDQzMFx1MDQzRFx1MDQzNFx1MDQzMFwiLFxyXG4gIGFkZHJlc3M6IFwiXHUwNDQzXHUwNDNCLiBcdTA0MjFcdTA0M0ZcdTA0M0VcdTA0NDBcdTA0NDJcdTA0MzhcdTA0MzJcdTA0M0RcdTA0MzBcdTA0NEYsIDEyXCIsXHJcbiAgcGhvbmU6IFwiKzcgKDcyMTIpIDU1LTAxLTAyXCIsXHJcbiAgaG91cnM6IFwiXHUwNDE1XHUwNDM2XHUwNDM1XHUwNDM0XHUwNDNEXHUwNDM1XHUwNDMyXHUwNDNEXHUwNDNFIDA3OjAwXHUyMDEzMjM6MDBcIixcclxufTtcclxuIiwgImltcG9ydCB7IFdPUktPVVRfS0lORFMgfSBmcm9tIFwiLi4vY29yZS90eXBlc1wiO1xyXG5pbXBvcnQgdHlwZSB7IEFwcENvbnRleHQgfSBmcm9tIFwiLi4vYXBwL2NvbnRleHRcIjtcclxuaW1wb3J0IHtcclxuICBDTFVCX0lORk8sXHJcbiAgRElSRUNUSU9OUyxcclxuICBGQVEsXHJcbiAgZm9ybWF0UHJpY2UsXHJcbiAgUExBTlMsXHJcbiAgUkVWSUVXUyxcclxuICBUUkFJTkVSUyxcclxuICB0eXBlIFBsYW4sXHJcbn0gZnJvbSBcIi4uL2FwcC9jb250ZW50XCI7XHJcbmltcG9ydCB7IGgsIHJlcGxhY2UgfSBmcm9tIFwiLi4vdWkvZG9tXCI7XHJcbmltcG9ydCB7IEhFUk9fUEhPVE8sIEtJTkRfTEFCRUwgfSBmcm9tIFwiLi4vdWkvZm9ybWF0XCI7XHJcbmltcG9ydCB7IGljb24gfSBmcm9tIFwiLi4vdWkvaWNvbnNcIjtcclxuaW1wb3J0IHsgQmFzZVZpZXcgfSBmcm9tIFwiLi92aWV3XCI7XHJcbmltcG9ydCB7XHJcbiAgYXZhdGFyLFxyXG4gIGJ1dHRvbixcclxuICBjb3ZlckltZyxcclxuICBpbnRlbnNpdHlDaGlwLFxyXG4gIGtpbmRCYWRnZSxcclxuICByZW1vdGVJbWcsXHJcbn0gZnJvbSBcIi4uL3VpL2NvbnRyb2xzXCI7XHJcbmltcG9ydCB7IHJlcXVlc3RBdXRoVGFiIH0gZnJvbSBcIi4vYXV0aC12aWV3XCI7XHJcblxyXG5leHBvcnQgY2xhc3MgTGFuZGluZ1ZpZXcgZXh0ZW5kcyBCYXNlVmlldyB7XHJcbiAgcHJpdmF0ZSBvYnNlcnZlcjogSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIGNvdW50ZXJPYnNlcnZlcjogSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgfCBudWxsID0gbnVsbDtcclxuXHJcbiAgY29uc3RydWN0b3IoY3R4OiBBcHBDb250ZXh0KSB7XHJcbiAgICBzdXBlcihjdHgpO1xyXG4gIH1cclxuXHJcbiAgcHJvdGVjdGVkIGluaXQoKTogdm9pZCB7XHJcbiAgICB0aGlzLndhdGNoKFwiYXV0aFwiLCAoKSA9PiB0aGlzLnJlbmRlcigpKTtcclxuICB9XHJcblxyXG4gIHByb3RlY3RlZCBvbkRlc3Ryb3koKTogdm9pZCB7XHJcbiAgICB0aGlzLm9ic2VydmVyPy5kaXNjb25uZWN0KCk7XHJcbiAgICB0aGlzLmNvdW50ZXJPYnNlcnZlcj8uZGlzY29ubmVjdCgpO1xyXG4gIH1cclxuXHJcbiAgcHJvdGVjdGVkIHJlbmRlcigpOiB2b2lkIHtcclxuICAgIHJlcGxhY2UoXHJcbiAgICAgIHRoaXMucm9vdCxcclxuICAgICAgdGhpcy5wcm9tb0JhcigpLFxyXG4gICAgICB0aGlzLmhlcm8oKSxcclxuICAgICAgdGhpcy5tYXJxdWVlKCksXHJcbiAgICAgIHRoaXMuZGlyZWN0aW9ucygpLFxyXG4gICAgICB0aGlzLnN0ZXBzKCksXHJcbiAgICAgIHRoaXMudHJhaW5lcnMoKSxcclxuICAgICAgdGhpcy5wcmljaW5nKCksXHJcbiAgICAgIHRoaXMucmV2aWV3cygpLFxyXG4gICAgICB0aGlzLmZhcSgpLFxyXG4gICAgICB0aGlzLmN0YUJhbmQoKSxcclxuICAgICAgdGhpcy5mb290ZXIoKSxcclxuICAgICk7XHJcbiAgICB0aGlzLm9ic2VydmVSZXZlYWxzKCk7XHJcbiAgICB0aGlzLm9ic2VydmVDb3VudGVycygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvYnNlcnZlUmV2ZWFscygpOiB2b2lkIHtcclxuICAgIHRoaXMub2JzZXJ2ZXI/LmRpc2Nvbm5lY3QoKTtcclxuICAgIHRoaXMub2JzZXJ2ZXIgPSBuZXcgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIoXHJcbiAgICAgIChlbnRyaWVzKSA9PiB7XHJcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XHJcbiAgICAgICAgICBpZiAoZW50cnkuaXNJbnRlcnNlY3RpbmcpIHtcclxuICAgICAgICAgICAgZW50cnkudGFyZ2V0LmNsYXNzTGlzdC5hZGQoXCJpblwiKTtcclxuICAgICAgICAgICAgdGhpcy5vYnNlcnZlcj8udW5vYnNlcnZlKGVudHJ5LnRhcmdldCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9LFxyXG4gICAgICB7IHRocmVzaG9sZDogMC4xMiB9LFxyXG4gICAgKTtcclxuICAgIHRoaXMucm9vdFxyXG4gICAgICAucXVlcnlTZWxlY3RvckFsbChcIi5yZXZlYWxcIilcclxuICAgICAgLmZvckVhY2goKGVsKSA9PiB0aGlzLm9ic2VydmVyPy5vYnNlcnZlKGVsKSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIG9ic2VydmVDb3VudGVycygpOiB2b2lkIHtcclxuICAgIHRoaXMuY291bnRlck9ic2VydmVyPy5kaXNjb25uZWN0KCk7XHJcbiAgICB0aGlzLmNvdW50ZXJPYnNlcnZlciA9IG5ldyBJbnRlcnNlY3Rpb25PYnNlcnZlcihcclxuICAgICAgKGVudHJpZXMpID0+IHtcclxuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcclxuICAgICAgICAgIGlmICghZW50cnkuaXNJbnRlcnNlY3RpbmcpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgY29uc3QgZWwgPSBlbnRyeS50YXJnZXQgYXMgSFRNTEVsZW1lbnQ7XHJcbiAgICAgICAgICB0aGlzLmNvdW50ZXJPYnNlcnZlcj8udW5vYnNlcnZlKGVsKTtcclxuICAgICAgICAgIHRoaXMuYW5pbWF0ZUNvdW50KGVsKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0sXHJcbiAgICAgIHsgdGhyZXNob2xkOiAwLjQgfSxcclxuICAgICk7XHJcbiAgICB0aGlzLnJvb3RcclxuICAgICAgLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KFwiW2RhdGEtY291bnRdXCIpXHJcbiAgICAgIC5mb3JFYWNoKChlbCkgPT4gdGhpcy5jb3VudGVyT2JzZXJ2ZXI/Lm9ic2VydmUoZWwpKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYW5pbWF0ZUNvdW50KGVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xyXG4gICAgY29uc3QgdGFyZ2V0ID0gTnVtYmVyKGVsLmRhdGFzZXQuY291bnQgPz8gXCIwXCIpO1xyXG4gICAgY29uc3Qgc3VmZml4ID0gZWwuZGF0YXNldC5zdWZmaXggPz8gXCJcIjtcclxuICAgIGNvbnN0IGR1cmF0aW9uID0gMTEwMDtcclxuICAgIGNvbnN0IHN0YXJ0ID0gcGVyZm9ybWFuY2Uubm93KCk7XHJcbiAgICBjb25zdCB0aWNrID0gKG5vdzogbnVtYmVyKTogdm9pZCA9PiB7XHJcbiAgICAgIGNvbnN0IHQgPSBNYXRoLm1pbigxLCAobm93IC0gc3RhcnQpIC8gZHVyYXRpb24pO1xyXG4gICAgICBjb25zdCBlYXNlZCA9IDEgLSBNYXRoLnBvdygxIC0gdCwgMyk7XHJcbiAgICAgIGVsLnRleHRDb250ZW50ID0gYCR7TWF0aC5yb3VuZCh0YXJnZXQgKiBlYXNlZCl9JHtzdWZmaXh9YDtcclxuICAgICAgaWYgKHQgPCAxKSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGljayk7XHJcbiAgICB9O1xyXG4gICAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRpY2spO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBnbygpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLmN0eC5hdXRoLmN1cnJlbnRVc2VyKCkpIHtcclxuICAgICAgdGhpcy5jdHgubmF2aWdhdGUoXCJzY2hlZHVsZVwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgcmVxdWVzdEF1dGhUYWIoXCJyZWdpc3RlclwiKTtcclxuICAgIHRoaXMuY3R4Lm5hdmlnYXRlKFwiYXV0aFwiKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2Nyb2xsVG8oaWQ6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgZG9jdW1lbnRcclxuICAgICAgLmdldEVsZW1lbnRCeUlkKGlkKVxyXG4gICAgICA/LnNjcm9sbEludG9WaWV3KHsgYmVoYXZpb3I6IFwic21vb3RoXCIsIGJsb2NrOiBcInN0YXJ0XCIgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHByb21vQmFyKCk6IEhUTUxFbGVtZW50IHtcclxuICAgIHJldHVybiBoKFxyXG4gICAgICBcImRpdlwiLFxyXG4gICAgICB7IGNsYXNzOiBcInByb21vLWJhclwiIH0sXHJcbiAgICAgIGgoXCJzcGFuXCIsIHsgdGV4dDogXCJcdTA0MUZcdTA0MzVcdTA0NDBcdTA0MzJcdTA0MzBcdTA0NEYgXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDMwIFx1MjAxNCBcdTA0MzFcdTA0MzVcdTA0NDFcdTA0M0ZcdTA0M0JcdTA0MzBcdTA0NDJcdTA0M0RcdTA0M0VcIiB9KSxcclxuICAgICAgaChcImJ1dHRvblwiLCB7XHJcbiAgICAgICAgY2xhc3M6IFwicHJvbW8tbGlua1wiLFxyXG4gICAgICAgIGF0dHJzOiB7IHR5cGU6IFwiYnV0dG9uXCIgfSxcclxuICAgICAgICB0ZXh0OiBcIlx1MDQxN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzMFx1MDQ0Mlx1MDQ0Q1x1MDQ0MVx1MDQ0RiBcdTIxOTJcIixcclxuICAgICAgICBvbjogeyBjbGljazogKCkgPT4gdGhpcy5nbygpIH0sXHJcbiAgICAgIH0pLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgaGVybygpOiBIVE1MRWxlbWVudCB7XHJcbiAgICBjb25zdCBzdGF0ID0gKHZhbHVlOiBudW1iZXIsIHN1ZmZpeDogc3RyaW5nLCBsYWJlbDogc3RyaW5nKTogSFRNTEVsZW1lbnQgPT5cclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwiaGwtc3RhdFwiIH0sXHJcbiAgICAgICAgaChcInN0cm9uZ1wiLCB7XHJcbiAgICAgICAgICBhdHRyczogeyBcImRhdGEtY291bnRcIjogU3RyaW5nKHZhbHVlKSwgXCJkYXRhLXN1ZmZpeFwiOiBzdWZmaXggfSxcclxuICAgICAgICAgIHRleHQ6IGAwJHtzdWZmaXh9YCxcclxuICAgICAgICB9KSxcclxuICAgICAgICBoKFwic3BhblwiLCB7IHRleHQ6IGxhYmVsIH0pLFxyXG4gICAgICApO1xyXG4gICAgY29uc3QgYXJ0ID0gaChcclxuICAgICAgXCJkaXZcIixcclxuICAgICAgeyBjbGFzczogXCJobC1hcnRcIiB9LFxyXG4gICAgICByZW1vdGVJbWcoSEVST19QSE9UTywgXCJcdTA0MTBcdTA0NDJcdTA0M0JcdTA0MzVcdTA0NDIgXHUwNDMyIFx1MDQzN1x1MDQzMFx1MDQzQlx1MDQzNVwiLCBcImhsLWF0aGxldGVcIiwgKCkgPT5cclxuICAgICAgICBoKFwiZGl2XCIsIHsgY2xhc3M6IFwiaGwtYXRobGV0ZSBobC1hdGhsZXRlLWZhbGxiYWNrXCIgfSksXHJcbiAgICAgICksXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJkaXZcIixcclxuICAgICAgICB7IGNsYXNzOiBcImhsLWJhZGdlXCIgfSxcclxuICAgICAgICBoKFwic3Ryb25nXCIsIHsgdGV4dDogXCIxNitcIiB9KSxcclxuICAgICAgICBoKFwic3BhblwiLCB7IHRleHQ6IFwiXHUwNDNCXHUwNDM1XHUwNDQyIFx1MDQzOCBcdTA0NDFcdTA0NDJcdTA0MzBcdTA0NDBcdTA0NDhcdTA0MzVcIiB9KSxcclxuICAgICAgKSxcclxuICAgICk7XHJcbiAgICByZXR1cm4gaChcclxuICAgICAgXCJzZWN0aW9uXCIsXHJcbiAgICAgIHsgY2xhc3M6IFwiaGxcIiB9LFxyXG4gICAgICBoKFxyXG4gICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJobC1pbm5lclwiIH0sXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcImhsLWNvcHlcIiB9LFxyXG4gICAgICAgICAgaChcInNwYW5cIiwge1xyXG4gICAgICAgICAgICBjbGFzczogXCJobC1raWNrZXJcIixcclxuICAgICAgICAgICAgdGV4dDogYFx1MDQyMVx1MDQzRlx1MDQzRVx1MDQ0MFx1MDQ0Mlx1MDQzOFx1MDQzMlx1MDQzRFx1MDQ0Qlx1MDQzOSBcdTA0NDZcdTA0MzVcdTA0M0RcdTA0NDJcdTA0NDAgXHUwMEI3ICR7Q0xVQl9JTkZPLmNpdHl9YCxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgaChcclxuICAgICAgICAgICAgXCJoMVwiLFxyXG4gICAgICAgICAgICB7IGNsYXNzOiBcImhsLXRpdGxlXCIgfSxcclxuICAgICAgICAgICAgXCJcdTA0MjFcdTA0MzhcdTA0M0JcdTA0MzAuXCIsXHJcbiAgICAgICAgICAgIGgoXCJiclwiKSxcclxuICAgICAgICAgICAgXCJcdTA0MjBcdTA0MzhcdTA0NDJcdTA0M0MuXCIsXHJcbiAgICAgICAgICAgIGgoXCJiclwiKSxcclxuICAgICAgICAgICAgaChcInNwYW5cIiwgeyBjbGFzczogXCJobC1hY2NlbnRcIiwgdGV4dDogXCJcdTA0MjBcdTA0MzVcdTA0MzdcdTA0NDNcdTA0M0JcdTA0NENcdTA0NDJcdTA0MzBcdTA0NDIuXCIgfSksXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgICAgaChcInBcIiwge1xyXG4gICAgICAgICAgICBjbGFzczogXCJobC1zdWJcIixcclxuICAgICAgICAgICAgdGV4dDogXCJcdTA0MUZcdTA0NEZcdTA0NDJcdTA0NEMgXHUwNDNEXHUwNDMwXHUwNDNGXHUwNDQwXHUwNDMwXHUwNDMyXHUwNDNCXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM5IFx1MDQzOCBcdTA0NDBcdTA0MzBcdTA0NDFcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzBcdTA0M0RcdTA0MzhcdTA0MzUsIFx1MDQzQVx1MDQzRVx1MDQ0Mlx1MDQzRVx1MDQ0MFx1MDQzRVx1MDQzNSBcdTA0M0ZcdTA0M0VcdTA0MzRcdTA0NDFcdTA0NDJcdTA0NDBcdTA0MzBcdTA0MzhcdTA0MzJcdTA0MzBcdTA0MzVcdTA0NDJcdTA0NDFcdTA0NEYgXHUwNDNGXHUwNDNFXHUwNDM0IFx1MDQ0Mlx1MDQzNVx1MDQzMVx1MDQ0Ri4gXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDRDIFx1MjAxNCBcdTA0MzIgXHUwNDM0XHUwNDMyXHUwNDMwIFx1MDQzQVx1MDQzQlx1MDQzOFx1MDQzQVx1MDQzMCwgXHUwNDNGXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDMwXHUwNDRGIFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzQVx1MDQzMCBcdTIwMTQgXHUwNDMxXHUwNDM1XHUwNDQxXHUwNDNGXHUwNDNCXHUwNDMwXHUwNDQyXHUwNDNEXHUwNDNFLlwiLFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgICBoKFxyXG4gICAgICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgICAgICB7IGNsYXNzOiBcImhsLWN0YXNcIiB9LFxyXG4gICAgICAgICAgICBidXR0b24oeyBsYWJlbDogXCJcdTA0MTdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzBcdTA0NDJcdTA0NENcdTA0NDFcdTA0NEYgXHUwNDMxXHUwNDM1XHUwNDQxXHUwNDNGXHUwNDNCXHUwNDMwXHUwNDQyXHUwNDNEXHUwNDNFXCIsIG9uQ2xpY2s6ICgpID0+IHRoaXMuZ28oKSB9KSxcclxuICAgICAgICAgICAgYnV0dG9uKHtcclxuICAgICAgICAgICAgICBsYWJlbDogXCJcdTA0MjFcdTA0M0NcdTA0M0VcdTA0NDJcdTA0NDBcdTA0MzVcdTA0NDJcdTA0NEMgXHUwNDQ2XHUwNDM1XHUwNDNEXHUwNDRCXCIsXHJcbiAgICAgICAgICAgICAgdG9uZTogXCJnaG9zdFwiLFxyXG4gICAgICAgICAgICAgIG9uQ2xpY2s6ICgpID0+IHRoaXMuc2Nyb2xsVG8oXCJwcmljaW5nXCIpLFxyXG4gICAgICAgICAgICB9KSxcclxuICAgICAgICAgICksXHJcbiAgICAgICAgICBoKFxyXG4gICAgICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgICAgICB7IGNsYXNzOiBcImhsLXN0YXRzXCIgfSxcclxuICAgICAgICAgICAgc3RhdCg1LCBcIlwiLCBcIlx1MDQzRFx1MDQzMFx1MDQzRlx1MDQ0MFx1MDQzMFx1MDQzMlx1MDQzQlx1MDQzNVx1MDQzRFx1MDQzOFx1MDQzOVwiKSxcclxuICAgICAgICAgICAgc3RhdCg1LCBcIlwiLCBcIlx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzNVx1MDQ0MFx1MDQzRVx1MDQzMlwiKSxcclxuICAgICAgICAgICAgc3RhdCg3LCBcIlwiLCBcIlx1MDQzNFx1MDQzRFx1MDQzNVx1MDQzOSBcdTA0MzIgXHUwNDNEXHUwNDM1XHUwNDM0XHUwNDM1XHUwNDNCXHUwNDRFXCIpLFxyXG4gICAgICAgICAgICBzdGF0KDEyMDAsIFwiK1wiLCBcIlx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzNVx1MDQzOVwiKSxcclxuICAgICAgICAgICksXHJcbiAgICAgICAgKSxcclxuICAgICAgICBhcnQsXHJcbiAgICAgICksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBtYXJxdWVlKCk6IEhUTUxFbGVtZW50IHtcclxuICAgIGNvbnN0IHRleHQgPVxyXG4gICAgICBXT1JLT1VUX0tJTkRTLm1hcCgoaykgPT4gS0lORF9MQUJFTFtrXS50b1VwcGVyQ2FzZSgpKS5qb2luKFwiICBcdTAwQjcgIFwiKSArXHJcbiAgICAgIFwiICBcdTAwQjcgIFwiO1xyXG4gICAgcmV0dXJuIGgoXHJcbiAgICAgIFwiZGl2XCIsXHJcbiAgICAgIHsgY2xhc3M6IFwibWFycXVlZVwiLCBhdHRyczogeyBcImFyaWEtaGlkZGVuXCI6IFwidHJ1ZVwiIH0gfSxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwibWFycXVlZS10cmFja1wiIH0sXHJcbiAgICAgICAgaChcInNwYW5cIiwgeyB0ZXh0IH0pLFxyXG4gICAgICAgIGgoXCJzcGFuXCIsIHsgdGV4dCB9KSxcclxuICAgICAgKSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHNlY3Rpb25IZWFkKFxyXG4gICAga2lja2VyOiBzdHJpbmcsXHJcbiAgICB0aXRsZTogc3RyaW5nLFxyXG4gICAgc3ViPzogc3RyaW5nLFxyXG4gICk6IEhUTUxFbGVtZW50IHtcclxuICAgIHJldHVybiBoKFxyXG4gICAgICBcImRpdlwiLFxyXG4gICAgICB7IGNsYXNzOiBcImxzLWhlYWQgcmV2ZWFsXCIgfSxcclxuICAgICAgaChcInNwYW5cIiwgeyBjbGFzczogXCJscy1raWNrZXJcIiwgdGV4dDoga2lja2VyIH0pLFxyXG4gICAgICBoKFwiaDJcIiwgeyBjbGFzczogXCJscy10aXRsZVwiLCB0ZXh0OiB0aXRsZSB9KSxcclxuICAgICAgc3ViID8gaChcInBcIiwgeyBjbGFzczogXCJscy1zdWJcIiwgdGV4dDogc3ViIH0pIDogbnVsbCxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGRpcmVjdGlvbnMoKTogSFRNTEVsZW1lbnQge1xyXG4gICAgY29uc3QgY2FyZHMgPSBESVJFQ1RJT05TLm1hcCgoZGlyKSA9PlxyXG4gICAgICBoKFxyXG4gICAgICAgIFwiYXJ0aWNsZVwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwiZGlyLWNhcmQgcmV2ZWFsXCIgfSxcclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJkaXZcIixcclxuICAgICAgICAgIHsgY2xhc3M6IFwiZGlyLWNvdmVyXCIgfSxcclxuICAgICAgICAgIGNvdmVySW1nKGRpci5raW5kLCBcImRpci1pbWdcIiksXHJcbiAgICAgICAgICBoKFwic3BhblwiLCB7IGNsYXNzOiBcImRpci1kdXJhdGlvblwiLCB0ZXh0OiBkaXIuZHVyYXRpb24gfSksXHJcbiAgICAgICAgKSxcclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJkaXZcIixcclxuICAgICAgICAgIHsgY2xhc3M6IFwiZGlyLWJvZHlcIiB9LFxyXG4gICAgICAgICAgaChcclxuICAgICAgICAgICAgXCJkaXZcIixcclxuICAgICAgICAgICAgeyBjbGFzczogXCJkaXItYmFkZ2VzXCIgfSxcclxuICAgICAgICAgICAga2luZEJhZGdlKGRpci5raW5kKSxcclxuICAgICAgICAgICAgaW50ZW5zaXR5Q2hpcChkaXIua2luZCksXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgICAgaChcImgzXCIsIHsgdGV4dDogZGlyLnRpdGxlIH0pLFxyXG4gICAgICAgICAgaChcInBcIiwgeyBjbGFzczogXCJtdXRlZFwiLCB0ZXh0OiBkaXIuZGVzY3JpcHRpb24gfSksXHJcbiAgICAgICAgICBidXR0b24oe1xyXG4gICAgICAgICAgICBsYWJlbDogXCJcdTA0MTIgXHUwNDQwXHUwNDMwXHUwNDQxXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDM1XCIsXHJcbiAgICAgICAgICAgIHRvbmU6IFwiZ2hvc3RcIixcclxuICAgICAgICAgICAgc21hbGw6IHRydWUsXHJcbiAgICAgICAgICAgIG9uQ2xpY2s6ICgpID0+IHRoaXMuZ28oKSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICksXHJcbiAgICAgICksXHJcbiAgICApO1xyXG4gICAgcmV0dXJuIGgoXHJcbiAgICAgIFwic2VjdGlvblwiLFxyXG4gICAgICB7IGNsYXNzOiBcImxzXCIsIGF0dHJzOiB7IGlkOiBcImRpcmVjdGlvbnNcIiB9IH0sXHJcbiAgICAgIHRoaXMuc2VjdGlvbkhlYWQoXHJcbiAgICAgICAgXCJcdTA0MURcdTA0MzBcdTA0M0ZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NEZcIixcclxuICAgICAgICBcIlx1MDQxRFx1MDQzMFx1MDQzOVx1MDQzNFx1MDQzOCBcdTA0NDFcdTA0MzJcdTA0M0VcdTA0NEUgXHUwNDNEXHUwNDMwXHUwNDMzXHUwNDQwXHUwNDQzXHUwNDM3XHUwNDNBXHUwNDQzXCIsXHJcbiAgICAgICAgXCJcdTA0MUVcdTA0NDIgXHUwNDQxXHUwNDNGXHUwNDNFXHUwNDNBXHUwNDNFXHUwNDM5XHUwNDNEXHUwNDNFXHUwNDM5IFx1MDQzOVx1MDQzRVx1MDQzM1x1MDQzOCBcdTA0MzRcdTA0M0UgXHUwNDM2XHUwNDUxXHUwNDQxXHUwNDQyXHUwNDNBXHUwNDNFXHUwNDMzXHUwNDNFIFx1MDQzQVx1MDQ0MFx1MDQzRVx1MDQ0MVx1MDQ0MVx1MDQ0NFx1MDQzOFx1MDQ0Mlx1MDQzMCBcdTIwMTQgXHUwNDM4XHUwNDNEXHUwNDQyXHUwNDM1XHUwNDNEXHUwNDQxXHUwNDM4XHUwNDMyXHUwNDNEXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDIFx1MDQzMlx1MDQzOFx1MDQzNFx1MDQzRFx1MDQzMCBcdTA0NDFcdTA0NDBcdTA0MzBcdTA0MzdcdTA0NDMuXCIsXHJcbiAgICAgICksXHJcbiAgICAgIGgoXCJkaXZcIiwgeyBjbGFzczogXCJkaXItZ3JpZFwiIH0sIC4uLmNhcmRzKSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0ZXBzKCk6IEhUTUxFbGVtZW50IHtcclxuICAgIGNvbnN0IGl0ZW1zID0gW1xyXG4gICAgICB7XHJcbiAgICAgICAgbjogXCIwMVwiLFxyXG4gICAgICAgIHRpdGxlOiBcIlx1MDQxMlx1MDQ0Qlx1MDQzMVx1MDQzNVx1MDQ0MFx1MDQzOCBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0NDNcIixcclxuICAgICAgICB0ZXh0OiBcIlx1MDQyMFx1MDQzMFx1MDQ0MVx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzMFx1MDQzRFx1MDQzOFx1MDQzNSBcdTA0M0RcdTA0MzAgXHUwNDNEXHUwNDM1XHUwNDM0XHUwNDM1XHUwNDNCXHUwNDRFIFx1MDQzMlx1MDQzRlx1MDQzNVx1MDQ0MFx1MDQ1MVx1MDQzNDogXHUwNDM0XHUwNDM1XHUwNDNEXHUwNDRDLCBcdTA0MzJcdTA0NDBcdTA0MzVcdTA0M0NcdTA0NEYsIFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzNVx1MDQ0MCBcdTA0MzggXHUwNDQxXHUwNDMyXHUwNDNFXHUwNDMxXHUwNDNFXHUwNDM0XHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQzQ1x1MDQzNVx1MDQ0MVx1MDQ0Mlx1MDQzMCBcdTIwMTQgXHUwNDMyXHUwNDQxXHUwNDUxIFx1MDQzMlx1MDQzOFx1MDQzNFx1MDQzRFx1MDQzRSBcdTA0NDFcdTA0NDBcdTA0MzBcdTA0MzdcdTA0NDMuXCIsXHJcbiAgICAgIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBuOiBcIjAyXCIsXHJcbiAgICAgICAgdGl0bGU6IFwiXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQ4XHUwNDM4XHUwNDQxXHUwNDRDIFx1MDQzMiBcdTA0MzRcdTA0MzJcdTA0MzAgXHUwNDNBXHUwNDNCXHUwNDM4XHUwNDNBXHUwNDMwXCIsXHJcbiAgICAgICAgdGV4dDogXCJcdTA0MTFcdTA0MzVcdTA0MzcgXHUwNDM3XHUwNDMyXHUwNDNFXHUwNDNEXHUwNDNBXHUwNDNFXHUwNDMyIFx1MDQzOCBcdTA0MzBcdTA0M0RcdTA0M0FcdTA0MzVcdTA0NDIuIFx1MDQxQ1x1MDQzNVx1MDQ0MVx1MDQ0Mlx1MDQzRSBcdTA0MzFcdTA0NDBcdTA0M0VcdTA0M0RcdTA0MzhcdTA0NDBcdTA0NDNcdTA0MzVcdTA0NDJcdTA0NDFcdTA0NEYgXHUwNDNDXHUwNDMzXHUwNDNEXHUwNDNFXHUwNDMyXHUwNDM1XHUwNDNEXHUwNDNEXHUwNDNFLCBcdTA0M0VcdTA0NDJcdTA0M0NcdTA0MzVcdTA0M0RcdTA0MzAgXHUyMDE0IFx1MDQ0Mlx1MDQzRVx1MDQzNlx1MDQzNSBcdTA0MzIgXHUwNDNFXHUwNDM0XHUwNDM4XHUwNDNEIFx1MDQzQVx1MDQzQlx1MDQzOFx1MDQzQS5cIixcclxuICAgICAgfSxcclxuICAgICAge1xyXG4gICAgICAgIG46IFwiMDNcIixcclxuICAgICAgICB0aXRsZTogXCJcdTA0MUZcdTA0NDBcdTA0MzhcdTA0NDVcdTA0M0VcdTA0MzRcdTA0MzggXHUwNDM4IFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0MFx1MDQ0M1x1MDQzOVx1MDQ0MVx1MDQ0RlwiLFxyXG4gICAgICAgIHRleHQ6IFwiXHUwNDIyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM1XHUwNDQwIFx1MDQzMlx1MDQ0MVx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQ0Mlx1MDQzOFx1MDQ0MiwgXHUwNDNGXHUwNDNFXHUwNDM0XHUwNDMxXHUwNDM1XHUwNDQwXHUwNDUxXHUwNDQyIFx1MDQzRFx1MDQzMFx1MDQzM1x1MDQ0MFx1MDQ0M1x1MDQzN1x1MDQzQVx1MDQ0MyBcdTA0MzggXHUwNDM0XHUwNDNFXHUwNDMyXHUwNDM1XHUwNDM0XHUwNDUxXHUwNDQyIFx1MDQzNFx1MDQzRSBcdTA0NDBcdTA0MzVcdTA0MzdcdTA0NDNcdTA0M0JcdTA0NENcdTA0NDJcdTA0MzBcdTA0NDJcdTA0MzAuIFx1MDQxRlx1MDQzNVx1MDQ0MFx1MDQzMlx1MDQzRVx1MDQzNSBcdTA0MzdcdTA0MzBcdTA0M0RcdTA0NEZcdTA0NDJcdTA0MzhcdTA0MzUgXHUyMDE0IFx1MDQzMVx1MDQzNVx1MDQ0MVx1MDQzRlx1MDQzQlx1MDQzMFx1MDQ0Mlx1MDQzRFx1MDQzRS5cIixcclxuICAgICAgfSxcclxuICAgIF07XHJcbiAgICBjb25zdCBjYXJkcyA9IGl0ZW1zLm1hcCgocykgPT5cclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwic3RlcC1jYXJkIHJldmVhbFwiIH0sXHJcbiAgICAgICAgaChcInNwYW5cIiwgeyBjbGFzczogXCJzdGVwLW51bVwiLCB0ZXh0OiBzLm4gfSksXHJcbiAgICAgICAgaChcImgzXCIsIHsgdGV4dDogcy50aXRsZSB9KSxcclxuICAgICAgICBoKFwicFwiLCB7IGNsYXNzOiBcIm11dGVkXCIsIHRleHQ6IHMudGV4dCB9KSxcclxuICAgICAgKSxcclxuICAgICk7XHJcbiAgICByZXR1cm4gaChcclxuICAgICAgXCJzZWN0aW9uXCIsXHJcbiAgICAgIHsgY2xhc3M6IFwibHMgbHMtYWx0XCIgfSxcclxuICAgICAgdGhpcy5zZWN0aW9uSGVhZChcIlx1MDQxQVx1MDQzMFx1MDQzQSBcdTA0NERcdTA0NDJcdTA0M0UgXHUwNDQwXHUwNDMwXHUwNDMxXHUwNDNFXHUwNDQyXHUwNDMwXHUwNDM1XHUwNDQyXCIsIFwiXHUwNDIyXHUwNDQwXHUwNDM4IFx1MDQ0OFx1MDQzMFx1MDQzM1x1MDQzMCBcdTA0MzRcdTA0M0UgXHUwNDNGXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDNFXHUwNDM5IFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzQVx1MDQzOFwiKSxcclxuICAgICAgaChcImRpdlwiLCB7IGNsYXNzOiBcInN0ZXBzLWdyaWRcIiB9LCAuLi5jYXJkcyksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSB0cmFpbmVycygpOiBIVE1MRWxlbWVudCB7XHJcbiAgICBjb25zdCBjYXJkcyA9IFRSQUlORVJTLm1hcCgodCkgPT5cclxuICAgICAgaChcclxuICAgICAgICBcImFydGljbGVcIixcclxuICAgICAgICB7IGNsYXNzOiBgdHJhaW5lci1jYXJkIHJldmVhbCBrLSR7dC5raW5kfWAgfSxcclxuICAgICAgICByZW1vdGVJbWcodC5waG90bywgdC5uYW1lLCBcInRyYWluZXItcGhvdG9cIiwgKCkgPT4gYXZhdGFyKHQubmFtZSkpLFxyXG4gICAgICAgIGgoXCJoM1wiLCB7IHRleHQ6IHQubmFtZSB9KSxcclxuICAgICAgICBoKFwic3BhblwiLCB7IGNsYXNzOiBcInRyYWluZXItcm9sZVwiLCB0ZXh0OiB0LnJvbGUgfSksXHJcbiAgICAgICAgaChcInNwYW5cIiwgeyBjbGFzczogXCJ0cmFpbmVyLWV4cCBtdXRlZFwiLCB0ZXh0OiB0LmV4cGVyaWVuY2UgfSksXHJcbiAgICAgICAgaChcInBcIiwgeyBjbGFzczogXCJ0cmFpbmVyLXF1b3RlXCIsIHRleHQ6IGBcdTAwQUIke3QucXVvdGV9XHUwMEJCYCB9KSxcclxuICAgICAgKSxcclxuICAgICk7XHJcbiAgICByZXR1cm4gaChcclxuICAgICAgXCJzZWN0aW9uXCIsXHJcbiAgICAgIHsgY2xhc3M6IFwibHNcIiwgYXR0cnM6IHsgaWQ6IFwidHJhaW5lcnNcIiB9IH0sXHJcbiAgICAgIHRoaXMuc2VjdGlvbkhlYWQoXHJcbiAgICAgICAgXCJcdTA0MUFcdTA0M0VcdTA0M0NcdTA0MzBcdTA0M0RcdTA0MzRcdTA0MzBcIixcclxuICAgICAgICBcIlx1MDQyMlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzNVx1MDQ0MFx1MDQ0QiwgXHUwNDNBXHUwNDNFXHUwNDQyXHUwNDNFXHUwNDQwXHUwNDRCXHUwNDM1IFx1MDQzNFx1MDQzRVx1MDQzMlx1MDQzRVx1MDQzNFx1MDQ0Rlx1MDQ0MiBcdTA0MzRcdTA0M0UgXHUwNDQwXHUwNDM1XHUwNDM3XHUwNDQzXHUwNDNCXHUwNDRDXHUwNDQyXHUwNDMwXHUwNDQyXHUwNDMwXCIsXHJcbiAgICAgICAgXCJcdTA0MUFcdTA0MzBcdTA0MzZcdTA0MzRcdTA0NEJcdTA0MzkgXHUyMDE0IFx1MDQ0MVx1MDQzRlx1MDQzNVx1MDQ0Nlx1MDQzOFx1MDQzMFx1MDQzQlx1MDQzOFx1MDQ0MVx1MDQ0MiBcdTA0MzIgXHUwNDQxXHUwNDMyXHUwNDNFXHUwNDUxXHUwNDNDIFx1MDQzRFx1MDQzMFx1MDQzRlx1MDQ0MFx1MDQzMFx1MDQzMlx1MDQzQlx1MDQzNVx1MDQzRFx1MDQzOFx1MDQzOCwgXHUwNDMwIFx1MDQzRFx1MDQzNSBcdTA0NDNcdTA0M0RcdTA0MzhcdTA0MzJcdTA0MzVcdTA0NDBcdTA0NDFcdTA0MzBcdTA0M0IgXHUwMEFCXHUwNDNFXHUwNDMxXHUwNDNFIFx1MDQzMlx1MDQ0MVx1MDQ1MVx1MDQzQ1x1MDBCQi5cIixcclxuICAgICAgKSxcclxuICAgICAgaChcImRpdlwiLCB7IGNsYXNzOiBcInRyYWluZXItZ3JpZFwiIH0sIC4uLmNhcmRzKSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHByaWNpbmcoKTogSFRNTEVsZW1lbnQge1xyXG4gICAgY29uc3QgY2FyZHMgPSBQTEFOUy5tYXAoKHBsYW4pID0+IHRoaXMucHJpY2VDYXJkKHBsYW4pKTtcclxuICAgIHJldHVybiBoKFxyXG4gICAgICBcInNlY3Rpb25cIixcclxuICAgICAgeyBjbGFzczogXCJscyBscy1hbHRcIiwgYXR0cnM6IHsgaWQ6IFwicHJpY2luZ1wiIH0gfSxcclxuICAgICAgdGhpcy5zZWN0aW9uSGVhZChcclxuICAgICAgICBcIlx1MDQxMFx1MDQzMVx1MDQzRVx1MDQzRFx1MDQzNVx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQ0Mlx1MDQ0QlwiLFxyXG4gICAgICAgIFwiXHUwNDI3XHUwNDM1XHUwNDQxXHUwNDQyXHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQ0Nlx1MDQzNVx1MDQzRFx1MDQ0QiBcdTA0MzFcdTA0MzVcdTA0MzcgXHUwNDM3XHUwNDMyXHUwNDUxXHUwNDM3XHUwNDM0XHUwNDNFXHUwNDQ3XHUwNDM1XHUwNDNBXCIsXHJcbiAgICAgICAgXCJcdTA0MUZcdTA0MzVcdTA0NDBcdTA0MzJcdTA0MzBcdTA0NEYgXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDMwIFx1MDQzMVx1MDQzNVx1MDQ0MVx1MDQzRlx1MDQzQlx1MDQzMFx1MDQ0Mlx1MDQzRFx1MDQzRS4gXHUwNDE0XHUwNDMwXHUwNDNCXHUwNDRDXHUwNDQ4XHUwNDM1IFx1MjAxNCBcdTA0MzJcdTA0NEJcdTA0MzFcdTA0MzVcdTA0NDBcdTA0MzggXHUwNDQxXHUwNDMyXHUwNDNFXHUwNDM5IFx1MDQ0NFx1MDQzRVx1MDQ0MFx1MDQzQ1x1MDQzMFx1MDQ0Mi5cIixcclxuICAgICAgKSxcclxuICAgICAgaChcImRpdlwiLCB7IGNsYXNzOiBcInByaWNlLWdyaWRcIiB9LCAuLi5jYXJkcyksXHJcbiAgICAgIGgoXCJwXCIsIHtcclxuICAgICAgICBjbGFzczogXCJwcmljZS1ub3RlIG11dGVkXCIsXHJcbiAgICAgICAgdGV4dDogXCJcdTA0MUVcdTA0M0ZcdTA0M0JcdTA0MzBcdTA0NDJcdTA0MzAgXHUwNDMyIFx1MDQzQVx1MDQzQlx1MDQ0M1x1MDQzMVx1MDQzNSBcdTA0MzhcdTA0M0JcdTA0MzggXHUwNDNFXHUwNDNEXHUwNDNCXHUwNDMwXHUwNDM5XHUwNDNELiBcdTA0MTdcdTA0MzBcdTA0M0NcdTA0M0VcdTA0NDBcdTA0M0VcdTA0MzdcdTA0M0FcdTA0MzAgXHUwNDM4IFx1MDQzRVx1MDQ0Mlx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzMCBcdTIwMTQgXHUwNDMxXHUwNDM1XHUwNDM3IFx1MDQ0OFx1MDQ0Mlx1MDQ0MFx1MDQzMFx1MDQ0NFx1MDQzRVx1MDQzMi5cIixcclxuICAgICAgfSksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBwcmljZUNhcmQocGxhbjogUGxhbik6IEhUTUxFbGVtZW50IHtcclxuICAgIGNvbnN0IGZlYXR1cmVzID0gcGxhbi5mZWF0dXJlcy5tYXAoKGYpID0+XHJcbiAgICAgIGgoXCJsaVwiLCB7fSwgaWNvbihcImNoZWNrXCIsIDE2KSwgaChcInNwYW5cIiwgeyB0ZXh0OiBmIH0pKSxcclxuICAgICk7XHJcbiAgICByZXR1cm4gaChcclxuICAgICAgXCJhcnRpY2xlXCIsXHJcbiAgICAgIHsgY2xhc3M6IGBwcmljZS1jYXJkIHJldmVhbCR7cGxhbi5wb3B1bGFyID8gXCIgcG9wdWxhclwiIDogXCJcIn1gIH0sXHJcbiAgICAgIHBsYW4uYmFkZ2UgPyBoKFwic3BhblwiLCB7IGNsYXNzOiBcInByaWNlLWJhZGdlXCIsIHRleHQ6IHBsYW4uYmFkZ2UgfSkgOiBudWxsLFxyXG4gICAgICBoKFwiaDNcIiwgeyB0ZXh0OiBwbGFuLm5hbWUgfSksXHJcbiAgICAgIGgoXCJwXCIsIHsgY2xhc3M6IFwibXV0ZWQgcHJpY2UtdGFnbGluZVwiLCB0ZXh0OiBwbGFuLnRhZ2xpbmUgfSksXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJkaXZcIixcclxuICAgICAgICB7IGNsYXNzOiBcInByaWNlLXZhbHVlXCIgfSxcclxuICAgICAgICBoKFwic3Ryb25nXCIsIHsgdGV4dDogZm9ybWF0UHJpY2UocGxhbi5wcmljZSkgfSksXHJcbiAgICAgICAgaChcInNwYW5cIiwgeyBjbGFzczogXCJtdXRlZFwiLCB0ZXh0OiBwbGFuLnBlcmlvZCB9KSxcclxuICAgICAgKSxcclxuICAgICAgaChcInVsXCIsIHsgY2xhc3M6IFwiZmVhdHVyZS1saXN0XCIgfSwgLi4uZmVhdHVyZXMpLFxyXG4gICAgICBidXR0b24oe1xyXG4gICAgICAgIGxhYmVsOiBwbGFuLnBvcHVsYXIgPyBcIlx1MDQxMlx1MDQ0Qlx1MDQzMVx1MDQ0MFx1MDQzMFx1MDQ0Mlx1MDQ0QyBcdTA0MzFcdTA0MzVcdTA0MzdcdTA0M0JcdTA0MzhcdTA0M0NcdTA0MzhcdTA0NDJcIiA6IFwiXHUwNDEyXHUwNDRCXHUwNDMxXHUwNDQwXHUwNDMwXHUwNDQyXHUwNDRDXCIsXHJcbiAgICAgICAgdG9uZTogcGxhbi5wb3B1bGFyID8gXCJwcmltYXJ5XCIgOiBcImdob3N0XCIsXHJcbiAgICAgICAgd2lkZTogdHJ1ZSxcclxuICAgICAgICBvbkNsaWNrOiAoKSA9PiB0aGlzLm9uUGxhbihwbGFuKSxcclxuICAgICAgfSksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvblBsYW4ocGxhbjogUGxhbik6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmN0eC5hdXRoLmN1cnJlbnRVc2VyKCkpIHtcclxuICAgICAgcmVxdWVzdEF1dGhUYWIoXCJyZWdpc3RlclwiKTtcclxuICAgICAgdGhpcy5jdHgubmF2aWdhdGUoXCJhdXRoXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICB0aGlzLm9wZW5DaGVja291dChwbGFuKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgb3BlbkNoZWNrb3V0KHBsYW46IFBsYW4pOiB2b2lkIHtcclxuICAgIGNvbnN0IG1ldGhvZCA9IChcclxuICAgICAgdmFsdWU6IHN0cmluZyxcclxuICAgICAgbGFiZWw6IHN0cmluZyxcclxuICAgICAgY2hlY2tlZDogYm9vbGVhbixcclxuICAgICk6IEhUTUxFbGVtZW50ID0+XHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJsYWJlbFwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwicGF5LW9wdFwiIH0sXHJcbiAgICAgICAgaChcImlucHV0XCIsIHsgYXR0cnM6IHsgdHlwZTogXCJyYWRpb1wiLCBuYW1lOiBcInBheVwiLCB2YWx1ZSB9LCBjaGVja2VkIH0pLFxyXG4gICAgICAgIGgoXCJzcGFuXCIsIHsgdGV4dDogbGFiZWwgfSksXHJcbiAgICAgICk7XHJcbiAgICBjb25zdCBmb3JtID0gaChcclxuICAgICAgXCJmb3JtXCIsXHJcbiAgICAgIHtcclxuICAgICAgICBvbjoge1xyXG4gICAgICAgICAgc3VibWl0OiAoZSkgPT4ge1xyXG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICAgIGNsb3NlKCk7XHJcbiAgICAgICAgICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KFxyXG4gICAgICAgICAgICAgIGBcdTA0MTdcdTA0MzBcdTA0NEZcdTA0MzJcdTA0M0FcdTA0MzAgXHUwNDNEXHUwNDMwIFx1MDBBQiR7cGxhbi5uYW1lfVx1MDBCQiBcdTA0M0ZcdTA0NDBcdTA0MzhcdTA0M0RcdTA0NEZcdTA0NDJcdTA0MzAgXHUyMDE0IFx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzNVx1MDQzNFx1MDQzNlx1MDQzNVx1MDQ0MCBcdTA0NDFcdTA0MzJcdTA0NEZcdTA0MzZcdTA0MzVcdTA0NDJcdTA0NDFcdTA0NEYgXHUwNDQxIFx1MDQ0Mlx1MDQzRVx1MDQzMVx1MDQzRVx1MDQzOWAsXHJcbiAgICAgICAgICAgICAgXCJva1wiLFxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgICBoKFwiaDNcIiwgeyB0ZXh0OiBcIlx1MDQxRVx1MDQ0NFx1MDQzRVx1MDQ0MFx1MDQzQ1x1MDQzQlx1MDQzNVx1MDQzRFx1MDQzOFx1MDQzNSBcdTA0MzBcdTA0MzFcdTA0M0VcdTA0M0RcdTA0MzVcdTA0M0NcdTA0MzVcdTA0M0RcdTA0NDJcdTA0MzBcIiB9KSxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwicGxhbi1zdW1tYXJ5XCIgfSxcclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJkaXZcIixcclxuICAgICAgICAgIHt9LFxyXG4gICAgICAgICAgaChcInN0cm9uZ1wiLCB7IHRleHQ6IHBsYW4ubmFtZSB9KSxcclxuICAgICAgICAgIGgoXCJzcGFuXCIsIHsgY2xhc3M6IFwibXV0ZWRcIiwgdGV4dDogcGxhbi5wZXJpb2QgfSksXHJcbiAgICAgICAgKSxcclxuICAgICAgICBoKFwic3Ryb25nXCIsIHsgY2xhc3M6IFwicGxhbi1wcmljZVwiLCB0ZXh0OiBmb3JtYXRQcmljZShwbGFuLnByaWNlKSB9KSxcclxuICAgICAgKSxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwicGF5LW1ldGhvZHNcIiB9LFxyXG4gICAgICAgIG1ldGhvZChcImthc3BpXCIsIFwiS2FzcGkgUVJcIiwgdHJ1ZSksXHJcbiAgICAgICAgbWV0aG9kKFwiY2FyZFwiLCBcIlx1MDQxMVx1MDQzMFx1MDQzRFx1MDQzQVx1MDQzRVx1MDQzMlx1MDQ0MVx1MDQzQVx1MDQzMFx1MDQ0RiBcdTA0M0FcdTA0MzBcdTA0NDBcdTA0NDJcdTA0MzBcIiwgZmFsc2UpLFxyXG4gICAgICApLFxyXG4gICAgICBoKFwicFwiLCB7XHJcbiAgICAgICAgY2xhc3M6IFwiZGVtby1ub3RlXCIsXHJcbiAgICAgICAgdGV4dDogXCJcdTA0MTRcdTA0MzVcdTA0M0NcdTA0M0UtXHUwNDQwXHUwNDM1XHUwNDM2XHUwNDM4XHUwNDNDOiBcdTA0M0VcdTA0M0RcdTA0M0JcdTA0MzBcdTA0MzlcdTA0M0QtXHUwNDNFXHUwNDNGXHUwNDNCXHUwNDMwXHUwNDQyXHUwNDMwIFx1MDQzRFx1MDQzNSBcdTA0M0ZcdTA0M0VcdTA0MzRcdTA0M0FcdTA0M0JcdTA0NEVcdTA0NDdcdTA0MzVcdTA0M0RcdTA0MzAuIFx1MDQxN1x1MDQzMFx1MDQ0Rlx1MDQzMlx1MDQzQVx1MDQzMCBcdTA0M0RcdTA0MzggXHUwNDNBIFx1MDQ0N1x1MDQzNVx1MDQzQ1x1MDQ0MyBcdTA0M0RcdTA0MzUgXHUwNDNFXHUwNDMxXHUwNDRGXHUwNDM3XHUwNDRCXHUwNDMyXHUwNDMwXHUwNDM1XHUwNDQyLlwiLFxyXG4gICAgICB9KSxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwibW9kYWwtYWN0aW9uc1wiIH0sXHJcbiAgICAgICAgYnV0dG9uKHsgbGFiZWw6IFwiXHUwNDFFXHUwNDQyXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDMwXCIsIHRvbmU6IFwiZ2hvc3RcIiwgb25DbGljazogKCkgPT4gY2xvc2UoKSB9KSxcclxuICAgICAgICBidXR0b24oeyBsYWJlbDogXCJcdTA0MUVcdTA0NDFcdTA0NDJcdTA0MzBcdTA0MzJcdTA0MzhcdTA0NDJcdTA0NEMgXHUwNDM3XHUwNDMwXHUwNDRGXHUwNDMyXHUwNDNBXHUwNDQzXCIsIHR5cGU6IFwic3VibWl0XCIgfSksXHJcbiAgICAgICksXHJcbiAgICApO1xyXG4gICAgY29uc3QgY2xvc2UgPSB0aGlzLmN0eC5vdmVybGF5cy5vcGVuKGZvcm0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZXZpZXdzKCk6IEhUTUxFbGVtZW50IHtcclxuICAgIGNvbnN0IGNhcmRzID0gUkVWSUVXUy5tYXAoKHIpID0+XHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJhcnRpY2xlXCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJyZXZpZXctY2FyZCByZXZlYWxcIiB9LFxyXG4gICAgICAgIGgoXCJzcGFuXCIsIHtcclxuICAgICAgICAgIGNsYXNzOiBcInN0YXJzXCIsXHJcbiAgICAgICAgICB0ZXh0OiBcIlx1MjYwNVwiLnJlcGVhdChyLnN0YXJzKSxcclxuICAgICAgICAgIGF0dHJzOiB7IFwiYXJpYS1sYWJlbFwiOiBgXHUwNDFFXHUwNDQ2XHUwNDM1XHUwNDNEXHUwNDNBXHUwNDMwICR7ci5zdGFyc30gXHUwNDM4XHUwNDM3IDVgIH0sXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgaChcInBcIiwgeyB0ZXh0OiBgXHUwMEFCJHtyLnRleHR9XHUwMEJCYCB9KSxcclxuICAgICAgICBoKFwic3Ryb25nXCIsIHsgdGV4dDogci5uYW1lIH0pLFxyXG4gICAgICApLFxyXG4gICAgKTtcclxuICAgIHJldHVybiBoKFxyXG4gICAgICBcInNlY3Rpb25cIixcclxuICAgICAgeyBjbGFzczogXCJsc1wiIH0sXHJcbiAgICAgIHRoaXMuc2VjdGlvbkhlYWQoXHJcbiAgICAgICAgXCJcdTA0MUVcdTA0NDJcdTA0MzdcdTA0NEJcdTA0MzJcdTA0NEJcIixcclxuICAgICAgICBcIlx1MDQyN1x1MDQ0Mlx1MDQzRSBcdTA0MzNcdTA0M0VcdTA0MzJcdTA0M0VcdTA0NDBcdTA0NEZcdTA0NDIgXHUwNDQzXHUwNDQ3XHUwNDMwXHUwNDQxXHUwNDQyXHUwNDNEXHUwNDM4XHUwNDNBXHUwNDM4XCIsXHJcbiAgICAgICAgXCJcdTA0MTRcdTA0MzVcdTA0M0NcdTA0M0VcdTA0M0RcdTA0NDFcdTA0NDJcdTA0NDBcdTA0MzBcdTA0NDZcdTA0MzhcdTA0M0VcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDNFXHUwNDQyXHUwNDM3XHUwNDRCXHUwNDMyXHUwNDRCIFx1MDQ0M1x1MDQ0N1x1MDQzNVx1MDQzMVx1MDQzRFx1MDQzRVx1MDQzM1x1MDQzRSBcdTA0M0ZcdTA0NDBcdTA0M0VcdTA0MzVcdTA0M0FcdTA0NDJcdTA0MzAuXCIsXHJcbiAgICAgICksXHJcbiAgICAgIGgoXCJkaXZcIiwgeyBjbGFzczogXCJyZXZpZXctZ3JpZFwiIH0sIC4uLmNhcmRzKSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGZhcSgpOiBIVE1MRWxlbWVudCB7XHJcbiAgICBjb25zdCBpdGVtcyA9IEZBUS5tYXAoKGl0ZW0pID0+XHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJkZXRhaWxzXCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJmYXEtaXRlbSByZXZlYWxcIiB9LFxyXG4gICAgICAgIGgoXHJcbiAgICAgICAgICBcInN1bW1hcnlcIixcclxuICAgICAgICAgIHt9LFxyXG4gICAgICAgICAgaChcInNwYW5cIiwgeyB0ZXh0OiBpdGVtLnEgfSksXHJcbiAgICAgICAgICBoKFwic3BhblwiLCB7XHJcbiAgICAgICAgICAgIGNsYXNzOiBcImZhcS1tYXJrXCIsXHJcbiAgICAgICAgICAgIGF0dHJzOiB7IFwiYXJpYS1oaWRkZW5cIjogXCJ0cnVlXCIgfSxcclxuICAgICAgICAgICAgdGV4dDogXCIrXCIsXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICApLFxyXG4gICAgICAgIGgoXCJwXCIsIHsgY2xhc3M6IFwibXV0ZWRcIiwgdGV4dDogaXRlbS5hIH0pLFxyXG4gICAgICApLFxyXG4gICAgKTtcclxuICAgIHJldHVybiBoKFxyXG4gICAgICBcInNlY3Rpb25cIixcclxuICAgICAgeyBjbGFzczogXCJscyBscy1hbHRcIiB9LFxyXG4gICAgICB0aGlzLnNlY3Rpb25IZWFkKFwiXHUwNDEyXHUwNDNFXHUwNDNGXHUwNDQwXHUwNDNFXHUwNDQxXHUwNDRCXCIsIFwiXHUwNDI3XHUwNDMwXHUwNDQxXHUwNDQyXHUwNDRCXHUwNDM1IFx1MDQzMlx1MDQzRVx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQ0MVx1MDQ0QlwiKSxcclxuICAgICAgaChcImRpdlwiLCB7IGNsYXNzOiBcImZhcS1saXN0XCIgfSwgLi4uaXRlbXMpLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3RhQmFuZCgpOiBIVE1MRWxlbWVudCB7XHJcbiAgICByZXR1cm4gaChcclxuICAgICAgXCJzZWN0aW9uXCIsXHJcbiAgICAgIHsgY2xhc3M6IFwiY3RhLWJhbmQgcmV2ZWFsXCIgfSxcclxuICAgICAgaChcImgyXCIsIHsgdGV4dDogXCJcdTA0MUZcdTA0MzVcdTA0NDBcdTA0MzJcdTA0MzBcdTA0NEYgXHUwNDQyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDMwIFx1MjAxNCBcdTA0MzdcdTA0MzAgXHUwNDNEXHUwNDMwXHUwNDQ4IFx1MDQ0MVx1MDQ0N1x1MDQ1MVx1MDQ0MlwiIH0pLFxyXG4gICAgICBoKFwicFwiLCB7XHJcbiAgICAgICAgdGV4dDogXCJcdTA0MTJcdTA0NEJcdTA0MzFcdTA0MzVcdTA0NDBcdTA0MzggXHUwNDNEXHUwNDMwXHUwNDNGXHUwNDQwXHUwNDMwXHUwNDMyXHUwNDNCXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM1LCBcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDhcdTA0MzhcdTA0NDFcdTA0NEMgXHUwNDNFXHUwNDNEXHUwNDNCXHUwNDMwXHUwNDM5XHUwNDNEIFx1MDQzOCBcdTA0M0ZcdTA0NDBcdTA0MzhcdTA0NDVcdTA0M0VcdTA0MzRcdTA0MzguIFx1MDQxMVx1MDQzNVx1MDQzNyBcdTA0M0VcdTA0MzFcdTA0NEZcdTA0MzdcdTA0MzBcdTA0NDJcdTA0MzVcdTA0M0JcdTA0NENcdTA0NDFcdTA0NDJcdTA0MzIuXCIsXHJcbiAgICAgIH0pLFxyXG4gICAgICBidXR0b24oeyBsYWJlbDogXCJcdTA0MTdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzBcdTA0NDJcdTA0NENcdTA0NDFcdTA0NEYgXHUwNDMxXHUwNDM1XHUwNDQxXHUwNDNGXHUwNDNCXHUwNDMwXHUwNDQyXHUwNDNEXHUwNDNFXCIsIG9uQ2xpY2s6ICgpID0+IHRoaXMuZ28oKSB9KSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGZvb3RlcigpOiBIVE1MRWxlbWVudCB7XHJcbiAgICByZXR1cm4gaChcclxuICAgICAgXCJmb290ZXJcIixcclxuICAgICAgeyBjbGFzczogXCJsYW5kaW5nLWZvb3RcIiB9LFxyXG4gICAgICBoKFxyXG4gICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJsZi1pbm5lclwiIH0sXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcImxmLWJyYW5kXCIgfSxcclxuICAgICAgICAgIGgoXCJzcGFuXCIsIHsgY2xhc3M6IFwibG9nby1tYXJrXCIgfSwgaWNvbihcImR1bWJiZWxsXCIsIDIyKSksXHJcbiAgICAgICAgICBoKFxyXG4gICAgICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgICAgICB7fSxcclxuICAgICAgICAgICAgaChcInN0cm9uZ1wiLCB7IHRleHQ6IFwiXHUwNDEwXHUwNDIyXHUwNDFCXHUwNDE1XHUwNDIyXCIgfSksXHJcbiAgICAgICAgICAgIGgoXCJzcGFuXCIsIHsgY2xhc3M6IFwibXV0ZWRcIiwgdGV4dDogXCJcdTA0NDFcdTA0M0ZcdTA0M0VcdTA0NDBcdTA0NDJcdTA0MzhcdTA0MzJcdTA0M0RcdTA0NEJcdTA0MzkgXHUwNDQ2XHUwNDM1XHUwNDNEXHUwNDQyXHUwNDQwXCIgfSksXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgICksXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcImxmLWNvbFwiIH0sXHJcbiAgICAgICAgICBoKFwic3Ryb25nXCIsIHsgdGV4dDogXCJcdTA0MUFcdTA0M0VcdTA0M0RcdTA0NDJcdTA0MzBcdTA0M0FcdTA0NDJcdTA0NEJcIiB9KSxcclxuICAgICAgICAgIGgoXCJzcGFuXCIsIHsgdGV4dDogYCR7Q0xVQl9JTkZPLmNpdHl9LCAke0NMVUJfSU5GTy5hZGRyZXNzfWAgfSksXHJcbiAgICAgICAgICBoKFwiYVwiLCB7XHJcbiAgICAgICAgICAgIGF0dHJzOiB7IGhyZWY6IGB0ZWw6JHtDTFVCX0lORk8ucGhvbmUucmVwbGFjZSgvW15cXGQrXS9nLCBcIlwiKX1gIH0sXHJcbiAgICAgICAgICAgIHRleHQ6IENMVUJfSU5GTy5waG9uZSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICksXHJcbiAgICAgICAgaChcclxuICAgICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgICB7IGNsYXNzOiBcImxmLWNvbFwiIH0sXHJcbiAgICAgICAgICBoKFwic3Ryb25nXCIsIHsgdGV4dDogXCJcdTA0MjBcdTA0MzVcdTA0MzZcdTA0MzhcdTA0M0MgXHUwNDQwXHUwNDMwXHUwNDMxXHUwNDNFXHUwNDQyXHUwNDRCXCIgfSksXHJcbiAgICAgICAgICBoKFwic3BhblwiLCB7IHRleHQ6IENMVUJfSU5GTy5ob3VycyB9KSxcclxuICAgICAgICAgIGgoXCJzcGFuXCIsIHsgY2xhc3M6IFwibXV0ZWRcIiwgdGV4dDogXCJcdTA0MjNcdTA0NDdcdTA0MzVcdTA0MzFcdTA0M0RcdTA0NEJcdTA0MzkgXHUwNDNGXHUwNDQwXHUwNDNFXHUwNDM1XHUwNDNBXHUwNDQyIFx1MDBCNyBcdTA0MzRcdTA0MzVcdTA0M0NcdTA0M0UtXHUwNDM0XHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1XCIgfSksXHJcbiAgICAgICAgKSxcclxuICAgICAgKSxcclxuICAgICk7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQge1xyXG4gIGJvb2tpbmdPZixcclxuICBmaWx0ZXJTZXNzaW9ucyxcclxuICBpc0ZpbmlzaGVkLFxyXG4gIHNlYXRzTGVmdCxcclxuICBzZWF0c1Rha2VuLFxyXG4gIHNvcnRTZXNzaW9ucyxcclxufSBmcm9tIFwiLi4vY29yZS9ydWxlc1wiO1xyXG5pbXBvcnQge1xyXG4gIERFRkFVTFRfRklMVEVSUyxcclxuICBXT1JLT1VUX0tJTkRTLFxyXG4gIHR5cGUgU2NoZWR1bGVGaWx0ZXJzLFxyXG4gIHR5cGUgVGltZU9mRGF5LFxyXG4gIHR5cGUgV29ya291dFNlc3Npb24sXHJcbn0gZnJvbSBcIi4uL2NvcmUvdHlwZXNcIjtcclxuaW1wb3J0IHR5cGUgeyBBcHBDb250ZXh0IH0gZnJvbSBcIi4uL2FwcC9jb250ZXh0XCI7XHJcbmltcG9ydCB0eXBlIHsgRmlsdGVyUHJlc2V0IH0gZnJvbSBcIi4uL2FwcC9zYXZlZC12aWV3c1wiO1xyXG5pbXBvcnQgeyBoLCByZXBsYWNlIH0gZnJvbSBcIi4uL3VpL2RvbVwiO1xyXG5pbXBvcnQge1xyXG4gIGRheUxhYmVsLFxyXG4gIGZtdEVuZFRpbWUsXHJcbiAgZm10RnVsbCxcclxuICBmbXRUaW1lLFxyXG4gIEtJTkRfTEFCRUwsXHJcbiAgcGx1cmFsLFxyXG4gIHJlbGF0aXZlRGF5LFxyXG59IGZyb20gXCIuLi91aS9mb3JtYXRcIjtcclxuaW1wb3J0IHsgaWNvbiB9IGZyb20gXCIuLi91aS9pY29uc1wiO1xyXG5pbXBvcnQgeyBlcnJvck1lc3NhZ2UgfSBmcm9tIFwiLi4vdWkvbWVzc2FnZXNcIjtcclxuaW1wb3J0IHsgQmFzZVZpZXcgfSBmcm9tIFwiLi92aWV3XCI7XHJcbmltcG9ydCB7XHJcbiAgYnV0dG9uLFxyXG4gIGNoaXAsXHJcbiAgY292ZXJJbWcsXHJcbiAgZW1wdHlTdGF0ZSxcclxuICBmaWVsZCxcclxuICBpY29uQnV0dG9uLFxyXG4gIGludGVuc2l0eUNoaXAsXHJcbiAga2luZEJhZGdlLFxyXG4gIG1pbmlBdmF0YXIsXHJcbiAgb2NjdXBhbmN5QmFyLFxyXG4gIHRleHRJbnB1dCxcclxufSBmcm9tIFwiLi4vdWkvY29udHJvbHNcIjtcclxuY29uc3QgVElNRV9PUFRJT05TOiB7IHZhbHVlOiBUaW1lT2ZEYXkgfCBcImFsbFwiOyBsYWJlbDogc3RyaW5nIH1bXSA9IFtcclxuICB7IHZhbHVlOiBcImFsbFwiLCBsYWJlbDogXCJcdTA0MUJcdTA0NEVcdTA0MzFcdTA0M0VcdTA0MzUgXHUwNDMyXHUwNDQwXHUwNDM1XHUwNDNDXHUwNDRGXCIgfSxcclxuICB7IHZhbHVlOiBcIm1vcm5pbmdcIiwgbGFiZWw6IFwiXHUwNDIzXHUwNDQyXHUwNDQwXHUwNDNFXCIgfSxcclxuICB7IHZhbHVlOiBcImRheVwiLCBsYWJlbDogXCJcdTA0MTRcdTA0MzVcdTA0M0RcdTA0NENcIiB9LFxyXG4gIHsgdmFsdWU6IFwiZXZlbmluZ1wiLCBsYWJlbDogXCJcdTA0MTJcdTA0MzVcdTA0NDdcdTA0MzVcdTA0NDBcIiB9LFxyXG5dO1xyXG5cclxuZXhwb3J0IGNsYXNzIFNjaGVkdWxlVmlldyBleHRlbmRzIEJhc2VWaWV3IHtcclxuICBwcml2YXRlIGZpbHRlcnM6IFNjaGVkdWxlRmlsdGVycyA9IHsgLi4uREVGQVVMVF9GSUxURVJTIH07XHJcbiAgcHJpdmF0ZSBkYXlzRWwhOiBIVE1MRWxlbWVudDtcclxuICBwcml2YXRlIGNoaXBzRWwhOiBIVE1MRWxlbWVudDtcclxuICBwcml2YXRlIHByZXNldHNFbCE6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgY291bnRFbCE6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgbGlzdEVsITogSFRNTEVsZW1lbnQ7XHJcbiAgcHJpdmF0ZSBuZXh0RWwhOiBIVE1MRWxlbWVudDtcclxuICBwcml2YXRlIHNlYXJjaElucHV0ITogSFRNTElucHV0RWxlbWVudDtcclxuICBwcml2YXRlIHNvcnRTZWxlY3QhOiBIVE1MU2VsZWN0RWxlbWVudDtcclxuICBwcml2YXRlIGRyYXdlckNvbnRlbnQ6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBkcmF3ZXJTZXNzaW9uSWQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgY2xvc2VEcmF3ZXI6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgc2VhcmNoVGltZXIgPSAwO1xyXG5cclxuICBjb25zdHJ1Y3RvcihjdHg6IEFwcENvbnRleHQpIHtcclxuICAgIHN1cGVyKGN0eCk7XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgaW5pdCgpOiB2b2lkIHtcclxuICAgIHRoaXMud2F0Y2goXCJzZXNzaW9uc1wiLCAoKSA9PiB7XHJcbiAgICAgIHRoaXMucmVuZGVyTGlzdCgpO1xyXG4gICAgICB0aGlzLnJlbmRlck5leHQoKTtcclxuICAgICAgdGhpcy5yZWZyZXNoRHJhd2VyKCk7XHJcbiAgICB9KTtcclxuICAgIHRoaXMud2F0Y2goXCJib29raW5nc1wiLCAoKSA9PiB7XHJcbiAgICAgIHRoaXMucmVuZGVyTGlzdCgpO1xyXG4gICAgICB0aGlzLnJlbmRlck5leHQoKTtcclxuICAgICAgdGhpcy5yZWZyZXNoRHJhd2VyKCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByb3RlY3RlZCBvbkRlc3Ryb3koKTogdm9pZCB7XHJcbiAgICB3aW5kb3cuY2xlYXJUaW1lb3V0KHRoaXMuc2VhcmNoVGltZXIpO1xyXG4gICAgdGhpcy5jbG9zZURyYXdlcj8uKCk7XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgcmVuZGVyKCk6IHZvaWQge1xyXG4gICAgdGhpcy5kYXlzRWwgPSBoKFwiZGl2XCIsIHtcclxuICAgICAgY2xhc3M6IFwiZGF5c1wiLFxyXG4gICAgICBhdHRyczogeyByb2xlOiBcInRhYmxpc3RcIiwgXCJhcmlhLWxhYmVsXCI6IFwiXHUwNDE0XHUwNDNEXHUwNDM4IFx1MDQzRFx1MDQzNVx1MDQzNFx1MDQzNVx1MDQzQlx1MDQzOFwiIH0sXHJcbiAgICB9KTtcclxuICAgIHRoaXMuY2hpcHNFbCA9IGgoXCJkaXZcIiwgeyBjbGFzczogXCJjaGlwc1wiIH0pO1xyXG4gICAgdGhpcy5wcmVzZXRzRWwgPSBoKFwiZGl2XCIsIHsgY2xhc3M6IFwicHJlc2V0c1wiIH0pO1xyXG4gICAgdGhpcy5jb3VudEVsID0gaChcInBcIiwgeyBjbGFzczogXCJtdXRlZCByZXN1bHQtY291bnRcIiB9KTtcclxuICAgIHRoaXMubGlzdEVsID0gaChcImRpdlwiLCB7IGNsYXNzOiBcInNlc3Npb24tbGlzdFwiIH0pO1xyXG4gICAgdGhpcy5uZXh0RWwgPSBoKFwiZGl2XCIsIHsgY2xhc3M6IFwibmV4dC1zbG90XCIgfSk7XHJcblxyXG4gICAgdGhpcy5zZWFyY2hJbnB1dCA9IGgoXCJpbnB1dFwiLCB7XHJcbiAgICAgIGNsYXNzOiBcInNlYXJjaC1pbnB1dFwiLFxyXG4gICAgICBhdHRyczoge1xyXG4gICAgICAgIHR5cGU6IFwic2VhcmNoXCIsXHJcbiAgICAgICAgcGxhY2Vob2xkZXI6IFwiXHUwNDIyXHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDMwLCBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzVcdTA0NDAgXHUwNDM4XHUwNDNCXHUwNDM4IFx1MDQzN1x1MDQzMFx1MDQzQlx1MjAyNlwiLFxyXG4gICAgICAgIFwiYXJpYS1sYWJlbFwiOiBcIlx1MDQxRlx1MDQzRVx1MDQzOFx1MDQ0MVx1MDQzQVwiLFxyXG4gICAgICAgIGF1dG9jb21wbGV0ZTogXCJvZmZcIixcclxuICAgICAgfSxcclxuICAgICAgdmFsdWU6IHRoaXMuZmlsdGVycy5xdWVyeSxcclxuICAgICAgb246IHtcclxuICAgICAgICBpbnB1dDogKCkgPT4ge1xyXG4gICAgICAgICAgd2luZG93LmNsZWFyVGltZW91dCh0aGlzLnNlYXJjaFRpbWVyKTtcclxuICAgICAgICAgIHRoaXMuc2VhcmNoVGltZXIgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMuZmlsdGVycy5xdWVyeSA9IHRoaXMuc2VhcmNoSW5wdXQudmFsdWU7XHJcbiAgICAgICAgICAgIHRoaXMucmVuZGVyTGlzdCgpO1xyXG4gICAgICAgICAgfSwgMTUwKTtcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLnNvcnRTZWxlY3QgPSBoKFxyXG4gICAgICBcInNlbGVjdFwiLFxyXG4gICAgICB7XHJcbiAgICAgICAgY2xhc3M6IFwiaW5wdXQgc2VsZWN0IHNvcnQtc2VsZWN0XCIsXHJcbiAgICAgICAgYXR0cnM6IHsgXCJhcmlhLWxhYmVsXCI6IFwiXHUwNDIxXHUwNDNFXHUwNDQwXHUwNDQyXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDNBXHUwNDMwXCIgfSxcclxuICAgICAgICB2YWx1ZTogdGhpcy5maWx0ZXJzLnNvcnQsXHJcbiAgICAgICAgb246IHtcclxuICAgICAgICAgIGNoYW5nZTogKCkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLmZpbHRlcnMuc29ydCA9XHJcbiAgICAgICAgICAgICAgdGhpcy5zb3J0U2VsZWN0LnZhbHVlID09PSBcInNlYXRzXCIgPyBcInNlYXRzXCIgOiBcInRpbWVcIjtcclxuICAgICAgICAgICAgdGhpcy5yZW5kZXJMaXN0KCk7XHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICAgIGgoXCJvcHRpb25cIiwgeyBhdHRyczogeyB2YWx1ZTogXCJ0aW1lXCIgfSwgdGV4dDogXCJcdTA0MjFcdTA0M0RcdTA0MzBcdTA0NDdcdTA0MzBcdTA0M0JcdTA0MzAgXHUwNDQwXHUwNDMwXHUwNDNEXHUwNDNEXHUwNDM4XHUwNDM1XCIgfSksXHJcbiAgICAgIGgoXCJvcHRpb25cIiwgeyBhdHRyczogeyB2YWx1ZTogXCJzZWF0c1wiIH0sIHRleHQ6IFwiXHUwNDExXHUwNDNFXHUwNDNCXHUwNDRDXHUwNDQ4XHUwNDM1IFx1MDQ0MVx1MDQzMlx1MDQzRVx1MDQzMVx1MDQzRVx1MDQzNFx1MDQzRFx1MDQ0Qlx1MDQ0NSBcdTA0M0NcdTA0MzVcdTA0NDFcdTA0NDJcIiB9KSxcclxuICAgICk7XHJcblxyXG4gICAgcmVwbGFjZShcclxuICAgICAgdGhpcy5yb290LFxyXG4gICAgICB0aGlzLmhlcm8oKSxcclxuICAgICAgdGhpcy5uZXh0RWwsXHJcbiAgICAgIHRoaXMuZGF5c0VsLFxyXG4gICAgICBoKFxyXG4gICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJ0b29sYmFyXCIgfSxcclxuICAgICAgICBoKFwibGFiZWxcIiwgeyBjbGFzczogXCJzZWFyY2hcIiB9LCBpY29uKFwic2VhcmNoXCIsIDE4KSwgdGhpcy5zZWFyY2hJbnB1dCksXHJcbiAgICAgICAgdGhpcy5zb3J0U2VsZWN0LFxyXG4gICAgICApLFxyXG4gICAgICB0aGlzLmNoaXBzRWwsXHJcbiAgICAgIHRoaXMucHJlc2V0c0VsLFxyXG4gICAgICB0aGlzLmNvdW50RWwsXHJcbiAgICAgIHRoaXMubGlzdEVsLFxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLnJlbmRlckRheXMoKTtcclxuICAgIHRoaXMucmVuZGVyQ2hpcHMoKTtcclxuICAgIHRoaXMucmVuZGVyUHJlc2V0cygpO1xyXG4gICAgdGhpcy5yZW5kZXJMaXN0KCk7XHJcbiAgICB0aGlzLnJlbmRlck5leHQoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgaGVybygpOiBIVE1MRWxlbWVudCB7XHJcbiAgICBjb25zdCB1c2VyID0gdGhpcy5jdHguYXV0aC5jdXJyZW50VXNlcigpO1xyXG4gICAgY29uc3QgZmlyc3QgPSB1c2VyPy5uYW1lLnNwbGl0KFwiIFwiKVswXSA/PyBcIlwiO1xyXG4gICAgcmV0dXJuIGgoXHJcbiAgICAgIFwic2VjdGlvblwiLFxyXG4gICAgICB7IGNsYXNzOiBcImhlcm8tZml0XCIgfSxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwiaGVyby1jb3B5XCIgfSxcclxuICAgICAgICBoKFwic3BhblwiLCB7IGNsYXNzOiBcImhlcm8ta2lja2VyXCIsIHRleHQ6IFwiXHUwNDIwXHUwNDMwXHUwNDQxXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDM1XCIgfSksXHJcbiAgICAgICAgaChcImgxXCIsIHtcclxuICAgICAgICAgIGNsYXNzOiBcImhlcm8tdGl0bGVcIixcclxuICAgICAgICAgIHRleHQ6IGZpcnN0ID8gYFx1MDQxRlx1MDQ0MFx1MDQzOFx1MDQzMlx1MDQzNVx1MDQ0MiwgJHtmaXJzdH1gIDogXCJcdTA0MjJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0NDNcdTA0MzlcdTA0NDFcdTA0NEYgXHUwNDMyIFx1MDQ0MVx1MDQzMlx1MDQzRVx1MDQ1MVx1MDQzQyBcdTA0NDBcdTA0MzhcdTA0NDJcdTA0M0NcdTA0MzVcIixcclxuICAgICAgICB9KSxcclxuICAgICAgICBoKFwicFwiLCB7XHJcbiAgICAgICAgICBjbGFzczogXCJoZXJvLXN1YlwiLFxyXG4gICAgICAgICAgdGV4dDogXCJcdTA0MTJcdTA0NEJcdTA0MzFcdTA0MzVcdTA0NDBcdTA0MzggXHUwNDM0XHUwNDM1XHUwNDNEXHUwNDRDIFx1MDQzOCBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0NDMgXHUyMDE0IFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQ0QyBcdTA0MzdcdTA0MzBcdTA0MzlcdTA0M0NcdTA0NTFcdTA0NDIgXHUwNDNGXHUwNDMwXHUwNDQwXHUwNDQzIFx1MDQ0MVx1MDQzNVx1MDQzQVx1MDQ0M1x1MDQzRFx1MDQzNC5cIixcclxuICAgICAgICB9KSxcclxuICAgICAgKSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJlbmRlck5leHQoKTogdm9pZCB7XHJcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xyXG4gICAgY29uc3QgdXBjb21pbmcgPSB0aGlzLmN0eC5ib29raW5nXHJcbiAgICAgIC5vZkN1cnJlbnRVc2VyKClcclxuICAgICAgLm1hcCgoYikgPT4gdGhpcy5jdHguc3RhdGUuc2Vzc2lvbkJ5SWQoYi5zZXNzaW9uSWQpKVxyXG4gICAgICAuZmlsdGVyKFxyXG4gICAgICAgIChzKTogcyBpcyBXb3Jrb3V0U2Vzc2lvbiA9PiBzICE9PSB1bmRlZmluZWQgJiYgIWlzRmluaXNoZWQocywgbm93KSxcclxuICAgICAgKVxyXG4gICAgICAuc29ydCgoYSwgYikgPT4gYS5zdGFydHNBdC5sb2NhbGVDb21wYXJlKGIuc3RhcnRzQXQpKTtcclxuICAgIGNvbnN0IG5leHQgPSB1cGNvbWluZ1swXTtcclxuICAgIGlmICghbmV4dCkge1xyXG4gICAgICByZXBsYWNlKHRoaXMubmV4dEVsKTtcclxuICAgICAgdGhpcy5uZXh0RWwuaGlkZGVuID0gdHJ1ZTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgdGhpcy5uZXh0RWwuaGlkZGVuID0gZmFsc2U7XHJcbiAgICByZXBsYWNlKFxyXG4gICAgICB0aGlzLm5leHRFbCxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwibmV4dC1jYXJkXCIgfSxcclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJkaXZcIixcclxuICAgICAgICAgIHsgY2xhc3M6IFwibmV4dC1pbmZvXCIgfSxcclxuICAgICAgICAgIGgoXCJzcGFuXCIsIHsgY2xhc3M6IFwibmV4dC1sYWJlbFwiLCB0ZXh0OiBcIlx1MDQxMVx1MDQzQlx1MDQzOFx1MDQzNlx1MDQzMFx1MDQzOVx1MDQ0OFx1MDQzMFx1MDQ0RiBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0MzBcIiB9KSxcclxuICAgICAgICAgIGgoXCJzdHJvbmdcIiwgeyB0ZXh0OiBuZXh0LnRpdGxlIH0pLFxyXG4gICAgICAgICAgaChcInNwYW5cIiwge1xyXG4gICAgICAgICAgICBjbGFzczogXCJtdXRlZFwiLFxyXG4gICAgICAgICAgICB0ZXh0OiBgJHtyZWxhdGl2ZURheShuZXh0LnN0YXJ0c0F0LCBub3cpfSwgJHtmbXRUaW1lKG5leHQuc3RhcnRzQXQpfSBcdTAwQjcgJHtuZXh0LnRyYWluZXJ9YCxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICksXHJcbiAgICAgICAgYnV0dG9uKHtcclxuICAgICAgICAgIGxhYmVsOiBcIlx1MDQxRVx1MDQ0Mlx1MDQzQVx1MDQ0MFx1MDQ0Qlx1MDQ0Mlx1MDQ0Q1wiLFxyXG4gICAgICAgICAgdG9uZTogXCJnaG9zdFwiLFxyXG4gICAgICAgICAgc21hbGw6IHRydWUsXHJcbiAgICAgICAgICBvbkNsaWNrOiAoKSA9PiB0aGlzLm9wZW5EcmF3ZXIobmV4dC5pZCksXHJcbiAgICAgICAgfSksXHJcbiAgICAgICksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZW5kZXJEYXlzKCk6IHZvaWQge1xyXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgIHJlcGxhY2UoXHJcbiAgICAgIHRoaXMuZGF5c0VsLFxyXG4gICAgICAuLi5BcnJheS5mcm9tKHsgbGVuZ3RoOiA3IH0sIChfLCBpKSA9PiB7XHJcbiAgICAgICAgY29uc3QgbGFiZWwgPSBkYXlMYWJlbChpLCBub3cpO1xyXG4gICAgICAgIHJldHVybiBoKFxyXG4gICAgICAgICAgXCJidXR0b25cIixcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgY2xhc3M6IGBkYXkke3RoaXMuZmlsdGVycy5kYXlPZmZzZXQgPT09IGkgPyBcIiBhY3RpdmVcIiA6IFwiXCJ9YCxcclxuICAgICAgICAgICAgYXR0cnM6IHtcclxuICAgICAgICAgICAgICB0eXBlOiBcImJ1dHRvblwiLFxyXG4gICAgICAgICAgICAgIHJvbGU6IFwidGFiXCIsXHJcbiAgICAgICAgICAgICAgXCJhcmlhLXNlbGVjdGVkXCI6IFN0cmluZyh0aGlzLmZpbHRlcnMuZGF5T2Zmc2V0ID09PSBpKSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgb246IHtcclxuICAgICAgICAgICAgICBjbGljazogKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5maWx0ZXJzLmRheU9mZnNldCA9IGk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnJlbmRlckRheXMoKTtcclxuICAgICAgICAgICAgICAgIHRoaXMucmVuZGVyTGlzdCgpO1xyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgaChcInNwYW5cIiwgeyB0ZXh0OiBsYWJlbC50b3AgfSksXHJcbiAgICAgICAgICBoKFwic21hbGxcIiwgeyB0ZXh0OiBsYWJlbC5zdWIgfSksXHJcbiAgICAgICAgKTtcclxuICAgICAgfSksXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZW5kZXJDaGlwcygpOiB2b2lkIHtcclxuICAgIGNvbnN0IGtpbmRDaGlwcyA9IFtcclxuICAgICAgY2hpcChcIlx1MDQxMlx1MDQ0MVx1MDQzNVwiLCB0aGlzLmZpbHRlcnMua2luZCA9PT0gXCJhbGxcIiwgKCkgPT4ge1xyXG4gICAgICAgIHRoaXMuZmlsdGVycy5raW5kID0gXCJhbGxcIjtcclxuICAgICAgICB0aGlzLnJlbmRlckNoaXBzKCk7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJMaXN0KCk7XHJcbiAgICAgIH0pLFxyXG4gICAgICAuLi5XT1JLT1VUX0tJTkRTLm1hcCgoa2luZCkgPT5cclxuICAgICAgICBjaGlwKEtJTkRfTEFCRUxba2luZF0sIHRoaXMuZmlsdGVycy5raW5kID09PSBraW5kLCAoKSA9PiB7XHJcbiAgICAgICAgICB0aGlzLmZpbHRlcnMua2luZCA9IGtpbmQ7XHJcbiAgICAgICAgICB0aGlzLnJlbmRlckNoaXBzKCk7XHJcbiAgICAgICAgICB0aGlzLnJlbmRlckxpc3QoKTtcclxuICAgICAgICB9KSxcclxuICAgICAgKSxcclxuICAgIF07XHJcbiAgICBjb25zdCB0aW1lQ2hpcHMgPSBUSU1FX09QVElPTlMubWFwKChvcHQpID0+XHJcbiAgICAgIGNoaXAob3B0LmxhYmVsLCB0aGlzLmZpbHRlcnMudGltZSA9PT0gb3B0LnZhbHVlLCAoKSA9PiB7XHJcbiAgICAgICAgdGhpcy5maWx0ZXJzLnRpbWUgPSBvcHQudmFsdWU7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJDaGlwcygpO1xyXG4gICAgICAgIHRoaXMucmVuZGVyTGlzdCgpO1xyXG4gICAgICB9KSxcclxuICAgICk7XHJcbiAgICByZXBsYWNlKFxyXG4gICAgICB0aGlzLmNoaXBzRWwsXHJcbiAgICAgIC4uLmtpbmRDaGlwcyxcclxuICAgICAgaChcInNwYW5cIiwgeyBjbGFzczogXCJjaGlwcy1zZXBcIiwgYXR0cnM6IHsgXCJhcmlhLWhpZGRlblwiOiBcInRydWVcIiB9IH0pLFxyXG4gICAgICAuLi50aW1lQ2hpcHMsXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZW5kZXJQcmVzZXRzKCk6IHZvaWQge1xyXG4gICAgY29uc3QgcHJlc2V0cyA9IHRoaXMuY3R4LnNhdmVkVmlld3MuYWxsKCk7XHJcbiAgICByZXBsYWNlKFxyXG4gICAgICB0aGlzLnByZXNldHNFbCxcclxuICAgICAgcHJlc2V0cy5sZW5ndGggPiAwXHJcbiAgICAgICAgPyBoKFwic3BhblwiLCB7IGNsYXNzOiBcInByZXNldHMtbGFiZWwgbXV0ZWRcIiwgdGV4dDogXCJcdTA0MjFcdTA0M0VcdTA0NDVcdTA0NDBcdTA0MzBcdTA0M0RcdTA0NTFcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzU6XCIgfSlcclxuICAgICAgICA6IG51bGwsXHJcbiAgICAgIC4uLnByZXNldHMubWFwKChwKSA9PlxyXG4gICAgICAgIGgoXHJcbiAgICAgICAgICBcInNwYW5cIixcclxuICAgICAgICAgIHsgY2xhc3M6IFwicHJlc2V0XCIgfSxcclxuICAgICAgICAgIGgoXCJidXR0b25cIiwge1xyXG4gICAgICAgICAgICBjbGFzczogXCJwcmVzZXQtYXBwbHlcIixcclxuICAgICAgICAgICAgYXR0cnM6IHsgdHlwZTogXCJidXR0b25cIiwgdGl0bGU6IFwiXHUwNDFGXHUwNDQwXHUwNDM4XHUwNDNDXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQ0NFx1MDQzOFx1MDQzQlx1MDQ0Q1x1MDQ0Mlx1MDQ0MFwiIH0sXHJcbiAgICAgICAgICAgIHRleHQ6IHAubmFtZSxcclxuICAgICAgICAgICAgb246IHsgY2xpY2s6ICgpID0+IHRoaXMuYXBwbHlQcmVzZXQocCkgfSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgaChcImJ1dHRvblwiLCB7XHJcbiAgICAgICAgICAgIGNsYXNzOiBcInByZXNldC14XCIsXHJcbiAgICAgICAgICAgIGF0dHJzOiB7IHR5cGU6IFwiYnV0dG9uXCIsIFwiYXJpYS1sYWJlbFwiOiBgXHUwNDIzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQ0NFx1MDQzOFx1MDQzQlx1MDQ0Q1x1MDQ0Mlx1MDQ0MCAke3AubmFtZX1gIH0sXHJcbiAgICAgICAgICAgIHRleHQ6IFwiXHUwMEQ3XCIsXHJcbiAgICAgICAgICAgIG9uOiB7XHJcbiAgICAgICAgICAgICAgY2xpY2s6ICgpID0+IHtcclxuICAgICAgICAgICAgICAgIHRoaXMuY3R4LnNhdmVkVmlld3MucmVtb3ZlKHAuaWQpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5yZW5kZXJQcmVzZXRzKCk7XHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICksXHJcbiAgICAgICksXHJcbiAgICAgIGJ1dHRvbih7XHJcbiAgICAgICAgbGFiZWw6IFwiXHUwNDIxXHUwNDNFXHUwNDQ1XHUwNDQwXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQ0NFx1MDQzOFx1MDQzQlx1MDQ0Q1x1MDQ0Mlx1MDQ0MFwiLFxyXG4gICAgICAgIHRvbmU6IFwiZ2hvc3RcIixcclxuICAgICAgICBzbWFsbDogdHJ1ZSxcclxuICAgICAgICBpY29uOiBcImJvb2ttYXJrXCIsXHJcbiAgICAgICAgb25DbGljazogKCkgPT4gdGhpcy5vcGVuU2F2ZVByZXNldCgpLFxyXG4gICAgICB9KSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGx5UHJlc2V0KHA6IEZpbHRlclByZXNldCk6IHZvaWQge1xyXG4gICAgdGhpcy5maWx0ZXJzID0geyAuLi5ERUZBVUxUX0ZJTFRFUlMsIC4uLnAuZmlsdGVycyB9O1xyXG4gICAgdGhpcy5zZWFyY2hJbnB1dC52YWx1ZSA9IHRoaXMuZmlsdGVycy5xdWVyeTtcclxuICAgIHRoaXMuc29ydFNlbGVjdC52YWx1ZSA9IHRoaXMuZmlsdGVycy5zb3J0O1xyXG4gICAgdGhpcy5yZW5kZXJEYXlzKCk7XHJcbiAgICB0aGlzLnJlbmRlckNoaXBzKCk7XHJcbiAgICB0aGlzLnJlbmRlckxpc3QoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgb3BlblNhdmVQcmVzZXQoKTogdm9pZCB7XHJcbiAgICBjb25zdCBpbnB1dCA9IHRleHRJbnB1dCh7XHJcbiAgICAgIHR5cGU6IFwidGV4dFwiLFxyXG4gICAgICByZXF1aXJlZDogdHJ1ZSxcclxuICAgICAgbWF4bGVuZ3RoOiA0MCxcclxuICAgICAgcGxhY2Vob2xkZXI6IFwiXHUwNDFEXHUwNDMwXHUwNDNGXHUwNDQwXHUwNDM4XHUwNDNDXHUwNDM1XHUwNDQwOiBcdTA0MTlcdTA0M0VcdTA0MzNcdTA0MzAgXHUwNDNGXHUwNDNFIFx1MDQ0M1x1MDQ0Mlx1MDQ0MFx1MDQzMFx1MDQzQ1wiLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCBmb3JtID0gaChcclxuICAgICAgXCJmb3JtXCIsXHJcbiAgICAgIHtcclxuICAgICAgICBvbjoge1xyXG4gICAgICAgICAgc3VibWl0OiAoZSkgPT4ge1xyXG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICAgIGNvbnN0IG5hbWUgPSBpbnB1dC52YWx1ZS50cmltKCk7XHJcbiAgICAgICAgICAgIGlmICghbmFtZSkgcmV0dXJuO1xyXG4gICAgICAgICAgICB0aGlzLmN0eC5zYXZlZFZpZXdzLnNhdmUobmFtZSwgdGhpcy5maWx0ZXJzKTtcclxuICAgICAgICAgICAgY2xvc2UoKTtcclxuICAgICAgICAgICAgdGhpcy5yZW5kZXJQcmVzZXRzKCk7XHJcbiAgICAgICAgICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KFwiXHUwNDI0XHUwNDM4XHUwNDNCXHUwNDRDXHUwNDQyXHUwNDQwIFx1MDQ0MVx1MDQzRVx1MDQ0NVx1MDQ0MFx1MDQzMFx1MDQzRFx1MDQ1MVx1MDQzRFwiLCBcIm9rXCIpO1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgICBoKFwiaDNcIiwgeyB0ZXh0OiBcIlx1MDQyMVx1MDQzRVx1MDQ0NVx1MDQ0MFx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0Mlx1MDQ0QyBcdTA0NDJcdTA0MzVcdTA0M0FcdTA0NDNcdTA0NDlcdTA0MzhcdTA0MzkgXHUwNDQ0XHUwNDM4XHUwNDNCXHUwNDRDXHUwNDQyXHUwNDQwXCIgfSksXHJcbiAgICAgIGZpZWxkKFwiXHUwNDFEXHUwNDMwXHUwNDM3XHUwNDMyXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDM1XCIsIGlucHV0LCB0cnVlKSxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwibW9kYWwtYWN0aW9uc1wiIH0sXHJcbiAgICAgICAgYnV0dG9uKHsgbGFiZWw6IFwiXHUwNDFFXHUwNDQyXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDMwXCIsIHRvbmU6IFwiZ2hvc3RcIiwgb25DbGljazogKCkgPT4gY2xvc2UoKSB9KSxcclxuICAgICAgICBidXR0b24oeyBsYWJlbDogXCJcdTA0MjFcdTA0M0VcdTA0NDVcdTA0NDBcdTA0MzBcdTA0M0RcdTA0MzhcdTA0NDJcdTA0NENcIiwgdHlwZTogXCJzdWJtaXRcIiB9KSxcclxuICAgICAgKSxcclxuICAgICk7XHJcbiAgICBjb25zdCBjbG9zZSA9IHRoaXMuY3R4Lm92ZXJsYXlzLm9wZW4oZm9ybSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJlbmRlckxpc3QoKTogdm9pZCB7XHJcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xyXG4gICAgY29uc3QgYm9va2luZ3MgPSB0aGlzLmN0eC5zdGF0ZS5hbGxCb29raW5ncygpO1xyXG4gICAgY29uc3QgbGlzdCA9IHNvcnRTZXNzaW9ucyhcclxuICAgICAgZmlsdGVyU2Vzc2lvbnModGhpcy5jdHguc3RhdGUuYWxsU2Vzc2lvbnMoKSwgdGhpcy5maWx0ZXJzLCBub3cpLFxyXG4gICAgICB0aGlzLmZpbHRlcnMuc29ydCxcclxuICAgICAgYm9va2luZ3MsXHJcbiAgICApO1xyXG4gICAgdGhpcy5jb3VudEVsLnRleHRDb250ZW50ID0gYCR7bGlzdC5sZW5ndGh9ICR7cGx1cmFsKGxpc3QubGVuZ3RoLCBbXCJcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0MzBcIiwgXCJcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0FcdTA0MzhcIiwgXCJcdTA0NDJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0M0VcdTA0M0FcIl0pfWA7XHJcbiAgICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcclxuICAgICAgcmVwbGFjZShcclxuICAgICAgICB0aGlzLmxpc3RFbCxcclxuICAgICAgICBlbXB0eVN0YXRlKFxyXG4gICAgICAgICAgXCJcdTA0MURcdTA0MzhcdTA0NDdcdTA0MzVcdTA0MzNcdTA0M0UgXHUwNDNEXHUwNDM1IFx1MDQzRFx1MDQzMFx1MDQzOVx1MDQzNFx1MDQzNVx1MDQzRFx1MDQzRS4gXHUwNDE4XHUwNDM3XHUwNDNDXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQyXHUwNDM1IFx1MDQ0NFx1MDQzOFx1MDQzQlx1MDQ0Q1x1MDQ0Mlx1MDQ0MFx1MDQ0Qi5cIixcclxuICAgICAgICAgIGJ1dHRvbih7XHJcbiAgICAgICAgICAgIGxhYmVsOiBcIlx1MDQyMVx1MDQzMVx1MDQ0MFx1MDQzRVx1MDQ0MVx1MDQzOFx1MDQ0Mlx1MDQ0QyBcdTA0NDRcdTA0MzhcdTA0M0JcdTA0NENcdTA0NDJcdTA0NDBcdTA0NEJcIixcclxuICAgICAgICAgICAgdG9uZTogXCJnaG9zdFwiLFxyXG4gICAgICAgICAgICBvbkNsaWNrOiAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgdGhpcy5maWx0ZXJzID0ge1xyXG4gICAgICAgICAgICAgICAgLi4uREVGQVVMVF9GSUxURVJTLFxyXG4gICAgICAgICAgICAgICAgZGF5T2Zmc2V0OiB0aGlzLmZpbHRlcnMuZGF5T2Zmc2V0LFxyXG4gICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgdGhpcy5zZWFyY2hJbnB1dC52YWx1ZSA9IFwiXCI7XHJcbiAgICAgICAgICAgICAgdGhpcy5zb3J0U2VsZWN0LnZhbHVlID0gXCJ0aW1lXCI7XHJcbiAgICAgICAgICAgICAgdGhpcy5yZW5kZXJDaGlwcygpO1xyXG4gICAgICAgICAgICAgIHRoaXMucmVuZGVyTGlzdCgpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgKSxcclxuICAgICAgKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgcmVwbGFjZSh0aGlzLmxpc3RFbCwgLi4ubGlzdC5tYXAoKHMsIGkpID0+IHRoaXMuc2Vzc2lvbkNhcmQocywgaSkpKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2Vzc2lvbkNhcmQoczogV29ya291dFNlc3Npb24sIGluZGV4OiBudW1iZXIpOiBIVE1MRWxlbWVudCB7XHJcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xyXG4gICAgY29uc3QgYm9va2luZ3MgPSB0aGlzLmN0eC5zdGF0ZS5hbGxCb29raW5ncygpO1xyXG4gICAgY29uc3QgdXNlciA9IHRoaXMuY3R4LmF1dGguY3VycmVudFVzZXIoKTtcclxuICAgIGNvbnN0IGxlZnQgPSBzZWF0c0xlZnQocywgYm9va2luZ3MpO1xyXG4gICAgY29uc3QgbWluZSA9IHVzZXIgPyBib29raW5nT2YoYm9va2luZ3MsIHVzZXIuaWQsIHMuaWQpIDogdW5kZWZpbmVkO1xyXG4gICAgY29uc3QgZmluaXNoZWQgPSBpc0ZpbmlzaGVkKHMsIG5vdyk7XHJcblxyXG4gICAgY29uc3QgY292ZXIgPSBoKFxyXG4gICAgICBcImRpdlwiLFxyXG4gICAgICB7IGNsYXNzOiBcImNhcmQtY292ZXJcIiB9LFxyXG4gICAgICBjb3ZlckltZyhzLmtpbmQpLFxyXG4gICAgICBoKFwic3BhblwiLCB7IGNsYXNzOiBcImNvdmVyLXRpbWVcIiwgdGV4dDogZm10VGltZShzLnN0YXJ0c0F0KSB9KSxcclxuICAgICk7XHJcbiAgICBjb25zdCBpbmZvID0gaChcclxuICAgICAgXCJkaXZcIixcclxuICAgICAgeyBjbGFzczogXCJzZXNzaW9uLWluZm9cIiB9LFxyXG4gICAgICBoKFxyXG4gICAgICAgIFwiZGl2XCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJzZXNzaW9uLXRvcFwiIH0sXHJcbiAgICAgICAgaChcImgzXCIsIHsgdGV4dDogcy50aXRsZSB9KSxcclxuICAgICAgICBraW5kQmFkZ2Uocy5raW5kKSxcclxuICAgICAgICBpbnRlbnNpdHlDaGlwKHMua2luZCksXHJcbiAgICAgICksXHJcbiAgICAgIGgoXHJcbiAgICAgICAgXCJwXCIsXHJcbiAgICAgICAgeyBjbGFzczogXCJtdXRlZCBzZXNzaW9uLW1ldGFcIiB9LFxyXG4gICAgICAgIG1pbmlBdmF0YXIocy50cmFpbmVyKSxcclxuICAgICAgICBoKFwic3BhblwiLCB7IHRleHQ6IGAke3MudHJhaW5lcn0gXHUwMEI3ICR7cy5yb29tfSBcdTAwQjcgJHtzLmR1cmF0aW9uTWlufSBcdTA0M0NcdTA0MzhcdTA0M0RgIH0pLFxyXG4gICAgICApLFxyXG4gICAgKTtcclxuXHJcbiAgICBjb25zdCBhY3Rpb24gPSBmaW5pc2hlZFxyXG4gICAgICA/IGJ1dHRvbih7IGxhYmVsOiBcIlx1MDQxN1x1MDQzMFx1MDQzMlx1MDQzNVx1MDQ0MFx1MDQ0OFx1MDQzNVx1MDQzRFx1MDQzMFwiLCB0b25lOiBcImdob3N0XCIsIGRpc2FibGVkOiB0cnVlIH0pXHJcbiAgICAgIDogbWluZVxyXG4gICAgICAgID8gYnV0dG9uKHtcclxuICAgICAgICAgICAgbGFiZWw6IFwiXHUwNDEyXHUwNDRCIFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzMFx1MDQzRFx1MDQ0QlwiLFxyXG4gICAgICAgICAgICB0b25lOiBcIm9rXCIsXHJcbiAgICAgICAgICAgIGljb246IFwiY2hlY2tcIixcclxuICAgICAgICAgICAgb25DbGljazogKGUpID0+IHtcclxuICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgICAgICAgIHRoaXMub3BlbkRyYXdlcihzLmlkKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgOiBsZWZ0IDw9IDBcclxuICAgICAgICAgID8gYnV0dG9uKHsgbGFiZWw6IFwiXHUwNDFDXHUwNDM1XHUwNDQxXHUwNDQyIFx1MDQzRFx1MDQzNVx1MDQ0MlwiLCB0b25lOiBcImdob3N0XCIsIGRpc2FibGVkOiB0cnVlIH0pXHJcbiAgICAgICAgICA6IGJ1dHRvbih7XHJcbiAgICAgICAgICAgICAgbGFiZWw6IFwiXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDQyXHUwNDRDXHUwNDQxXHUwNDRGXCIsXHJcbiAgICAgICAgICAgICAgb25DbGljazogKGUpID0+IHtcclxuICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICB2b2lkIHRoaXMuYm9vayhzLmlkKTtcclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICBjb25zdCB0YWtlbiA9IHNlYXRzVGFrZW4oYm9va2luZ3MsIHMuaWQpO1xyXG4gICAgY29uc3QgcGN0ID0gcy5jYXBhY2l0eSA/IE1hdGgucm91bmQoKHRha2VuIC8gcy5jYXBhY2l0eSkgKiAxMDApIDogMDtcclxuICAgIGNvbnN0IHNwb3RzVGV4dCA9IGZpbmlzaGVkXHJcbiAgICAgID8gXCJcdTIwMTRcIlxyXG4gICAgICA6IGxlZnQgPD0gMFxyXG4gICAgICAgID8gXCJcdTA0MUNcdTA0MzVcdTA0NDFcdTA0NDIgXHUwNDNEXHUwNDM1XHUwNDQyXCJcclxuICAgICAgICA6IGAke2xlZnR9ICR7cGx1cmFsKGxlZnQsIFtcIlx1MDQzQ1x1MDQzNVx1MDQ0MVx1MDQ0Mlx1MDQzRVwiLCBcIlx1MDQzQ1x1MDQzNVx1MDQ0MVx1MDQ0Mlx1MDQzMFwiLCBcIlx1MDQzQ1x1MDQzNVx1MDQ0MVx1MDQ0MlwiXSl9YDtcclxuICAgIGNvbnN0IHNwb3RzQ2xzID0gZmluaXNoZWRcclxuICAgICAgPyBcInNwb3RzXCJcclxuICAgICAgOiBsZWZ0IDw9IDBcclxuICAgICAgICA/IFwic3BvdHMgbm9uZVwiXHJcbiAgICAgICAgOiBsZWZ0IDw9IDNcclxuICAgICAgICAgID8gXCJzcG90cyBsb3cgdXJnZW50XCJcclxuICAgICAgICAgIDogXCJzcG90c1wiO1xyXG4gICAgY29uc3Qgc2lkZSA9IGgoXHJcbiAgICAgIFwiZGl2XCIsXHJcbiAgICAgIHsgY2xhc3M6IFwic2Vzc2lvbi1zaWRlXCIgfSxcclxuICAgICAgaChcInNwYW5cIiwgeyBjbGFzczogc3BvdHNDbHMsIHRleHQ6IHNwb3RzVGV4dCB9KSxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwiY2FyZC1vY2NcIiB9LFxyXG4gICAgICAgIG9jY3VwYW5jeUJhcihwY3QpLFxyXG4gICAgICAgIGgoXCJzcGFuXCIsIHsgdGV4dDogYCR7dGFrZW59LyR7cy5jYXBhY2l0eX1gIH0pLFxyXG4gICAgICApLFxyXG4gICAgICBhY3Rpb24sXHJcbiAgICApO1xyXG5cclxuICAgIHJldHVybiBoKFxyXG4gICAgICBcImFydGljbGVcIixcclxuICAgICAge1xyXG4gICAgICAgIGNsYXNzOiBgc2Vzc2lvbi1jYXJkJHtmaW5pc2hlZCA/IFwiIHBhc3RcIiA6IFwiXCJ9YCxcclxuICAgICAgICBzdHlsZTogYGFuaW1hdGlvbi1kZWxheToke01hdGgubWluKGluZGV4ICogNDAsIDI0MCl9bXNgLFxyXG4gICAgICAgIGF0dHJzOiB7XHJcbiAgICAgICAgICB0YWJpbmRleDogXCIwXCIsXHJcbiAgICAgICAgICByb2xlOiBcImdyb3VwXCIsXHJcbiAgICAgICAgICBcImFyaWEtbGFiZWxcIjogYCR7cy50aXRsZX0sICR7Zm10VGltZShzLnN0YXJ0c0F0KX0uIFx1MDQxRVx1MDQ0Mlx1MDQzQVx1MDQ0MFx1MDQ0Qlx1MDQ0Mlx1MDQ0QyBcdTA0M0ZcdTA0M0VcdTA0MzRcdTA0NDBcdTA0M0VcdTA0MzFcdTA0M0RcdTA0M0VcdTA0NDFcdTA0NDJcdTA0MzhgLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb246IHtcclxuICAgICAgICAgIGNsaWNrOiAoKSA9PiB0aGlzLm9wZW5EcmF3ZXIocy5pZCksXHJcbiAgICAgICAgICBrZXlkb3duOiAoZSkgPT4ge1xyXG4gICAgICAgICAgICBpZiAoZS5rZXkgPT09IFwiRW50ZXJcIiB8fCBlLmtleSA9PT0gXCIgXCIpIHtcclxuICAgICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICAgICAgdGhpcy5vcGVuRHJhd2VyKHMuaWQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICAgIGNvdmVyLFxyXG4gICAgICBpbmZvLFxyXG4gICAgICBzaWRlLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgYm9vayhzZXNzaW9uSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgciA9IGF3YWl0IHRoaXMuY3R4LmJvb2tpbmcuYm9vayhzZXNzaW9uSWQpO1xyXG4gICAgaWYgKCFyLm9rKSB7XHJcbiAgICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KGVycm9yTWVzc2FnZShyLmVycm9yKSwgXCJlcnJcIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IHMgPSB0aGlzLmN0eC5zdGF0ZS5zZXNzaW9uQnlJZChzZXNzaW9uSWQpO1xyXG4gICAgdGhpcy5jdHgudG9hc3RzLnNob3coXHJcbiAgICAgIHMgPyBgXHUwNDEyXHUwNDRCIFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQzMFx1MDQzRFx1MDQ0QjogJHtzLnRpdGxlfSwgJHtmbXRGdWxsKHMuc3RhcnRzQXQpfWAgOiBcIlx1MDQxMlx1MDQ0QiBcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzBcdTA0M0RcdTA0NEJcIixcclxuICAgICAgXCJva1wiLFxyXG4gICAgICB7XHJcbiAgICAgICAgbGFiZWw6IFwiXHUwNDFFXHUwNDQyXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDQyXHUwNDRDXCIsXHJcbiAgICAgICAgcnVuOiAoKSA9PiB7XHJcbiAgICAgICAgICB2b2lkIHRoaXMuY2FuY2VsKHIudmFsdWUuaWQpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBjYW5jZWwoYm9va2luZ0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmN0eC5ib29raW5nLmNhbmNlbChib29raW5nSWQpO1xyXG4gICAgaWYgKCFyLm9rKSB7XHJcbiAgICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KGVycm9yTWVzc2FnZShyLmVycm9yKSwgXCJlcnJcIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRoaXMuY3R4LnRvYXN0cy5zaG93KFwiXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDRDIFx1MDQzRVx1MDQ0Mlx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzNVx1MDQzRFx1MDQzMFwiLCBcImluZm9cIiwge1xyXG4gICAgICBsYWJlbDogXCJcdTA0MTJcdTA0MzVcdTA0NDBcdTA0M0RcdTA0NDNcdTA0NDJcdTA0NENcIixcclxuICAgICAgcnVuOiAoKSA9PiB7XHJcbiAgICAgICAgdm9pZCB0aGlzLnJlc3RvcmUoci52YWx1ZSk7XHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVzdG9yZShib29raW5nOiB7IHNlc3Npb25JZDogc3RyaW5nIH0pOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCB0aGlzLmN0eC5ib29raW5nLmJvb2soYm9va2luZy5zZXNzaW9uSWQpO1xyXG4gICAgdGhpcy5jdHgudG9hc3RzLnNob3coXHJcbiAgICAgIHIub2sgPyBcIlx1MDQxN1x1MDQzMFx1MDQzRlx1MDQzOFx1MDQ0MVx1MDQ0QyBcdTA0MzJcdTA0M0VcdTA0NDFcdTA0NDFcdTA0NDJcdTA0MzBcdTA0M0RcdTA0M0VcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzBcIiA6IGVycm9yTWVzc2FnZShyLmVycm9yKSxcclxuICAgICAgci5vayA/IFwib2tcIiA6IFwiZXJyXCIsXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvcGVuRHJhd2VyKHNlc3Npb25JZDogc3RyaW5nKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMuY3R4LnN0YXRlLnNlc3Npb25CeUlkKHNlc3Npb25JZCkpIHJldHVybjtcclxuICAgIHRoaXMuZHJhd2VyU2Vzc2lvbklkID0gc2Vzc2lvbklkO1xyXG4gICAgdGhpcy5kcmF3ZXJDb250ZW50ID0gaChcImRpdlwiLCB7IGNsYXNzOiBcImRyYXdlci1ib2R5XCIgfSk7XHJcbiAgICB0aGlzLmZpbGxEcmF3ZXIoKTtcclxuICAgIHRoaXMuY2xvc2VEcmF3ZXIgPSB0aGlzLmN0eC5vdmVybGF5cy5vcGVuKFxyXG4gICAgICB0aGlzLmRyYXdlckNvbnRlbnQsXHJcbiAgICAgIFwiZHJhd2VyXCIsXHJcbiAgICAgICgpID0+IHtcclxuICAgICAgICB0aGlzLmRyYXdlclNlc3Npb25JZCA9IG51bGw7XHJcbiAgICAgICAgdGhpcy5kcmF3ZXJDb250ZW50ID0gbnVsbDtcclxuICAgICAgICB0aGlzLmNsb3NlRHJhd2VyID0gbnVsbDtcclxuICAgICAgfSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJlZnJlc2hEcmF3ZXIoKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMuZHJhd2VyU2Vzc2lvbklkKSByZXR1cm47XHJcbiAgICBpZiAoIXRoaXMuY3R4LnN0YXRlLnNlc3Npb25CeUlkKHRoaXMuZHJhd2VyU2Vzc2lvbklkKSkge1xyXG4gICAgICB0aGlzLmNsb3NlRHJhd2VyPy4oKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgdGhpcy5maWxsRHJhd2VyKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGZpbGxEcmF3ZXIoKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMuZHJhd2VyQ29udGVudCB8fCAhdGhpcy5kcmF3ZXJTZXNzaW9uSWQpIHJldHVybjtcclxuICAgIGNvbnN0IHMgPSB0aGlzLmN0eC5zdGF0ZS5zZXNzaW9uQnlJZCh0aGlzLmRyYXdlclNlc3Npb25JZCk7XHJcbiAgICBpZiAoIXMpIHJldHVybjtcclxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgICBjb25zdCBib29raW5ncyA9IHRoaXMuY3R4LnN0YXRlLmFsbEJvb2tpbmdzKCk7XHJcbiAgICBjb25zdCB1c2VyID0gdGhpcy5jdHguYXV0aC5jdXJyZW50VXNlcigpO1xyXG4gICAgY29uc3QgdGFrZW4gPSBzZWF0c1Rha2VuKGJvb2tpbmdzLCBzLmlkKTtcclxuICAgIGNvbnN0IGxlZnQgPSBzZWF0c0xlZnQocywgYm9va2luZ3MpO1xyXG4gICAgY29uc3QgbWluZSA9IHVzZXIgPyBib29raW5nT2YoYm9va2luZ3MsIHVzZXIuaWQsIHMuaWQpIDogdW5kZWZpbmVkO1xyXG4gICAgY29uc3QgZmluaXNoZWQgPSBpc0ZpbmlzaGVkKHMsIG5vdyk7XHJcbiAgICBjb25zdCBwY3QgPSBzLmNhcGFjaXR5ID8gTWF0aC5yb3VuZCgodGFrZW4gLyBzLmNhcGFjaXR5KSAqIDEwMCkgOiAwO1xyXG5cclxuICAgIGNvbnN0IGFjdGlvbiA9IGZpbmlzaGVkXHJcbiAgICAgID8gYnV0dG9uKHtcclxuICAgICAgICAgIGxhYmVsOiBcIlx1MDQyMlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzQVx1MDQzMCBcdTA0MzdcdTA0MzBcdTA0MzJcdTA0MzVcdTA0NDBcdTA0NDhcdTA0MzVcdTA0M0RcdTA0MzBcIixcclxuICAgICAgICAgIHRvbmU6IFwiZ2hvc3RcIixcclxuICAgICAgICAgIHdpZGU6IHRydWUsXHJcbiAgICAgICAgICBkaXNhYmxlZDogdHJ1ZSxcclxuICAgICAgICB9KVxyXG4gICAgICA6IG1pbmVcclxuICAgICAgICA/IGJ1dHRvbih7XHJcbiAgICAgICAgICAgIGxhYmVsOiBcIlx1MDQxRVx1MDQ0Mlx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0Mlx1MDQ0QyBcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0NENcIixcclxuICAgICAgICAgICAgdG9uZTogXCJkYW5nZXJcIixcclxuICAgICAgICAgICAgd2lkZTogdHJ1ZSxcclxuICAgICAgICAgICAgb25DbGljazogKCkgPT4ge1xyXG4gICAgICAgICAgICAgIHZvaWQgdGhpcy5jYW5jZWwobWluZS5pZCk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIDogbGVmdCA8PSAwXHJcbiAgICAgICAgICA/IGJ1dHRvbih7XHJcbiAgICAgICAgICAgICAgbGFiZWw6IFwiXHUwNDIxXHUwNDMyXHUwNDNFXHUwNDMxXHUwNDNFXHUwNDM0XHUwNDNEXHUwNDRCXHUwNDQ1IFx1MDQzQ1x1MDQzNVx1MDQ0MVx1MDQ0MiBcdTA0M0RcdTA0MzVcdTA0NDJcIixcclxuICAgICAgICAgICAgICB0b25lOiBcImdob3N0XCIsXHJcbiAgICAgICAgICAgICAgd2lkZTogdHJ1ZSxcclxuICAgICAgICAgICAgICBkaXNhYmxlZDogdHJ1ZSxcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICAgIDogYnV0dG9uKHtcclxuICAgICAgICAgICAgICBsYWJlbDogXCJcdTA0MTdcdTA0MzBcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0MzBcdTA0NDJcdTA0NENcdTA0NDFcdTA0NEZcIixcclxuICAgICAgICAgICAgICB3aWRlOiB0cnVlLFxyXG4gICAgICAgICAgICAgIG9uQ2xpY2s6ICgpID0+IHtcclxuICAgICAgICAgICAgICAgIHZvaWQgdGhpcy5ib29rKHMuaWQpO1xyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNvdmVyID0gaChcclxuICAgICAgXCJkaXZcIixcclxuICAgICAgeyBjbGFzczogXCJkcmF3ZXItY292ZXJcIiB9LFxyXG4gICAgICBjb3ZlckltZyhzLmtpbmQsIFwiZHJhd2VyLWNvdmVyLWltZ1wiKSxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwiZHJhd2VyLWNvdmVyLWJhZGdlc1wiIH0sXHJcbiAgICAgICAga2luZEJhZGdlKHMua2luZCksXHJcbiAgICAgICAgaW50ZW5zaXR5Q2hpcChzLmtpbmQpLFxyXG4gICAgICApLFxyXG4gICAgICBpY29uQnV0dG9uKFwieFwiLCBcIlx1MDQxN1x1MDQzMFx1MDQzQVx1MDQ0MFx1MDQ0Qlx1MDQ0Mlx1MDQ0Q1wiLCAoKSA9PiB0aGlzLmNsb3NlRHJhd2VyPy4oKSksXHJcbiAgICApO1xyXG5cclxuICAgIHJlcGxhY2UoXHJcbiAgICAgIHRoaXMuZHJhd2VyQ29udGVudCxcclxuICAgICAgY292ZXIsXHJcbiAgICAgIGgoXCJoMlwiLCB7IHRleHQ6IHMudGl0bGUgfSksXHJcbiAgICAgIGgoXCJwXCIsIHtcclxuICAgICAgICBjbGFzczogXCJtdXRlZFwiLFxyXG4gICAgICAgIHRleHQ6IGAke2ZtdEZ1bGwocy5zdGFydHNBdCl9IFx1MDBCNyAke3MuZHVyYXRpb25NaW59IFx1MDQzQ1x1MDQzOFx1MDQzRGAsXHJcbiAgICAgIH0pLFxyXG4gICAgICBoKFxyXG4gICAgICAgIFwidWxcIixcclxuICAgICAgICB7IGNsYXNzOiBcImZhY3RzXCIgfSxcclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJsaVwiLFxyXG4gICAgICAgICAge30sXHJcbiAgICAgICAgICBpY29uKFwidXNlclwiLCAxOCksXHJcbiAgICAgICAgICBoKFwic3BhblwiLCB7fSwgXCJcdTA0MjJcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzVcdTA0NDA6IFwiLCBoKFwic3Ryb25nXCIsIHsgdGV4dDogcy50cmFpbmVyIH0pKSxcclxuICAgICAgICApLFxyXG4gICAgICAgIGgoXCJsaVwiLCB7fSwgaWNvbihcInBpblwiLCAxOCksIGgoXCJzcGFuXCIsIHsgdGV4dDogcy5yb29tIH0pKSxcclxuICAgICAgICBoKFxyXG4gICAgICAgICAgXCJsaVwiLFxyXG4gICAgICAgICAge30sXHJcbiAgICAgICAgICBpY29uKFwiY2xvY2tcIiwgMTgpLFxyXG4gICAgICAgICAgaChcInNwYW5cIiwge1xyXG4gICAgICAgICAgICB0ZXh0OiBgJHtmbXRUaW1lKHMuc3RhcnRzQXQpfVx1MjAxMyR7Zm10RW5kVGltZShzLnN0YXJ0c0F0LCBzLmR1cmF0aW9uTWluKX1gLFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgKSxcclxuICAgICAgKSxcclxuICAgICAgaChcclxuICAgICAgICBcImRpdlwiLFxyXG4gICAgICAgIHsgY2xhc3M6IFwib2NjXCIgfSxcclxuICAgICAgICBoKFwiZGl2XCIsIHsgY2xhc3M6IFwib2NjLWJhclwiIH0sIGgoXCJzcGFuXCIsIHsgc3R5bGU6IGB3aWR0aDoke3BjdH0lYCB9KSksXHJcbiAgICAgICAgaChcInBcIiwgeyBjbGFzczogXCJtdXRlZFwiLCB0ZXh0OiBgXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDMwXHUwNDNEXHUwNDNFICR7dGFrZW59IFx1MDQzOFx1MDQzNyAke3MuY2FwYWNpdHl9YCB9KSxcclxuICAgICAgKSxcclxuICAgICAgYWN0aW9uLFxyXG4gICAgKTtcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCBcIi4vc3R5bGVzL21haW4uY3NzXCI7XHJcblxyXG5pbXBvcnQgeyBBcGlDbGllbnQgfSBmcm9tIFwiLi9hcGkvY2xpZW50XCI7XHJcbmltcG9ydCB7XHJcbiAgUmVtb3RlQWNjb3VudHMsXHJcbiAgUmVtb3RlQXV0aCxcclxuICBSZW1vdGVCb29raW5nLFxyXG4gIFJlbW90ZUNhdGFsb2csXHJcbn0gZnJvbSBcIi4vYXBwbGljYXRpb24vc2VydmljZXNcIjtcclxuaW1wb3J0IHsgQXBwU2hlbGwgfSBmcm9tIFwiLi9hcHAvc2hlbGxcIjtcclxuaW1wb3J0IHR5cGUgeyBBcHBDb250ZXh0IH0gZnJvbSBcIi4vYXBwL2NvbnRleHRcIjtcclxuaW1wb3J0IHsgUm91dGVyIH0gZnJvbSBcIi4vYXBwL3JvdXRlclwiO1xyXG5pbXBvcnQgeyBTYXZlZFZpZXdzU3RvcmUgfSBmcm9tIFwiLi9hcHAvc2F2ZWQtdmlld3NcIjtcclxuaW1wb3J0IHsgQXBwU3RhdGUsIEV2ZW50QnVzIH0gZnJvbSBcIi4vc3RhdGUvYXBwLXN0YXRlXCI7XHJcbmltcG9ydCB7IGVycm9yTWVzc2FnZSB9IGZyb20gXCIuL3VpL21lc3NhZ2VzXCI7XHJcbmltcG9ydCB7IE92ZXJsYXlIb3N0IH0gZnJvbSBcIi4vdWkvb3ZlcmxheVwiO1xyXG5pbXBvcnQgeyBUb2FzdENlbnRlciB9IGZyb20gXCIuL3VpL3RvYXN0XCI7XHJcbmltcG9ydCB7IEFkbWluVmlldyB9IGZyb20gXCIuL3ZpZXdzL2FkbWluLXZpZXdcIjtcclxuaW1wb3J0IHsgQXV0aFZpZXcgfSBmcm9tIFwiLi92aWV3cy9hdXRoLXZpZXdcIjtcclxuaW1wb3J0IHsgQm9va2luZ3NWaWV3IH0gZnJvbSBcIi4vdmlld3MvYm9va2luZ3Mtdmlld1wiO1xyXG5pbXBvcnQgeyBMYW5kaW5nVmlldyB9IGZyb20gXCIuL3ZpZXdzL2xhbmRpbmctdmlld1wiO1xyXG5pbXBvcnQgeyBTY2hlZHVsZVZpZXcgfSBmcm9tIFwiLi92aWV3cy9zY2hlZHVsZS12aWV3XCI7XHJcblxyXG5mdW5jdGlvbiByZXF1aXJlRWxlbWVudChpZDogc3RyaW5nKTogSFRNTEVsZW1lbnQge1xyXG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpO1xyXG4gIGlmICghZWwpIHRocm93IG5ldyBFcnJvcihgIyR7aWR9IFx1MDQzRFx1MDQzNSBcdTA0M0RcdTA0MzBcdTA0MzlcdTA0MzRcdTA0MzVcdTA0M0QgXHUyMDE0IFx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzNVx1MDQ0MFx1MDQ0QyB3d3cvaW5kZXguaHRtbGApO1xyXG4gIHJldHVybiBlbDtcclxufVxyXG5cclxuLyoqIFx1MDQxRlx1MDQ0MFx1MDQzRVx1MDQzNCAoOjgwMDEpIFx1MjAxNCBzYW1lLW9yaWdpbi4gRGV2ICg6ODAwMCkgXHUyMDE0IFx1MDQ0Mlx1MDQzRVx1MDQ0MiBcdTA0MzZcdTA0MzUgXHUwNDQ1XHUwNDNFXHUwNDQxXHUwNDQyLCBcdTA0NDdcdTA0NDJcdTA0M0UgXHUwNDNFXHUwNDQyXHUwNDNBXHUwNDQwXHUwNDRCXHUwNDNCIFx1MDQzRlx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzN1x1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQzNVx1MDQzQlx1MDQ0QywgXHUwNDNGXHUwNDNFXHUwNDQwXHUwNDQyIEFQSS4gKi9cclxuY29uc3QgYXBpQmFzZSA9ICgpOiBzdHJpbmcgPT5cclxuICBsb2NhdGlvbi5wb3J0ID09PSBcIjgwMDFcIlxyXG4gICAgPyBcIi9hcGlcIlxyXG4gICAgOiBgJHtsb2NhdGlvbi5wcm90b2NvbH0vLyR7bG9jYXRpb24uaG9zdG5hbWV9OjgwMDEvYXBpYDtcclxuXHJcbiAgICBhc3luYyBmdW5jdGlvbiBib290c3RyYXAoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3QgYnVzID0gbmV3IEV2ZW50QnVzKCk7XHJcbiAgY29uc3QgYXBpID0gbmV3IEFwaUNsaWVudChhcGlCYXNlKCkpO1xyXG4gIGNvbnN0IHN0YXRlID0gbmV3IEFwcFN0YXRlKGFwaSwgYnVzKTtcclxuICBjb25zdCBhdXRoID0gbmV3IFJlbW90ZUF1dGgoYXBpLCBzdGF0ZSk7XHJcbiAgY29uc3QgYm9va2luZyA9IG5ldyBSZW1vdGVCb29raW5nKGFwaSwgc3RhdGUpO1xyXG4gIGNvbnN0IGNhdGFsb2cgPSBuZXcgUmVtb3RlQ2F0YWxvZyhhcGksIHN0YXRlKTtcclxuICBjb25zdCBhY2NvdW50cyA9IG5ldyBSZW1vdGVBY2NvdW50cyhhcGksIHN0YXRlKTtcclxuICBjb25zdCBzYXZlZFZpZXdzID0gbmV3IFNhdmVkVmlld3NTdG9yZSgpO1xyXG5cclxuICBjb25zdCB0b2FzdHMgPSBuZXcgVG9hc3RDZW50ZXIoZG9jdW1lbnQuYm9keSk7XHJcbiAgY29uc3Qgb3ZlcmxheXMgPSBuZXcgT3ZlcmxheUhvc3QoZG9jdW1lbnQuYm9keSk7XHJcbiAgc3RhdGUub25TeW5jRXJyb3IoKGUpID0+IHRvYXN0cy5zaG93KGVycm9yTWVzc2FnZShlKSwgXCJlcnJcIikpO1xyXG5cclxuICBsZXQgcm91dGVyOiBSb3V0ZXI7XHJcbiAgY29uc3QgY3R4OiBBcHBDb250ZXh0ID0ge1xyXG4gICAgYXV0aCxcclxuICAgIGJvb2tpbmcsXHJcbiAgICBjYXRhbG9nLFxyXG4gICAgYWNjb3VudHMsXHJcbiAgICBzdGF0ZSxcclxuICAgIHNhdmVkVmlld3MsXHJcbiAgICBidXMsXHJcbiAgICB0b2FzdHMsXHJcbiAgICBvdmVybGF5cyxcclxuICAgIG5hdmlnYXRlOiAocm91dGUpID0+IHJvdXRlci5uYXZpZ2F0ZShyb3V0ZSksXHJcbiAgfTtcclxuXHJcbiAgY29uc3Qgc2hlbGwgPSBuZXcgQXBwU2hlbGwoY3R4LCByZXF1aXJlRWxlbWVudChcImFwcFwiKSk7XHJcbiAgcm91dGVyID0gbmV3IFJvdXRlcihcclxuICAgIGN0eCxcclxuICAgIHNoZWxsLmNvbnRlbnQsXHJcbiAgICB7XHJcbiAgICAgIGhvbWU6ICgpID0+IG5ldyBMYW5kaW5nVmlldyhjdHgpLFxyXG4gICAgICBhdXRoOiAoKSA9PiBuZXcgQXV0aFZpZXcoY3R4KSxcclxuICAgICAgc2NoZWR1bGU6ICgpID0+IG5ldyBTY2hlZHVsZVZpZXcoY3R4KSxcclxuICAgICAgYm9va2luZ3M6ICgpID0+IG5ldyBCb29raW5nc1ZpZXcoY3R4KSxcclxuICAgICAgYWRtaW46ICgpID0+IG5ldyBBZG1pblZpZXcoY3R4KSxcclxuICAgIH0sXHJcbiAgICAocm91dGUpID0+IHNoZWxsLnN5bmMocm91dGUpLFxyXG4gICk7XHJcblxyXG4gIGJ1cy5vbihcImF1dGhcIiwgKCkgPT4gb3ZlcmxheXMuY2xvc2VBbGwoKSk7XHJcblxyXG4gIGNvbnN0IHJlc3RvcmVkID0gYXdhaXQgYXV0aC5yZXN0b3JlU2Vzc2lvbigpO1xyXG4gIGlmICghcmVzdG9yZWQub2sgJiYgcmVzdG9yZWQuZXJyb3IuY29kZSA9PT0gXCJuZXR3b3JrXCIpIHN0YXRlLm1hcmtTeW5jRmFpbGVkKCk7XHJcbiAgaWYgKCFhdXRoLmN1cnJlbnRVc2VyKCkpIHN0YXRlLmxvYWRTbmFwc2hvdCgpO1xyXG4gIHJvdXRlci5zdGFydCgpO1xyXG4gIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwiYm9vdFwiKT8ucmVtb3ZlKCk7XHJcbn1cclxuXHJcbmJvb3RzdHJhcCgpLmNhdGNoKChlcnJvcjogdW5rbm93bikgPT4ge1xyXG4gIGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xyXG4gIGNvbnN0IGJvb3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImJvb3RcIik7XHJcbiAgaWYgKGJvb3QpXHJcbiAgICBib290LnRleHRDb250ZW50ID1cclxuICAgICAgXCJcdTA0MURcdTA0MzUgXHUwNDQzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDNFXHUwNDQxXHUwNDRDIFx1MDQzN1x1MDQzMFx1MDQzRlx1MDQ0M1x1MDQ0MVx1MDQ0Mlx1MDQzOFx1MDQ0Mlx1MDQ0QyBcdTA0M0ZcdTA0NDBcdTA0MzhcdTA0M0JcdTA0M0VcdTA0MzZcdTA0MzVcdTA0M0RcdTA0MzhcdTA0MzUuIFx1MDQxRVx1MDQ0Mlx1MDQzQVx1MDQ0MFx1MDQzRVx1MDQzOSBcdTA0M0FcdTA0M0VcdTA0M0RcdTA0NDFcdTA0M0VcdTA0M0JcdTA0NEMgKEYxMikgXHUwNDM4IFx1MDQzRVx1MDQzMVx1MDQzRFx1MDQzRVx1MDQzMlx1MDQzOCBcdTA0NDFcdTA0NDJcdTA0NDBcdTA0MzBcdTA0M0RcdTA0MzhcdTA0NDZcdTA0NDMuXCI7XHJcbn0pO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBSU8sSUFBTSxLQUFLLENBQUksV0FBZ0MsRUFBRSxJQUFJLE1BQU0sTUFBTTtBQUNqRSxJQUFNLE9BQU8sQ0FBSSxXQUFnQyxFQUFFLElBQUksT0FBTyxNQUFNOzs7QUM4Q3BFLElBQU0sWUFBTixNQUErQjtBQUFBLEVBQ3BDLFlBQTZCLE1BQWM7QUFBZDtBQUU3QixnQkFBTztBQUFBLE1BQ0wsVUFBVSxDQUFDLE1BQWMsT0FBZSxhQUN0QyxLQUFLLFFBQWMsUUFBUSxrQkFBa0IsRUFBRSxNQUFNLE9BQU8sU0FBUyxDQUFDO0FBQUEsTUFDeEUsT0FBTyxDQUFDLE9BQWUsYUFDckIsS0FBSyxRQUFjLFFBQVEsZUFBZSxFQUFFLE9BQU8sU0FBUyxDQUFDO0FBQUEs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
