/**
 * @file Live Google Sheets → Supabase import (issue #469), the
 * Supabase-native successor to the old `owner-data.html`'s Sheets import
 * panel (deleted issue #434). Reuses `src/data/google-sheets.js`'s OAuth/
 * fetch plumbing (`window.requestGoogleAccessToken`/`fetchGoogleSheetValues`/
 * `rowsToDelimited`) and the same `src/imports/*.js` parsers, resolver, and
 * per-stage write architecture `scripts/import-owner-sheets-to-supabase.mjs`
 * (issue #468) already proved end-to-end against local Supabase - including
 * every bug fix found there (period-label-as-year disambiguation, single-
 * fuzzy-match auto-resolve, batch-upsert de-duplication, `added_at`
 * omission instead of an explicit null).
 *
 * Two structural simplifications the browser gives for free over the Node
 * script:
 * - No service-role key or `eligibility`-table owner lookup - this runs as
 *   the real signed-in user via `window.ensureSupabaseClient()`; RLS scopes
 *   every read/write to `auth.uid()` automatically, and `find_or_create_film`
 *   (`security invoker`) correctly attributes `created_by` to the real user.
 *   Every personal table's `user_id` column defaults to `auth.uid()`, so it's
 *   omitted from every payload below rather than passed explicitly.
 * - No Node `vm` sandboxing - `src/imports/*.js`'s parsers are already real
 *   `window.*` globals on this page.
 *
 * Public API: `fetchGoogleSheetsSupabaseSource()` (does the OAuth + Sheets
 * fetch once) and `runGoogleSheetsSupabaseImport(source, options)` (runs
 * every stage against that same fetched source, in dry-run or --confirm-
 * equivalent mode) - `src/pages/data.js` calls these for its Preview/Apply
 * buttons, passing the same `source` to both so they see identical data.
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

  /** Normalizes a nomination source key so recipient order is deterministic. @param {string} rawKey Raw source key. @returns {string} Normalized key. */
  window.normalizeNominationSourceKey = function (rawKey) {
    if (!rawKey || typeof rawKey !== "string") return String(rawKey || "");
    try {
      let parsed = JSON.parse(rawKey);
      if (
        Array.isArray(parsed) &&
        parsed.length === 7 &&
        Array.isArray(parsed[6])
      ) {
        let sortedRecipients = [...parsed[6]].sort((a, b) =>
          String(a).localeCompare(String(b), undefined, {
            sensitivity: "base",
          }),
        );
        parsed[6] = sortedRecipients;
        return JSON.stringify(parsed);
      }
    } catch (_e) {
      // If not JSON array, return as is.
    }
    return rawKey;
  };

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

  function dedupeByKey(rows, keyFn) {
    let byKey = new Map();
    for (let row of rows) byKey.set(keyFn(row), row);
    return [...byKey.values()];
  }

  /** Splits raw text or an already-split rows array uniformly - the Sheets API hands this code rows directly, while a future text-based caller would still work. */
  function ensureRows(input) {
    return Array.isArray(input) ? input : window.parseTabbedSheetRows(input);
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

  async function writeBatches(rows, writer, onBatch) {
    const WRITE_BATCH_SIZE = 500;
    for (let from = 0; from < rows.length; from += WRITE_BATCH_SIZE) {
      let batch = rows.slice(from, from + WRITE_BATCH_SIZE);
      if (!batch.length) continue;
      await writer(batch);
      onBatch?.(Math.min(from + batch.length, rows.length), rows.length);
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
      categories,
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
      // (issue #473). Tier 2 is exactly #471's original any-category,
      // any-narrower-rank check, tried against the same original candidate
      // set whenever tier 1 can't narrow to one, so nothing #471 already
      // resolved regresses.
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
        if (categories?.length && Number.isFinite(currentRank) && currentRank > 0) {
          let immediateScope = PERIOD_BY_RANK[currentRank - 1];
          let withCategory = candidates.filter((film) => {
            let categorySet = filmCategoryHistory
              .get(film.id)
              ?.get(immediateScope);
            return categorySet && categories.some((c) => categorySet.has(c));
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
        return { status: "resolved", film: candidates[0], via: via || "title-only" };
      if (candidates.length > 1) return { status: "ambiguous", candidates };
      return { status: "missing" };
    }

    function resolve(source) {
      let tmdbId = cleanTmdbId(source.tmdbId);
      let year = numericOrNull(source.year);
      if (tmdbId !== null && byTmdbId.has(tmdbId)) {
        return { status: "resolved", film: byTmdbId.get(tmdbId), via: "tmdb" };
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
    let nextPendingId = 1;

    function remember(person) {
      let key = normalizedPersonName(person.name);
      if (!byName.has(key)) byName.set(key, person);
    }
    existingPeople.forEach(remember);

    function resolve(name) {
      return byName.get(normalizedPersonName(name)) || null;
    }

    function createPlaceholder(name) {
      let person = {
        id: `pending:person:${nextPendingId++}`,
        name,
        _pending: true,
      };
      remember(person);
      return person;
    }

    return { resolve, remember, createPlaceholder };
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

  async function resolveOrCreateFilm(resolver, source, ctx) {
    let resolution = resolver.resolve(source);
    if (resolution.status !== "missing") return resolution;
    if (!ctx.confirm) {
      return {
        status: "would-create",
        film: resolver.createPlaceholder(source),
      };
    }
    let normalized = Object.assign({}, source);
    window.normalizeFilmMetadata(normalized);
    let { data: filmId, error } = await ctx.client.rpc("find_or_create_film", {
      p_tmdb_id: cleanTmdbId(source.tmdbId),
      p_title: source.title,
      p_year: numericOrNull(source.year),
      p_medium: normalized.medium || null,
      p_type: source.type || null,
      p_runtime_minutes: integerOrNull(source.runtimeMinutes),
      p_country: normalized.country || null,
      p_primary_country: normalized.primaryCountry || null,
      p_poster_url: null,
      p_swedish_title: null,
      p_genre: null,
      p_screenplay_type: normalized.screenplayType || null,
      p_adaptation_source: normalized.adaptationSource || null,
      p_letterboxd_url: textOrNull(source.letterboxdUrl),
    });
    if (error) throw error;
    let film = {
      id: filmId,
      tmdb_id: cleanTmdbId(source.tmdbId),
      title: source.title,
      year: numericOrNull(source.year),
    };
    resolver.remember(film);
    return { status: "created", film };
  }

  /** Resolves/creates a person by name - never via find_or_create_person, which only dedups by tmdb_id (useless for sheet-sourced names). */
  async function resolveOrCreatePerson(resolver, name, ctx) {
    let cleaned = textOrNull(name);
    if (!cleaned) return null;
    let existing = resolver.resolve(cleaned);
    if (existing) return { status: "resolved", person: existing };
    if (!ctx.confirm) {
      return {
        status: "would-create",
        person: resolver.createPlaceholder(cleaned),
      };
    }
    let { data, error } = await ctx.client
      .from("people")
      .insert({ name: cleaned, created_by: ctx.userId })
      .select("id,name")
      .single();
    if (error) throw error;
    resolver.remember(data);
    return { status: "created", person: data };
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
      ambiguous: [],
      skipped: [],
      notes: {},
    };
  }

  function noteFilmResolution(report, resolution) {
    if (resolution.status === "resolved") {
      report.resolved += 1;
      if (resolution.via === "tmdb") report.viaTmdb += 1;
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

  function noteSkipped(report, rowNumber, reason) {
    report.skipped.push({ rowNumber: rowNumber ?? null, reason });
  }

  /* ===========================
     Directors and Franchises: bespoke flat-row parser (issue #468) - the
     existing lane-based parseDirectorWatchlistSheet/parseFranchiseSheet
     don't fit this tab's flat one-row-per-film layout.
  =========================== */

  /** Recovers Watchlist's "Date" column, which parseWatchlist never reads. Keyed the same way parseWatchlist's own internal dedup does. */
  function watchlistDatesByKey(input) {
    let rows = ensureRows(input);
    let map = new Map();
    if (!rows.length) return map;
    let header = (rows[0] || []).map((cell) =>
      String(cell || "")
        .trim()
        .toLowerCase(),
    );
    let dateIdx = header.indexOf("date");
    let nameIdx = header.findIndex(
      (cell) => cell === "name" || cell === "title",
    );
    let yearIdx = header.indexOf("year");
    if (dateIdx < 0 || nameIdx < 0) return map;
    for (let index = 1; index < rows.length; index += 1) {
      let row = rows[index];
      let title = window.cleanSheetCell(row[nameIdx]);
      if (!title) continue;
      let year = yearIdx >= 0 ? window.cleanSheetCell(row[yearIdx]) : "";
      let date = window.cleanSheetCell(row[dateIdx]);
      if (!date) continue;
      map.set(`${window.normalizeTitle(title)}\n${year}`, date);
    }
    return map;
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
    let { error } = await ctx.client.from("film_franchises").insert({
      franchise_id: leaf.id,
      film_id: filmId,
      position: integerOrNull(membership.rank),
    });
    // Same authenticated-grant gap as credits above (select+insert only,
    // no update) - insert and tolerate the unique violation instead of
    // upserting, matching supabase-workspace.js's existing film_franchises
    // writer.
    if (error && error.code !== "23505") throw error;
  }

  /**
   * Resolves and records a film's director credit, shared by
   * runAllTimeStage and runDirectorsFranchisesStage (both stages carry a
   * director name alongside a film row).
   */
  async function applyDirectorCredit(personResolver, filmId, directorName, ctx) {
    let directorResolution = await resolveOrCreatePerson(
      personResolver,
      directorName,
      ctx,
    );
    if (!directorResolution || !ctx.confirm) return;
    let { error } = await ctx.client.from("credits").insert({
      film_id: filmId,
      person_id: directorResolution.person.id,
      role: "director",
    });
    // authenticated only has select+insert on credits (a shared,
    // append-only catalog fact) - no update grant, so upsert's ON
    // CONFLICT DO UPDATE plan is rejected outright even when no row
    // actually conflicts. A plain insert plus tolerating the unique
    // violation gets the same "create if missing" result and matches
    // how supabase-workspace.js already treats film_franchises.
    if (error && error.code !== "23505") throw error;
  }

  /* ===========================
     Stage 1: All-time ranked list
  =========================== */

  async function runAllTimeStage(raw, resolvers, ctx) {
    let report = newStageReport("All-time");
    let parsed = window.parseRankedList(raw, { includeRowNumbers: true });
    if (!parsed) return { report, watchedFilmIds: new Set() };
    report.totalRows = parsed.films.length;
    report.skipped = (parsed.diagnostics?.skippedDetails || []).map(
      (entry) => ({ rowNumber: entry.rowNumber, reason: entry.reason }),
    );

    let watchedFilmIds = new Set();
    let rankingRowsByScope = new Map();
    let tagNames = new Set();
    let filmTagRelations = [];

    function addRankingRow(scopeType, scope, row) {
      let key = `${scopeType}::${scope}`;
      let list = rankingRowsByScope.get(key) || [];
      list.push(row);
      rankingRowsByScope.set(key, list);
    }

    let index = 0;
    for (let film of parsed.films) {
      index += 1;
      ctx.onProgress?.("All-time", index, parsed.films.length);
      let resolution = await resolveOrCreateFilm(
        resolvers.filmResolver,
        film,
        ctx,
      );
      noteFilmResolution(report, resolution);
      if (resolution.status === "ambiguous") {
        noteAmbiguous(report, film, resolution);
        continue;
      }
      let filmId = resolution.film.id;
      watchedFilmIds.add(filmId);

      if (film.director) {
        await applyDirectorCredit(
          resolvers.personResolver,
          filmId,
          film.director,
          ctx,
        );
      }

      let ratingParsed = window.parseFilmRating(film.rating);
      let musicParsed = window.parseFilmRating(film.musicScore);
      let watchedRow = {
        film_id: filmId,
        rating: ratingParsed.value || null,
        rating_modifier: ratingParsed.value
          ? textOrNull(ratingParsed.modifier)
          : null,
        date_watched: textOrNull(film.dateWatched),
        views: integerOrNull(film.views),
        platform: textOrNull(film.platform),
        music_score: textOrNull(film.musicScore),
        music_rating: textOrNull(film.musicScore),
        music_rating_value: musicParsed.value || null,
        source_row_number: integerOrNull(film.rowNumber),
      };
      report.notes["watched rows"] = (report.notes["watched rows"] || 0) + 1;
      if (ctx.confirm) {
        let { error } = await ctx.client
          .from("watched")
          .upsert(watchedRow, { onConflict: "user_id,film_id" });
        if (error) throw error;
      }

      let year = integerOrNull(film.year);
      let scopes = [
        ["years", year ? String(year) : null, integerOrNull(film.yearRank)],
        [
          "decades",
          year ? `${Math.floor(year / 10) * 10}s` : null,
          integerOrNull(film.decadeRank),
        ],
        [
          "centuries",
          year ? `${Math.floor(year / 100) * 100}s` : null,
          integerOrNull(film.centuryRank),
        ],
        ["allTime", "alltime", integerOrNull(film.allTimeRank)],
      ];
      for (let [scopeType, scope, rank] of scopes) {
        if (!scope || !rank || rank < 1) continue;
        addRankingRow(scopeType, scope, {
          filmId,
          position: String(rank).padStart(10, "0"),
          rankConfirmed: film.rankConfirmed !== false,
          suppressAllTimeRank:
            scopeType === "allTime" && Boolean(film.suppressAllTimeRank),
          tieGroupId:
            scopeType === "allTime" ? textOrNull(film.rankingGroupId) : null,
          tieGroupTitle:
            scopeType === "allTime"
              ? textOrNull(film.rankingGroupTitle)
              : null,
        });
      }

      for (let membership of film.franchises || []) {
        await applyFranchiseMembership(
          resolvers.franchiseResolver,
          filmId,
          membership,
          ctx,
          report,
        );
      }

      for (let tag of film.tags || []) {
        let name = textOrNull(tag);
        if (!name) continue;
        tagNames.add(name);
        filmTagRelations.push({ filmId, name });
      }
    }

    let scopeKeys = [...rankingRowsByScope.keys()];
    report.notes["ranking scopes"] = scopeKeys.length;
    report.notes["ranking entries"] = [...rankingRowsByScope.values()].reduce(
      (sum, list) => sum + list.length,
      0,
    );
    if (ctx.confirm && scopeKeys.length) {
      await writeBatches(
        scopeKeys.map((key) => {
          let [scopeType, scope] = key.split("::");
          return { scope_type: scopeType, scope };
        }),
        async (batch) => {
          let { error } = await ctx.client
            .from("rankings")
            .upsert(batch, { onConflict: "user_id,scope_type,scope" });
          if (error) throw error;
        },
      );
      let rankings = (
        await fetchAll(ctx.client, "rankings", "id,user_id,scope_type,scope")
      ).filter((row) => row.user_id === ctx.userId);
      let rankingIdByScope = new Map(
        rankings.map((row) => [`${row.scope_type}::${row.scope}`, row.id]),
      );
      let entries = [];
      for (let [key, rows] of rankingRowsByScope) {
        let rankingId = rankingIdByScope.get(key);
        for (let row of rows) {
          entries.push({
            ranking_id: rankingId,
            film_id: row.filmId,
            position: row.position,
            rank_confirmed: row.rankConfirmed,
            suppress_all_time_rank: row.suppressAllTimeRank,
            tie_group_id: row.tieGroupId,
            tie_group_title: row.tieGroupTitle,
          });
        }
      }
      await writeBatches(
        dedupeByKey(entries, (row) => `${row.ranking_id}::${row.film_id}`),
        async (batch) => {
          let { error } = await ctx.client
            .from("ranking_entries")
            .upsert(batch, { onConflict: "ranking_id,film_id" });
          if (error) throw error;
        },
      );
    }

    report.notes["tags"] = tagNames.size;
    report.notes["film-tag relations"] = filmTagRelations.length;
    if (ctx.confirm && tagNames.size) {
      await writeBatches([...tagNames].map((name) => ({ name })), async (batch) => {
        let { error } = await ctx.client
          .from("tags")
          .upsert(batch, { onConflict: "user_id,name" });
        if (error) throw error;
      });
      let tags = (await fetchAll(ctx.client, "tags", "id,user_id,name")).filter(
        (row) => row.user_id === ctx.userId,
      );
      let tagIdByName = new Map(tags.map((row) => [row.name, row.id]));
      let filmTags = dedupeByKey(
        filmTagRelations
          .map((relation) => ({
            film_id: relation.filmId,
            tag_id: tagIdByName.get(relation.name),
          }))
          .filter((row) => row.tag_id),
        (row) => `${row.film_id}::${row.tag_id}`,
      );
      await writeBatches(filmTags, async (batch) => {
        let { error } = await ctx.client
          .from("film_tags")
          .upsert(batch, { onConflict: "user_id,film_id,tag_id" });
        if (error) throw error;
      });
    }

    return { report, watchedFilmIds };
  }

  /* ===========================
     Stage 2: Watchlist
  =========================== */

  async function runWatchlistStage(raw, resolvers, watchedFilmIds, ctx) {
    let report = newStageReport("Watchlist");
    let parsed = window.parseWatchlist(raw);
    report.totalRows = parsed.items.length;
    report.skipped = (parsed.diagnostics?.skippedDetails || []).map(
      (entry) => ({ rowNumber: entry.rowNumber, reason: entry.reason }),
    );
    let dateByKey = watchlistDatesByKey(raw);

    let skippedAlreadyWatched = 0;
    let watchlistFilmIds = new Set();
    let nextPosition = 1;
    let rows = [];

    let index = 0;
    for (let item of parsed.items) {
      index += 1;
      ctx.onProgress?.("Watchlist", index, parsed.items.length);
      let resolution = await resolveOrCreateFilm(
        resolvers.filmResolver,
        item,
        ctx,
      );
      noteFilmResolution(report, resolution);
      if (resolution.status === "ambiguous") {
        noteAmbiguous(report, item, resolution);
        continue;
      }
      let filmId = resolution.film.id;
      if (watchedFilmIds.has(filmId)) {
        skippedAlreadyWatched += 1;
        continue;
      }
      watchlistFilmIds.add(filmId);
      let dateKey = `${window.normalizeTitle(item.title)}\n${item.year || ""}`;
      let addedAt = dateByKey.get(dateKey) || null;
      // added_at is NOT NULL - omit the key (taking the column's own
      // default now()) on the rare row with no recovered date.
      let row = {
        film_id: filmId,
        tier: null,
        position: String(nextPosition).padStart(10, "0"),
        reason: null,
      };
      if (addedAt) row.added_at = addedAt;
      rows.push(row);
      nextPosition += 1;
    }

    rows = dedupeByKey(rows, (row) => row.film_id);
    report.notes["skipped (already watched)"] = skippedAlreadyWatched;
    report.notes["would-write watchlist rows"] = rows.length;
    if (ctx.confirm && rows.length) {
      await writeBatches(rows, async (batch) => {
        let { error } = await ctx.client
          .from("watchlist")
          .upsert(batch, { onConflict: "user_id,film_id" });
        if (error) throw error;
      });
    }

    return { report, watchlistFilmIds, nextPosition };
  }

  /* ===========================
     Stage 3: Directors and Franchises
  =========================== */

  async function runDirectorsFranchisesStage(
    input,
    resolvers,
    watchedFilmIds,
    watchlistFilmIds,
    startPosition,
    ctx,
  ) {
    let report = newStageReport("Directors and Franchises");
    let items = window.parseDirectorsFranchisesSheet(input);
    report.totalRows = items.length;

    let alreadyWatched = 0;
    let tierUpdates = 0;
    let newWatchlistRows = [];
    let nextPosition = startPosition;

    let index = 0;
    for (let item of items) {
      index += 1;
      ctx.onProgress?.("Directors and Franchises", index, items.length);
      let resolution = await resolveOrCreateFilm(
        resolvers.filmResolver,
        item,
        ctx,
      );
      noteFilmResolution(report, resolution);
      if (resolution.status === "ambiguous") {
        noteAmbiguous(report, item, resolution);
        continue;
      }
      let filmId = resolution.film.id;

      if (item.director) {
        await applyDirectorCredit(
          resolvers.personResolver,
          filmId,
          item.director,
          ctx,
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

      if (watchedFilmIds.has(filmId)) {
        alreadyWatched += 1;
        continue;
      }
      if (watchlistFilmIds.has(filmId)) {
        tierUpdates += 1;
        if (ctx.confirm && item.tier) {
          let { error } = await ctx.client
            .from("watchlist")
            .update({ tier: item.tier })
            .eq("film_id", filmId);
          if (error) throw error;
        }
        continue;
      }
      watchlistFilmIds.add(filmId);
      newWatchlistRows.push({
        film_id: filmId,
        tier: item.tier || null,
        position: String(nextPosition).padStart(10, "0"),
        reason: null,
      });
      nextPosition += 1;
    }

    newWatchlistRows = dedupeByKey(newWatchlistRows, (row) => row.film_id);
    report.notes["already watched (franchise/director only)"] = alreadyWatched;
    report.notes["existing watchlist tier updates"] = tierUpdates;
    report.notes["new watchlist rows (no added_at source)"] =
      newWatchlistRows.length;
    if (ctx.confirm && newWatchlistRows.length) {
      await writeBatches(newWatchlistRows, async (batch) => {
        let { error } = await ctx.client
          .from("watchlist")
          .upsert(batch, { onConflict: "user_id,film_id" });
        if (error) throw error;
      });
    }

    return { report };
  }

  /* ===========================
     Stage 4: The Oskars award brackets
  =========================== */

  async function runOskarsStage(input, resolvers, existingNominations, ctx) {
    let report = newStageReport("The Oskars");
    let blocks = window.splitBracketSheetBlocks(ensureRows(input));
    let periods = blocks.map((block) => window.parseTable("", { rows: block.rows }));
    // Process narrow-to-broad (years, then decades, then centuries, then
    // allTime) regardless of sheet layout order, so a decade nomination
    // resolved earlier in this same run can inform that film's century/
    // all-time disambiguation later in this same run (see
    // filmCategoryHistory below). Array.prototype.sort is stable, so blocks
    // sharing a rank keep their original sheet order.
    periods.sort(
      (a, b) => (PERIOD_RANK[a.periodType] ?? 0) - (PERIOD_RANK[b.periodType] ?? 0),
    );

    let scopeKeys = new Set();
    let nominationsBySourceKey = new Map();
    let resolvedNominations = 0;
    let skippedNominations = 0;

    // Which award period types (and, within those, which categories) has
    // each film already been nominated for - read-only, so safe to always
    // compute even in preview mode. Seeded from the user's real existing
    // history, then grown live as this run resolves each period
    // (narrow-to-broad, per the sort above), and used by
    // resolveByTitleOnly to break same-title/same-century ties: a
    // candidate with real nomination history at a narrower period is
    // preferred over one with none, since this app's award brackets
    // promote a narrower period's winner into the next one up
    // (src/domain/decade-merge.js) - and specifically history in the
    // *same category* being resolved is stronger evidence than history in
    // any category at all (issue #473).
    let priorAwards = (
      await fetchAll(ctx.client, "personal_awards", "id,user_id,scope_type,scope")
    ).filter((row) => row.user_id === ctx.userId);
    let scopeTypeByAwardId = new Map(
      priorAwards.map((row) => [row.id, row.scope_type]),
    );
    let filmCategoryHistory = new Map();
    function noteFilmCategory(filmId, scopeType, category) {
      let byScope = filmCategoryHistory.get(filmId) || new Map();
      let categories = byScope.get(scopeType) || new Set();
      if (category) categories.add(category);
      byScope.set(scopeType, categories);
      filmCategoryHistory.set(filmId, byScope);
    }
    for (let nomination of existingNominations) {
      let scopeType = scopeTypeByAwardId.get(nomination.personal_award_id);
      if (scopeType && nomination.film_id)
        noteFilmCategory(nomination.film_id, scopeType, nomination.category);
    }

    let periodIndex = 0;
    for (let period of periods) {
      periodIndex += 1;
      ctx.onProgress?.("The Oskars", periodIndex, periods.length);
      if (!period?.films?.length) continue;
      scopeKeys.add(`${period.periodType}::${period.year}`);
      report.totalRows += period.films.length;

      for (let film of period.films) {
        // parseTable's getOrCreateFilm sets every nominee's "year" to the
        // bracket block's own period key, not the film's real release
        // year - only true for a "years" (annual) block. For decade/
        // century/all-time blocks, resolve by title alone against the
        // working catalog instead of trusting film.year.
        let resolution = window.filmConcreteYear(film.year)
          ? await resolveOrCreateFilm(resolvers.filmResolver, film, ctx)
          : resolvers.filmResolver.resolveByTitleOnly(
              film.title,
              { periodType: period.periodType, year: period.year },
              filmCategoryHistory,
              (film.awards || []).map((award) => award.category),
            );
        noteFilmResolution(report, resolution);
        if (resolution.status === "ambiguous") {
          noteAmbiguous(report, film, resolution);
          skippedNominations += (film.awards || []).length;
          continue;
        }
        if (resolution.status === "missing") {
          noteSkipped(
            report,
            null,
            `"${film.title}" has no known real release year (only known as "${film.year}") - skipping ${(film.awards || []).length} nomination(s)`,
          );
          skippedNominations += (film.awards || []).length;
          continue;
        }
        let filmId = resolution.film.id;
        for (let award of film.awards || [])
          noteFilmCategory(filmId, period.periodType, award.category);
        let isPending = String(filmId).startsWith("pending:");

        for (let award of film.awards || []) {
          if (isPending && ctx.confirm) {
            skippedNominations += 1;
            noteSkipped(
              report,
              null,
              `Film "${film.title}" unresolved for ${award.category}`,
            );
            continue;
          }
          let recipients = (award.recipients || [])
            .map((recipient) => textOrNull(recipient?.name))
            .filter(Boolean);
          let sortedRecipients = [...recipients].sort((a, b) =>
            String(a).localeCompare(String(b), undefined, {
              sensitivity: "base",
            }),
          );
          let sourceKey = JSON.stringify([
            filmId,
            period.periodType,
            period.year,
            award.category,
            award.placement,
            textOrNull(award.detail),
            sortedRecipients,
          ]);
          let rawSourceKey = JSON.stringify([
            filmId,
            period.periodType,
            period.year,
            award.category,
            award.placement,
            textOrNull(award.detail),
            recipients,
          ]);
          resolvedNominations += 1;
          nominationsBySourceKey.set(sourceKey, {
            scopeType: period.periodType,
            scope: period.year,
            sourceKey,
            rawSourceKey,
            category: award.category,
            placement: award.placement,
            filmId,
            detail: textOrNull(award.detail),
            recipients,
          });
        }
      }
    }

    report.notes["award periods"] = scopeKeys.size;
    report.notes["nominations resolved"] = resolvedNominations;
    report.notes["nominations skipped (unresolved film)"] = skippedNominations;

    if (!ctx.confirm) return { report };

    await writeBatches(
      [...scopeKeys].map((key) => {
        let [scopeType, scope] = key.split("::");
        return { scope_type: scopeType, scope };
      }),
      async (batch) => {
        let { error } = await ctx.client
          .from("personal_awards")
          .upsert(batch, { onConflict: "user_id,scope_type,scope" });
        if (error) throw error;
      },
    );
    let awards = (
      await fetchAll(
        ctx.client,
        "personal_awards",
        "id,user_id,scope_type,scope",
      )
    ).filter((row) => row.user_id === ctx.userId);
    let awardIdByScope = new Map(
      awards.map((row) => [`${row.scope_type}::${row.scope}`, row.id]),
    );

    // personal_nominations: source_key has a *partial* unique index, so
    // .upsert() can't target it - diff against already-fetched rows and
    // .insert() only what's missing.
    let existingBySourceKey = new Map();
    let existingByNormalizedSourceKey = new Map();
    existingNominations.forEach((row) => {
      if (!row.source_key) return;
      existingBySourceKey.set(row.source_key, row);
      let norm = window.normalizeNominationSourceKey(row.source_key);
      if (norm) existingByNormalizedSourceKey.set(norm, row);
    });
    let toInsert = [];
    for (let [sourceKey, nomination] of nominationsBySourceKey) {
      if (
        existingBySourceKey.has(sourceKey) ||
        existingBySourceKey.has(nomination.rawSourceKey) ||
        existingByNormalizedSourceKey.has(sourceKey)
      ) {
        continue;
      }
      toInsert.push({
        personal_award_id: awardIdByScope.get(
          `${nomination.scopeType}::${nomination.scope}`,
        ),
        source_key: sourceKey,
        category: nomination.category,
        placement: nomination.placement,
        film_id: nomination.filmId,
        detail: nomination.detail,
      });
    }
    await writeBatches(toInsert, async (batch) => {
      let { error } = await ctx.client
        .from("personal_nominations")
        .insert(batch);
      if (error) throw error;
    });

    let allAwardIds = new Set(awards.map((row) => row.id));
    let stored = (
      await fetchAll(
        ctx.client,
        "personal_nominations",
        "id,personal_award_id,source_key",
      )
    ).filter((row) => allAwardIds.has(row.personal_award_id));
    let nominationIdBySourceKey = new Map();
    let nominationIdByNormalizedSourceKey = new Map();
    stored.forEach((row) => {
      if (!row.source_key) return;
      nominationIdBySourceKey.set(row.source_key, row.id);
      let norm = window.normalizeNominationSourceKey(row.source_key);
      if (norm) nominationIdByNormalizedSourceKey.set(norm, row.id);
    });

    let recipientRows = [];
    for (let [sourceKey, nomination] of nominationsBySourceKey) {
      let nominationId =
        nominationIdBySourceKey.get(sourceKey) ||
        nominationIdBySourceKey.get(nomination.rawSourceKey) ||
        nominationIdByNormalizedSourceKey.get(sourceKey);
      if (!nominationId) continue;
      for (let name of nomination.recipients) {
        let personResolution = await resolveOrCreatePerson(
          resolvers.personResolver,
          name,
          ctx,
        );
        recipientRows.push({
          nomination_id: nominationId,
          person_id:
            personResolution?.person &&
            !String(personResolution.person.id).startsWith("pending:")
              ? personResolution.person.id
              : null,
          recipient_name: name,
        });
      }
    }
    await writeBatches(
      dedupeByKey(
        recipientRows,
        (row) => `${row.nomination_id}::${row.recipient_name}`,
      ),
      async (batch) => {
        let { error } = await ctx.client
          .from("personal_nomination_recipients")
          .upsert(batch, { onConflict: "nomination_id,recipient_name" });
        if (error) throw error;
      },
    );

    return { report };
  }

  /* ===========================
     Public API
  =========================== */

  function googleSheetsSupabaseRanges() {
    let ranges = window.OSKARS_LOCAL_CONFIG?.googleSheets?.ranges || {};
    return {
      allTime: ranges.allTime,
      bracket: ranges.bracket,
      watchlist: ranges.watchlist,
      directorsAndFranchises: ranges.directorsAndFranchises,
    };
  }

  /** Reports whether this browser has a configured Google Sheet to import from - gates the whole feature's visibility. */
  window.googleSheetsSupabaseImportConfigured = function () {
    let config = window.OSKARS_LOCAL_CONFIG?.googleSheets;
    return Boolean(
      window.OSKARS_LOCAL_CONFIG?.googleClientId &&
        config?.spreadsheetId &&
        Object.values(googleSheetsSupabaseRanges()).some(Boolean),
    );
  };

  /**
   * Signs in and fetches every configured range once. The same result is
   * passed to runGoogleSheetsSupabaseImport for both a dry-run preview and
   * the real --confirm-equivalent apply, so the two operate on identical
   * source data.
   * @returns {Promise<{allTime: string, watchlist: string, bracketRows: string[][], directorsFranchisesRows: string[][]}>}
   */
  window.fetchGoogleSheetsSupabaseSource = async function () {
    let config = window.OSKARS_LOCAL_CONFIG?.googleSheets;
    let spreadsheetId = String(config?.spreadsheetId || "").trim();
    if (!spreadsheetId)
      throw new Error("Missing googleSheets.spreadsheetId in config.local.js.");
    let ranges = googleSheetsSupabaseRanges();
    let rangeKeys = Object.keys(ranges).filter((key) => ranges[key]);
    if (!rangeKeys.length)
      throw new Error("Missing googleSheets.ranges in config.local.js.");

    await window.loadGoogleIdentity();
    let accessToken = await window.requestGoogleAccessToken();
    let data = await window.fetchGoogleSheetValues(
      spreadsheetId,
      rangeKeys.map((key) => ranges[key]),
      accessToken,
    );
    let valueRanges = data.valueRanges || [];
    let byKey = {};
    rangeKeys.forEach((key, index) => {
      byKey[key] = valueRanges[index]?.values || [];
    });

    return {
      allTimeRaw: window.rowsToDelimited(byKey.allTime || [], "\t"),
      watchlistRaw: window.rowsToDelimited(byKey.watchlist || [], "\t"),
      bracketRows: byKey.bracket || [],
      directorsFranchisesRows: byKey.directorsAndFranchises || [],
    };
  };

  /**
   * Runs every stage against an already-fetched source. Pass {confirm:
   * false} (the default) for a dry run that writes nothing; {confirm: true}
   * to write for real. onProgress(stageName, done, total) is called
   * throughout - a real hosted import is thousands of sequential Supabase
   * round trips, slower than local testing, so the caller should show it.
   * @returns {Promise<{reports: Object[]}>}
   */
  window.runGoogleSheetsSupabaseImport = async function (source, options = {}) {
    let { client, user } = await readyClient();
    let ctx = {
      confirm: Boolean(options.confirm),
      client,
      userId: user.id,
      onProgress: options.onProgress,
    };

    let [films, people, franchises, watched, watchlist, personalNominations] =
      await Promise.all([
        fetchAll(
          client,
          "films",
          "id,tmdb_id,title,year,medium,type,runtime_minutes,country,primary_country,poster_url,swedish_title,genre,screenplay_type,adaptation_source,letterboxd_url",
        ),
        fetchAll(client, "people", "id,name"),
        fetchAll(client, "franchises", "id,slug,name,parent_id,source_url"),
        fetchAll(client, "watched", "user_id,film_id"),
        fetchAll(client, "watchlist", "user_id,film_id"),
        fetchAll(
          client,
          "personal_nominations",
          "id,personal_award_id,source_key,category,placement,film_id,detail",
        ),
      ]);

    let resolvers = {
      filmResolver: buildFilmResolver(films),
      personResolver: buildPersonResolver(people),
      franchiseResolver: buildFranchiseResolver(franchises),
    };

    let ownedWatchedFilmIds = new Set(watched.map((row) => row.film_id));
    let ownedWatchlistFilmIds = new Set(watchlist.map((row) => row.film_id));
    let nextWatchlistPosition = ownedWatchlistFilmIds.size + 1;

    let reports = [];

    let stage1 = await runAllTimeStage(source.allTimeRaw, resolvers, ctx);
    reports.push(stage1.report);
    stage1.watchedFilmIds.forEach((id) => ownedWatchedFilmIds.add(id));

    let stage2 = await runWatchlistStage(
      source.watchlistRaw,
      resolvers,
      ownedWatchedFilmIds,
      ctx,
    );
    reports.push(stage2.report);
    stage2.watchlistFilmIds.forEach((id) => ownedWatchlistFilmIds.add(id));
    nextWatchlistPosition = Math.max(
      nextWatchlistPosition,
      stage2.nextPosition,
    );

    let stage3 = await runDirectorsFranchisesStage(
      source.directorsFranchisesRows,
      resolvers,
      ownedWatchedFilmIds,
      ownedWatchlistFilmIds,
      nextWatchlistPosition,
      ctx,
    );
    reports.push(stage3.report);

    let stage4 = await runOskarsStage(
      source.bracketRows,
      resolvers,
      personalNominations,
      ctx,
    );
    reports.push(stage4.report);

    return { reports };
  };
})();
