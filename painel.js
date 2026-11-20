(function () {
  "use strict";

  var db = window.db;
  var $ = function (id) { return document.getElementById(id); };

  var loginView = $("login-view");
  var appView = $("app-view");
  var loginForm = $("login-form");
  var emailInput = $("email");
  var passInput = $("password");
  var loginError = $("login-error");
  var loginBtn = $("login-btn");
  var liveEl = $("live");
  var soundBtn = $("sound");
  var logoutBtn = $("logout");
  var boardError = $("board-error");

  /* ---------- Textos e agrupamento ---------- */
  var COLUMNS = {
    "new":  ["received"],
    "prep": ["preparing"],
    "go":   ["ready", "out_for_delivery"],
    "done": ["delivered", "cancelled"]
  };

  var METHOD_LABEL = { pix: "Pix", card: "Cartão", cash: "Dinheiro" };

  var orders = [];
  var channel = null;
  var pollTimer = null;
  var soundOn = true;
  var audioCtx = null;
  var loading = false;

  /* ---------- Utilidades ---------- */
  // Todo texto digitado pelo cliente passa por aqui antes de ir para a tela
  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(value) {
    return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatPhone(digits) {
    var d = String(digits || "").replace(/\D/g, "");
    if (d.length === 11) return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    if (d.length === 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return d;
  }

  function timeOf(iso) {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function minutesAgo(iso) {
    return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  }

  /* ---------- Som de novo pedido ---------- */
  function unlockAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx && Ctx) audioCtx = new Ctx();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { /* sem som */ }
  }

  function beep() {
    if (!soundOn || !audioCtx) return;
    try {
      [0, 0.25].forEach(function (delay) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.value = 0.2;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + delay);
        osc.stop(audioCtx.currentTime + delay + 0.18);
      });
    } catch (e) { /* sem som */ }
  }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? "🔔 Som ligado" : "🔕 Som desligado";
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    if (soundOn) { unlockAudio(); beep(); }
  });

  /* ---------- Telas ---------- */
  function showLogin(message) {
    appView.hidden = true;
    loginView.hidden = false;
    loginError.hidden = !message;
    loginError.textContent = message || "";
    loginBtn.disabled = false;
    loginBtn.textContent = "Entrar";
    document.title = "Painel de pedidos | DevBurguer";
  }

  function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
  }

  /* ---------- Cartões ---------- */
  function nextStep(o) {
    if (o.status === "received") return { to: "preparing", label: "Iniciar preparo" };
    if (o.status === "preparing") {
      return o.mode === "pickup"
        ? { to: "ready", label: "Pronto para retirada" }
        : { to: "out_for_delivery", label: "Saiu para entrega" };
    }
    if (o.status === "ready" || o.status === "out_for_delivery") {
      return { to: "delivered", label: "Marcar como entregue" };
    }
    return null;
  }

  function paymentText(o) {
    var text = METHOD_LABEL[o.payment_method] || o.payment_method;
    if (o.payment_method === "card" && o.card_type) text += " (" + o.card_type + ")";
    if (o.payment_method === "cash") {
      text += o.change_for ? " · troco para " + money(o.change_for) : " · sem troco";
    }
    return text;
  }

  function cardHtml(o) {
    var items = (o.order_items || []).map(function (i) {
      return "<li>" + esc(i.qty) + "x " + esc(i.name) + "</li>";
    }).join("");

    var where = o.mode === "delivery"
      ? "🛵 <strong>Entrega:</strong> " + esc(o.address) +
        ' <a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address || "") +
        '" target="_blank" rel="noopener">ver no mapa</a>'
      : "🏪 <strong>Retirada na loja</strong>";

    var tag = o.status === "cancelled"
      ? '<span class="tag cancelled">Cancelado</span>'
      : o.payment_status === "paid"
        ? '<span class="tag paid">Pago</span>'
        : '<span class="tag">Pagamento pendente</span>';

    var active = o.status !== "delivered" && o.status !== "cancelled";
    var step = nextStep(o);
    var buttons = "";

    if (step) {
      buttons += '<button type="button" class="btn btn-primary" data-action="status" data-to="' +
        esc(step.to) + '" data-id="' + esc(o.id) + '">' + esc(step.label) + "</button>";
    }
    if (active && o.payment_status !== "paid") {
      buttons += '<button type="button" class="btn btn-ghost" data-action="paid" data-id="' +
        esc(o.id) + '">Marcar como pago</button>';
    }
    if (active) {
      buttons += '<button type="button" class="btn btn-danger" data-action="cancel" data-id="' +
        esc(o.id) + '">Cancelar</button>';
    }

    return (
      '<article class="card is-' + esc(o.status) + '">' +
        '<header class="card-head"><strong>#' + esc(o.number) + "</strong>" +
          "<span>" + timeOf(o.created_at) + (active ? " · há " + minutesAgo(o.created_at) + " min" : "") + "</span></header>" +
        "<p><strong>" + esc(o.customer_name) + '</strong> · <a href="tel:' + esc(String(o.customer_phone).replace(/\D/g, "")) + '">' +
          esc(formatPhone(o.customer_phone)) + "</a></p>" +
        "<p>" + where + "</p>" +
        '<ul class="lines">' + items + "</ul>" +
        "<p>💳 " + esc(paymentText(o)) + " · <strong>" + money(o.total) + "</strong> " + tag + "</p>" +
        (buttons ? '<div class="actions">' + buttons + "</div>" : "") +
      "</article>"
    );
  }

  function render() {
    var newCount = 0;

    Object.keys(COLUMNS).forEach(function (col) {
      var list = orders.filter(function (o) { return COLUMNS[col].indexOf(o.status) > -1; });

      // mais antigos primeiro; nos finalizados, os mais recentes primeiro
      list.sort(function (a, b) {
        var diff = new Date(a.created_at) - new Date(b.created_at);
        return col === "done" ? -diff : diff;
      });

      $("count-" + col).textContent = list.length;
      $("list-" + col).innerHTML = list.length
        ? list.map(cardHtml).join("")
        : '<p class="empty-col">Nenhum pedido</p>';

      if (col === "new") newCount = list.length;
    });

    document.title = (newCount ? "(" + newCount + ") " : "") + "Painel de pedidos | DevBurguer";
  }

  /* ---------- Dados ---------- */
  async function loadOrders() {
    if (loading) return;
    loading = true;

    var since = new Date();
    since.setHours(0, 0, 0, 0);

    // pedidos de hoje + qualquer pedido ainda em andamento (mesmo de ontem)
    var result = await db
      .from("orders")
      .select("*, order_items(*)")
      .or("created_at.gte." + since.toISOString() + ",status.in.(received,preparing,ready,out_for_delivery)")
      .order("created_at", { ascending: true });

    loading = false;

    if (result.error) {
      boardError.textContent = "Não foi possível carregar os pedidos: " + result.error.message;
      boardError.hidden = false;
      return;
    }

    boardError.hidden = true;
    orders = result.data || [];
    render();
  }

  async function changeOrder(id, changes) {
    var result = await db.from("orders").update(changes).eq("id", id);
    if (result.error) {
      window.alert("Não foi possível atualizar o pedido: " + result.error.message);
    }
    loadOrders();
  }

  $("board").addEventListener("click", function (event) {
    var button = event.target.closest("button[data-action]");
    if (!button) return;

    var id = button.dataset.id;
    var action = button.dataset.action;

    if (action === "status") {
      changeOrder(id, { status: button.dataset.to });
    } else if (action === "paid") {
      changeOrder(id, { payment_status: "paid" });
    } else if (action === "cancel") {
      if (window.confirm("Cancelar este pedido?")) changeOrder(id, { status: "cancelled" });
    }
  });

  /* ---------- Tempo real ---------- */
  function startRealtime() {
    stopRealtime();

    channel = db
      .channel("pedidos")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, function (payload) {
        if (payload.eventType === "INSERT") beep();
        loadOrders();
      })
      .subscribe(function (status) {
        var live = status === "SUBSCRIBED";
        liveEl.textContent = live ? "● Ao vivo" : "○ Reconectando...";
        liveEl.classList.toggle("on", live);
      });

    // Garantia: se o tempo real cair, a lista ainda atualiza sozinha
    pollTimer = setInterval(loadOrders, 30000);
  }

  function stopRealtime() {
    if (channel) { db.removeChannel(channel); channel = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ---------- Entrada e saída ---------- */
  async function enter() {
    var check = await db.from("admins").select("user_id").maybeSingle();

    if (check.error || !check.data) {
      await db.auth.signOut();
      showLogin("Este usuário não tem acesso ao painel.");
      return;
    }

    showApp();
    await loadOrders();
    startRealtime();
  }

  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    unlockAudio(); // o toque no botão libera o som do navegador

    var email = emailInput.value.trim();
    var password = passInput.value;

    if (!email || !password) {
      loginError.textContent = "Informe e-mail e senha.";
      loginError.hidden = false;
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = "Entrando...";
    loginError.hidden = true;

    var result = await db.auth.signInWithPassword({ email: email, password: password });

    if (result.error) {
      showLogin("E-mail ou senha incorretos.");
      return;
    }

    passInput.value = "";
    await enter();
  });

  logoutBtn.addEventListener("click", async function () {
    stopRealtime();
    await db.auth.signOut();
    orders = [];
    showLogin("");
  });

  /* ---------- Início ---------- */
  if (!db) {
    showLogin("Não foi possível conectar ao sistema. Confira o supabase-config.js.");
    return;
  }

  db.auth.getSession().then(function (result) {
    if (result.data && result.data.session) {
      enter();
    } else {
      showLogin("");
    }
  });
})();
