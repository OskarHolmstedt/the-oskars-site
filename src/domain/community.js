/**
 * @file Defines the public Community directory contract and the pure,
 * read-only aggregation used by multi-profile comparisons and joint ceremonies.
 */

window.OSKARS_COMMUNITY_INDEX_SCHEMA_VERSION = 1;

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
  if (!Array.isArray(source.profiles))
    errors.push("profiles must be an array");
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
    yearCount: new Set(films.map((film) => communityText(film.year)).filter(Boolean))
      .size,
    posters,
  };
};

/**
 * Parses a shareable pinned profile token (`slug@revision`).
 * @param {string} token Token.
 * @returns {{slug: string, revision: string}|null} Parsed token.
 */
window.parseCommunityProfileToken = function (token) {
  let separator = communityText(token).indexOf("@");
  if (separator < 1) return null;
  let slug = communityText(token).slice(0, separator);
  let revision = communityText(token).slice(separator + 1);
  return slug && revision ? { slug, revision } : null;
};

/**
 * Builds a stable token for a selected directory entry.
 * @param {Object} profile Directory profile.
 * @returns {string} Pinned token.
 */
window.communityProfileToken = function (profile) {
  return `${communityText(profile?.slug)}@${communityText(profile?.activeRevision)}`;
};

/**
 * Compares selected immutable public-profile revisions.
 * @param {Array<{slug: string, ownerName: string, revision: string, data: Object}>} profiles Selected profiles.
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
    let spread = values.length >= 2 ? Math.max(...values) - Math.min(...values) : null;
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
    sharedByAllCount: rows.filter(
      (row) => row.archiveCount === prepared.length,
    ).length,
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

function communityAnnualBallots(profile) {
  let ballots = new Map();
  communityFilmMap(profile.data).forEach((film) =>
    (film.awards || []).forEach((award) => {
      if (
        award.periodType !== "years" ||
        !/^\d{4}$/.test(communityText(award.year)) ||
        !communityText(award.category) ||
        Number(award.placement) < 1
      )
        return;
      let ballotKey = `${award.year}\n${award.category}`;
      if (!ballots.has(ballotKey)) ballots.set(ballotKey, []);
      ballots.get(ballotKey).push({ film, placement: Number(award.placement) });
    }),
  );
  return ballots;
}

/**
 * Builds equal-weight consensus results for the newest annual ceremony in
 * which at least two selected profiles published ballots.
 * @param {Array<{slug: string, ownerName: string, revision: string, data: Object}>} profiles Selected profiles.
 * @returns {{year: string, categories: Object[], participatingProfiles: number, reason?: string}} Ceremony model.
 */
window.buildCommunityCeremony = function (profiles) {
  let prepared = profiles.map((profile) => ({
    ...profile,
    ballots: communityAnnualBallots(profile),
  }));
  let years = new Set();
  prepared.forEach((profile) =>
    profile.ballots.forEach((_entries, key) => years.add(key.split("\n")[0])),
  );
  let eligibleYears = [...years]
    .filter(
      (year) =>
        prepared.filter((profile) =>
          [...profile.ballots.keys()].some((key) => key.startsWith(`${year}\n`)),
        ).length >= 2,
    )
    .sort((left, right) => Number(right) - Number(left));
  let year = eligibleYears[0] || "";
  if (!year)
    return {
      year: "",
      categories: [],
      participatingProfiles: 0,
      reason: "No annual ceremony has published ballots from at least two selected archives.",
    };
  let categoryNames = new Set();
  prepared.forEach((profile) =>
    profile.ballots.forEach((_entries, key) => {
      let [ballotYear, category] = key.split("\n");
      if (ballotYear === year) categoryNames.add(category);
    }),
  );
  let categories = [...categoryNames]
    .map((category) => {
      let ballotKey = `${year}\n${category}`;
      let participating = prepared.filter((profile) =>
        profile.ballots.has(ballotKey),
      );
      if (participating.length < 2) return null;
      let candidates = new Map();
      participating.forEach((profile) => {
        let entries = profile.ballots.get(ballotKey) || [];
        let maximumPlacement = Math.max(
          1,
          ...entries.map((entry) => entry.placement),
        );
        entries.forEach((entry) => {
          let key = communityFilmKey(entry.film);
          if (!key) return;
          let candidate = candidates.get(key) || {
            film: entry.film,
            score: 0,
            firstPlaceVotes: 0,
            support: [],
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
          candidates.set(key, candidate);
        });
      });
      let ranking = [...candidates.values()].sort(
        (left, right) =>
          right.score - left.score ||
          right.firstPlaceVotes - left.firstPlaceVotes ||
          communityTitleCompare(left.film.title, right.film.title),
      );
      return { category, participatingProfiles: participating.length, ranking };
    })
    .filter(Boolean)
    .sort((left, right) => communityTitleCompare(left.category, right.category));
  return {
    year,
    categories,
    participatingProfiles: prepared.filter((profile) =>
      [...profile.ballots.keys()].some((key) => key.startsWith(`${year}\n`)),
    ).length,
  };
};
