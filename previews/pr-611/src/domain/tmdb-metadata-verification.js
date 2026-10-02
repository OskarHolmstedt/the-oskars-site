/** @file Compares every objective catalog film field with TMDB evidence and retains explicit limits of verification. */

const filmVerificationColumns = [
  "tmdb_id",
  "tmdb_tv_ref",
  "title",
  "swedish_title",
  "year",
  "runtime_minutes",
  "country",
  "primary_country",
  "poster_url",
  "medium",
  "screenplay_type",
  "original_language",
  "genre",
  "type",
  "adaptation_source",
  "letterboxd_url",
];

/** Captures the metadata and director identities a report describes. @param {Object} film Catalog film. @returns {Object} Comparable snapshot. */
window.filmVerificationSnapshot = function (film) {
  let snapshot = Object.fromEntries(
    filmVerificationColumns.map((key) => [key, film[key] ?? null]),
  );
  snapshot.directors = (film.credits || [])
    .filter((c) => c.role === "director" && c.people)
    .map((c) => ({ name: c.people.name, tmdb_id: c.people.tmdb_id ?? null }))
    .sort(
      (a, b) =>
        (a.tmdb_id || 0) - (b.tmdb_id || 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
  return snapshot;
};

/** Checks whether the current metadata has a saved expanded review. @param {Object} film Catalog film. @returns {boolean} Whether its review is current. */
window.hasCurrentFilmMetadataVerification = function (film) {
  let header = film.tmdb_verification;
  if (header?.version !== 2 || !header.snapshot) return false;
  if ((!film.type || film.type === "unknown") && header.type_policy !== 1)
    return false;
  if (header.medium_policy !== 1 || !header.identity) return false;
  if (isWholeTvSeries(film) && header.creator_policy !== 1) return false;
  let current = window.filmVerificationSnapshot(film);
  return Object.keys(current).every((key) =>
    key === "directors"
      ? JSON.stringify(current.directors.map((d) => [d.tmdb_id, d.name])) ===
        JSON.stringify(
          (header.snapshot.directors || []).map((d) => [d.tmdb_id, d.name]),
        )
      : current[key] === header.snapshot[key],
  );
};

function verificationText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
function verificationValues(value) {
  return Array.isArray(value)
    ? value
    : value === null ||
        value === undefined ||
        value === "" ||
        value === "unknown"
      ? []
      : [value];
}
function verificationCountries(value) {
  return String(value || "")
    .split(/[,;/|]/)
    .map(
      (name) => window.countryCodeFor?.(name.trim()) || verificationText(name),
    )
    .filter(Boolean);
}
function isWholeTvSeries(film) {
  return /^TV:\d+$/.test(film?.tmdb_tv_ref || "");
}
function verificationReference(film) {
  return film.tmdb_tv_ref || `movie:${film.tmdb_id}`;
}

/** Judges whether a report's TMDB entry is the catalogued work: doubtful when the entry is missing or title, year or directors disagree without an owner decision. @param {Object} fields Report field results. @returns {'confirmed'|'doubtful'} Identity verdict. */
window.filmIdentityVerdict = function (fields) {
  if (fields?.identity?.status !== "match") return "doubtful";
  return ["title", "year", "directors"].some(
    (key) => fields[key]?.status === "mismatch",
  )
    ? "doubtful"
    : "confirmed";
};

/** Builds explicit field outcomes from source evidence without editing metadata; a field the owner decided is kept rather than reported as a disagreement or gap. @param {Object} film Catalog film. @param {Object} evidence Source evidence. @returns {Object} Versioned field report. */
window.compareFilmMetadataEvidence = function (film, evidence) {
  let fields = {};
  let decided = new Set(film.owner_decided_fields || []);
  let runtime = Number(evidence.runtimes?.[0] || film.runtime_minutes) || 0;
  let inferredType =
    evidence.mediaType === "tv" || film.tmdb_tv_ref
      ? "TV series"
      : (evidence.genres || []).includes("Documentary")
        ? "Documentary"
        : runtime > 0 && runtime <= 40
          ? "Short"
          : "Film";
  let inferredMedium = (evidence.genres || []).includes("Animation")
    ? "animation"
    : "live-action";
  let snapshot = window.filmVerificationSnapshot(film);
  let unavailable =
    film.tmdb_field_outcomes?.[verificationReference(film)] || {};
  function add(key, remote, options = {}) {
    let local = key === "directors" ? snapshot.directors : snapshot[key];
    let values = verificationValues(remote);
    let localValues = verificationValues(local);
    let status;
    let note = options.note || "";
    if (unavailable[options.availabilityKey || key] === "unavailable") {
      status = "unavailable";
      values = [];
      note =
        "Previously confirmed unavailable from TMDB for this identity; not checked again.";
    } else if (options.unsupported) status = "not_verifiable";
    else if (!values.length) status = "unavailable";
    else if (!localValues.length) status = "missing";
    else
      status = (
        options.matches
          ? options.matches(local, values)
          : values.some(
              (value) => verificationText(value) === verificationText(local),
            )
      )
        ? "match"
        : "mismatch";
    if (decided.has(key) && ["mismatch", "missing"].includes(status))
      status = "kept";
    fields[key] = {
      status,
      local,
      source: key === "directors" ? values : values.slice(0, 8),
      note,
    };
  }
  if (!evidence.exists) {
    fields.identity = {
      status: "mismatch",
      local: verificationReference(film),
      source: [],
      note: "The declared TMDB resource was not found.",
    };
    for (let key of [
      ...filmVerificationColumns.filter((k) => !k.startsWith("tmdb_")),
      "directors",
    ])
      fields[key] = {
        status: "not_checked",
        local: snapshot[key],
        source: [],
        note: "Resource unavailable.",
      };
  } else {
    fields.identity = {
      status: "match",
      local: verificationReference(film),
      source: [verificationReference(film)],
      note: "The declared resource exists.",
    };
    add("title", evidence.titles);
    add("swedish_title", evidence.swedishTitles);
    add("year", evidence.years, {
      matches: (local, values) => values.map(String).includes(String(local)),
      note: "Primary and regional release years are accepted.",
    });
    add("runtime_minutes", evidence.runtimes, {
      matches: (local, values) => values.map(Number).includes(Number(local)),
      note:
        evidence.runtimeNote ||
        "Primary and translated-cut runtimes are accepted.",
    });
    let countries = evidence.countries || [];
    let codes = countries
      .flatMap((c) => [
        c.code,
        window.countryCodeFor?.(c.name) || verificationText(c.name),
      ])
      .filter(Boolean);
    add(
      "country",
      countries.map((c) => c.name || c.code),
      {
        matches: (local) =>
          verificationCountries(local).every((code) => codes.includes(code)),
        note: "Stored countries must be among the production countries; aliases and codes are accepted.",
      },
    );
    add(
      "primary_country",
      countries.map((c) => c.name || c.code),
      {
        availabilityKey: "country",
        matches: (local) =>
          codes.includes(
            window.countryCodeFor?.(local) || verificationText(local),
          ),
        note: "Checks membership, not a TMDB ranking of primary country.",
      },
    );
    add("original_language", evidence.language);
    let wholeSeries = isWholeTvSeries(film);
    add("directors", evidence.directors, {
      matches: (local, values) =>
        local.every((director) =>
          [...values, ...(wholeSeries ? evidence.creators || [] : [])].some(
            (remote) =>
              director.tmdb_id && remote.tmdb_id
                ? Number(director.tmdb_id) === Number(remote.tmdb_id)
                : verificationText(director.name) ===
                  verificationText(remote.name),
          ),
        ),
      note: wholeSeries
        ? "Every stored director must be a TMDB director or series creator; additional TMDB co-directors are allowed."
        : "Every stored director must match; additional TMDB co-directors are allowed. Series creators are not treated as directors.",
    });
    let image = null;
    try {
      let url = new URL(film.poster_url);
      if (url.hostname === "image.tmdb.org")
        image = url.pathname.split("/").pop();
    } catch (_) {}
    let posters = evidence.posters || [];
    add("poster_url", image && posters.includes(image) ? [image] : posters, {
      unsupported: !!film.poster_url && !image,
      matches: () => posters.includes(image),
      note:
        film.poster_url && !image
          ? "Externally hosted artwork cannot be authenticated by TMDB."
          : "Checks all TMDB posters/stills, not just the preferred image.",
    });
    add("genre", evidence.genres, {
      matches: (local, values) =>
        String(local)
          .split(/[,;/|]/)
          .every((genre) =>
            values.some(
              (value) => verificationText(value) === verificationText(genre),
            ),
          ),
      note: "Uses TMDB genre labels; local genre taxonomies may need review.",
    });
    add("medium", inferredMedium, {
      note: "Catalog rule: TMDB's Animation genre means animation; no Animation genre confirms live-action.",
    });
    add("screenplay_type", evidence.screenplay, {
      unsupported: !["original", "adapted"].includes(evidence.screenplay),
      note: "Catalog rule: explicit underlying-source credits, or TMDB keywords for a source work, remake or franchise entry, mean adapted; writing credits without them mean original. Story, Screenplay and Adaptation alone are not source material, and neither is a true story. Inferred from TMDB credits and keywords, not an independent factual guarantee.",
    });
    add("type", inferredType, {
      unsupported:
        !!verificationValues(film.type).length && film.type !== inferredType,
      note: "Catalog default: TV identity, then Documentary genre, then runtime up to 40 minutes; otherwise Film. Existing types are retained. TV-film, Stage, Concert and Anthology are manual choices. This is a catalog rule, not independent verification.",
    });
    add(
      "adaptation_source",
      [...(evidence.adaptationJobs || []), ...(evidence.sourceKeywords || [])],
      {
        unsupported: true,
        note: "TMDB source-material jobs do not establish the exact adaptation-source taxonomy.",
      },
    );
    add("letterboxd_url", [], {
      unsupported: true,
      note: "TMDB does not provide an authoritative Letterboxd URL.",
    });
  }
  if (evidence.exists) {
    let suggestions = {
      title: evidence.titles?.[0],
      swedish_title: evidence.swedishTitles?.[0],
      year: Number(evidence.years?.[0]) || null,
      runtime_minutes: evidence.runtimes?.[0],
      country: evidence.countries?.map((c) => c.name || c.code).join(", "),
      primary_country:
        evidence.countries?.length === 1
          ? evidence.countries[0].name || evidence.countries[0].code
          : null,
      original_language: evidence.language,
      genre: evidence.genres?.join(", "),
      poster_url: evidence.posters?.[0]
        ? `https://image.tmdb.org/t/p/w500/${evidence.posters[0]}`
        : null,
      medium: inferredMedium,
      screenplay_type: evidence.screenplay,
      type: inferredType,
      directors: evidence.directors,
    };
    for (let [key, value] of Object.entries(suggestions)) {
      if (
        ["missing", "mismatch", "kept"].includes(fields[key]?.status) &&
        verificationValues(value).length
      )
        fields[key].suggested_value = value;
    }
  }
  let statuses = Object.values(fields).map((field) => field.status);
  let summary = statuses.includes("mismatch")
    ? "differences"
    : statuses.includes("missing")
      ? "gaps"
      : "complete";
  return {
    header: {
      version: 2,
      type_policy: 1,
      medium_policy: 1,
      creator_policy: 1,
      identity: window.filmIdentityVerdict(fields),
      reference: verificationReference(film),
      snapshot,
      summary,
    },
    fields,
  };
};

/** Describes the next catalog action without treating source limitations as retries. @param {Object} film Catalog film. @returns {string} Workflow status. */
window.catalogFilmWorkflowStatus = function (film) {
  if (
    film.tmdb_verification &&
    !window.hasCurrentFilmMetadataVerification(film)
  )
    return "changed";
  if (window.hasCurrentFilmMetadataVerification(film))
    return film.tmdb_verification.summary === "differences"
      ? "review"
      : "reviewed";
  return "ready";
};

/** Recompares saved evidence with the film's current values and owner decisions. @param {Object} film Current film. @param {Object} previous Saved report with normalized evidence. @returns {Object} Updated report. */
window.reassessFilmMetadataEvidence = function (film, previous) {
  if (
    previous?.evidence?.version !== 1 ||
    previous.header.reference !== verificationReference(film)
  )
    throw new Error("Saved evidence does not describe this TMDB identity.");
  let report = window.compareFilmMetadataEvidence(film, previous.evidence.data);
  report.evidence = previous.evidence;
  return carryVerificationDecisions(report, previous);
};

/** Keeps the record of an accepted TMDB value while the unchanged value still matches TMDB, then recomputes the summary and identity verdict. Kept values come from the film's owner decisions, not from earlier reports. */
function carryVerificationDecisions(report, previous) {
  for (let [key, field] of Object.entries(report.fields)) {
    let old = previous?.fields?.[key];
    if (
      old?.status === "accepted" &&
      field.status === "match" &&
      JSON.stringify(field.local) === JSON.stringify(old.local)
    )
      report.fields[key] = {
        ...field,
        status: old.status,
        previous: old.previous,
      };
  }
  let statuses = Object.values(report.fields).map((field) => field.status);
  report.header.summary = statuses.includes("mismatch")
    ? "differences"
    : statuses.includes("missing")
      ? "gaps"
      : "complete";
  report.header.identity = window.filmIdentityVerdict(report.fields);
  return report;
}

/** Fetches once or reuses saved evidence, then compares and fills through the guarded report writer. @param {Object} film Loaded catalog row. @param {Object} options Report loading/saving, fetch and explicit refresh options. @returns {Promise<Object|null>} Saved report, header-only result for an unchanged review, or null without reusable evidence. */
window.processCatalogFilmMetadata = async function (film, options) {
  if (!(film.tmdb_id || film.tmdb_tv_ref))
    throw new Error(
      "Choose a TMDB movie ID or TV reference before processing.",
    );
  // Catalog headers suffice to skip reviewed rows, even in a full-catalog pass.
  if (!options.refresh && window.hasCurrentFilmMetadataVerification(film))
    return { header: film.tmdb_verification, fields: {} };
  let previous = film.tmdb_verification ? await options.loadReport(film) : null;
  let reusable =
    previous?.evidence?.version === 1 &&
    previous.header.reference === verificationReference(film) &&
    !(isWholeTvSeries(film) && !previous.evidence.data?.creators);
  if (options.reassessOnly && !reusable) return null;
  let report;
  if (!options.refresh && reusable)
    report = window.reassessFilmMetadataEvidence(film, previous);
  else {
    let evidence = await window.fetchFilmMetadataEvidence(
      film,
      options.fetchFn || window.fetch.bind(window),
    );
    report = window.compareFilmMetadataEvidence(film, evidence);
    report.evidence = {
      version: 1,
      fetched_at: new Date().toISOString(),
      data: evidence,
    };
    if (previous?.header?.reference === verificationReference(film))
      report = carryVerificationDecisions(report, previous);
  }
  return options.saveReport(film, report);
};

/** Fetches evidence for the exact movie/TV identity, excluding known unavailable field work. @param {Object} film Catalog film. @param {Function} fetchFn Fetch implementation. @returns {Promise<Object>} Source evidence. */
window.fetchFilmMetadataEvidence = async function (film, fetchFn) {
  let ref = window.parseTmdbReference(film.tmdb_tv_ref || film.tmdb_id);
  let resource = window.tmdbResourcePath(ref);
  let unavailable =
    film.tmdb_field_outcomes?.[verificationReference(film)] || {};
  async function get(path, params = {}) {
    let query = new URLSearchParams(params).toString();
    let response = await fetchFn(
      `${window.TMDB_API_BASE}/${path}${query ? `?${query}` : ""}`,
      { headers: { accept: "application/json" } },
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`TMDB request failed (${response.status})`);
    return response.json();
  }
  let appended =
    ref.mediaType === "movie"
      ? [
          "credits",
          "alternative_titles",
          "translations",
          "release_dates",
          "keywords",
        ]
      : ref.episode !== null
        ? ["credits", "translations"]
        : ref.season !== null
          ? ["credits", "aggregate_credits", "translations"]
          : [
              "credits",
              "aggregate_credits",
              "alternative_titles",
              "translations",
            ];
  let details = await get(resource, {
    language: "en-US",
    append_to_response: appended.join(","),
  });
  if (!details) return { exists: false };
  if (!details.id) throw new Error("Incomplete TMDB resource response");
  for (let name of appended) {
    if (details[name]?.success === false)
      throw new Error(`TMDB ${name} evidence unavailable`);
  }
  let parent = details;
  if (ref.mediaType === "tv" && ref.season !== null) {
    parent = await get(`tv/${ref.id}`, {
      language: "en-US",
      append_to_response: "credits,aggregate_credits,translations",
    });
    if (!parent?.id) throw new Error("TV parent metadata unavailable");
  }
  let runtimes = [];
  let runtimeNote = "";
  if (unavailable.runtime_minutes !== "unavailable") {
    if (ref.mediaType === "movie")
      runtimes = window.tmdbRuntimeOptions(details);
    else if (ref.episode !== null)
      runtimes = Number(details.runtime) > 0 ? [Number(details.runtime)] : [];
    else {
      let episodes = details.episodes || [];
      let complete = true;
      if (ref.season === null) {
        let seasons = (details.seasons || []).filter(
          (s) => Number(s.season_number) >= 1,
        );
        episodes = [];
        for (let season of seasons) {
          let data = await get(`tv/${ref.id}/season/${season.season_number}`);
          if (!data?.id) throw new Error("TV season metadata unavailable");
          let seasonEpisodes = data.episodes || [];
          if (
            !seasonEpisodes.length ||
            (Number(season.episode_count) > 0 &&
              seasonEpisodes.length !== Number(season.episode_count))
          )
            complete = false;
          episodes.push(...seasonEpisodes);
        }
      }
      if (
        complete &&
        episodes.length &&
        episodes.every((e) => Number(e.runtime) > 0)
      )
        runtimes = [
          episodes.reduce((total, e) => total + Number(e.runtime), 0),
        ];
      runtimeNote =
        "Series/season runtime requires durations for every episode; specials are excluded from series totals.";
    }
  }
  let posters = [];
  if (unavailable.poster_url !== "unavailable") {
    posters = [details.poster_path, details.still_path].filter(Boolean);
    let images = await get(`${resource}/images`);
    if (!images) throw new Error("TMDB artwork list unavailable");
    posters.push(
      ...(images.posters || []).map((p) => p.file_path),
      ...(images.stills || []).map((p) => p.file_path),
    );
  }
  let crew = [
    ...(details.credits?.crew || []),
    ...(details.aggregate_credits?.crew || []),
    ...(details.crew || []),
  ];
  let directors = crew
    .filter(
      (p) => p.job === "Director" || p.jobs?.some((j) => j.job === "Director"),
    )
    .map((p) => ({ tmdb_id: p.id || null, name: p.name || "" }));
  directors = directors.filter(
    (p, i) =>
      p.name &&
      directors.findIndex(
        (q) => q.tmdb_id === p.tmdb_id && q.name === p.name,
      ) === i,
  );
  let classification =
    ref.mediaType === "movie"
      ? window.extractTmdbFilmClassification(details)
      : {};
  let alternatives =
    details.alternative_titles?.titles ||
    details.alternative_titles?.results ||
    [];
  let translations = details.translations?.translations || [];
  let evidence = {
    exists: true,
    mediaType: ref.mediaType,
    titles: [
      details.title,
      details.original_title,
      details.name,
      details.original_name,
      ...alternatives.map((a) => a.title),
    ].filter(Boolean),
    swedishTitles: [
      details.original_language === "sv"
        ? details.original_title || details.original_name
        : null,
      ...translations
        .filter((t) => t.iso_639_1 === "sv")
        .map((t) => t.data?.title || t.data?.name),
      ...alternatives.filter((a) => a.iso_3166_1 === "SE").map((a) => a.title),
    ].filter(Boolean),
    years:
      ref.mediaType === "movie"
        ? window.tmdbReleaseYearOptions(details)
        : [
            String(details.air_date || details.first_air_date || "").slice(
              0,
              4,
            ),
          ].filter(Boolean),
    runtimes,
    runtimeNote,
    directors,
    countries: (parent.production_countries || []).map((c) => ({
      code: c.iso_3166_1,
      name: c.name,
    })),
    language: parent.original_language || null,
    posters: [...new Set(posters.map((p) => p.split("/").pop()))],
    genres: (parent.genres || []).map((g) => g.name),
    medium: classification.medium || null,
    screenplay: classification.screenplayType || null,
    adaptationJobs: window.tmdbSourceMaterialJobs(crew),
    sourceKeywords: window.tmdbSourceMaterialKeywords(details),
    creators:
      ref.mediaType === "tv" && ref.season === null
        ? (details.created_by || [])
            .map((p) => ({ tmdb_id: p.id || null, name: p.name || "" }))
            .filter((p) => p.name)
        : undefined,
  };
  return evidence;
};

let expandedVerificationAttempts = new Set();
/** Runs bounded expanded reviews, persisting through an optional callback. @param {Object[]} films Catalog films. @param {Object} [options] Fetch, limit, force, progress and onResult callbacks. @returns {Promise<Object>} Review batch. */
window.checkCatalogFilmMetadata = async function (films, options = {}) {
  let candidates = films.filter(
    (f) =>
      (f.tmdb_id || f.tmdb_tv_ref) &&
      (options.force || !window.hasCurrentFilmMetadataVerification(f)),
  );
  let attemptKey = (f) =>
    `${f.id}:${JSON.stringify(window.filmVerificationSnapshot(f))}`;
  let batch = candidates
    .filter((f) => !expandedVerificationAttempts.has(attemptKey(f)))
    .slice(0, Math.max(1, options.limit || 300));
  let result = {
    attempted: batch.length,
    ok: 0,
    okFilms: [],
    issues: [],
    reports: [],
    failed: 0,
    failures: [],
  };
  let cursor = 0;
  async function worker() {
    while (cursor < batch.length) {
      let film = batch[cursor++];
      let key = attemptKey(film);
      expandedVerificationAttempts.add(key);
      try {
        let evidence = await window.fetchFilmMetadataEvidence(
          film,
          options.fetchFn || window.fetch.bind(window),
        );
        let report = window.compareFilmMetadataEvidence(film, evidence);
        report.evidence = {
          version: 1,
          fetched_at: new Date().toISOString(),
          data: evidence,
        };
        let savedReport = await options.onResult?.(film, report);
        if (savedReport) report = savedReport;
        expandedVerificationAttempts.add(attemptKey(film));
        result.reports.push({ film, report });
        if (report.header.summary === "differences")
          result.issues.push({
            film,
            report,
            status: "metadata",
            detail: Object.entries(report.fields)
              .filter(([, f]) => f.status === "mismatch")
              .map(([name]) => name)
              .join(", "),
          });
        else {
          result.ok++;
          result.okFilms.push(film);
        }
      } catch (error) {
        result.failed++;
        result.failures.push({ film, message: error.message || String(error) });
        expandedVerificationAttempts.delete(key);
      }
      options.onProgress?.(
        result.reports.length + result.failed,
        batch.length,
        film,
      );
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(batch.length, options.concurrency || 4) },
      worker,
    ),
  );
  result.remaining = candidates.filter(
    (f) => !expandedVerificationAttempts.has(attemptKey(f)),
  ).length;
  return result;
};
