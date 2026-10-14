/** @file Preserves the standalone watchlist merge URL by opening the confirmed-group merge workflow. */
(function () {
  let url = new URL("merge.html", window.location.href);
  url.searchParams.set("mode", "watchlist");
  let tier = window.pageQueryParam("tier");
  if (tier) url.searchParams.set("tier", tier);
  window.location.replace(url.href);
})();
