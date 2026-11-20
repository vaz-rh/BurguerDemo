/* produtos.js
   Fonte única de verdade do DevBurguer: o cardápio (lista de produtos) e o carrinho.
   Carregue este arquivo ANTES de cardapio.js, carrinho.js e pagamento.js. */
(function (global) {
  "use strict";

  var CART_KEY = "devburguer_cart";

  /* ---------- 1. Os produtos ----------
     Cada produto tem um id único que NUNCA deve mudar: o carrinho guarda só o id e a quantidade,
     e busca nome e preço aqui. Assim, se o preço mudar, o carrinho já mostra o valor atualizado. */
  var PRODUCTS = [
    {
      id: "x-burguer",
      emoji: "🍔",
      name: "X-Burguer",
      desc: "Pão brioche, hamburguer 180g, queijo cheddar, alface, tomate e molho especial",
      price: 29.9,
      image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSFdoE358JrGKbwBYdJ_dixpBqGvakPNAngquw23IbrFw&s=10M"
    },
    {
      id: "x-bacon",
      emoji: "🥓",
      name: "X - Bacon",
      desc: "Pão brioche, hamburguer 180g, queijo cheddar, bacon, alface, tomate e molho especial",
      price: 32.9,
      image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRzeviD4R1dw5wmV3T3qOrdSmTFXlKJnxBrUa60SGofUw&s=10"
    },
    {
      id: "bacon-duplo",
      emoji: "🍔",
      name: "Bacon duplo",
      desc: "Pão brioche, dois hamburgueres 180g, queijo cheddar, bacon, alface, tomate e molho especial",
      price: 35.9,
      badge: "Novidade!",
      image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTyeoqyD74KZ3V__jax8sw8rGlqwSLZ2olhW5hiCDFEMA&s=10"
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
      image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS8ygyt43K-hzd2XiRRR7XGKQsP00blc8m9KZDcMVQGcA&s=10"
    }
  ];

  function getProduct(id) {
    return PRODUCTS.find(function (p) { return p.id === id; }) || null;
  }

  /* ---------- 2. Armazenamento: só { id, qty } ---------- */
  function readRows() {
    var parsed;
    try {
      parsed = JSON.parse(localStorage.getItem(CART_KEY));
    } catch (e) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    // Mantém apenas itens que existem no cardápio (descarta itens antigos, de teste ou removidos)
    return parsed
      .map(function (row) {
        return { id: row && row.id, qty: Math.floor(Number(row && row.qty)) };
      })
      .filter(function (row) {
        return getProduct(row.id) && row.qty > 0;
      });
  }

  function writeRows(rows) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(rows));
    } catch (e) { /* armazenamento indisponível: vale só nesta visita */ }
  }

  /* ---------- 3. Funções do carrinho ---------- */

  // Itens completos (nome, preço, descrição...) prontos para mostrar na tela
  function getCart() {
    return readRows().map(function (row) {
      var p = getProduct(row.id);
      return {
        id: p.id,
        name: p.name,
        desc: p.desc,
        price: p.price,
        emoji: p.emoji,
        image: p.image,
        qty: row.qty
      };
    });
  }

  function setQty(id, qty) {
    if (!getProduct(id)) return;
    var rows = readRows();
    var index = rows.findIndex(function (row) { return row.id === id; });

    if (qty <= 0) {
      if (index > -1) rows.splice(index, 1);
    } else if (index > -1) {
      rows[index].qty = qty;
    } else {
      rows.push({ id: id, qty: qty });
    }

    writeRows(rows);
    updateBadge();
  }

  function addToCart(id) {
    var found = readRows().find(function (row) { return row.id === id; });
    setQty(id, (found ? found.qty : 0) + 1);
  }

  function removeFromCart(id) {
    setQty(id, 0);
  }

  function clearCart() {
    writeRows([]);
    updateBadge();
  }

  function count() {
    return readRows().reduce(function (sum, row) { return sum + row.qty; }, 0);
  }

  /* Atualiza o número no ícone do carrinho (#cart-badge), em qualquer página que o tenha */
  function updateBadge() {
    var badge = document.getElementById("cart-badge");
    if (badge) badge.textContent = count();
  }

  global.DevBurguer = {
    products: PRODUCTS,
    getProduct: getProduct,
    getCart: getCart,
    setQty: setQty,
    addToCart: addToCart,
    removeFromCart: removeFromCart,
    clearCart: clearCart,
    count: count,
    updateBadge: updateBadge
  };

  // Ao carregar qualquer página, já mostra a quantidade certa no ícone
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateBadge);
  } else {
    updateBadge();
  }
})(window);
