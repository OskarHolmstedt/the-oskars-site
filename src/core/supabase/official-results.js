/** @file Owns shared official-result projections and scoped nomination reads. */

(function () {
  // A nomination's first film embeds as `films`; the further films of a
  // multi-film nomination as `official_nomination_extra_films`, by position.
  const OFFICIAL_NOMINATION_FIELDS =
    "id, category_id, film_id, is_winner, source_id, source_title, original_title, source_category, detail, country, recipient_text, films(id, tmdb_id, tmdb_tv_ref, title, year), official_nomination_extra_films(position, films(id, tmdb_id, tmdb_tv_ref, title, year))";

  /**
   * Loads every table src/domain/supabase-official-results-hydration.js
   * needs to rebuild state.officialResults from live data - every ceremony,
   * category, and nomination across every imported source
   * (academy-awards, cannes, guldbaggen), each nomination's matched film
   * embedded directly so no per-nomination lookup is needed. Deliberately
   * separate from loadSupabaseLegacyHydrationSource() above, and NOT called
   * from ensureOskarsData()'s shared bootstrap: only the handful of pages
   * that render official-results content call this, since paginating
   * ~1,900 categories and ~9,300 nominations on every one of the app's
   * pages would regress every other page's performance budget for no
   * benefit. Not cached - called fresh on every visit to a page that needs
   * it, matching every other page-specific Supabase read in this codebase.
   * @returns {Promise<{ceremonies: Object[], categories: Object[], nominations: Object[]}>}
   */
  window.loadSupabaseOfficialResultsSource = async function () {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in")
      return { ceremonies: [], categories: [], nominations: [] };
    let client = ready.client;
    let [ceremoniesResult, categories, nominations] = await Promise.all([
      client
        .from("official_ceremonies")
        .select(
          "id, source, year, period_key, period_type, ceremony_label, source_url",
        ),
      window.supabaseWorkspaceContext.fetchAllSupabaseRows((withCount) =>
        client
          .from("official_categories")
          .select(
            "id, ceremony_id, name",
            withCount ? { count: "exact" } : undefined,
          ),
      ),
      window.supabaseWorkspaceContext.fetchAllSupabaseRows((withCount) =>
        client
          .from("official_nominations")
          .select(
            OFFICIAL_NOMINATION_FIELDS,
            withCount ? { count: "exact" } : undefined,
          ),
      ),
    ]);
    if (ceremoniesResult.error) throw ceremoniesResult.error;
    return {
      ceremonies: ceremoniesResult.data || [],
      categories,
      nominations,
    };
  };

  /**
   * Loads official nominations involving one film without fetching unrelated ceremony nominations.
   * @param {string} filmId
   * @returns {Promise<{ceremonies: Object[], categories: Object[], nominations: Object[]}>}
   */
  window.loadSupabaseOfficialResultsForFilm = async function (filmId) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    // A film is credited either as a nomination's film_id or as one of its
    // further films.
    let { data: extraLinks, error: extraError } = await ready.client
      .from("official_nomination_extra_films")
      .select("nomination_id")
      .eq("film_id", filmId);
    if (extraError) throw extraError;
    let extraIds = (extraLinks || []).map((row) => row.nomination_id);
    let { data, error } = await ready.client
      .from("official_nominations")
      .select(
        `${OFFICIAL_NOMINATION_FIELDS}, official_categories!inner(id, ceremony_id, name, official_ceremonies!inner(id, source, year, period_key, period_type, ceremony_label, source_url))`,
      )
      .or(
        extraIds.length
          ? `film_id.eq.${filmId},id.in.(${extraIds.join(",")})`
          : `film_id.eq.${filmId}`,
      )
      // official_categories!inner/official_ceremonies!inner above turn this
      // into a real inner-join filter - a non-academy-awards nomination row
      // is excluded entirely, not just missing its embed (confirmed against
      // real Postgres: without !inner on both levels, a plain .eq() here
      // still returns the row with the embed merely nulled out).
      .eq("official_categories.official_ceremonies.source", "academy-awards");
    if (error) throw error;
    let ceremoniesById = new Map();
    let categoriesById = new Map();
    let nominations = [];
    (data || []).forEach((row) => {
      let category = row.official_categories;
      let ceremony = category?.official_ceremonies;
      // Never actually null given the !inner filtering above - defensive
      // only, matching loadSupabaseOfficialResultsSource()'s own FK-orphan
      // guard.
      if (!category || !ceremony) return;
      ceremoniesById.set(ceremony.id, {
        id: ceremony.id,
        source: ceremony.source,
        year: ceremony.year,
        period_key: ceremony.period_key,
        period_type: ceremony.period_type,
        ceremony_label: ceremony.ceremony_label,
        source_url: ceremony.source_url,
      });
      categoriesById.set(category.id, {
        id: category.id,
        ceremony_id: category.ceremony_id,
        name: category.name,
      });
      nominations.push({
        id: row.id,
        category_id: row.category_id,
        film_id: row.film_id,
        is_winner: row.is_winner,
        source_id: row.source_id,
        source_title: row.source_title,
        original_title: row.original_title,
        source_category: row.source_category,
        detail: row.detail,
        country: row.country,
        recipient_text: row.recipient_text,
        films: row.films,
        official_nomination_extra_films: row.official_nomination_extra_films,
      });
    });
    return {
      ceremonies: [...ceremoniesById.values()],
      categories: [...categoriesById.values()],
      nominations,
    };
  };

  // Every ceremony (a few hundred rows) plus only the nominations `filter`
  // keeps, in loadSupabaseOfficialResultsSource()'s flat shape. Returning
  // every ceremony means a source with no matching nominations still
  // replaces its bundled default with an empty live one, exactly as the
  // complete read would. `categoryEmbed` must embed official_categories
  // (with any ancestor the filter targets marked !inner at every level); a
  // null `filter` matches no nominations.
  async function loadScopedOfficialResults(client, categoryEmbed, filter) {
    let ceremoniesResult = await client
      .from("official_ceremonies")
      .select(
        "id, source, year, period_key, period_type, ceremony_label, source_url",
      );
    if (ceremoniesResult.error) throw ceremoniesResult.error;
    let rows = !filter
      ? []
      : await window.supabaseWorkspaceContext.fetchAllSupabaseRows(
          (withCount) =>
            filter(
              client
                .from("official_nominations")
                .select(
                  `${OFFICIAL_NOMINATION_FIELDS}, ${categoryEmbed}`,
                  withCount ? { count: "exact" } : undefined,
                ),
            ),
        );
    let categoriesById = new Map();
    let nominations = rows.map((row) => {
      let { official_categories: category, ...nomination } = row;
      if (category)
        categoriesById.set(category.id, {
          id: category.id,
          ceremony_id: category.ceremony_id,
          name: category.name,
        });
      return nomination;
    });
    return {
      ceremonies: ceremoniesResult.data || [],
      categories: [...categoriesById.values()],
      nominations,
    };
  }

  /**
   * Loads official results matching a person's recipient text
   * - the read person.html's officialPersonRecords() needs, instead of
   * loadSupabaseOfficialResultsSource()'s complete ~9,300 nominations.
   * officialPersonRecord() already matches by case-insensitive substring of
   * the recipient text against the person's name/aliases and then narrows
   * to exact person ids; the same substring filter runs here in SQL, so it
   * returns a superset the unchanged client logic narrows exactly as
   * before.
   * @param {string[]} needles Name and alias strings to match.
   * @returns {Promise<{ceremonies: Object[], categories: Object[], nominations: Object[]}>}
   */
  window.loadSupabaseOfficialResultsForRecipients = async function (needles) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let terms = [
      ...new Set(
        (needles || [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ];
    return loadScopedOfficialResults(
      ready.client,
      "official_categories(id, ceremony_id, name)",
      !terms.length
        ? null
        : (query) =>
            query.or(
              terms
                .map(
                  (term) =>
                    `recipient_text.ilike.${window.supabaseWorkspaceContext.postgrestQuoted(`*${window.supabaseWorkspaceContext.ilikeLiteral(term)}*`)}`,
                )
                .join(","),
            ),
    );
  };

  /**
   * Loads one official category's complete history across every source
   * - category.html only ever reads nominations whose category
   * name equals the page's category, so the other categories' nominations
   * are never fetched.
   * @param {string} categoryName Official category name, e.g. "Best Picture".
   * @returns {Promise<{ceremonies: Object[], categories: Object[], nominations: Object[]}>}
   */
  window.loadSupabaseOfficialResultsForCategory = async function (
    categoryName,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    return loadScopedOfficialResults(
      ready.client,
      "official_categories!inner(id, ceremony_id, name)",
      (query) => query.eq("official_categories.name", String(categoryName)),
    );
  };

  /**
   * Loads every source's official results for one period key -
   * period.html's year view only ever reads `periods[key]` of each source.
   * @param {string} periodKey Ceremony period key, e.g. "2019".
   * @returns {Promise<{ceremonies: Object[], categories: Object[], nominations: Object[]}>}
   */
  window.loadSupabaseOfficialResultsForPeriod = async function (periodKey) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    return loadScopedOfficialResults(
      ready.client,
      "official_categories!inner(id, ceremony_id, name, official_ceremonies!inner(period_key))",
      (query) =>
        query.eq(
          "official_categories.official_ceremonies.period_key",
          String(periodKey),
        ),
    );
  };
})();
