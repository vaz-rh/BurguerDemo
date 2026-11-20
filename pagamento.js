(function () {
  "use strict";

  /* ---------- Configurações ---------- */
  var CHECKOUT_KEY = "devburguer_checkout"; // entrega/retirada e endereço, salvos pelo carrinho.js
  var PIX_KEY = "SUA-CHAVE-PIX-AQUI";       // troque pela chave Pix da loja

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
  var radios = form.querySelectorAll('input[name="payment"]');
  var panels = { pix: $("panel-pix"), card: $("panel-card"), cash: $("panel-cash") };

  /* ---------- Utilidades ---------- */
  function money(value) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

  /* ---------- Dados do pedido (vindos do carrinho.js) ---------- */
  var Store = window.DevBurguer; // produtos e carrinho compartilhados (produtos.js)
  var cart = Store ? Store.getCart() : [];
  var checkout = read(CHECKOUT_KEY);

  var hasOrder =
    cart.length > 0 &&
    checkout &&
    (checkout.mode === "pickup" || (checkout.mode === "delivery" && checkout.address));

  function updateBadge() {
    if (Store) Store.updateBadge();
  }

  updateBadge();

  if (!hasOrder) {
    noOrderEl.hidden = false;
    return; // nada para pagar: mostra só o aviso
  }

  var isPickup = checkout.mode === "pickup";
  var subtotal = cart.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
  var fee = isPickup ? 0 : Number(checkout.fee) || 0;
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

  /* ---------- Mensagem do pedido ---------- */
  function methodLabel(method) {
    var where = isPickup ? "retirada" : "entrega";
    if (method === "pix") return "Pix (vou enviar o comprovante)";
    if (method === "card") return "Cartão de " + cardType.value + " na " + where;

    var change = parseMoney(changeInput.value);
    return "Dinheiro na " + where + (change ? " - troco para " + money(change) : " - sem troco");
  }

  function buildMessage(orderNumber, method) {
    var lines = ["*Novo pedido - DevBurguer*", "Pedido nº " + orderNumber, ""];

    lines.push("Cliente: " + nameInput.value.trim());
    lines.push("Telefone: " + phoneInput.value);
    lines.push("");

    cart.forEach(function (item) {
      lines.push(item.qty + "x " + item.name + " - " + money(item.price * item.qty));
    });

    lines.push("");
    lines.push("Subtotal: " + money(subtotal));
    lines.push(isPickup ? "Retirada na loja" : "Entrega: " + money(fee));
    lines.push("*Total: " + money(total) + "*");
    lines.push("");
    if (!isPickup) lines.push("Endereço: " + checkout.address);
    lines.push("Pagamento: " + methodLabel(method));

    return lines.join("\n");
  }

  /* ---------- Confirmar pedido ---------- */
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearErrors();

    var problems = [];
    var method = selectedMethod();

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
      var change = parseMoney(changeInput.value);
      if (change === null) {
        showError("err-change", "Digite um valor válido, por exemplo 100,00.", changeInput);
        problems.push(changeInput);
      } else if (change < total) {
        showError("err-change", "O valor do troco precisa ser maior ou igual ao total (" + money(total) + ").", changeInput);
        problems.push(changeInput);
      }
    }

    if (problems.length > 0) {
      problems[0].focus();
      return;
    }

    confirmBtn.disabled = true;

    var orderNumber = String(Date.now()).slice(-5);
    var url = "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(buildMessage(orderNumber, method));

    // Tela de confirmação
    $("done-order").textContent = "Pedido nº " + orderNumber + " · Total " + money(total);
    $("done-text").textContent = method === "pix"
      ? "Abra o WhatsApp para enviar o pedido e mande o comprovante do Pix para confirmarmos."
      : "Abra o WhatsApp para enviar o pedido. " + (isPickup ? "Avisaremos quando estiver pronto para retirada." : "Em instantes ele sai para entrega.");
    $("done-whatsapp").href = url;

    // O pedido foi montado: esvazia o carrinho e os dados de entrega
    if (Store) Store.clearCart();
    try { localStorage.removeItem(CHECKOUT_KEY); } catch (e) { /* ignora */ }
    cart = [];
    updateBadge();

    layoutEl.hidden = true;
    doneEl.hidden = false;
    window.scrollTo(0, 0);

    window.open(url, "_blank", "noopener");
  });
})();
