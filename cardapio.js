(function () {
  "use strict";

  /* ---------- 1. Os produtos (uma única lista, cada um com seu id) ----------
     O id precisa ser único e nunca mudar: é ele que liga o card ao item do carrinho.
     Cole em "image" as URLs completas das suas imagens. */
  var PRODUCTS = [
    {
      id: "x-burguer",            // confira o nome do primeiro item
      emoji: "🍔",
      name: "X-Burguer",
      desc: "Pão brioche, hamburguer 180g, queijo cheddar, alface, tomate e molho especial",
      price: 29.9,
      image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTHY8UrjGa7Y-ITnZIL6Y5P01jA6CWdcizKczg7QrH3FJ6HmQApGdcU61I&s=10"
    },
    {
      id: "x-bacon",
      emoji: "🥓",
      name: "X - Bacon",
      desc: "Pão brioche, hamburguer 180g, queijo cheddar, bacon, alface, tomate e molho especial",
      price: 32.9,
      image: "https://www.seara.com.br/wp-content/uploads/2025/09/x-bacon-portal-minha-receita.jpg"
    },
    {
      id: "bacon-duplo",
      emoji: "🍔",
      name: "Bacon duplo",
      desc: "Pão brioche, dois hamburgueres 180g, queijo cheddar, bacon, alface, tomate e molho especial",
      price: 35.9,
      badge: "Novidade!",
      image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSwndbVBfB0918otKYztDH3JFx18GLr4MVoY6b1oSAkEq_AmG08Z1-EKaE&s=10"
    },
    {
      id: "porcao-batata",
      emoji: "🍟",
      name: "Porção de fritas",
      desc: "Batata frita 300g",
      price: 22.9,
      image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8TeRHKcCe_Qa3xDA4vo8WWEi4AxWe8uXVTn2oefwmXg&s=10"
    },
    {
      id: "coca-cola-350",
      emoji: "🥤",
      name: "Coca Cola",
      desc: "Coca Cola 350ml",
      price: 8.9,
      image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRQ8Q358YXUjNKUfbfIfnG4JQdrVNGq-HZZJ6AUPIJHkw&s=10"
    },
    {
      id: "milkshake",
      emoji: "🥛",
      name: "MilkShake",
      desc: "MilkShake com várias opções de sabores",
      price: 23.9,
      image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRxrn_yBuSJDYwhg4Kfd-D_4JnglY3RKH7wxZzQD3fjsg&s=10"
    }
  ];

  var STORAGE_KEY = "devburguer_cart"; // a mesma chave usada no carrinho.js

  /* ---------- 2. Utilidades ---------- */
  function money(value) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /* ---------- 3. Montar os cards ---------- */
  var grid = document.querySelector(".menu-grid");

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

  grid.innerHTML = PRODUCTS.map(cardHtml).join("");

  /* ---------- 4. Carrinho (mesmo formato do carrinho.js) ---------- */
  function loadCart() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveCart(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) { /* armazenamento indisponível */ }
  }

  function addToCart(productId) {
    // Procura o produto pelo id que veio do botão clicado
    var product = PRODUCTS.find(function (p) { return p.id === productId; });
    if (!product) return;

    var cart = loadCart();
    var existing = cart.find(function (item) { return item.id === productId; });

    if (existing) {
      existing.qty += 1;               // já está no carrinho: só aumenta a quantidade
    } else {
      cart.push({
        id: product.id,
        name: product.name,
        desc: product.desc,
        price: product.price,
        emoji: product.emoji,
        qty: 1
      });
    }

    saveCart(cart);
    updateBadge(cart);
  }

  /* Atualiza o número no ícone do carrinho (se existir na página) */
  function updateBadge(cart) {
    var badge = document.getElementById("cart-badge");
    if (!badge) return;
    badge.textContent = cart.reduce(function (sum, item) { return sum + item.qty; }, 0);
  }

  /* ---------- 5. Clique no botão "Pedir" ---------- */
  grid.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-id]");
    if (!button) return;

    addToCart(button.dataset.id);

    // Confirmação rápida no próprio botão
    var original = button.textContent;
    button.textContent = "Adicionado ✓";
    button.disabled = true;
    setTimeout(function () {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
  });

  updateBadge(loadCart());
})();
