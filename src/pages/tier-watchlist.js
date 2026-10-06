/**
 * @file Set watchlist tier: the owner's queue of watchlist items without an
 * interest tier, grouped by release year, director or franchise. The shared
 * queue controller (src/ui/supabase-queue-page.js) owns loading, grouping
 * and navigation; this supplies the segmented tier setter and saves each
 * tier straight to Supabase with setSupabaseWatchlistTier().
 */

window.mountSupabaseQueuePage({
  container: document.getElementById("tierWatchlistPage"),
  page: "tier-watchlist.html",
  part: "watchlist",
  timer: "tierWatchlist:render",
  title: "Set watchlist tier",
  intro:
    "Give untiered watchlist films an interest tier, one release year, director or franchise at a time.",
  words: {
    open: "untiered",
    done: "tiered",
    doneHeading: "Tiered",
    nothing: "Nothing to tier",
    allDone: "Everything on your watchlist has a tier.",
    noRows: "No watchlist films found for this account.",
    loadError: "Could not load your watchlist",
  },
  isDone: (row) => Boolean(window.normalizeWatchlistTier(row.tier)),
  doneScore: (row) => -window.watchlistTierGrade(row.tier, row.tier_modifier),
  renderInput: () => window.renderTierSetter(),
  renderDoneValue: (row) =>
    window.renderWatchlistTierBadge(row.tier, { modifier: row.tier_modifier }),
  enhance: (container) => window.enhanceTierSetters(container),
  readInput: (form) => {
    let values = new FormData(form);
    let tier = window.normalizeWatchlistTier(values.get("tier"));
    if (!tier) throw new Error("Choose a tier before saving.");
    return { tier, modifier: values.get("tierModifier") || "" };
  },
  save: (rowId, input) =>
    window.setSupabaseWatchlistTier(rowId, input.tier, input.modifier),
});
