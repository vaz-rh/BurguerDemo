/* pix.js
   Mostra o QR Code do Pix de um pedido e espera a confirmação do pagamento.
   Precisa do supabase-config.js carregado antes (ele define window.DEVBURGUER_API).

   Uso:
     DevBurguerPix.mount(elemento, {
       number: 1001,            // número do pedido
       phone: "41999999999",    // telefone usado no pedido (só números)
       onPaid: function () {},  // pagamento confirmado
       onCancelled: function () {}  // Pix expirou e o pedido foi cancelado
     });
*/
(function () {
  "use strict";

  var POLL_MS = 5000; // consulta a cada 5 segundos

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(value) {
    return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  // action: "create" (gera ou recupera o QR Code) ou "check" (confere se foi pago)
  function callApi(action, order) {
    var api = window.DEVBURGUER_API;
    if (!api) return Promise.reject(new Error("DEVBURGUER_API não configurada"));

    return fetch(api.functionsUrl + "/pix", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: api.key },
      body: JSON.stringify({ action: action, number: order.number, phone: order.phone })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        return { ok: response.ok, status: response.status, data: data };
      });
    });
  }

  function mount(box, options) {
    var order = { number: options.number, phone: String(options.phone || "").replace(/\D/g, "") };
    var pollTimer = null;
    var clockTimer = null;
    var expiresAt = 0;
    var finished = false;
    var checking = false;

    /* ---------- Controle ---------- */
    function stop() {
      finished = true;
      clearTimeout(pollTimer);
      clearInterval(clockTimer);
      document.removeEventListener("visibilitychange", onVisible);
    }

    function onVisible() {
      // Ao voltar do aplicativo do banco, confere na hora
      if (!document.hidden && !finished) {
        clearTimeout(pollTimer);
        check(false);
      }
    }

    function schedule() {
      clearTimeout(pollTimer);
      if (finished) return;
      pollTimer = setTimeout(function () {
        if (document.hidden) schedule(); else check(false);
      }, POLL_MS);
    }

    /* ---------- Telas ---------- */
    function showMessage(text) {
      box.innerHTML = '<p class="pix-hint" role="status">' + esc(text) + "</p>";
    }

    function showRetry(text) {
      box.innerHTML =
        '<div class="pix-ended"><p class="notice cancel" role="alert">' + esc(text) + "</p>" +
        '<button type="button" class="btn btn-primary" data-pix-retry>Tentar de novo</button> ' +
        '<a class="btn btn-outline" href="acompanhar.html">Acompanhar pedido</a></div>';
      box.querySelector("[data-pix-retry]").addEventListener("click", start);
    }

    function showEnded(text) {
      box.innerHTML =
        '<div class="pix-ended"><p class="notice cancel" role="alert">' + esc(text) + "</p>" +
        '<a class="btn btn-primary" href="cardapio.html">Fazer novo pedido</a></div>';
    }

    function renderPix(data) {
      var qr = /^[A-Za-z0-9+\/=]+$/.test(String(data.qr_code_base64 || "")) ? data.qr_code_base64 : "";

      box.innerHTML =
        '<div class="pix-box">' +
          '<p class="pix-total">Valor: <strong>' + money(data.amount) + "</strong></p>" +
          (qr ? '<img class="pix-qr" alt="QR Code do Pix" src="data:image/png;base64,' + qr + '">' : "") +
          '<p class="pix-hint">Abra o aplicativo do seu banco, escolha pagar com Pix e leia o QR Code. ' +
            "Ou copie o código abaixo e use a opção Pix Copia e Cola:</p>" +
          '<div class="pix-row">' +
            '<input type="text" readonly value="' + esc(data.qr_code) + '" aria-label="Pix Copia e Cola">' +
            '<button type="button" class="btn btn-primary" data-pix-copy>Copiar código</button>' +
          "</div>" +
          '<p class="pix-timer" data-pix-timer></p>' +
          '<p class="pix-status" role="status" aria-live="polite" data-pix-status>⏳ Aguardando o pagamento...</p>' +
        "</div>";

      var input = box.querySelector(".pix-row input");
      var copyBtn = box.querySelector("[data-pix-copy]");

      function copied() {
        copyBtn.textContent = "Copiado ✓";
        setTimeout(function () { copyBtn.textContent = "Copiar código"; }, 1500);
      }

      function fallbackCopy() {
        input.focus();
        input.select();
        input.setSelectionRange(0, 99999);
        try { if (document.execCommand("copy")) copied(); } catch (e) { /* o cliente copia manualmente */ }
      }

      copyBtn.addEventListener("click", function () {
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(data.qr_code).then(copied, fallbackCopy);
        } else {
          fallbackCopy();
        }
      });

      expiresAt = new Date(data.expires_at).getTime();
      tickClock();
      clearInterval(clockTimer);
      clockTimer = setInterval(tickClock, 1000);
    }

    function tickClock() {
      var timer = box.querySelector("[data-pix-timer]");
      if (!timer) return;

      var left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      var mm = String(Math.floor(left / 60)).padStart(2, "0");
      var ss = String(left % 60).padStart(2, "0");
      timer.textContent = left > 0 ? "Este código expira em " + mm + ":" + ss : "O tempo do Pix acabou.";

      if (left === 0 && !finished) {
        clearInterval(clockTimer);
        check(true); // última conferência antes de encerrar
      }
    }

    /* ---------- Resultados ---------- */
    function paid() {
      stop();
      var status = box.querySelector("[data-pix-status]");
      if (status) {
        status.textContent = "✅ Pagamento confirmado!";
        status.classList.add("paid");
      }
      if (options.onPaid) options.onPaid();
    }

    function cancelled(text) {
      stop();
      showEnded(text || "O Pix expirou e o pedido foi cancelado. Faça um novo pedido.");
      if (options.onCancelled) options.onCancelled();
    }

    function check(final) {
      if (finished || checking) return;
      // Segurança: se o prazo já passou há mais de 1 minuto, esta é a última conferência
      if (!final && expiresAt && Date.now() > expiresAt + 60000) final = true;
      checking = true;

      callApi("check", order).then(function (res) {
        checking = false;
        if (finished) return;

        if (res.ok && res.data.paid) return paid();
        if (res.ok && res.data.cancelled) return cancelled();
        if (final) return cancelled("O tempo do Pix acabou e o pagamento não foi identificado. Se você já pagou, fale com a loja informando o número do pedido.");
        schedule();
      }).catch(function () {
        checking = false;
        if (final) cancelled("O tempo do Pix acabou. Se você já pagou, fale com a loja informando o número do pedido.");
        else schedule();
      });
    }

    function createFailed(code) {
      if (code === "ALREADY_PAID") return paid();
      if (code === "NOT_PAYABLE") return cancelled("Este pedido não está mais aguardando pagamento.");
      if (code === "NOT_FOUND" || code === "NOT_PIX") return showEnded("Não encontramos este pedido para pagamento com Pix.");
      if (code === "TOO_MANY_ATTEMPTS") return showEnded("Foram feitas muitas tentativas de gerar o Pix. Fale com a loja para concluir o pedido.");
      showRetry("Não foi possível gerar o Pix agora. Seu pedido foi registrado e você pode tentar de novo.");
    }

    /* ---------- Início ---------- */
    function start() {
      finished = false;
      showMessage("Gerando o QR Code do Pix...");
      document.addEventListener("visibilitychange", onVisible);

      callApi("create", order).then(function (res) {
        if (res.ok && res.data && res.data.qr_code) {
          renderPix(res.data);
          schedule();
        } else {
          document.removeEventListener("visibilitychange", onVisible);
          createFailed(res.data && res.data.error);
        }
      }).catch(function () {
        document.removeEventListener("visibilitychange", onVisible);
        showRetry("Não foi possível conectar. Verifique sua internet e tente de novo.");
      });
    }

    start();
    return { stop: stop };
  }

  window.DevBurguerPix = { mount: mount };
})();
