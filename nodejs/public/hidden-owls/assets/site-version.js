/* Single source for displaying the current release number. */
window.QUICHE_SITE_VERSION = "3.1.0";
document.querySelectorAll("#site-version").forEach((el) => {
  el.textContent = "v" + window.QUICHE_SITE_VERSION;
});
