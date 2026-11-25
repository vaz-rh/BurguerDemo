(function () {
  "use strict";

  /* ---------- Configurações ---------- */
  var CHECKOUT_KEY = "devburguer_checkout";  // entrega/retirada e endereço, salvos pelo carrinho.js
  var LAST_ORDER_KEY = "devburguer_last_order"; // último pedido (usado na página de acompanhamento)
  var WHATSAPP_LINK = "https://w.app/m4yedv"; // usado só para enviar o comprovante do Pix
  var PIX_KEY = "SUA-CHAVE-PIX-AQUI";         // troque pela chave Pix da loja

  /* ---------- Elementos ---------- */
  var $ = function (id) { return document.getElementById(id); };

  var layoutEl = $("checkout-layout");
  var noOrderEl = $("no-order");
  var doneEl = $("done");
  var form = $("pay-form");
  var nameInput = $("name");
  var phoneInput = $("phone");
  var changeInput = $("change");
  var cardType = $("card-type");
  var pixInput = $("pix-key");
  var copyBtn = $("copy-pix");
  var confirmBtn = $("confirm");
  var submitError = $("err-submit");
  var radios = form.querySelectorAll('input[name="payment"]');
  var panels = { pix: $("panel-pix"), card: $("panel-card"), cash: $("panel-cash") };

  /* ---------- Utilidades ---------- */
  function money(value) {
    return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  function parseMoney(text) {
    var t = String(text).replace(/[^\d,.]/g, "");
    if (!t) return null;
    if (t.indexOf(",") > -1) t = t.replace(/\./g, "").replace(",", ".");
    var n = parseFloat(t);
    return isNaN(n) ? null : n;
  }

  function maskPhone(value) {
    var d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length === 0) return "";
    if (d.length <= 2) return "(" + d;
    if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  }

  var Store = window.DevBurguer; // cardápio, taxa e carrinho (produtos.js)

  function showUnavailable() {
    noOrderEl.querySelector(".empty-title").textContent = "Não foi possível carregar o cardápio";
    noOrderEl.querySelector(".empty-text").textContent = "Verifique sua conexão e volte ao carrinho para tentar de novo.";
    noOrderEl.hidden = false;
  }

  if (!Store) {
    showUnavailable();
    return;
  }

  // Preços e taxa vêm do banco: só monta a página depois de carregá-los
  Store.ready().then(function (status) {
    if (!status.ok) {
      showUnavailable();
      return;
    }
    start();
  });

  function start() {
  /* ---------- Dados do pedido (vindos do carrinho.js) ---------- */
  var cart = Store.getCart();
  var checkout = read(CHECKOUT_KEY);

  var hasOrder =
    cart.length > 0 &&
    checkout &&
    (checkout.mode === "pickup" || (checkout.mode === "delivery" && checkout.address));

  function updateBadge() {
    Store.updateBadge();
  }

  updateBadge();

  if (!hasOrder) {
    noOrderEl.hidden = false;
    return; // nada para pagar: mostra só o aviso
  }

  var isPickup = checkout.mode === "pickup";
  var subtotal = cart.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
  var fee = isPickup ? 0 : Store.getDeliveryFee() || 0; // taxa vem do banco
  var total = subtotal + fee;

  /* ---------- Resumo ---------- */
  function renderSummary() {
    $("mini-list").innerHTML = cart.map(function (item) {
      return (
        "<li><span>" + item.qty + "x " + escapeHtml(item.name) + "</span>" +
        "<span>" + money(item.price * item.qty) + "</span></li>"
      );
    }).join("");

    $("recv").innerHTML = isPickup
      ? "<strong>Retirar na loja</strong><span>Sem taxa de entrega</span>"
      : "<strong>Receber em casa</strong><span>" + escapeHtml(checkout.address) + "</span>";

    $("subtotal").textContent = money(subtotal);
    $("delivery-fee").textContent = isPickup ? "Grátis" : money(fee);
    $("total").textContent = money(total);

    // "Cartão na entrega" ou "Cartão na retirada"
    var where = isPickup ? "retirada" : "entrega";
    Array.prototype.forEach.call(document.querySelectorAll(".where"), function (el) {
      el.textContent = where;
    });
  }

  renderSummary();
  pixInput.value = PIX_KEY;
  layoutEl.hidden = false;

  /* ---------- Erros ---------- */
  function clearErrors() {
    Array.prototype.forEach.call(document.querySelectorAll(".field-error"), function (el) {
      el.hidden = true;
      el.textContent = "";
    });
    nameInput.classList.remove("invalid");
    phoneInput.classList.remove("invalid");
    changeInput.classList.remove("invalid");
  }

  function showError(id, message, input) {
    var el = $(id);
    el.textContent = message;
    el.hidden = false;
    if (input) input.classList.add("invalid");
  }

  /* ---------- Forma de pagamento ---------- */
  function selectedMethod() {
    var chosen = form.querySelector('input[name="payment"]:checked');
    return chosen ? chosen.value : null;
  }

  function showPanel() {
    var method = selectedMethod();
    Object.keys(panels).forEach(function (key) {
      panels[key].hidden = key !== method;
    });
    $("err-payment").hidden = true;
  }

  Array.prototype.forEach.call(radios, function (radio) {
    radio.addEventListener("change", showPanel);
  });

  /* Copiar chave Pix */
  function copyDone() {
    copyBtn.textContent = "Copiado ✓";
    setTimeout(function () { copyBtn.textContent = "Copiar"; }, 1500);
  }

  function copyFallback() {
    pixInput.focus();
    pixInput.select();
    pixInput.setSelectionRange(0, 99999);
    try { if (document.execCommand("copy")) copyDone(); } catch (e) { /* o cliente copia manualmente */ }
  }

  copyBtn.addEventListener("click", function () {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(PIX_KEY).then(copyDone, copyFallback);
    } else {
      copyFallback();
    }
  });

  /* ---------- Campos ---------- */
  phoneInput.addEventListener("input", function () {
    phoneInput.value = maskPhone(phoneInput.value);
    phoneInput.classList.remove("invalid");
    $("err-phone").hidden = true;
  });

  nameInput.addEventListener("input", function () {
    nameInput.classList.remove("invalid");
    $("err-name").hidden = true;
  });

  changeInput.addEventListener("input", function () {
    changeInput.classList.remove("invalid");
    $("err-change").hidden = true;
  });

  /* ---------- Enviar o pedido ao Supabase ---------- */
  function friendlyError(error) {
    var text = (error && error.message) || "";

    if (text.indexOf("PRECO_DIVERGENTE") > -1 || text.indexOf("PRODUTO_INVALIDO") > -1) {
      return "O cardápio foi atualizado. Volte ao carrinho, confira os itens e tente de novo.";
    }
    if (text.indexOf("MUITOS_PEDIDOS") > -1) {
      return "Você fez vários pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.";
    }
    if (text.indexOf("TROCO_INVALIDO") > -1) {
      return "O valor do troco precisa ser maior ou igual ao total do pedido.";
    }
    if (text.indexOf("DADOS_INVALIDOS") > -1) {
      return "Confira seus dados (nome, telefone e endereço) e tente de novo.";
    }
    return "Não foi possível enviar o pedido agora. Verifique sua conexão e tente de novo.";
  }

  function sendOrder(method, changeFor) {
    return window.db.rpc("create_order", {
      p_customer_name: nameInput.value.trim(),
      p_customer_phone: phoneInput.value,
      p_mode: checkout.mode,
      p_address: isPickup ? null : checkout.address,
      p_payment_method: method,
      p_card_type: method === "card" ? cardType.value : null,
      p_change_for: method === "cash" ? changeFor : null,
      p_items: cart.map(function (item) { return { id: item.id, qty: item.qty }; }),
      p_expected_total: Math.round(total * 100) / 100
    });
  }

  function showDone(order, method) {
    var where = isPickup ? "retirada" : "entrega";
    var text;

    if (method === "pix") {
      text = "Pague com o Pix usando a chave abaixo e envie o comprovante pelo WhatsApp. Seu pedido será preparado assim que o pagamento for confirmado.";
    } else if (method === "card") {
      text = "Pagamento com cartão na " + where + ". Já estamos preparando seu pedido!";
    } else {
      text = "Pagamento em dinheiro na " + where + ". Já estamos preparando seu pedido!";
    }

    $("done-order").textContent = "Pedido nº " + order.number + " · Total " + money(order.total);
    $("done-text").textContent = text;

    var pixBox = $("done-pix");
    pixBox.hidden = method !== "pix";
    $("done-pix-key").value = PIX_KEY;
    $("done-whatsapp").href = WHATSAPP_LINK;
    $("done-whatsapp").hidden = method !== "pix";

    layoutEl.hidden = true;
    doneEl.hidden = false;
    window.scrollTo(0, 0);
  }

  $("done-copy-pix").addEventListener("click", function () {
    var button = $("done-copy-pix");
    var box = $("done-pix-key");

    function ok() {
      button.textContent = "Copiado ✓";
      setTimeout(function () { button.textContent = "Copiar"; }, 1500);
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(PIX_KEY).then(ok, function () {});
    } else {
      box.focus();
      box.select();
      box.setSelectionRange(0, 99999);
      try { if (document.execCommand("copy")) ok(); } catch (e) { /* o cliente copia manualmente */ }
    }
  });

  var sending = false;

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (sending) return;
    clearErrors();

    var problems = [];
    var method = selectedMethod();
    var changeFor = null;

    if (nameInput.value.trim().length < 3) {
      showError("err-name", "Informe seu nome completo.", nameInput);
      problems.push(nameInput);
    }

    var phoneDigits = phoneInput.value.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      showError("err-phone", "Informe um telefone com DDD.", phoneInput);
      problems.push(phoneInput);
    }

    if (!method) {
      showError("err-payment", "Escolha uma forma de pagamento.");
      problems.push(radios[0]);
    }

    if (method === "cash" && changeInput.value.trim() !== "") {
      changeFor = parseMoney(changeInput.value);
      if (changeFor === null) {
        showError("err-change", "Digite um valor válido, por exemplo 100,00.", changeInput);
        problems.push(changeInput);
      } else if (changeFor < total) {
        showError("err-change", "O valor do troco precisa ser maior ou igual ao total (" + money(total) + ").", changeInput);
        problems.push(changeInput);
      }
    }

    if (problems.length > 0) {
      problems[0].focus();
      return;
    }

    if (!window.db) {
      showError("err-submit", "Não foi possível conectar ao sistema de pedidos. Tente novamente mais tarde.");
      return;
    }

    sending = true;
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Enviando...";

    sendOrder(method, changeFor).then(function (result) {
      if (result.error || !result.data) {
        showError("err-submit", friendlyError(result.error));
        return;
      }

      var order = result.data;

      // Guarda o número do pedido para acompanhar depois
      try {
        localStorage.setItem(LAST_ORDER_KEY, JSON.stringify({ number: order.number, phone: phoneDigits }));
        localStorage.removeItem(CHECKOUT_KEY);
      } catch (e) { /* ignora */ }

      // O pedido foi recebido: esvazia o carrinho
      if (Store) Store.clearCart();
      cart = [];
      updateBadge();

      showDone(order, method);
    }).catch(function (error) {
      showError("err-submit", friendlyError(error));
    }).then(function () {
      sending = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Confirmar pedido";
    });
  });
  } // fim de start()
})();
