/**
 * Torrent Speed Filter + Best Quality
 * - Тест швидкості до TorrServer
 * - Нічого не приховує: важкі роздачі просто вниз
 * - Найкраща якість зверху
 * - Авто-відкриття найкращої роздачі (можна вимкнути)
 */
(function () {
  "use strict";

  if (window.__isrTorrentSpeedFilterInstalled) return;
  window.__isrTorrentSpeedFilterInstalled = true;

  var SETTING_ENABLED = "torrent_speed_filter_enabled";
  var SETTING_RESERVE = "torrent_speed_filter_reserve";
  var SETTING_AUTO_OPEN = "torrent_speed_filter_auto_open";
  var TEST_DURATION = 5000;
  var opening = false;

  function enabled() {
    var value = Lampa.Storage.get(SETTING_ENABLED, "true");
    return value !== false && value !== "false" && value !== 0 && value !== "0";
  }

  function autoOpenEnabled() {
    var value = Lampa.Storage.get(SETTING_AUTO_OPEN, "true");
    return value !== false && value !== "false" && value !== 0 && value !== "0";
  }

  function reserveMbps() {
    var value = parseInt(Lampa.Storage.get(SETTING_RESERVE, "5"), 10);
    return isFinite(value) && value >= 0 ? value : 5;
  }

  function addSettings() {
    if (!Lampa.SettingsApi || typeof Lampa.SettingsApi.addParam !== "function") return;

    Lampa.SettingsApi.addParam({
      component: "server",
      param: {
        name: SETTING_ENABLED,
        type: "trigger",
        values: "",
        default: true
      },
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
        values: {
          3: "3 Мбіт/с",
          5: "5 Мбіт/с",
          10: "10 Мбіт/с",
          15: "15 Мбіт/с"
        },
        default: "5"
      },
      field: {
        name: "Запас швидкості",
        description: "Віднімається від результату тесту"
      }
    });

    Lampa.SettingsApi.addParam({
      component: "server",
      param: {
        name: SETTING_AUTO_OPEN,
        type: "trigger",
        values: "",
        default: true
      },
      field: {
        name: "Авто-відкриття найкращої",
        description: "Після пошуку автоматично відкриває найкращу роздачу під твою швидкість"
      }
    });
  }

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

  function qualityByBitrate(mbps) {
    if (mbps >= 25) return "4K / висока 1080p";
    if (mbps >= 12) return "1080p";
    if (mbps >= 6) return "720p";
    if (mbps >= 3) return "480p";
    return "низька";
  }

  function getBitrate(torrent, runtime) {
    return parseFloat(Lampa.Utils.calcBitrate(torrent.Size, runtime)) || 0;
  }

  function getSeeders(torrent) {
    return parseInt(torrent.Seeders || torrent.seed || torrent.seeds || 0, 10) || 0;
  }

  /**
   * Сортування:
   * 1. Спочатку роздачі в межах ліміту (найкраща якість зверху)
   * 2. Потім усі інші — вниз списку
   */
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

    function byQuality(a, b) {
      var ba = getBitrate(a, runtime);
      var bb = getBitrate(b, runtime);
      if (bb !== ba) return bb - ba;
      return getSeeders(b) - getSeeders(a);
    }

    safe.sort(byQuality);
    heavy.sort(byQuality);

    return safe.concat(heavy);
  }

  function tryAutoOpenBest(bestTorrent, movie) {
    if (!bestTorrent || !autoOpenEnabled()) return;

    // Невелика затримка, щоб список встиг відмалюватися
    setTimeout(function () {
      try {
        if (Lampa.Torrent && typeof Lampa.Torrent.start === "function") {
          Lampa.Torrent.start(bestTorrent, movie);
          return;
        }
        if (Lampa.Torrent && typeof Lampa.Torrent.open === "function") {
          Lampa.Torrent.open(bestTorrent, movie);
          return;
        }
        // Fallback: клікаємо перший елемент списку, якщо він є
        var first = document.querySelector(
          ".torrent-item, .torrents__item, .files__item, .selector"
        );
        if (first) {
          first.click();
        }
      } catch (e) {
        console.log("[SpeedFilter] auto-open error", e);
      }
    }, 600);
  }

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
          try {
            Lampa.Speedtest.close();
          } catch (e) {}
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

        // Рахуємо скільки "важких" пішло вниз
        var heavyCount = 0;
        original.forEach(function (t) {
          var br = getBitrate(t, runtime);
          if (br > limit) heavyCount++;
        });

        var recommended = qualityByBitrate(limit);
        var message =
          "Швидкість: " +
          measured.toFixed(1) +
          " Мбіт/с → ліміт " +
          limit +
          " Мбіт/с · найкраще: " +
          recommended;

        if (heavyCount) {
          message += " · важких униз: " + heavyCount;
        }

        Lampa.Noty.show(message, { time: 8000 });

        // Найкраща роздача = перша в відсортованому списку (якщо вона в ліміті)
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
