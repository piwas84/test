/**
 * Torrent Speed Filter + Confirm Open + Multi-Language Voice Priority
 * - Тест швидкості до TorrServer
 * - Важкі роздачі вниз
 * - Найкраща якість зверху
 * - Перед відкриттям питає підтвердження
 * - Пріоритет озвучок: UA / RU / EN / PL / DE / FR / ES / TR + інші
 */
(function () {
  "use strict";

  if (window.__isrTorrentSpeedFilterInstalled) return;
  window.__isrTorrentSpeedFilterInstalled = true;

  // ===== Ключі налаштувань =====
  var SETTING_ENABLED      = "torrent_speed_filter_enabled";
  var SETTING_RESERVE      = "torrent_speed_filter_reserve";
  var SETTING_AUTO_OPEN    = "torrent_speed_filter_auto_open";
  var SETTING_ASK_OPEN     = "torrent_speed_filter_ask_open";

  var SETTING_VOICE_UA     = "torrent_voice_ua";
  var SETTING_VOICE_RU     = "torrent_voice_ru";
  var SETTING_VOICE_EN     = "torrent_voice_en";
  var SETTING_VOICE_PL     = "torrent_voice_pl";
  var SETTING_VOICE_DE     = "torrent_voice_de";
  var SETTING_VOICE_FR     = "torrent_voice_fr";
  var SETTING_VOICE_ES     = "torrent_voice_es";
  var SETTING_VOICE_TR     = "torrent_voice_tr";
  var SETTING_VOICE_OTHER  = "torrent_voice_other";

  var TEST_DURATION = 5000;
  var opening = false;

  // ===== Допоміжні функції =====
  function enabled() {
    var value = Lampa.Storage.get(SETTING_ENABLED, "true");
    return value !== false && value !== "false" && value !== 0 && value !== "0";
  }

  function autoOpenEnabled() {
    var value = Lampa.Storage.get(SETTING_AUTO_OPEN, "true");
    return value !== false && value !== "false" && value !== 0 && value !== "0";
  }

  function askBeforeOpen() {
    var value = Lampa.Storage.get(SETTING_ASK_OPEN, "true");
    return value !== false && value !== "false" && value !== 0 && value !== "0";
  }

  function reserveMbps() {
    var value = parseInt(Lampa.Storage.get(SETTING_RESERVE, "5"), 10);
    return isFinite(value) && value >= 0 ? value : 5;
  }

  function getTitle(torrent) {
    return (torrent.Title || torrent.title || torrent.name || torrent.path || "") + "";
  }

  function getBitrate(torrent, runtime) {
    return parseFloat(Lampa.Utils.calcBitrate(torrent.Size, runtime)) || 0;
  }

  function getSeeders(torrent) {
    return parseInt(torrent.Seeders || torrent.seed || torrent.seeds || 0, 10) || 0;
  }

  function qualityByBitrate(mbps) {
    if (mbps >= 25) return "4K / висока 1080p";
    if (mbps >= 12) return "1080p";
    if (mbps >= 6) return "720p";
    if (mbps >= 3) return "480p";
    return "низька";
  }

  // ===== Оцінка озвучки (чим більше — тим вище) =====
  function getVoiceScore(text) {
    if (!text) return 0;
    text = (text + "").toLowerCase();
    var score = 0;

    // Українська (найвищий пріоритет)
    if (Lampa.Storage.get(SETTING_VOICE_UA, true) !== false) {
      if (/україн|укр\.|укр |ua |ukrainian|українськ/.test(text)) score += 100;
    }

    // Російська
    if (Lampa.Storage.get(SETTING_VOICE_RU, true) !== false) {
      if (/російськ|русск|russian|rus |ru |рус\./.test(text)) score += 90;
    }

    // Англійська
    if (Lampa.Storage.get(SETTING_VOICE_EN, true) !== false) {
      if (/english|eng |en |англ/.test(text)) score += 80;
    }

    // Польська
    if (Lampa.Storage.get(SETTING_VOICE_PL, false) === true) {
      if (/polski|polish|pl |польськ/.test(text)) score += 70;
    }

    // Німецька
    if (Lampa.Storage.get(SETTING_VOICE_DE, false) === true) {
      if (/deutsch|german|de |німецьк|немецк/.test(text)) score += 60;
    }

    // Французька
    if (Lampa.Storage.get(SETTING_VOICE_FR, false) === true) {
      if (/français|french|fr |франц/.test(text)) score += 50;
    }

    // Іспанська
    if (Lampa.Storage.get(SETTING_VOICE_ES, false) === true) {
      if (/español|spanish|es |іспан|испан/.test(text)) score += 40;
    }

    // Турецька
    if (Lampa.Storage.get(SETTING_VOICE_TR, false) === true) {
      if (/türkçe|turkish|tr |турецьк/.test(text)) score += 30;
    }

    // Інші мітки
    if (Lampa.Storage.get(SETTING_VOICE_OTHER, false) === true) {
      if (/multi|дубляж|озвуч|voice|audio|sub/.test(text)) score += 10;
    }

    return score;
  }

  // ===== Налаштування =====
  function addSettings() {
    if (!Lampa.SettingsApi || typeof Lampa.SettingsApi.addParam !== "function") return;

    // --- Основні ---
    Lampa.SettingsApi.addParam({
      component: "server",
      param: { name: SETTING_ENABLED, type: "trigger", default: true },
      field: {
        name: "Фільтр торрентів по швидкості",
        description: "Тест швидкості + сортування: найкраща якість зверху, важкі роздачі вниз"
      }
    });

    Lampa.SettingsApi.addParam({
      component: "server",
      param: {
        name: SETTING_RESERVE,
        type: "select",
        values: { 3: "3 Мбіт/с", 5: "5 Мбіт/с", 10: "10 Мбіт/с", 15: "15 Мбіт/с" },
        default: "5"
      },
      field: {
        name: "Запас швидкості",
        description: "Віднімається від результату тесту"
      }
    });

    Lampa.SettingsApi.addParam({
      component: "server",
      param: { name: SETTING_AUTO_OPEN, type: "trigger", default: true },
      field: {
        name: "Авто-відкриття найкращої",
        description: "Після пошуку пропонує відкрити найкращу роздачу"
      }
    });

    Lampa.SettingsApi.addParam({
      component: "server",
      param: { name: SETTING_ASK_OPEN, type: "trigger", default: true },
      field: {
        name: "Питати перед відкриттям",
        description: "Завжди питати підтвердження перед відкриттям роздачі"
      }
    });

    // --- Пріоритет мов ---
    Lampa.SettingsApi.addParam({
      component: "server",
      param: { name: SETTING_VOICE_UA, type: "trigger", default: true },
      field: { name: "Пріоритет: Українська", description: "Піднімати українську озвучку" }
    });

    Lampa.SettingsApi.addParam({
      component: "server",
      param: { name: SETTING_VOICE_RU, type: "trigger", default: true },
      field: { name: "Пріоритет: Російська", description: "Піднімати російську озвучку" }
    });

    Lampa.SettingsApi.addParam({
      component: "server",
      param: { name: SETTING_VOICE_EN, type: "trigger", default: true },
      field: { name: "Пріоритет: Англійська", description: "Піднімати англійську озвучку" }
    });

    Lampa.SettingsApi.addParam({
      component: "server",
      param: { name: SETTING_VOICE_PL, type: "trigger", default: false },
      field: { name: "Пріоритет: Польська", description: "Піднімати польську озвучку" }
    });

    Lampa.SettingsApi.addParam({
      component: "server",
      param: { name: SETTING_VOICE_DE, type: "trigger", default: false },
      field: { name: "Пріоритет: Німецька", description: "Піднімати німецьку озвучку" }
    });

    Lampa.SettingsApi.addParam({
      component: "server",
      param: { name: SETTING_VOICE_FR, type: "trigger", default: false },
      field: { name: "Пріоритет: Французька", description: "Піднімати французьку озвучку" }
    });

    Lampa.SettingsApi.addParam({
      component: "server",
      param: { name: SETTING_VOICE_ES, type: "trigger", default: false },
      field: { name: "Пріоритет: Іспанська", description: "Піднімати іспанську озвучку" }
    });

    Lampa.SettingsApi.addParam({
      component: "server",
      param: { name: SETTING_VOICE_TR, type: "trigger", default: false },
      field: { name: "Пріоритет: Турецька", description: "Піднімати турецьку озвучку" }
    });

    Lampa.SettingsApi.addParam({
      component: "server",
      param: { name: SETTING_VOICE_OTHER, type: "trigger", default: false },
      field: { name: "Пріоритет: Інші мітки", description: "Multi, дубляж, voice, audio тощо" }
    });
  }

  // ===== Тест швидкості =====
  function testParams(onEnd, onBack) {
    var params = {
      url: Lampa.Torserver.url() + "/download/300",
      duration: TEST_DURATION,
      onEnd: onEnd,
      onBack: onBack
    };

    if (Lampa.Storage.field("torrserver_auth")) {
      params.login = Lampa.Storage.get("torrserver_login");
      params.password = Lampa.Storage.value("torrserver_password");
    }

    return params;
  }

  function canMeasure(object) {
    return (
      object &&
      object.component === "torrents" &&
      object.movie &&
      parseFloat(object.movie.runtime) > 0
    );
  }

  // ===== Сортування =====
  function sortResults(list, runtime, limit) {
    var safe = [];
    var heavy = [];

    list.forEach(function (torrent) {
      var bitrate = getBitrate(torrent, runtime);
      if (bitrate > 0 && bitrate <= limit) {
        safe.push(torrent);
      } else {
        heavy.push(torrent);
      }
    });

    function byQualityAndVoice(a, b) {
      var aScore = getVoiceScore(getTitle(a));
      var bScore = getVoiceScore(getTitle(b));
      if (bScore !== aScore) return bScore - aScore;

      var ba = getBitrate(a, runtime);
      var bb = getBitrate(b, runtime);
      if (bb !== ba) return bb - ba;

      return getSeeders(b) - getSeeders(a);
    }

    safe.sort(byQualityAndVoice);
    heavy.sort(byQualityAndVoice);

    return safe.concat(heavy);
  }

  // ===== Відкриття роздачі =====
  function openTorrent(bestTorrent, movie) {
    try {
      if (Lampa.Torrent && typeof Lampa.Torrent.start === "function") {
        Lampa.Torrent.start(bestTorrent, movie);
        return;
      }
      if (Lampa.Torrent && typeof Lampa.Torrent.open === "function") {
        Lampa.Torrent.open(bestTorrent, movie);
        return;
      }
      var first = document.querySelector(
        ".torrent-item, .torrents__item, .files__item, .selector"
      );
      if (first) first.click();
    } catch (e) {
      console.log("[SpeedFilter] open error", e);
    }
  }

  function tryAutoOpenBest(bestTorrent, movie) {
    if (!bestTorrent || !autoOpenEnabled()) return;

    setTimeout(function () {
      if (askBeforeOpen()) {
        var title = getTitle(bestTorrent);
        var shortTitle = title.length > 70 ? title.substring(0, 67) + "..." : title;

        Lampa.Select.show({
          title: "Відкрити роздачу?",
          items: [
            {
              title: "Так, відкрити",
              subtitle: shortTitle,
              selected: true,
              action: function () {
                openTorrent(bestTorrent, movie);
              }
            },
            {
              title: "Ні, залишитись у списку",
              action: function () {}
            }
          ],
          onBack: function () {}
        });
      } else {
        openTorrent(bestTorrent, movie);
      }
    }, 700);
  }

  // ===== Основна логіка =====
  function install() {
    if (!Lampa.Activity || !Lampa.Parser || !Lampa.Speedtest) return;

    var activityPush = Lampa.Activity.push;
    var parserGet = Lampa.Parser.get;

    Lampa.Activity.push = function () {
      var context = this;
      var args = Array.prototype.slice.call(arguments);
      var object = args[0];

      if (opening && canMeasure(object)) return;

      if (!enabled() || !canMeasure(object) || object._speed_filter_checked) {
        return activityPush.apply(context, args);
      }

      opening = true;
      var controller = Lampa.Controller.enabled().name;
      var completed = false;

      function resume(speed) {
        if (completed) return;

        var measured = parseFloat(speed) || 0;
        completed = true;
        opening = false;
        object._speed_filter_checked = true;
        object._speed_filter_measured = measured;

        var limit = Math.floor(measured) - reserveMbps();
        if (limit > 0) {
          object._speed_filter_limit = limit;
        } else {
          Lampa.Noty.show("Не вдалося визначити безпечний бітрейт — сортування без ліміту", {
            time: 6000
          });
        }

        setTimeout(function () {
          try { Lampa.Speedtest.close(); } catch (e) {}
          activityPush.apply(context, args);
        }, 50);
      }

      function cancel() {
        opening = false;
        if (!completed) Lampa.Controller.toggle(controller);
      }

      Lampa.Speedtest.start(testParams(resume, cancel));
    };

    Lampa.Parser.get = function () {
      var context = this;
      var args = Array.prototype.slice.call(arguments);
      var params = args[0] || {};
      var success = args[1];
      var limit = parseFloat(params._speed_filter_limit);
      var runtime = params.movie && parseFloat(params.movie.runtime);
      var measured = parseFloat(params._speed_filter_measured) || 0;

      if (
        !enabled() ||
        !isFinite(limit) ||
        limit <= 0 ||
        !runtime ||
        typeof success !== "function"
      ) {
        return parserGet.apply(context, args);
      }

      args[1] = function (data) {
        if (!data || !Array.isArray(data.Results)) {
          return success.apply(this, arguments);
        }

        var output = {};
        Object.keys(data).forEach(function (key) {
          output[key] = data[key];
        });

        var original = data.Results.slice();
        output.Results = sortResults(original, runtime, limit);

        var heavyCount = 0;
        original.forEach(function (t) {
          if (getBitrate(t, runtime) > limit) heavyCount++;
        });

        var recommended = qualityByBitrate(limit);
        var message =
          "Швидкість: " + measured.toFixed(1) +
          " Мбіт/с → ліміт " + limit +
          " Мбіт/с · найкраще: " + recommended;

        if (heavyCount) message += " · важких униз: " + heavyCount;

        Lampa.Noty.show(message, { time: 8000 });

        var best = output.Results[0];
        var bestBitrate = best ? getBitrate(best, runtime) : 0;
        if (best && bestBitrate > 0 && bestBitrate <= limit) {
          tryAutoOpenBest(best, params.movie);
        }

        success.call(this, output);
      };

      return parserGet.apply(context, args);
    };
  }

  function start() {
    addSettings();
    install();
  }

  if (window.appready) {
    start();
  } else {
    var ready = function (event) {
      if (!event || event.type !== "ready") return;
      Lampa.Listener.remove("app", ready);
      start();
    };
    Lampa.Listener.follow("app", ready);
  }
})();
