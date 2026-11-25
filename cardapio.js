(function () {
  "use strict";

  /* Os produtos vêm do banco, pelo produtos.js (carregue-o antes deste arquivo) */
  var Store = window.DevBurguer;
  var grid = document.querySelector(".menu-grid");

  if (!grid) return;
  if (!Store) {
    console.error("cardapio.js: carregue produtos.js antes.");
    return;
  }

  function money(value) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML.replace(/"/g, "&quot;");
  }

  function statusItem(message) {
    return '<li class="menu-status">' + escapeHtml(message) + "</li>";
  }

  /* ---------- Montar os cards ---------- */
  function cardHtml(p) {
    var picture = p.image
      ? '<img src="' + escapeHtml(p.image) + '" alt="' + escapeHtml(p.name) + '" loading="lazy">'
      : '<div class="menu-emoji" aria-hidden="true">' + escapeHtml(p.emoji) + "</div>";

    return (
      "<li>" +
        picture +
        (p.badge ? '<span class="badge">' + escapeHtml(p.badge) + "</span>" : "") +
        "<h3>" + escapeHtml(p.name) + "</h3>" +
        "<p>" + escapeHtml(p.desc) + "</p>" +
        "<strong>" + money(p.price) + "</strong>" +
        '<button type="button" class="btn" data-id="' + escapeHtml(p.id) + '">Pedir</button>' +
      "</li>"
    );
  }

  grid.setAttribute("aria-busy", "true");
  grid.innerHTML = statusItem("Carregando cardápio...");

  Store.ready().then(function (status) {
    var products = Store.getProducts();

    if (!status.ok) {
      grid.innerHTML = statusItem("Não foi possível carregar o cardápio agora. Atualize a página em instantes.");
    } else if (products.length === 0) {
      grid.innerHTML = statusItem("O cardápio está indisponível no momento.");
    } else {
      grid.innerHTML = products.map(cardHtml).join("");
    }

    grid.setAttribute("aria-busy", "false");
  });

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
