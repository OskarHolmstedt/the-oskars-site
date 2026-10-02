/**
 * @file Loads the live public Community directory and defines its snapshot contract and
 * read-only aggregation used by multi-profile comparisons and joint ceremonies.
 */

window.OSKARS_COMMUNITY_INDEX_SCHEMA_VERSION = 1;

/**
 * Lists published profiles with live public counts and a small poster preview without hydrating an archive.
 * @returns {Promise<{profiles: Object[]}>} Published directory cards.
 */
window.fetchSupabaseCommunityDirectory = async function () {
  let ready = await window.ensureSupabasePublicClient?.();
  if (!ready) throw new Error("The public profile service is unavailable.");
  let client = ready.client;
  async function pages(build) {
    let rows = [];
    while (true) {
      let result = await build(rows.length, rows.length + 999);
      if (result.error) throw result.error;
      let page = result.data || [];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }
  let published = await pages((from, to) =>
    client
      .from("profiles")
      .select("public_slug, display_name")
      .not("public_slug", "is", null)
      .order("public_slug")
      .range(from, to),
  );
  let profiles = [];
  for (let offset = 0; offset < published.length; offset += 4) {
    let batch = await Promise.all(
      published.slice(offset, offset + 4).map(async (profile) => {
        let slug = profile.public_slug;
        let [films, rated, winners, posters] = await Promise.all([
          client
            .from("public_watched_films")
            .select("film_id", { count: "exact", head: true })
            .eq("public_slug", slug),
          client
            .from("public_watched_films")
            .select("film_id", { count: "exact", head: true })
            .eq("public_slug", slug)
            .gte("rating", 0.5)
            .lte("rating", 5),
          pages((from, to) =>
            client
              .from("public_personal_awards")
              .select("nomination_id")
              .eq("public_slug", slug)
              .eq("placement", 1)
              .order("nomination_id")
              .range(from, to),
          ),
          client
            .from("public_watched_films")
            .select("poster_url")
            .eq("public_slug", slug)
            .not("poster_url", "is", null)
            .order("rating", { ascending: false, nullsFirst: false })
            .order("film_id")
            .range(0, 3),
        ]);
        for (let result of [films, rated, posters]) {
          if (result.error) throw result.error;
        }
        if (films.count == null || rated.count == null)
          throw new Error("Public profile counts are unavailable.");
        return {
          slug,
          ownerName: profile.display_name || slug,
          summary: {
            filmCount: films.count,
            ratedCount: rated.count,
            winnerCount: new Set(winners.map((row) => row.nomination_id)).size,
          },
          posters: (posters.data || []).map((row) => row.poster_url),
        };
      }),
    );
    profiles.push(...batch);
  }
  return { profiles };
};

let COMMUNITY_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Looks up portrait images for a joint ceremony's award recipients. A
 * recipient's `personId` (public-profile-supabase.js's
 * award.recipients[].personId) is only ever a real `people.id` when the
 * source nomination had one - it falls back to a normalized-name string
 * when it didn't, which this filters out before querying rather than
 * asking Supabase to match a non-uuid value.
 * @param {string[]} personIds Candidate recipient ids, real or synthetic.
 * @returns {Promise<Object<string, string>>} portrait_url keyed by person id, real ids only.
 */
window.fetchCommunityPortraits = async function (personIds) {
  let realIds = [...new Set(personIds || [])].filter((id) =>
    COMMUNITY_UUID_PATTERN.test(String(id || "")),
  );
  if (!realIds.length) return {};
  let ready = await window.ensureSupabasePublicClient?.();
  if (!ready) return {};
  let { data, error } = await ready.client
    .from("people")
    .select("id, portrait_url")
    .in("id", realIds);
  if (error) throw error;
  let byId = {};
  (data || []).forEach((row) => {
    if (row.portrait_url) byId[row.id] = row.portrait_url;
  });
  return byId;
};

function communityText(value) {
  return String(value || "").trim();
}

function communityFilmKey(film) {
  let id = communityText(film?.id);
  if (id) return id;
  let title = communityText(film?.normalizedTitle || film?.title).toLowerCase();
  let year = communityText(film?.year);
  return title ? `${year}::${title}` : "";
}

function communityFilmMap(publicData) {
  let films = [];
  Object.values(publicData?.years || {}).forEach((period) =>
    films.push(...(period?.films || [])),
  );
  films.push(...(publicData?.watchedFilms || []));
  let byKey = new Map();
  films.forEach((film) => {
    let key = communityFilmKey(film);
    if (!key) return;
    let existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...film, awards: [...(film.awards || [])] });
      return;
    }
    let awardKeys = new Set();
    let awards = [...(existing.awards || []), ...(film.awards || [])].filter(
      (award) => {
        let awardKey = [
          award.periodType,
          award.year,
          award.category,
          award.placement,
          award.detail,
          award.recipientText,
        ].join("\n");
        if (awardKeys.has(awardKey)) return false;
        awardKeys.add(awardKey);
        return true;
      },
    );
    let merged = { ...existing, ...film, awards };
    ["rating", "ratingValue", "ratingModifier", "poster", "tmdbId"].forEach(
      (field) => {
        if (!film[field] && existing[field]) merged[field] = existing[field];
      },
    );
    ["allTimeRank", "centuryRank", "decadeRank", "yearRank"].forEach(
      (field) => {
        let ranks = [existing[field], film[field]]
          .map(Number)
          .filter((value) => value > 0);
        if (ranks.length) merged[field] = Math.min(...ranks);
      },
    );
    byKey.set(key, merged);
  });
  return byKey;
}

function communityRatingValue(film) {
  let value = Number(film?.ratingValue);
  return value >= 0.5 && value <= 5 ? value : 0;
}

function communityTitleCompare(left, right) {
  return communityText(left).localeCompare(communityText(right), undefined, {
    sensitivity: "base",
  });
}

/**
 * Validates the small generated public Community directory.
 * @param {Object} source Candidate directory.
 * @returns {{valid: boolean, errors: string[]}} Validation result.
 */
window.validateCommunityIndex = function (source) {
  let errors = [];
  if (!source || typeof source !== "object" || Array.isArray(source))
    return { valid: false, errors: ["directory is not a JSON object"] };
  if (
    source.communityIndexSchemaVersion !==
    window.OSKARS_COMMUNITY_INDEX_SCHEMA_VERSION
  )
    errors.push(
      `communityIndexSchemaVersion must be ${window.OSKARS_COMMUNITY_INDEX_SCHEMA_VERSION}`,
    );
  if (!Array.isArray(source.profiles)) errors.push("profiles must be an array");
  let slugs = new Set();
  (source.profiles || []).forEach((profile, index) => {
    let path = `profiles[${index}]`;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      errors.push(`${path} must be an object`);
      return;
    }
    let slug = communityText(profile.slug);
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      errors.push(`${path}.slug is invalid`);
    if (slugs.has(slug)) errors.push(`${path}.slug is duplicated`);
    slugs.add(slug);
    if (!communityText(profile.ownerName))
      errors.push(`${path}.ownerName is missing`);
    if (!communityText(profile.activeRevision))
      errors.push(`${path}.activeRevision is missing`);
    if (!profile.summary || typeof profile.summary !== "object")
      errors.push(`${path}.summary is missing`);
    if (!Array.isArray(profile.posters))
      errors.push(`${path}.posters must be an array`);
  });
  return { valid: errors.length === 0, errors };
};

/**
 * Builds the privacy-safe summary embedded in the generated directory.
 * @param {Object} publicData Valid public-profile data.
 * @returns {{filmCount: number, ratedCount: number, nominationCount: number, winnerCount: number, yearCount: number, posters: string[]}}
 */
window.buildCommunityProfileSummary = function (publicData) {
  let films = [...communityFilmMap(publicData).values()];
  let nominations = 0;
  let winners = 0;
  films.forEach((film) =>
    (film.awards || []).forEach((award) => {
      nominations += 1;
      if (Number(award.placement) === 1) winners += 1;
    }),
  );
  let posters = films
    .filter((film) => /^https?:\/\//.test(communityText(film.poster?.url)))
    .sort(
      (left, right) =>
        (Number(left.allTimeRank) || 999999) -
          (Number(right.allTimeRank) || 999999) ||
        communityRatingValue(right) - communityRatingValue(left) ||
        communityTitleCompare(left.title, right.title),
    )
    .slice(0, 4)
    .map((film) => film.poster.url);
  return {
    filmCount: films.length,
    ratedCount: films.filter(communityRatingValue).length,
    nominationCount: nominations,
    winnerCount: winners,
    yearCount: new Set(
      films.map((film) => communityText(film.year)).filter(Boolean),
    ).size,
    posters,
  };
};

/**
 * Compares selected live public-profile projections.
 * @param {Array<{slug: string, ownerName: string, data: Object}>} profiles Selected profiles.
 * @returns {Object} Comparison model.
 */
window.buildCommunityComparison = function (profiles) {
  let prepared = profiles.map((profile) => ({
    ...profile,
    films: communityFilmMap(profile.data),
  }));
  let everyKey = new Set();
  prepared.forEach((profile) =>
    profile.films.forEach((_film, key) => everyKey.add(key)),
  );
  let rows = [];
  everyKey.forEach((key) => {
    let entries = prepared
      .map((profile) => ({ profile, film: profile.films.get(key) }))
      .filter((entry) => entry.film);
    if (entries.length < 2) return;
    let ratings = entries
      .map((entry) => ({
        slug: entry.profile.slug,
        ownerName: entry.profile.ownerName,
        value: communityRatingValue(entry.film),
      }))
      .filter((entry) => entry.value);
    let values = ratings.map((entry) => entry.value);
    let spread =
      values.length >= 2 ? Math.max(...values) - Math.min(...values) : null;
    let film = entries[0].film;
    rows.push({
      key,
      film,
      archiveCount: entries.length,
      ratings,
      spread,
      averageRating: values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null,
    });
  });
  let comparable = rows.filter((row) => row.spread !== null);
  return {
    profiles: prepared,
    unionFilmCount: everyKey.size,
    sharedByAllCount: rows.filter((row) => row.archiveCount === prepared.length)
      .length,
    overlapRows: rows.sort(
      (left, right) =>
        right.archiveCount - left.archiveCount ||
        communityTitleCompare(left.film.title, right.film.title),
    ),
    agreements: comparable
      .filter((row) => row.spread <= 0.5)
      .sort(
        (left, right) =>
          (right.averageRating || 0) - (left.averageRating || 0) ||
          communityTitleCompare(left.film.title, right.film.title),
      ),
    disagreements: comparable
      .filter((row) => row.spread >= 1.5)
      .sort(
        (left, right) =>
          right.spread - left.spread ||
          communityTitleCompare(left.film.title, right.film.title),
      ),
  };
};

// Generalizes across all four award period types
// (years/decades/centuries/allTime, matching window.getAwardPeriodType's
// normalized values) instead of assuming every joint ceremony is annual -
// a joint decade/century/all-time ceremony is exactly the same
// aggregation, just keyed by a different periodType/scope pair. An
// award's own `periodType` is trusted directly (already normalized at the
// source, public-profile-supabase.js) rather than re-derived, since a
// community profile's award never carries the local-archive `state.years`
// context window.getAwardPeriodType's own fallback path depends on.
function communityBallotsForPeriod(profile, periodType) {
  let ballots = new Map();
  communityFilmMap(profile.data).forEach((film) =>
    (film.awards || []).forEach((award) => {
      if (
        window.normalizeAwardPeriodType(award.periodType) !== periodType ||
        !communityText(award.year) ||
        !communityText(award.category) ||
        Number(award.placement) < 1
      )
        return;
      let ballotKey = `${award.year}\n${award.category}`;
      if (!ballots.has(ballotKey)) ballots.set(ballotKey, []);
      ballots.get(ballotKey).push({
        film,
        placement: Number(award.placement),
        recipients: Array.isArray(award.recipients) ? award.recipients : [],
      });
    }),
  );
  return ballots;
}

// Every period type's scope key sorts newest-first by its leading digits -
// a 4-digit year and a "1990s"-style decade/century key both parse the
// same way; "alltime" (no digits) is always the type's sole key, so its
// rank never matters.
function communityPeriodKeyRank(key) {
  let match = /^(\d+)/.exec(String(key || ""));
  return match ? Number(match[1]) : -Infinity;
}

let COMMUNITY_PERIOD_TYPES = ["years", "decades", "centuries", "allTime"];

let COMMUNITY_PERIOD_TYPE_LABELS = {
  years: "annual",
  decades: "decade",
  centuries: "century",
  allTime: "all-time",
};

/**
 * Lists every period (year/decade/century/all-time) with ballots from at
 * least two selected archives - spoiler-free (scope keys only, never a
 * result) so a picker can link straight into one specific joint ceremony
 * without revealing anything about its outcome (issue #584).
 * @param {Array<{slug: string, ownerName: string, data: Object}>} profiles Selected profiles.
 * @returns {{periodType: string, periodKeys: string[]}[]} Non-empty groups, in COMMUNITY_PERIOD_TYPES order.
 */
window.buildCommunityAvailablePeriods = function (profiles) {
  return COMMUNITY_PERIOD_TYPES.map((periodType) => {
    let ballotsByProfile = profiles.map((profile) =>
      communityBallotsForPeriod(profile, periodType),
    );
    let keys = new Set();
    ballotsByProfile.forEach((ballots) =>
      ballots.forEach((_entries, ballotKey) =>
        keys.add(ballotKey.split("\n")[0]),
      ),
    );
    let periodKeys = [...keys]
      .filter(
        (key) =>
          ballotsByProfile.filter((ballots) =>
            [...ballots.keys()].some((ballotKey) =>
              ballotKey.startsWith(`${key}\n`),
            ),
          ).length >= 2,
      )
      .sort(
        (left, right) =>
          communityPeriodKeyRank(right) - communityPeriodKeyRank(left),
      );
    return { periodType, periodKeys };
  }).filter((group) => group.periodKeys.length);
};

/**
 * Builds equal-weight consensus results for one period (year, decade,
 * century, or all-time) in which at least two selected profiles published
 * ballots. Every such period is independently eligible - a couple
 * catching up together often has more than one to run - so callers get
 * the full sorted list of keys back alongside the selected one.
 * @param {Array<{slug: string, ownerName: string, data: Object}>} profiles Selected profiles.
 * @param {string} [periodType] "years" (default), "decades", "centuries", or "allTime".
 * @param {string} [requestedKey] A specific eligible scope key to build, e.g. from a URL param. Falls back to the newest eligible key when omitted or not eligible.
 * @returns {{periodType: string, periodKey: string, periodKeys: string[], categories: Object[], participatingProfiles: number, reason?: string}} Ceremony model.
 */
window.buildCommunityCeremony = function (
  profiles,
  periodType = "years",
  requestedKey,
) {
  let prepared = profiles.map((profile) => ({
    ...profile,
    ballots: communityBallotsForPeriod(profile, periodType),
  }));
  let keys = new Set();
  prepared.forEach((profile) =>
    profile.ballots.forEach((_entries, key) => keys.add(key.split("\n")[0])),
  );
  let eligibleKeys = [...keys]
    .filter(
      (key) =>
        prepared.filter((profile) =>
          [...profile.ballots.keys()].some((ballotKey) =>
            ballotKey.startsWith(`${key}\n`),
          ),
        ).length >= 2,
    )
    .sort(
      (left, right) =>
        communityPeriodKeyRank(right) - communityPeriodKeyRank(left),
    );
  let periodKey = eligibleKeys.includes(requestedKey)
    ? requestedKey
    : eligibleKeys[0] || "";
  if (!periodKey)
    return {
      periodType,
      periodKey: "",
      periodKeys: eligibleKeys,
      categories: [],
      participatingProfiles: 0,
      reason: `No ${COMMUNITY_PERIOD_TYPE_LABELS[periodType] || "shared"} ceremony has published ballots from at least two selected archives.`,
    };
  let categoryNames = new Set();
  prepared.forEach((profile) =>
    profile.ballots.forEach((_entries, key) => {
      let [ballotKey, category] = key.split("\n");
      if (ballotKey === periodKey) categoryNames.add(category);
    }),
  );
  let categories = [...categoryNames]
    .map((category) => {
      let ballotKey = `${periodKey}\n${category}`;
      let participating = prepared.filter((profile) =>
        profile.ballots.has(ballotKey),
      );
      if (participating.length < 2) return null;
      let candidates = new Map();
      // One row per participating archive, each holding that archive's own
      // nominees in alphabetical (title) order - not that archive's own
      // placement order, which would leak that person's ranking before
      // "Reveal ranking" is used - built from the exact same entries as
      // the consensus ranking below rather than a second read (issue #491).
      let byPerson = [];
      participating.forEach((profile) => {
        let entries = profile.ballots.get(ballotKey) || [];
        let maximumPlacement = Math.max(
          1,
          ...entries.map((entry) => entry.placement),
        );
        byPerson.push({
          ownerName: profile.ownerName,
          entries: [...entries].sort((left, right) =>
            communityTitleCompare(left.film.title, right.film.title),
          ),
        });
        entries.forEach((entry) => {
          let key = communityFilmKey(entry.film);
          if (!key) return;
          let candidate = candidates.get(key) || {
            film: entry.film,
            score: 0,
            firstPlaceVotes: 0,
            support: [],
            recipients: [],
          };
          let normalizedScore =
            maximumPlacement === 1
              ? 1
              : 1 - (entry.placement - 1) / (maximumPlacement - 1);
          candidate.score += normalizedScore / participating.length;
          if (entry.placement === 1) candidate.firstPlaceVotes += 1;
          candidate.support.push({
            ownerName: profile.ownerName,
            placement: entry.placement,
          });
          if (!candidate.recipients.length && entry.recipients?.length)
            candidate.recipients = entry.recipients;
          candidates.set(key, candidate);
        });
      });
      let ranking = [...candidates.values()].sort(
        (left, right) =>
          right.score - left.score ||
          right.firstPlaceVotes - left.firstPlaceVotes ||
          communityTitleCompare(left.film.title, right.film.title),
      );
      return {
        category,
        participatingProfiles: participating.length,
        ranking,
        byPerson,
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      communityTitleCompare(left.category, right.category),
    );
  return {
    periodType,
    periodKey,
    periodKeys: eligibleKeys,
    categories,
    participatingProfiles: prepared.filter((profile) =>
      [...profile.ballots.keys()].some((key) =>
        key.startsWith(`${periodKey}\n`),
      ),
    ).length,
  };
};
