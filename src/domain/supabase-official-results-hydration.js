/**
 * @file Reshapes the raw Supabase rows from
 * `window.loadSupabaseOfficialResultsSource()` into the exact
 * `state.officialResults` shape documented at `src/core/state-shape.js`
 * (`OfficialResultsSource`/`OfficialResultsPeriod`/`OfficialNomination`) and
 * enforced by `canonicalValidateOfficialResults()` in `canonical-data.js` -
 * so the page controllers that render official-results content
 * (period/category/stats/completion/film/person) keep their existing,
 * already-tested rendering logic unmodified, just fed by live data instead
 * of the bundled snapshot (`src/core/bundled-official-results.js`). A
 * deliberate sibling to `supabase-legacy-hydration.js`, not an extension of
 * it: that file's reshapers run as part of every hydrated page's shared
 * bootstrap; this one is lazily invoked only by the pages that need it. The
 * pure reshaper below has no Supabase client, no DOM;
 * `hydrateOfficialResultsFromSupabase()` is the one impure orchestrator
 * (fetch + reshape + assign to `window.state`).
 */

(function () {
  /**
   * Reshapes `{ceremonies, categories, nominations}` (the result of
   * `window.loadSupabaseOfficialResultsSource()`) into
   * `{[sourceId]: OfficialResultsSource}` - byte-for-byte the shape
   * `state.officialResults` already carries from the bundle.
   * @param {{ceremonies: Object[], categories: Object[], nominations: Object[]}} source Raw Supabase rows.
   * @returns {Record<string, Object>} Keyed by source id (e.g. "academy-awards").
   */
  window.buildOfficialResultsFromSupabase = function (source) {
    let ceremoniesById = new Map();
    let sources = {};

    (source?.ceremonies || []).forEach((ceremony) => {
      ceremoniesById.set(ceremony.id, ceremony);
      let sourceEntry = (sources[ceremony.source] ||= {
        id: ceremony.source,
        // Supabase never stored a source display name (official_ceremonies.source
        // is just "academy-awards"/"cannes"/"guldbaggen") - reusing the
        // untouched bundle's own name avoids a second, driftable hardcoded
        // map (bundled-official-results.js stays loaded as
        // createEmptyState()'s default, so it's always available here).
        name:
          window.OSKARS_BUNDLED_OFFICIAL_RESULTS?.[ceremony.source]?.name ||
          ceremony.source,
        periods: {},
      });
      let period = (sourceEntry.periods[ceremony.period_key] ||= {
        periodType: ceremony.period_type,
        sourceUrl: ceremony.source_url || "",
        nominations: [],
      });
      if (ceremony.ceremony_label) period.ceremony = ceremony.ceremony_label;
    });

    let categoriesById = new Map(
      (source?.categories || []).map((category) => [category.id, category]),
    );

    (source?.nominations || []).forEach((nomination) => {
      let category = categoriesById.get(nomination.category_id);
      let ceremony = category && ceremoniesById.get(category.ceremony_id);
      let period = ceremony
        ? sources[ceremony.source]?.periods?.[ceremony.period_key]
        : null;
      // Every row is reachable through its FK chain in practice (cascade
      // deletes keep category_id/ceremony_id consistent) - skipped
      // defensively rather than thrown, since dropping one orphaned row is
      // strictly safer than blanking every source's results over it.
      if (!category || !period) return;
      let film = nomination.films || null;
      let record = {
        id: nomination.source_id,
        category: category.name,
        winner: Boolean(nomination.is_winner),
        sourceTitle: nomination.source_title || "",
      };
      if (nomination.source_category)
        record.sourceCategory = nomination.source_category;
      if (nomination.recipient_text)
        record.recipient = nomination.recipient_text;
      if (nomination.detail) record.detail = nomination.detail;
      if (nomination.country) record.country = nomination.country;
      if (nomination.original_title)
        record.originalTitle = nomination.original_title;
      if (film?.tmdb_id != null) record.tmdbId = String(film.tmdb_id);
      // film.id is the real Supabase films.id uuid - the same id
      // addFilmToStore() keys state.filmsById by (issue #454 made it
      // prefer film.supabaseFilmId over the legacy year::title primitive),
      // so no id translation is needed here.
      if (nomination.film_id && film)
        record.filmRef = {
          id: film.id,
          title: film.title,
          year: film.year != null ? String(film.year) : "",
        };
      period.nominations.push(record);
    });

    Object.values(sources).forEach((sourceEntry) => {
      Object.values(sourceEntry.periods).forEach((period) => {
        period.nominations.sort(
          (left, right) =>
            left.category.localeCompare(right.category) ||
            String(left.sourceCategory || "").localeCompare(
              String(right.sourceCategory || ""),
            ) ||
            Number(right.winner) - Number(left.winner) ||
            left.sourceTitle.localeCompare(right.sourceTitle) ||
            String(left.recipient || "").localeCompare(
              String(right.recipient || ""),
            ) ||
            String(left.detail || "").localeCompare(String(right.detail || "")),
        );
      });
      sourceEntry.sourceRevision = window.canonicalDataRevision(
        sourceEntry.periods,
      );
    });

    return sources;
  };

  /**
   * Fetches and reshapes live official-results data, then overwrites
   * `window.state.officialResults` in place. Called by the page
   * controllers that render official-results content, fired-and-forgotten
   * after their own first synchronous render so it never blocks first
   * paint. Never throws, and never overwrites a working default with
   * nothing: a failed fetch (offline, RLS) or a not-yet-signed-in session
   * just leaves the bundled default in place rather than blanking a
   * working page.
   * @returns {Promise<boolean>} Whether state.officialResults was replaced with live data.
   */
  window.hydrateOfficialResultsFromSupabase = async function () {
    try {
      let source = await window.loadSupabaseOfficialResultsSource();
      let live = window.buildOfficialResultsFromSupabase(source);
      if (!Object.keys(live).length) return false;
      window.state.officialResults = live;
      return true;
    } catch (err) {
      console.warn("Could not load live official results from Supabase.", err);
      return false;
    }
  };
})();
