(function () {
  "use strict";

  var LAST_ORDER_KEY = "devburguer_last_order";
  var WHATSAPP_LINK = "https://w.app/m4yedv";
  var POLL_MS = 15000;

  var $ = function (id) { return document.getElementById(id); };

  var form = $("track-form");
  var numberInput = $("order-number");
  var phoneInput = $("phone");
  var searchBtn = $("search-btn");
  var errorEl = $("err-track");
  var resultEl = $("result");

  var current = null;
  var timer = null;
  var realtimeChannel = null;
  var searching = false;

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(value) {
    var cents = Math.round(Number(value) * 100);
    return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function timeOf(iso) {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function maskPhone(value) {
    var d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length === 0) return "";
    if (d.length <= 2) return "(" + d;
    if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  /* ---------- Etapas e textos (inclui awaiting_payment) ---------- */
  function stepsFor(order) {
    var isPix = order.payment_method === "pix";
    var base = order.mode === "pickup"
      ? ["Recebido", "Em preparo", "Pronto para retirada", "Retirado"]
      : ["Recebido", "Em preparo", "Saiu para entrega", "Entregue"];

    return isPix ? ["Pagamento Pix"].concat(base) : base;
  }

  function stepIndex(order) {
    var isPix = order.payment_method === "pix";
    var offset = isPix ? 1 : 0;

    switch (order.status) {
      case "awaiting_payment": return 0;
      case "received": return 0 + offset;
      case "preparing": return 1 + offset;
      case "ready":
      case "out_for_delivery": return 2 + offset;
      case "delivered": return 3 + offset;
      default: return -1;
    }
  }

  function headline(order) {
    var pickup = order.mode === "pickup";
    switch (order.status) {
      case "awaiting_payment": return "⏳ Aguardando pagamento do Pix";
      case "received": return "✅ Pedido recebido";
      case "preparing": return "👨‍🍳 Estamos preparando seu pedido";
      case "ready": return "🛍️ Pronto para retirada";
      case "out_for_delivery": return "🛵 Saiu para entrega";
      case "delivered": return pickup ? "😋 Pedido retirado. Bom apetite!" : "😋 Pedido entregue. Bom apetite!";
      case "cancelled": return "❌ Pedido cancelado";
      default: return "Pedido nº " + order.number;
    }
  }

  function paymentNotice(order) {
    if (order.status === "cancelled") return "";

    var where = order.mode === "pickup" ? "retirada" : "entrega";

    if (order.status === "awaiting_payment" || (order.payment_method === "pix" && order.payment_status !== "paid")) {
      return '<p class="notice">Seu pedido só vai para a cozinha após a confirmação do Pix. Se você já pagou, aguarde alguns segundos ou envie o comprovante pelo ' +
        '<a href="' + WHATSAPP_LINK + '" target="_blank" rel="noopener">WhatsApp</a>.</p>';
    }
    if (order.payment_status === "paid") {
      return '<p class="notice">Pagamento confirmado. Obrigado!</p>';
    }
    if (order.payment_method === "card") {
      return '<p class="notice">Pagamento com cartão na ' + where + ".</p>";
    }
    return '<p class="notice">Pagamento em dinheiro na ' + where + ".</p>";
  }

  function render(order) {
    var index = stepIndex(order);
    var labels = stepsFor(order);
    var cancelled = order.status === "cancelled";

    var steps = cancelled ? "" :
      '<ol class="steps" style="--step-cols:' + labels.length + '" aria-label="Etapas do pedido">' +
      labels.map(function (label, i) {
        var cls = i < index ? "done" : i === index ? "current" : "";
        return '<li class="step ' + cls + '"' + (i === index ? ' aria-current="step"' : "") + ">" + esc(label) + "</li>";
      }).join("") +
      "</ol>";

    var items = (order.items || []).map(function (item) {
      return "<li><span>" + esc(item.qty) + "x " + esc(item.name) + "</span></li>";
    }).join("");

    var finished = order.status === "delivered" || cancelled;

    resultEl.innerHTML =
      '<p class="result-head">Pedido nº ' + esc(order.number) + "</p>" +
      '<p class="result-status">' + esc(headline(order)) + "</p>" +
      '<p class="result-time">Atualizado às ' + timeOf(order.updated_at || order.created_at) + "</p>" +
      steps +
      (cancelled
        ? '<p class="notice cancel">Este pedido foi cancelado. Se tiver dúvidas, fale com a gente pelo ' +
          '<a href="' + WHATSAPP_LINK + '" target="_blank" rel="noopener">WhatsApp</a>.</p>'
        : "") +
      paymentNotice(order) +
      '<ul class="mini-list">' + items + "</ul>" +
      '<p class="result-total"><span>Total</span><span>' + money(order.total) + "</span></p>" +
      '<div class="result-actions">' +
        '<a class="btn btn-outline" href="' + WHATSAPP_LINK + '" target="_blank" rel="noopener">Falar com a loja</a>' +
        (finished ? '<a class="btn btn-primary" href="cardapio.html">Fazer novo pedido</a>' : "") +
      "</div>" +
      (finished ? "" : '<p class="result-foot">Atualização automática em tempo real ativa.</p>');

    resultEl.hidden = false;
  }

  /* ---------- Realtime + Fallback Polling ---------- */
  function stopRealtime() {
    if (realtimeChannel && window.db && window.db.removeChannel) {
      window.db.removeChannel(realtimeChannel);
    }
    realtimeChannel = null;
  }

  function startRealtime(orderNumber) {
    if (!window.db || !window.db.channel) return;
    stopRealtime();

    realtimeChannel = window.db
      .channel("order-track-" + orderNumber)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: "number=eq." + orderNumber
        },
        function () {
          lookup(true);
        }
      )
      .subscribe();
  }

  function stopPolling() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function schedule() {
    stopPolling();
    timer = setTimeout(function () {
      if (document.hidden) { schedule(); return; }
      lookup(true);
    }, POLL_MS);
  }

  async function lookup(silent) {
    if (!current || searching) return;

    if (!window.db) {
      showError("Não foi possível conectar ao sistema de pedidos. Tente novamente mais tarde.");
      return;
    }

    searching = true;
    if (!silent) {
      searchBtn.disabled = true;
      searchBtn.textContent = "Buscando...";
      clearError();
    }

    var result;
    try {
      result = await window.db.rpc("get_order_status", {
        p_number: current.number,
        p_phone: current.phone
      });
    } catch (e) {
      result = { error: e };
    }

    searching = false;
    searchBtn.disabled = false;
    searchBtn.textContent = "Acompanhar";

    if (result.error) {
      if (!silent) showError("Não foi possível buscar o pedido agora. Verifique sua conexão e tente de novo.");
      schedule();
      return;
    }

    if (!result.data) {
      stopPolling();
      stopRealtime();
      resultEl.hidden = true;
      showError("Não encontramos esse pedido. Confira o número e o telefone usado no pedido.");
      return;
    }

    clearError();
    render(result.data);

    try {
      localStorage.setItem(LAST_ORDER_KEY, JSON.stringify({ number: current.number, phone: current.phone }));
    } catch (e) { /* ignora */ }

    var status = result.data.status;
    if (status === "delivered" || status === "cancelled") {
      stopPolling();
      stopRealtime();
    } else {
      if (!realtimeChannel) startRealtime(current.number);
      schedule();
    }
  }

  phoneInput.addEventListener("input", function () {
    phoneInput.value = maskPhone(phoneInput.value);
  });

  numberInput.addEventListener("input", function () {
    numberInput.value = numberInput.value.replace(/\D/g, "").slice(0, 9);
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearError();

    var number = numberInput.value.trim();
    var phone = phoneInput.value.replace(/\D/g, "");

    if (!/^\d{1,9}$/.test(number)) {
      showError("Digite o número do pedido (só números).");
      numberInput.focus();
      return;
    }
    if (phone.length < 10) {
      showError("Digite o telefone com DDD, o mesmo usado no pedido.");
      phoneInput.focus();
      return;
    }

    stopPolling();
    stopRealtime();
    current = { number: parseInt(number, 10), phone: phone };
    lookup(false);
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && current) {
      stopPolling();
      lookup(true);
    }
  });

  try {
    var last = JSON.parse(localStorage.getItem(LAST_ORDER_KEY));
    if (last && last.number && last.phone) {
      numberInput.value = last.number;
      phoneInput.value = maskPhone(String(last.phone));
      current = { number: parseInt(last.number, 10), phone: String(last.phone).replace(/\D/g, "") };
      lookup(false);
    }
  } catch (e) { /* ignora */ }
})();
