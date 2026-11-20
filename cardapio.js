(function () {
  "use strict";

  /* Os produtos e o carrinho vêm do produtos.js (carregue-o antes deste arquivo) */
  var Store = window.DevBurguer;
  var grid = document.querySelector(".menu-grid");

  if (!Store) {
    console.error("cardapio.js: carregue produtos.js antes.");
    return;
  }
  if (!grid) return;

  function money(value) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /* ---------- Montar os cards ---------- */
  function cardHtml(p) {
    return (
      "<li>" +
        '<img src="' + escapeHtml(p.image) + '" alt="' + escapeHtml(p.name) + '" loading="lazy">' +
        (p.badge ? '<span class="badge">' + escapeHtml(p.badge) + "</span>" : "") +
        "<h3>" + escapeHtml(p.name) + "</h3>" +
        "<p>" + escapeHtml(p.desc) + "</p>" +
        "<strong>" + money(p.price) + "</strong>" +
        '<button type="button" class="btn" data-id="' + escapeHtml(p.id) + '">Pedir</button>' +
      "</li>"
    );
  }

  grid.innerHTML = Store.products.map(cardHtml).join("");

  /* ---------- Clique no botão "Pedir" ---------- */
  grid.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-id]");
    if (!button) return;

    Store.addToCart(button.dataset.id); // já atualiza o número no ícone do carrinho

    var original = button.textContent;
    button.textContent = "Adicionado ✓";
    button.disabled = true;
    setTimeout(function () {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
  });
})();
