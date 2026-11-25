/* produtos.js
   Cardápio, taxa de entrega e carrinho do DevBurguer.
   Trabalha com preços em centavos (inteiros) para evitar erros de ponto flutuante. */
(function (global) {
  "use strict";

  var CART_KEY = "devburguer_cart";
  var CATALOG_KEY = "devburguer_catalog";
  var MAX_QTY = 50;

  var products = [];
  var deliveryFeeCents = null;
  var readyPromise = null;

  function toCents(value) {
    var num = Number(value);
    if (isNaN(num)) return 0;
    return Math.round(num * 100);
  }

  function fromCents(cents) {
    return Number((cents / 100).toFixed(2));
  }

  function getProducts() {
    return products.slice();
  }

  function getProduct(id) {
    return products.find(function (p) { return p.id === id; }) || null;
  }

  function getDeliveryFee() {
    return deliveryFeeCents === null ? null : fromCents(deliveryFeeCents);
  }

  function getDeliveryFeeCents() {
    return deliveryFeeCents;
  }

  function applyCatalog(catalog) {
    if (!catalog || !Array.isArray(catalog.products)) return false;
    if (catalog.deliveryFeeCents === null || catalog.deliveryFeeCents === undefined) return false;

    var feeCents = Number(catalog.deliveryFeeCents);
    if (!Number.isInteger(feeCents) || feeCents < 0) return false;

    products = catalog.products;
    deliveryFeeCents = feeCents;
    return true;
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CATALOG_KEY)); } catch (e) { return null; }
  }

  function writeCache(catalog) {
    try { localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog)); } catch (e) { /* ignora */ }
  }

  function fetchCatalog() {
    var db = global.db;
    if (!db) return Promise.reject(new Error("sem conexão com o banco (supabase-config.js)"));

    return Promise.all([
      db.from("products")
        .select("id, name, description, price, emoji, image_url, badge, sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      db.from("settings").select("delivery_fee").eq("id", 1).maybeSingle()
    ]).then(function (results) {
      var productsResult = results[0];
      var settingsResult = results[1];

      if (productsResult.error) throw productsResult.error;
      if (settingsResult.error) throw settingsResult.error;
      if (!settingsResult.data) throw new Error("taxa de entrega não encontrada (tabela settings)");

      return {
        deliveryFeeCents: toCents(settingsResult.data.delivery_fee),
        products: (productsResult.data || []).map(function (row) {
          var priceCents = toCents(row.price);
          return {
            id: row.id,
            name: row.name,
            desc: row.description || "",
            priceCents: priceCents,
            price: fromCents(priceCents),
            emoji: row.emoji || "🍔",
            image: row.image_url || "",
            badge: row.badge || ""
          };
        })
      };
    });
  }

  var hasCatalog = applyCatalog(readCache());

  function ready() {
    if (!readyPromise) {
      readyPromise = fetchCatalog().then(function (catalog) {
        applyCatalog(catalog);
        writeCache(catalog);
        hasCatalog = true;
        prune();
        updateBadge();
        return { ok: true, source: "network" };
      }).catch(function (error) {
        console.error("produtos.js: não foi possível carregar o cardápio.", error);
        return { ok: hasCatalog, source: hasCatalog ? "cache" : "none" };
      });
    }
    return readyPromise;
  }

  function readRows() {
    var parsed;
    try {
      parsed = JSON.parse(localStorage.getItem(CART_KEY));
    } catch (e) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(function (row) {
        return { id: row && row.id, qty: Math.floor(Number(row && row.qty)) };
      })
      .filter(function (row) {
        return typeof row.id === "string" && row.id !== "" && row.qty > 0;
      });
  }

  function writeRows(rows) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(rows));
    } catch (e) { /* armazenamento indisponível */ }
  }

  function prune() {
    var rows = readRows();
    var kept = rows.filter(function (row) { return getProduct(row.id); });
    if (kept.length !== rows.length) writeRows(kept);
  }

  function getCart() {
    return readRows().map(function (row) {
      var p = getProduct(row.id);
      if (!p) return null;
      var qty = Math.min(row.qty, MAX_QTY);
      return {
        id: p.id,
        name: p.name,
        desc: p.desc,
        price: p.price,
        priceCents: p.priceCents,
        subtotalCents: p.priceCents * qty,
        emoji: p.emoji,
        image: p.image,
        qty: qty
      };
    }).filter(Boolean);
  }

  function getTotals(isDelivery) {
    var subtotalCents = getCart().reduce(function (acc, item) {
      return acc + item.subtotalCents;
    }, 0);
    var feeCents = isDelivery && deliveryFeeCents !== null ? deliveryFeeCents : 0;
    var totalCents = subtotalCents + feeCents;
    return {
      subtotalCents: subtotalCents,
      deliveryFeeCents: feeCents,
      totalCents: totalCents,
      subtotal: fromCents(subtotalCents),
      deliveryFee: fromCents(feeCents),
      total: fromCents(totalCents)
    };
  }

  function setQty(id, qty) {
    qty = Math.min(Math.floor(Number(qty)) || 0, MAX_QTY);

    var rows = readRows();
    var index = rows.findIndex(function (row) { return row.id === id; });

    if (qty <= 0) {
      if (index > -1) rows.splice(index, 1);
    } else {
      if (!getProduct(id)) return;
      if (index > -1) rows[index].qty = qty;
      else rows.push({ id: id, qty: qty });
    }

    writeRows(rows);
    updateBadge();
  }

  function addToCart(id) {
    if (!getProduct(id)) return;
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
    var known = products.length > 0;
    return readRows().reduce(function (sum, row) {
      return sum + (!known || getProduct(row.id) ? row.qty : 0);
    }, 0);
  }

  function updateBadge() {
    var badge = document.getElementById("cart-badge");
    if (badge) badge.textContent = count();
  }

  global.DevBurguer = {
    ready: ready,
    toCents: toCents,
    fromCents: fromCents,
    getProducts: getProducts,
    getProduct: getProduct,
    getDeliveryFee: getDeliveryFee,
    getDeliveryFeeCents: getDeliveryFeeCents,
    getCart: getCart,
    getTotals: getTotals,
    setQty: setQty,
    addToCart: addToCart,
    removeFromCart: removeFromCart,
    clearCart: clearCart,
    count: count,
    updateBadge: updateBadge
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateBadge);
  } else {
    updateBadge();
  }
})(window);
