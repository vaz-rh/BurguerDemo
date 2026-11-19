(function () {
  "use strict";

  /* ---------- Configurações ---------- */
  var STORAGE_KEY = "devburguer_cart";
  var DELIVERY_FEE = 6;               // taxa de entrega em reais

  // Itens de exemplo: aparecem só na primeira visita, para você testar a página.
  // Quando o cardápio estiver pronto, ele deve salvar o carrinho com addToCart().
  var DEMO_ITEMS = [
    { id: "x-burguer",  emoji: "🍔", name: "Classic Burguer", desc: "Pão brioche, blend 160 g, queijo e molho da casa", price: 28.9, qty: 2 },
    { id: "x-bacon",    emoji: "🥓", name: "Bacon Dev",       desc: "Blend 160 g, bacon crocante e cheddar",           price: 34.5, qty: 1 },
    { id: "porcao-batata",    emoji: "🍟", name: "Batata frita",    desc: "Porção individual",                               price: 14.0, qty: 1 },
    { id: "coca-cola-350",     emoji: "🥤", name: "Refrigerante lata", desc: "350 ml",                                        price: 6.0,  qty: 2 }
  ];

  /* ---------- Elementos ---------- */
  var $ = function (id) { return document.getElementById(id); };

  var listEl = $("item-list");
  var emptyEl = $("empty");
  var badgeEl = $("cart-badge");
  var subtotalEl = $("subtotal");
  var feeEl = $("delivery-fee");
  var totalEl = $("total");
  var feeLabelEl = $("fee-label");
  var optDelivery = $("opt-entrega");
  var optPickup = $("opt-retirada");
  var addressBox = $("address-box");
  var addressInput = $("address");
  var addressError = $("address-error");
  var checkoutBtn = $("checkout");
  var clearBtn = $("clear-cart");

  /* ---------- Armazenamento ---------- */
  function loadCart() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        saveCart(DEMO_ITEMS);
        return DEMO_ITEMS.slice();
      }
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return DEMO_ITEMS.slice();
    }
  }

  function saveCart(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) { /* armazenamento indisponível: o carrinho vale só nesta visita */ }
  }

  var cart = loadCart();

  /* ---------- Utilidades ---------- */
  function money(value) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function isPickup() {
    return optPickup.checked;
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /* ---------- Renderização ---------- */
  function render() {
    listEl.innerHTML = cart.map(function (item) {
      var lineTotal = item.price * item.qty;
      return (
        '<li class="item" data-id="' + escapeHtml(item.id) + '">' +
          '<div class="item-thumb" aria-hidden="true">' + (item.emoji || "🍔") + "</div>" +
          "<div>" +
            '<p class="item-name">' + escapeHtml(item.name) + "</p>" +
            (item.desc ? '<p class="item-desc">' + escapeHtml(item.desc) + "</p>" : "") +
            '<p class="item-unit">' + money(item.price) + " cada</p>" +
          "</div>" +
          '<div class="item-side">' +
            '<div class="qty" role="group" aria-label="Quantidade de ' + escapeHtml(item.name) + '">' +
              '<button type="button" data-action="dec" aria-label="Diminuir quantidade">−</button>' +
              "<output>" + item.qty + "</output>" +
              '<button type="button" data-action="inc" aria-label="Aumentar quantidade">+</button>' +
            "</div>" +
            '<span class="item-price">' + money(lineTotal) + "</span>" +
            '<button type="button" class="remove" data-action="remove">Remover</button>' +
          "</div>" +
        "</li>"
      );
    }).join("");

    var hasItems = cart.length > 0;
    emptyEl.hidden = hasItems;
    listEl.hidden = !hasItems;
    checkoutBtn.disabled = !hasItems;

    updateTotals();
  }

  function updateTotals() {
    var subtotal = cart.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
    var count = cart.reduce(function (sum, item) { return sum + item.qty; }, 0);
    var fee = cart.length === 0 || isPickup() ? 0 : DELIVERY_FEE;

    subtotalEl.textContent = money(subtotal);
    feeEl.textContent = fee === 0 && cart.length > 0 && isPickup() ? "Grátis" : money(fee);
    totalEl.textContent = money(subtotal + fee);
    feeLabelEl.textContent = money(DELIVERY_FEE);
    badgeEl.textContent = count;

    addressBox.hidden = isPickup();
    if (isPickup()) hideAddressError();
  }

  /* ---------- Ações nos itens ---------- */
  listEl.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-action]");
    if (!button) return;

    var li = button.closest(".item");
    var index = cart.findIndex(function (item) { return item.id === li.dataset.id; });
    if (index === -1) return;

    var action = button.dataset.action;

    if (action === "inc") {
      cart[index].qty += 1;
    } else if (action === "dec") {
      cart[index].qty -= 1;
      if (cart[index].qty <= 0) cart.splice(index, 1);
    } else if (action === "remove") {
      cart.splice(index, 1);
    }

    saveCart(cart);
    render();
  });

  clearBtn.addEventListener("click", function () {
    if (cart.length === 0) return;
    if (window.confirm("Deseja remover todos os itens do carrinho?")) {
      cart = [];
      saveCart(cart);
      render();
    }
  });

  /* ---------- Retirar ou receber em casa ----------
     Duas caixas de seleção que se alternam: sempre uma delas fica marcada. */
  function choose(mode) {
    optDelivery.checked = mode === "delivery";
    optPickup.checked = mode === "pickup";
    updateTotals();
  }

  optDelivery.addEventListener("change", function () {
    choose(optDelivery.checked ? "delivery" : "pickup");
  });

  optPickup.addEventListener("change", function () {
    choose(optPickup.checked ? "pickup" : "delivery");
  });

  /* ---------- Endereço ---------- */
  function showAddressError() {
    addressError.hidden = false;
    addressInput.classList.add("invalid");
    addressInput.focus();
  }

  function hideAddressError() {
    addressError.hidden = true;
    addressInput.classList.remove("invalid");
  }

  addressInput.addEventListener("input", hideAddressError);

  /* ---------- Finalizar pedido (envia pelo WhatsApp) ---------- */
  checkoutBtn.addEventListener("click", function () {
    if (cart.length === 0) return;

    var address = addressInput.value.trim();
    if (!isPickup() && address === "") {
      showAddressError();
      return;
    }

    var subtotal = cart.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
    var fee = isPickup() ? 0 : DELIVERY_FEE;

    var lines = ["*Novo pedido - DevBurguer*", ""];
    cart.forEach(function (item) {
      lines.push(item.qty + "x " + item.name + " - " + money(item.price * item.qty));
    });
    lines.push("");
    lines.push("Subtotal: " + money(subtotal));
    lines.push(isPickup() ? "Retirada na loja" : "Entrega: " + money(fee));
    lines.push("*Total: " + money(subtotal + fee) + "*");
    if (!isPickup()) lines.push("", "Endereço: " + address);

  });

  /* ---------- Função para usar na página do cardápio ----------
     Exemplo: addToCart({ id: "classic", name: "Classic Burguer", price: 28.9, emoji: "🍔" }) */
  window.addToCart = function (product) {
    var current = loadCart();
    var found = current.find(function (item) { return item.id === product.id; });
    if (found) {
      found.qty += 1;
    } else {
      current.push({
        id: product.id,
        name: product.name,
        desc: product.desc || "",
        price: product.price,
        emoji: product.emoji || "🍔",
        qty: 1
      });
    }
    saveCart(current);
  };

  render();
})();
