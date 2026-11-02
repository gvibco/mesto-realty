// Тёмная тема. Cookie `theme` = dark|light|auto (по умолчанию auto —
// системная prefers-color-scheme). Скрипт выполняется в <head> до отрисовки,
// чтобы тема применялась без мигания. LocalStorage в проекте запрещён.
(function () {
  var saved = readCookie();
  apply();
  window.setTheme = function (value) {
    saved = value;
    document.cookie =
      "theme=" + value + ";path=/;max-age=31536000;SameSite=Lax";
    apply();
  };
  document.addEventListener("DOMContentLoaded", function () {
    var button = document.querySelector("#theme-toggle");
    if (!button) return;
    function sync() {
      var dark = document.documentElement.dataset.theme === "dark";
      button.setAttribute(
        "aria-label",
        dark ? "Включить светлую тему" : "Включить тёмную тему",
      );
    }
    sync();
    button.addEventListener("click", function () {
      window.setTheme(
        document.documentElement.dataset.theme === "dark" ? "light" : "dark",
      );
      sync();
    });
  });

  function readCookie() {
    var match = document.cookie.match(/(?:^|;\s*)theme=(dark|light|auto)/);
    return match ? match[1] : "auto";
  }
  function resolve(value) {
    if (value === "dark" || value === "light") return value;
    return matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  function apply() {
    var dark = resolve(saved) === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#16212f" : "#235ee8";
  }
})();
