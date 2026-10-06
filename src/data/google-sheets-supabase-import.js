/**
 * @file Imports owner-reviewed franchise lists and director filmographies into
 * the shared production catalog. Reuses Sheets OAuth and row parsers, resolves
 * film/person identities, and adds catalog credits and memberships without
 * writing watched records, watchlist entries, rankings, or personal awards.
 */

(function () {
  const PAGE_SIZE = 1000;

  function textOrNull(value) {
    let text = String(value ?? "").trim();
    return text || null;
  }

  function numericOrNull(value) {
    if (value === null || value === undefined || String(value).trim() === "")
      return null;
    let number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function integerOrNull(value) {
    let number = numericOrNull(value);
    return number === null ? null : Math.round(number);
  }

  function cleanTmdbId(value) {
    let text = String(value ?? "").trim();
    return text && /^\d+$/.test(text) ? Number(text) : null;
  }

  function fuzzyTitleKey(title) {
    return String(title || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function exactTitleYearKey(title, year) {
    return `${String(title || "")
      .trim()
      .toLowerCase()}::${year ?? ""}`;
  }

  function fuzzyTitleYearKey(title, year) {
    return `${fuzzyTitleKey(title)}::${year ?? ""}`;
  }

  // Common words too short/generic to count as evidence two titles are
  // the same film - excluding them stops e.g. "The Cars That Ate Paris"
  // vs "Pat Garrett & Billy the Kid" from spuriously sharing "the".
  const TITLE_MATCH_STOPWORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "into",
    "from",
    "that",
    "this",
    "are",
    "was",
    "were",
  ]);

  /** Whether two titles share at least one real (non-stopword, 3+ char) word - a cheap plausibility check for an id-based match, not a full similarity score. @param {string} a Title. @param {string} b Title. @returns {boolean} */
  function titlesPlausiblyRelated(a, b) {
    let wordsA = fuzzyTitleKey(a)
      .split(" ")
      .filter((word) => word.length >= 3 && !TITLE_MATCH_STOPWORDS.has(word));
    if (!wordsA.length) return true; // Nothing to compare against - don't block on it.
    let wordsB = new Set(
      fuzzyTitleKey(b)
        .split(" ")
        .filter((word) => word.length >= 3 && !TITLE_MATCH_STOPWORDS.has(word)),
    );
    return wordsA.some((word) => wordsB.has(word));
  }

  /** Returns [startYear, endYear] for a bracket period's decade/century label ("1990s"), or null for anything else. */
  function periodYearRange(periodHint) {
    if (!periodHint) return null;
    let match = String(periodHint.year || "").match(/^(\d{3,4})s$/);
    if (!match) return null;
    let start = Number(match[1]);
    let span = periodHint.periodType === "centuries" ? 99 : 9;
    return [start, start + span];
  }

  /** Narrow-to-broad rank of award bracket period types - mirrors src/domain/awards.js's PERIOD_LIMITS key order. */
  const PERIOD_RANK = { years: 0, decades: 1, centuries: 2, allTime: 3 };
  const PERIOD_BY_RANK = ["years", "decades", "centuries", "allTime"];

  function normalizedPersonName(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  /* ===========================
     Supabase plumbing
  =========================== */

  async function readyClient() {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase is not configured.");
    let auth = await window.resolveSupabaseAuthState();
    if (auth.status !== "signed-in") throw new Error("Sign in first.");
    return { client: ready.client, user: auth.user };
  }

  async function fetchAll(client, table, select) {
    let rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let { data, error } = await client
        .from(table)
        .select(select)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
    }
  }

  /* ===========================
     Working resolvers - identical logic to the Node script, see
     scripts/import-owner-sheets-to-supabase.mjs for the full rationale.
  =========================== */

  function buildFilmResolver(existingFilms) {
    let byTmdbId = new Map();
    let byExactTitleYear = new Map();
    let byFuzzyTitleYear = new Map();
    let byTitleOnly = new Map();
    let nextPendingId = 1;

    function remember(film) {
      if (film.tmdb_id != null) byTmdbId.set(Number(film.tmdb_id), film);
      let exactKey = exactTitleYearKey(film.title, film.year);
      byExactTitleYear.set(exactKey, film);
      let fuzzyKey = fuzzyTitleYearKey(film.title, film.year);
      let list = byFuzzyTitleYear.get(fuzzyKey) || [];
      if (!list.includes(film)) list.push(film);
      byFuzzyTitleYear.set(fuzzyKey, list);
      if (film.year != null) {
        let titleKey = String(film.title || "")
          .trim()
          .toLowerCase();
        let titleList = byTitleOnly.get(titleKey) || [];
        if (!titleList.includes(film)) titleList.push(film);
        byTitleOnly.set(titleKey, titleList);
      }
    }

    existingFilms.forEach(remember);

    function resolveByTitleOnly(
      title,
      periodHint,
      filmCategoryHistory,
      awards,
    ) {
      let candidates = (
        byTitleOnly.get(
          String(title || "")
            .trim()
            .toLowerCase(),
        ) || []
      ).filter((film) => film.year != null);
      if (candidates.length > 1 && periodHint) {
        let range = periodYearRange(periodHint);
        if (range) {
          let narrowed = candidates.filter(
            (film) => film.year >= range[0] && film.year <= range[1],
          );
          if (narrowed.length) candidates = narrowed;
        }
      }
      // Same-century (or all-time, where periodYearRange never narrows at
      // all) remake collisions can still leave 2+ real candidates here -
      // prefer whichever one already has a nomination at a narrower award
      // period (award brackets are hierarchical: a decade winner is
      // promoted into the century bracket, a century winner into all-time,
      // see decade-merge.js), but only when that's unambiguous itself.
      // Two tiers, most precise first. Tier 1 checks the *same* category
      // specifically at the *immediately* next-narrower period - the one
      // level a hierarchical promotion would actually come from. Checking
      // "at any narrower rank" is too permissive: a long-running,
      // well-regarded film often has the same category nominated at
      // multiple unrelated periods in its own right (both real Suspiria
      // films have a Best Score nomination *somewhere* in their history),
      // so only the immediate level distinguishes "promoted into this
      // bracket" from "coincidentally also nominated once, elsewhere"
      // (issue #473). Within that immediate-scope category match, also
      // require the recipient name(s) to overlap when both the current
      // award and the historical one recorded any - a category match
      // alone isn't enough when both real Suspiria films separately won
      // Best Song at their own century (1900s Goblin's "Suspiria" vs.
      // 2000s Thom Yorke's "Suspirium"), which made the category-only
      // check match both candidates and wrongly stay ambiguous even
      // though the all-time win's own recipient ("Goblin") only ever
      // matches the 1977 film's history. A category with no recorded
      // recipients on either side (e.g. Best Picture) still falls back to
      // the category-only match. Tier 2 is exactly #471's original
      // any-category, any-narrower-rank check, tried against the same
      // original candidate set whenever tier 1 can't narrow to one, so
      // nothing #471 already resolved regresses.
      let via = null;
      function hasNarrowerHistory(film) {
        let currentRank = PERIOD_RANK[periodHint?.periodType] ?? Infinity;
        let byScope = filmCategoryHistory.get(film.id);
        if (!byScope) return false;
        for (let scopeType of byScope.keys()) {
          if ((PERIOD_RANK[scopeType] ?? Infinity) < currentRank) return true;
        }
        return false;
      }
      if (candidates.length > 1 && filmCategoryHistory) {
        let currentRank = PERIOD_RANK[periodHint?.periodType] ?? Infinity;
        if (awards?.length && Number.isFinite(currentRank) && currentRank > 0) {
          let immediateScope = PERIOD_BY_RANK[currentRank - 1];
          let withCategory = candidates.filter((film) => {
            let categoryMap = filmCategoryHistory
              .get(film.id)
              ?.get(immediateScope);
            if (!categoryMap) return false;
            return awards.some(({ category, recipients }) => {
              let recipientSet = categoryMap.get(category);
              if (!recipientSet) return false;
              if (!recipients?.length || !recipientSet.size) return true;
              return recipients.some((name) =>
                recipientSet.has(normalizedPersonName(name)),
              );
            });
          });
          if (withCategory.length === 1) {
            candidates = withCategory;
            via = "title-only-category-history";
          }
        }
        if (!via) {
          let withAny = candidates.filter((film) => hasNarrowerHistory(film));
          if (withAny.length === 1) {
            candidates = withAny;
            via = "title-only-history";
          }
        }
      }
      if (candidates.length === 1)
        return {
          status: "resolved",
          film: candidates[0],
          via: via || "title-only",
        };
      if (candidates.length > 1) return { status: "ambiguous", candidates };
      return { status: "missing" };
    }

    function resolve(source) {
      let tmdbId = cleanTmdbId(source.tmdbId);
      let year = numericOrNull(source.year);
      if (tmdbId !== null && byTmdbId.has(tmdbId)) {
        let tmdbMatch = byTmdbId.get(tmdbId);
        if (titlesPlausiblyRelated(source.title, tmdbMatch.title)) {
          return { status: "resolved", film: tmdbMatch, via: "tmdb" };
        }
        // A tmdb_id whose catalog title shares no real word with this
        // row's own title is untrustworthy - almost certainly a wrong id
        // pasted into the sheet, not a genuine match. Trusting it would
        // silently merge this row's rating/date/director onto a
        // completely unrelated film (found live: 28 real Diary rows with
        // a wrong tmdbId each merged a real viewing onto some other
        // owned film, e.g. a "Jesus Christ Superstar" viewing landing on
        // "Hair"). Never auto-resolve or auto-create from here - flag it
        // for the owner to fix the sheet's tmdbId and re-import.
        return {
          status: "tmdb-mismatch",
          requestedTmdbId: tmdbId,
          matchedFilm: tmdbMatch,
        };
      }
      let exact = byExactTitleYear.get(exactTitleYearKey(source.title, year));
      if (exact) return { status: "resolved", film: exact, via: "title-year" };
      let fuzzyMatches = byFuzzyTitleYear.get(
        fuzzyTitleYearKey(source.title, year),
      );
      if (fuzzyMatches?.length === 1) {
        return {
          status: "resolved",
          film: fuzzyMatches[0],
          via: "fuzzy-title-year",
        };
      }
      if (fuzzyMatches?.length > 1) {
        return { status: "ambiguous", candidates: fuzzyMatches };
      }
      return { status: "missing" };
    }

    function createPlaceholder(source) {
      let year = numericOrNull(source.year);
      let film = {
        id: `pending:film:${nextPendingId++}`,
        tmdb_id: cleanTmdbId(source.tmdbId),
        title: source.title,
        year,
        _pending: true,
      };
      remember(film);
      return film;
    }

    return { resolve, resolveByTitleOnly, remember, createPlaceholder };
  }

  function buildPersonResolver(existingPeople) {
    let byName = new Map();

    function remember(person) {
      let key = normalizedPersonName(person.name);
      if (!byName.has(key)) byName.set(key, person);
    }
    existingPeople.forEach(remember);

    function resolve(name) {
      return byName.get(normalizedPersonName(name)) || null;
    }

    return { resolve, remember };
  }

  function buildFranchiseResolver(existingFranchises) {
    let bySlug = new Map();
    let nextPendingId = 1;

    function remember(franchise) {
      bySlug.set(franchise.slug, franchise);
    }
    existingFranchises.forEach(remember);

    function resolve(slug) {
      return bySlug.get(slug) || null;
    }

    function createPlaceholder(slug, name, parentId) {
      let franchise = {
        id: `pending:franchise:${nextPendingId++}`,
        slug,
        name,
        parent_id: parentId,
        _pending: true,
      };
      remember(franchise);
      return franchise;
    }

    return { resolve, remember, createPlaceholder };
  }

  /**
   * Resolves a sheet film against the working catalog. A film missing from
   * it is created only with a TMDB identity: the sheet's own, or one a TMDB
   * title search finds (which may also turn out to be a catalog film).
   * Without one the film is not added ("not-created").
   */
  async function resolveOrCreateFilm(resolver, source, ctx) {
    let resolution = resolver.resolve(source);
    if (resolution.status !== "missing") return resolution;
    let identity = window.filmTmdbIdentity(source.tmdbId);
    if (!identity) {
      let letterboxdUrl = source.letterboxdUrl || source.url || "";
      let key = `${String(source.title || "")
        .trim()
        .toLowerCase()}::${numericOrNull(source.year) ?? ""}::${letterboxdUrl}`;
      ctx.tmdbFilmLookups ??= new Map();
      if (!ctx.tmdbFilmLookups.has(key))
        ctx.tmdbFilmLookups.set(
          key,
          await window.lookupTmdbFilmIdentity({
            title: source.title,
            year: numericOrNull(source.year),
            type: source.type,
            letterboxdUrl: letterboxdUrl || undefined,
          }),
        );
      identity = ctx.tmdbFilmLookups.get(key);
      if (!identity) return { status: "not-created" };
      if (cleanTmdbId(identity) !== null) {
        let known = resolver.resolve({ ...source, tmdbId: identity });
        if (known.status === "resolved")
          return { ...known, via: "tmdb-search" };
        if (known.status !== "missing") return known;
      }
    }
    let identified = { ...source, tmdbId: identity };
    if (!ctx.confirm) {
      return {
        status: "would-create",
        film: resolver.createPlaceholder(identified),
      };
    }
    let normalized = Object.assign({}, source);
    window.normalizeFilmMetadata(normalized);
    let { filmId } = await window.resolveSupabaseCatalogFilm(
      ctx.client,
      identified,
      {
        p_medium: normalized.medium || null,
        p_type: source.type || null,
        p_runtime_minutes: integerOrNull(source.runtimeMinutes),
        p_country: normalized.country || null,
        p_primary_country: normalized.primaryCountry || null,
        p_poster_url: null,
        p_swedish_title: null,
        p_genre: null,
        p_screenplay_type: ["original", "adapted"].includes(
          normalized.screenplayType,
        )
          ? normalized.screenplayType
          : null,
        p_adaptation_source: normalized.adaptationSource || null,
        p_letterboxd_url: textOrNull(source.letterboxdUrl),
      },
    );
    let film = {
      id: filmId,
      tmdb_id: cleanTmdbId(identity),
      title: source.title,
      year: numericOrNull(source.year),
    };
    resolver.remember(film);
    return { status: "created", film };
  }

  /**
   * Resolves a person by name among existing people, then on TMDB. A TMDB
   * match is added to the catalog (a placeholder in a dry run); a name with
   * neither match is not added: it is counted under `noteKey`, listed in
   * `report.notCreatedPeople`, and stays as text (recipients) or goes
   * unrecorded (directors).
   */
  async function resolvePerson(resolver, name, report, noteKey, ctx) {
    let cleaned = textOrNull(name);
    if (!cleaned) return null;
    let existing = resolver.resolve(cleaned);
    if (existing) return existing;
    let key = normalizedPersonName(cleaned);
    ctx.tmdbPersonLookups ??= new Map();
    if (!ctx.tmdbPersonLookups.has(key))
      ctx.tmdbPersonLookups.set(
        key,
        await window.lookupTmdbPersonIdentity(
          { name: cleaned },
          window.fetch.bind(window),
        ),
      );
    let match = ctx.tmdbPersonLookups.get(key);
    if (!match) {
      if (report) {
        report.notes[noteKey] = (report.notes[noteKey] || 0) + 1;
        report.notCreatedPeople.push(cleaned);
      }
      return null;
    }
    let person;
    if (!ctx.confirm) {
      person = {
        id: `pending:person:${match.tmdbId}`,
        name: cleaned,
        _pending: true,
      };
      if (report) report.wouldCreatePeople += 1;
    } else {
      let { personId } = await window.resolveSupabaseCatalogPerson(ctx.client, {
        name: match.name,
        tmdbId: match.tmdbId,
        profilePath: match.profilePath,
      });
      person = { id: personId, name: cleaned };
      if (report) report.createdPeople += 1;
    }
    resolver.remember(person);
    return person;
  }

  /** Walks an arbitrary-depth franchise chain root-first, resolving/creating each level, and returns the leaf. */
  async function resolveOrCreateFranchiseChain(
    resolver,
    parentChain,
    leafName,
    ctx,
  ) {
    let parentId = null;
    let leaf = null;
    for (let name of [...parentChain, leafName]) {
      let cleanedName = textOrNull(name);
      if (!cleanedName) continue;
      let slug = window.normalizeFranchiseId(cleanedName);
      let existing = resolver.resolve(slug);
      if (existing) {
        // If the existing franchise already has a different real parent,
        // deliberately don't reparent shared catalog data here - just keep
        // walking under its own existing identity for the next level.
        parentId = existing.id;
        leaf = existing;
        continue;
      }
      if (!ctx.confirm) {
        leaf = resolver.createPlaceholder(slug, cleanedName, parentId);
        parentId = leaf.id;
        continue;
      }
      let { data, error } = await ctx.client
        .from("franchises")
        .insert({
          slug,
          name: cleanedName,
          parent_id: parentId,
          created_by: ctx.userId,
        })
        .select("id,slug,name,parent_id")
        .single();
      if (error) throw error;
      resolver.remember(data);
      parentId = data.id;
      leaf = data;
    }
    return { leaf };
  }

  /* ===========================
     Report accumulator
  =========================== */

  function newStageReport(name) {
    return {
      name,
      totalRows: 0,
      resolved: 0,
      viaTmdb: 0,
      viaTitleYear: 0,
      viaFuzzy: 0,
      viaTitleOnly: 0,
      viaPeriodHistory: 0,
      viaCategoryHistory: 0,
      wouldCreateFilms: 0,
      createdFilms: 0,
      wouldCreatePeople: 0,
      createdPeople: 0,
      notCreatedFilms: [],
      notCreatedPeople: [],
      ambiguous: [],
      skipped: [],
      tmdbMismatches: [],
      notes: {},
    };
  }

  function noteFilmResolution(report, resolution, source) {
    if (resolution.status === "not-created") {
      report.notCreatedFilms.push(window.catalogFilmLabel(source));
      return;
    }
    if (resolution.status === "resolved") {
      report.resolved += 1;
      if (resolution.via === "tmdb" || resolution.via === "tmdb-search")
        report.viaTmdb += 1;
      else if (resolution.via === "fuzzy-title-year") report.viaFuzzy += 1;
      else if (resolution.via === "title-only-category-history")
        report.viaCategoryHistory += 1;
      else if (resolution.via === "title-only-history")
        report.viaPeriodHistory += 1;
      else if (resolution.via === "title-only") report.viaTitleOnly += 1;
      else report.viaTitleYear += 1;
    } else if (resolution.status === "would-create") {
      report.wouldCreateFilms += 1;
    } else if (resolution.status === "created") {
      report.createdFilms += 1;
    }
  }

  function noteAmbiguous(report, source, resolution) {
    report.ambiguous.push({
      title: source.title,
      year: source.year || null,
      candidates: (resolution.candidates || []).map((film) => film.id),
    });
  }

  /**
   * Reports a row whose tmdb_id points to a different film than its own
   * title rather than resolving, creating, or merging that row.
   */
  function noteTmdbMismatch(report, source, resolution, rowNumber) {
    report.tmdbMismatches.push({
      rowNumber: rowNumber ?? source.rowNumber ?? null,
      sheetTitle: source.title,
      sheetYear: source.year || null,
      requestedTmdbId: resolution.requestedTmdbId,
      matchedFilmId: resolution.matchedFilm?.id ?? null,
      matchedFilmTitle: resolution.matchedFilm?.title ?? null,
      matchedFilmYear: resolution.matchedFilm?.year ?? null,
    });
  }

  /* ===========================
     Franchise membership application - shared by every stage that produces
     {parentChain, name, rank} entries for a resolved film.
  =========================== */

  async function applyFranchiseMembership(
    franchiseResolver,
    filmId,
    membership,
    ctx,
    report,
  ) {
    let { leaf } = await resolveOrCreateFranchiseChain(
      franchiseResolver,
      membership.parentChain || [],
      membership.name,
      ctx,
    );
    if (!leaf) return;
    report.notes["franchise memberships"] =
      (report.notes["franchise memberships"] || 0) + 1;
    if (!ctx.confirm) return;
    let key = `${filmId}:${leaf.id}`;
    if (ctx.existingFranchiseMembershipKeys?.has(key)) {
      report.notes["franchise memberships already recorded"] =
        (report.notes["franchise memberships already recorded"] || 0) + 1;
      return;
    }
    let { error } = await ctx.client.from("film_franchises").insert({
      franchise_id: leaf.id,
      film_id: filmId,
      position: integerOrNull(membership.rank),
    });
    // Same authenticated-grant gap as credits above (select+insert only,
    // no update) - insert and tolerate the unique violation instead of
    // upserting, matching supabase-workspace.js's existing film_franchises
    // writer. The pre-check above handles the common "already recorded"
    // case locally without a round trip; this still covers a row created
    // moments earlier elsewhere in the same run and not yet in the set.
    if (error && error.code !== "23505") throw error;
    ctx.existingFranchiseMembershipKeys?.add(key);
  }

  /**
   * Resolves and records a catalog film's director credit.
   */
  async function applyDirectorCredit(
    personResolver,
    filmId,
    directorName,
    ctx,
    report,
  ) {
    let director = await resolvePerson(
      personResolver,
      directorName,
      report,
      "director names with no catalog or TMDB person (no credit)",
      ctx,
    );
    if (!director || !ctx.confirm) return;
    let key = `${filmId}:${director.id}`;
    if (ctx.existingDirectorCreditKeys?.has(key)) {
      if (report)
        report.notes["director credits already recorded"] =
          (report.notes["director credits already recorded"] || 0) + 1;
      return;
    }
    let { error } = await ctx.client.from("credits").insert({
      film_id: filmId,
      person_id: director.id,
      role: "director",
    });
    // authenticated only has select+insert on credits (a shared,
    // append-only catalog fact) - no update grant, so upsert's ON
    // CONFLICT DO UPDATE plan is rejected outright even when no row
    // actually conflicts. A plain insert plus tolerating the unique
    // violation gets the same "create if missing" result and matches
    // how supabase-workspace.js already treats film_franchises. The
    // pre-check above handles the common "already recorded" case locally
    // without a round trip; this still covers a row created moments
    // earlier elsewhere in the same run and not yet in the set.
    if (error && error.code !== "23505") throw error;
    ctx.existingDirectorCreditKeys?.add(key);
  }

  /* ===========================
     Catalog films, director credits and franchise memberships
  =========================== */

  async function runDirectorsFranchisesStage(items, resolvers, ctx) {
    let report = newStageReport("Catalog franchises and filmographies");
    report.totalRows = items.length;

    let index = 0;
    for (let item of items) {
      index += 1;
      ctx.onProgress?.("Directors and Franchises", index, items.length);
      let resolution = await resolveOrCreateFilm(
        resolvers.filmResolver,
        item,
        ctx,
      );
      noteFilmResolution(report, resolution, item);
      if (resolution.status === "tmdb-mismatch") {
        noteTmdbMismatch(report, item, resolution);
        continue;
      }
      if (resolution.status === "ambiguous") {
        noteAmbiguous(report, item, resolution);
        continue;
      }
      if (resolution.status === "not-created") {
        continue;
      }
      let filmId = resolution.film.id;

      if (item.director) {
        await applyDirectorCredit(
          resolvers.personResolver,
          filmId,
          item.director,
          ctx,
          report,
        );
      }

      for (let membership of item.franchises) {
        await applyFranchiseMembership(
          resolvers.franchiseResolver,
          filmId,
          membership,
          ctx,
          report,
        );
      }
    }

    return { report };
  }

  /* ===========================
     Public API
  =========================== */

  function googleSheetsCatalogRanges() {
    let ranges = window.OSKARS_LOCAL_CONFIG?.googleSheets?.ranges || {};
    return {
      directorsAndFranchises: ranges.directorsAndFranchises || "",
      franchises: ranges.franchises || "",
      directors: ranges.directors || "",
    };
  }

  /** Reports whether the owner has explicitly configured catalog-only Sheet ranges. @returns {boolean} Whether catalog ingestion is configured. */
  window.googleSheetsSupabaseImportConfigured = function () {
    return Boolean(
      window.OSKARS_LOCAL_CONFIG?.googleClientId &&
      window.OSKARS_LOCAL_CONFIG?.googleSheets?.spreadsheetId &&
      Object.values(googleSheetsCatalogRanges()).some(Boolean),
    );
  };

  /**
   * Fetches only explicitly configured catalog franchise and filmography ranges for reviewed ingestion.
   * @returns {Promise<Object>} Session source containing shared catalog ranges only.
   */
  window.fetchGoogleSheetsSupabaseSource = async function () {
    let spreadsheetId = window.OSKARS_LOCAL_CONFIG?.googleSheets?.spreadsheetId;
    let ranges = googleSheetsCatalogRanges();
    let keys = Object.keys(ranges).filter((key) => ranges[key]);
    if (!spreadsheetId || !keys.length)
      throw new Error(
        "Configure catalog franchise or filmography Sheet ranges first.",
      );
    await window.loadGoogleIdentity();
    let token = await window.requestGoogleAccessToken();
    let data = await window.fetchGoogleSheetValues(
      spreadsheetId,
      keys.map((key) => ranges[key]),
      token,
    );
    let source = {};
    keys.forEach((key, index) => {
      source[key] = data.valueRanges[index]?.values || [];
    });
    return source;
  };

  /**
   * Imports reviewed catalog films, director credits and franchise memberships without writing personal archive tables.
   * @param {Object} source Reviewed catalog Sheet rows.
   * @param {Object} [options] Dry-run/apply options and progress callback.
   * @returns {Promise<{reports: Object[]}>} Catalog ingestion reports.
   */
  window.runGoogleSheetsCatalogImport = async function (source, options = {}) {
    let ready = options.client && options.user ? options : await readyClient();
    let client = ready.client;
    let ctx = {
      confirm: Boolean(options.confirm),
      client,
      userId: ready.user.id,
      onProgress: options.onProgress,
    };
    await window.ensureCatalogIdentity?.();
    let [films, people, franchises, credits, memberships] = await Promise.all([
      fetchAll(
        client,
        "films",
        "id,tmdb_id,title,year,medium,type,runtime_minutes,country,primary_country,poster_url,swedish_title,genre,screenplay_type,adaptation_source,letterboxd_url",
      ),
      fetchAll(client, "people", "id,name"),
      fetchAll(client, "franchises", "id,slug,name,parent_id,source_url"),
      fetchAll(client, "credits", "film_id,person_id,role"),
      fetchAll(client, "film_franchises", "film_id,franchise_id"),
    ]);
    let resolvers = {
      filmResolver: buildFilmResolver(films),
      personResolver: buildPersonResolver(people),
      franchiseResolver: buildFranchiseResolver(franchises),
    };
    ctx.existingDirectorCreditKeys = new Set(
      credits
        .filter((entry) => entry.role === "director")
        .map((entry) => `${entry.film_id}:${entry.person_id}`),
    );
    ctx.existingFranchiseMembershipKeys = new Set(
      memberships.map((entry) => `${entry.film_id}:${entry.franchise_id}`),
    );
    let items = window.parseDirectorsFranchisesSheet(
      source.directorsAndFranchises || [],
    );
    let diagnostics = [];
    for (let key of ["franchises", "directors"]) {
      if (!source[key]?.length) continue;
      let parsed =
        key === "franchises"
          ? window.parseFranchiseSheet("", { rows: source[key] })
          : window.parseDirectorWatchlistSheet("", { rows: source[key] });
      diagnostics.push(...(parsed.diagnostics?.skippedDetails || []));
      items.push(
        ...parsed.items.map((item) => ({
          ...item,
          franchises:
            key === "franchises"
              ? [
                  {
                    name: item.franchiseName,
                    parentChain: item.parentChain || [],
                    sourceUrl: item.sourceUrl,
                    rank: item.rank,
                  },
                ]
              : [],
        })),
      );
    }
    let result = await runDirectorsFranchisesStage(items, resolvers, ctx);
    result.report.skipped.push(...diagnostics);
    result.report.notes["personal archive tables"] =
      "untouched; ratings and tiers ignored";
    return { reports: [result.report] };
  };
})();
