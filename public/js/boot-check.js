// Страховка для нестабильной сети: если интерфейс не запустился (оборвалась загрузка модулей),
// один раз перезагружаем страницу, а потом показываем кнопку «Обновить».
(function () {
  setTimeout(function () {
    if (document.documentElement.dataset.booted) return;
    var reloaded = false;
    try {
      reloaded = sessionStorage.getItem('hy-boot-retry') === '1';
      sessionStorage.setItem('hy-boot-retry', '1');
    } catch (e) {
      reloaded = true;
    }
    if (!reloaded) return location.reload();
    var box = document.querySelector('.boot');
    if (!box) return;
    box.innerHTML = '<img src="/assets/logo.webp" alt=""><p class="boot-text">Не удалось загрузить HYTEAM — проверьте подключение к интернету.</p><button class="btn btn-primary" id="boot-retry">Обновить</button>';
    document.getElementById('boot-retry').onclick = function () {
      location.reload();
    };
  }, 9000);
})();
