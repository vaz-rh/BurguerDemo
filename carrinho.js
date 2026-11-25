(function () {
  "use strict";

  /* ---------- Configurações ---------- */
  var CHECKOUT_KEY = "devburguer_checkout";  // entrega/retirada e endereço, lidos pela página de pagamento

  /* Produtos e carrinho vêm do produtos.js (carregue-o antes deste arquivo) */
  var Store = window.DevBurguer;
  if (!Store) {
    console.error("carrinho.js: carregue produtos.js antes.");
    return;
  }

  // A taxa vem do banco (tabela settings), pelo produtos.js
  function deliveryFee() {
    return Store.getDeliveryFee() || 0;
  }

  /* ---------- Elementos ---------- */
  var $ = function (id) { return document.getElementById(id); };

  var listEl = $("item-list");
  var emptyEl = $("empty");
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
  var loadErr = $("err-load");

  var cart = []; // itens completos, relidos do produtos.js a cada render()

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
    cart = Store.getCart();

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
    var fee = cart.length === 0 || isPickup() ? 0 : deliveryFee();

    subtotalEl.textContent = money(subtotal);
    feeEl.textContent = fee === 0 && cart.length > 0 && isPickup() ? "Grátis" : money(fee);
    totalEl.textContent = money(subtotal + fee);
    feeLabelEl.textContent = money(deliveryFee());

    addressBox.hidden = isPickup();
    if (isPickup()) hideAddressError();

    Store.updateBadge();
  }

  /* ---------- Ações nos itens ---------- */
  listEl.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-action]");
    if (!button) return;

    var id = button.closest(".item").dataset.id;
    var item = cart.find(function (row) { return row.id === id; });
    if (!item) return;

    var action = button.dataset.action;

    if (action === "inc") {
      Store.setQty(id, item.qty + 1);
    } else if (action === "dec") {
      Store.setQty(id, item.qty - 1); // chegando a zero, o item sai do carrinho
    } else if (action === "remove") {
      Store.removeFromCart(id);
    }

    render();
  });

  clearBtn.addEventListener("click", function () {
    if (cart.length === 0) return;
    if (window.confirm("Deseja remover todos os itens do carrinho?")) {
      Store.clearCart();
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

  /* ---------- Finalizar pedido: segue para a página de pagamento ---------- */
  checkoutBtn.addEventListener("click", function () {
    if (cart.length === 0) return;

    var address = addressInput.value.trim();
    if (!isPickup() && address === "") {
      showAddressError();
      return;
    }

    try {
      localStorage.setItem(CHECKOUT_KEY, JSON.stringify({
        mode: isPickup() ? "pickup" : "delivery",
        address: isPickup() ? "" : address
      }));
    } catch (e) { /* armazenamento indisponível */ }

    window.location.href = "pagamento.html";
  });

  /* Só mostra o carrinho depois de carregar o cardápio e a taxa do banco */
  Store.ready().then(function (status) {
    if (!status.ok) {
      loadErr.textContent = "Não foi possível carregar o cardápio. Verifique sua conexão e atualize a página.";
      loadErr.hidden = false;
      return;
    }

    // Se o cliente voltou da página de pagamento, recupera a escolha e o endereço
    try {
      var saved = JSON.parse(localStorage.getItem(CHECKOUT_KEY));
      if (saved) {
        choose(saved.mode === "pickup" ? "pickup" : "delivery");
        addressInput.value = saved.address || "";
      }
    } catch (e) { /* ignora */ }

    render();
  });
})();
