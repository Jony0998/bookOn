/**
 * Admin panel, live: new orders and questions arrive as notifications, the
 * sidebar badges follow the real counts, and an open conversation shows the
 * reader's messages and typing as they happen. Uses the session cookie.
 */
(function () {
  if (typeof io !== "function") return;
  var socket = io({ transports: ["websocket", "polling"] });
  var toasts = document.querySelector(".ad-toasts");
  var thread = document.querySelector(".ad-thread[data-inquiry-id]");
  var inquiryId = thread ? thread.dataset.inquiryId : null;

  var TOPIC = { ORDER: "Buyurtma", BOOK: "Kitob haqida", DELIVERY: "Yetkazib berish", ACCOUNT: "Hisob", OTHER: "Boshqa" };
  var ORDER = { PAUSE: "kutilmoqda", PROCESS: "yoʻlda", FINISH: "qabul qilindi", DELETE: "bekor qilindi" };
  var orderNo = function (id) { return "#" + String(id).slice(-6).toUpperCase(); };
  var money = function (n) { var v = Math.round((Number(n) || 0) * 100) / 100; return "$" + (v % 1 ? v.toFixed(2) : v); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  /** Notification card; text is always set with textContent (never HTML) */
  function toast(title, text, href, linkText) {
    if (!toasts) return;
    var card = el("div", "ad-toast");
    var body = el("div", "ad-toast__body");
    body.appendChild(el("strong", null, title));
    if (text) body.appendChild(el("span", null, text));
    if (href) { var a = el("a", "ad-toast__link", linkText || "Ochish"); a.href = href; body.appendChild(a); }
    var close = el("button", "ad-toast__close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Yopish");
    close.onclick = function () { card.remove(); };
    card.appendChild(body);
    card.appendChild(close);
    toasts.appendChild(card);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    setTimeout(function () { card.remove(); }, 9000);
  }

  /** Keep a sidebar badge equal to the server's count */
  function badge(href, count, title) {
    var link = document.querySelector('.ad-nav a[href="' + href + '"]');
    if (!link || typeof count !== "number") return;
    var b = link.querySelector(".ad-nav__badge");
    if (count <= 0) { if (b) b.remove(); return; }
    if (!b) { b = el("span", "ad-nav__badge"); b.title = title; link.appendChild(b); }
    b.textContent = String(count);
  }
  function counts(p) {
    badge("/admin/order/all", p.pendingOrders, "Kutilayotgan buyurtmalar");
    badge("/admin/inquiry/all", p.newInquiries, "Javob kutayotgan murojaatlar");
  }

  socket.on("order:new", function (p) {
    counts(p);
    toast("Yangi buyurtma " + orderNo(p.orderId), money(p.orderTotal) + " — tasdiqlashni kutmoqda", "/admin/order/all?status=PAUSE", "Buyurtmalarga oʻtish");
  });
  socket.on("order:status", function (p) {
    counts(p);
    if (p.by === "READER") toast("Buyurtma " + orderNo(p.orderId), "Kitobxon: " + (ORDER[p.orderStatus] || p.orderStatus), "/admin/order/all", "Koʻrish");
  });
  socket.on("inquiry:new", function (p) {
    counts(p);
    toast("Yangi murojaat: " + p.name, (TOPIC[p.topic] || "") + " — " + p.preview, "/admin/inquiry/" + p.inquiryId, "Javob berish");
  });
  socket.on("inquiry:reply", function (p) {
    counts(p);
    if (p.inquiryId !== inquiryId) toast(p.name + " yozdi", p.message.messageText.slice(0, 140), "/admin/inquiry/" + p.inquiryId, "Ochish");
  });

  if (!thread) return;

  // ---- an open conversation
  var typing = document.querySelector(".ad-typing");
  var typingTimer = null;
  var join = function () { socket.emit("inquiry:join", { id: inquiryId }); };
  socket.on("connect", join);
  if (socket.connected) join();

  function fmt(date) {
    var months = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
    var d = new Date(date), pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getDate() + "-" + months[d.getMonth()] + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  socket.on("inquiry:message", function (p) {
    if (p.inquiryId !== inquiryId || thread.querySelector('[data-message-id="' + p.message._id + '"]')) return;
    if (typing) typing.hidden = true;
    var mine = p.message.messageFrom === "LIBRARY";
    if (mine) return; // the library's own reply comes back with the page reload after sending
    var li = el("li", "ad-msg");
    li.dataset.messageId = p.message._id;
    li.appendChild(el("span", "ad-msg__who", thread.dataset.readerName + " · " + fmt(p.message.createdAt)));
    li.appendChild(el("div", "ad-msg__bubble", p.message.messageText));
    li.classList.add("is-new");
    thread.appendChild(li);
    li.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  socket.on("inquiry:typing", function (p) {
    if (p.inquiryId !== inquiryId || p.from !== "READER" || !typing) return;
    typing.hidden = false;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(function () { typing.hidden = true; }, 4000);
  });

  var text = document.getElementById("reply-text");
  var last = 0;
  if (text) text.addEventListener("input", function () {
    var now = Date.now();
    if (now - last < 1500) return;
    last = now;
    socket.emit("inquiry:typing", { id: inquiryId });
  });
})();
