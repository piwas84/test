(function () {
    'use strict';

    if (window.timecode_scale_card_v2) return;
    window.timecode_scale_card_v2 = true;

    // ===== Налаштування =====
    var SETTINGS = {
        show_time: true,
        show_percent: true,
        offset: 8,
        prefer_voice: true,       // пріоритет UA / RU озвучки
        ask_before_torrent: true  // питати перед автозапуском торрента
    };

    function loadSettings() {
        SETTINGS.show_time        = Lampa.Storage.get('tsc_show_time', true);
        SETTINGS.show_percent     = Lampa.Storage.get('tsc_show_percent', true);
        SETTINGS.offset           = parseInt(Lampa.Storage.get('tsc_offset', 8));
        SETTINGS.prefer_voice     = Lampa.Storage.get('tsc_prefer_voice', true);
        SETTINGS.ask_before_torrent = Lampa.Storage.get('tsc_ask_torrent', true);
    }

    function formatTime(sec) {
        if (!sec || isNaN(sec) || sec < 0) return '00:00';
        sec = Math.floor(sec);
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        if (h > 0) {
            return (h < 10 ? '0' + h : h) + ':' +
                   (m < 10 ? '0' + m : m) + ':' +
                   (s < 10 ? '0' + s : s);
        }
        return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
    }

    // ===== Перевірка озвучки =====
    function hasPreferredVoice(text) {
        if (!text) return false;
        text = (text + '').toLowerCase();
        return /україн|укр\.|укр |ua |ukrainian|російськ|русск|russian|rus |ru /.test(text);
    }

    // ===== Шкала таймкоду =====
    function addTimecodeScale(card) {
        try {
            if (!card || !card.data || !card.html) return;

            var data = card.data;
            var hash = null;

            if (data.original_title && !data.original_name) {
                hash = Lampa.Utils.hash(data.original_title);
            } else if (data.original_name) {
                hash = Lampa.Utils.hash(data.original_name);
            }
            if (!hash) return;

            var view = Lampa.Timeline.view(hash);
            if (!view || !view.percent || view.percent <= 0) return;

            var $card = $(card.html);
            var $view = $card.find('.card__view');
            if (!$view.length) return;

            $view.find('.timecode-scale').remove();

            var percent = Math.round(view.percent || 0);
            var parts = [];

            if (SETTINGS.show_time) {
                parts.push(formatTime(view.time) + ' / ' + formatTime(view.duration));
            }
            if (SETTINGS.show_percent) {
                parts.push(percent + '%');
            }
            if (parts.length === 0) return;

            var text = parts.join('  ·  ');

            var $scale = $(`
                <div class="timecode-scale" data-hash="\( {hash}" style="top: \){SETTINGS.offset}px">
                    <div class="timecode-scale__bar">
                        <div class="timecode-scale__fill" style="width:${percent}%"></div>
                    </div>
                    <div class="timecode-scale__text">${text}</div>
                </div>
            `);

            $view.append($scale);
        } catch (e) {}
    }

    function injectStyles() {
        if (document.getElementById('timecode-scale-style')) return;

        var style = document.createElement('style');
        style.id = 'timecode-scale-style';
        style.innerHTML = `
            .timecode-scale {
                position: absolute !important;
                left: 6px !important;
                right: 6px !important;
                top: 8px !important;
                z-index: 12 !important;
                pointer-events: none !important;
                box-sizing: border-box !important;
            }
            .timecode-scale__bar {
                height: 2px !important;
                background: rgba(255,255,255,0.22) !important;
                border-radius: 2px !important;
                overflow: hidden !important;
                margin-bottom: 4px !important;
            }
            .timecode-scale__fill {
                height: 100% !important;
                background: rgba(255,255,255,0.85) !important;
                border-radius: 2px !important;
            }
            .timecode-scale__text {
                font-size: 11px !important;
                line-height: 1.2 !important;
                color: rgba(255,255,255,0.92) !important;
                text-align: center !important;
                font-weight: 500 !important;
                text-shadow: 0 1px 2px rgba(0,0,0,0.7) !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                letter-spacing: 0.2px !important;
                background: rgba(0,0,0,0.35) !important;
                border-radius: 4px !important;
                padding: 2px 5px !important;
                display: inline-block !important;
                max-width: 100% !important;
            }
            .card--small .timecode-scale__text,
            .card--collection .timecode-scale__text {
                font-size: 10px !important;
                padding: 1px 4px !important;
            }
        `;
        document.head.appendChild(style);
    }

    // ===== Логіка перед автозапуском торрента =====
    function preferVoiceFiles(files) {
        if (!SETTINGS.prefer_voice || !Array.isArray(files)) return files;

        return files.slice().sort(function (a, b) {
            var aName = (a.path || a.name || a.title || '').toLowerCase();
            var bName = (b.path || b.name || b.title || '').toLowerCase();

            var aScore = hasPreferredVoice(aName) ? 2 : 0;
            var bScore = hasPreferredVoice(bName) ? 2 : 0;

            // додатково трохи піднімаємо файли з "ua" / "ukr" / "rus"
            if (/ua|ukr|укр/.test(aName)) aScore += 1;
            if (/ua|ukr|укр/.test(bName)) bScore += 1;
            if (/rus|ru |рус/.test(aName)) aScore += 0.5;
            if (/rus|ru |рус/.test(bName)) bScore += 0.5;

            return bScore - aScore;
        });
    }

    function interceptTorrentStart() {
        // Перехоплюємо вибір файлів торрента
        Lampa.Listener.follow('torrent', function (e) {
            if (e.type === 'files' && Array.isArray(e.data)) {
                e.data = preferVoiceFiles(e.data);
            }
        });

        // Перед автозапуском показуємо повідомлення + сортуємо
        Lampa.Listener.follow('player', function (e) {
            if ((e.type === 'start' || e.type === 'ready') && e.object && e.object.torrent) {
                if (SETTINGS.ask_before_torrent) {
                    Lampa.Noty.show('Рекомендовано: файли з українською / російською озвучкою', {
                        time: 4000
                    });
                }
            }
        });
    }

    // ===== Налаштування =====
    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'timecode_scale',
            name: 'Шкала таймкоду + озвучка',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 12h18M3 6h18M3 18h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: 'timecode_scale',
            param: { name: 'tsc_show_time', type: 'trigger', default: true },
            field: { name: 'Показувати час', description: '01:23:45 / 02:15:00' },
            onChange: function (v) {
                Lampa.Storage.set('tsc_show_time', v);
                loadSettings();
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timecode_scale',
            param: { name: 'tsc_show_percent', type: 'trigger', default: true },
            field: { name: 'Показувати процент', description: 'Наприклад 47%' },
            onChange: function (v) {
                Lampa.Storage.set('tsc_show_percent', v);
                loadSettings();
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timecode_scale',
            param: {
                name: 'tsc_offset',
                type: 'select',
                values: { '0': '0 px', '4': '4 px', '8': '8 px', '12': '12 px', '16': '16 px' },
                default: '8'
            },
            field: { name: 'Відступ зверху', description: 'Відступ шкали від верху картки' },
            onChange: function (v) {
                Lampa.Storage.set('tsc_offset', v);
                loadSettings();
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timecode_scale',
            param: { name: 'tsc_prefer_voice', type: 'trigger', default: true },
            field: {
                name: 'Пріоритет UA / RU озвучки',
                description: 'Файли з українською або російською озвучкою піднімаються вище'
            },
            onChange: function (v) {
                Lampa.Storage.set('tsc_prefer_voice', v);
                loadSettings();
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timecode_scale',
            param: { name: 'tsc_ask_torrent', type: 'trigger', default: true },
            field: {
                name: 'Повідомлення перед автозапуском торрента',
                description: 'Показувати рекомендацію перед стартом'
            },
            onChange: function (v) {
                Lampa.Storage.set('tsc_ask_torrent', v);
                loadSettings();
            }
        });
    }

    function start() {
        loadSettings();
        injectStyles();
        addSettings();
        interceptTorrentStart();

        // Патч карток
        if (Lampa.Maker && Lampa.Maker.map) {
            var CardMaker = Lampa.Maker.map('Card');
            if (CardMaker && CardMaker.Card && CardMaker.Card.onVisible) {
                var original = CardMaker.Card.onVisible;
                CardMaker.Card.onVisible = function () {
                    original.apply(this, arguments);
                    setTimeout(function () { addTimecodeScale(this); }.bind(this), 40);
                };
            }
        }

        Lampa.Listener.follow('card', function (e) {
            if (e.type === 'build' || e.type === 'visible') {
                setTimeout(function () {
                    addTimecodeScale(e.object || e.card);
                }, 50);
            }
        });

        Lampa.Listener.follow('state:changed', function (e) {
            if (e && e.target === 'timeline') {
                setTimeout(function () {
                    $('.card').each(function () {
                        var cardObj = $(this).data('card') || this.card;
                        if (cardObj) addTimecodeScale(cardObj);
                    });
                }, 120);
            }
        });
    }

    if (window.appready) {
        start();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }
})();
