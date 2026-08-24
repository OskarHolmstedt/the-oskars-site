/**
 * @file Defines the versioned canonical dataset contract, pure migrations,
 * path-aware validation, runtime adaptation, and deterministic serialization.
 */

window.OSKARS_CANONICAL_SCHEMA_VERSION = 1;

const CANONICAL_TOP_LEVEL_KEYS = [
  "canonicalSchemaVersion",
  "years",
  "officialResults",
  "collectionAwards",
  "watchlist",
  "watchedFilms",
  "intakeWorkflows",
  "rankingReviews",
  "awardReviews",
  "opinionRebuildSession",
  "projects",
  "watchlistProjectSources",
  "peopleAliases",
  "rejectedPersonAliases",
  "declinedOfficialWatchlistAdds",
  "personPortraits",
  "franchiseLinks",
  "directorLinks",
  "entityNotes",
  "localRanks",
  "editLog",
];

// The data-bearing top-level sections, excluding the schema-version marker
// - shared with src/core/workspace-sections.js (issue #248) so the
// Firestore sync unit list can never drift from the actual canonical
// contract. Exposed on window rather than duplicated because both files
// need the identical list, and this one already owns it.
window.OSKARS_CANONICAL_SECTION_KEYS = CANONICAL_TOP_LEVEL_KEYS.filter(
  (key) => key !== "canonicalSchemaVersion",
);

const CANONICAL_FILM_FIELDS = new Set([
  "adaptation",
  "adaptationSource",
  "allTimeRank",
  "awards",
  "canonicalComposite",
  "centuryRank",
  "compositeParts",
  "country",
  "dateWatched",
  "decadeRank",
  "director",
  "directors",
  "franchises",
  "genre",
  "id",
  "letterboxdUrl",
  "liveAction",
  "medium",
  "normalizedTitle",
  "musicScore",
  "musicRating",
  "musicRatingValue",
  "platform",
  "poster",
  "primaryCountry",
  "rank",
  "rankConfirmed",
  "rankingGroupId",
  "rankingGroupTitle",
  "rating",
  "ratingModifier",
  "ratingValue",
  "review",
  "rewatchTier",
  "runtimeMinutes",
  "screenplayType",
  "suppressAllTimeRank",
  "swedishTitle",
  "tags",
  "title",
  "tmdbId",
  "type",
  "url",
  "views",
  "wantToRewatch",
  "year",
  "yearRank",
]);

const CANONICAL_WATCHLIST_FIELDS = new Set([
  "added",
  "adaptationSource",
  "country",
  "director",
  "directors",
  "franchises",
  "id",
  "letterboxdUrl",
  "medium",
  "order",
  "platform",
  "poster",
  "runtimeMinutes",
  "screenplayType",
  "swedishTitle",
  "tags",
  "tier",
  "title",
  "tmdbId",
  "year",
]);

const CANONICAL_WATCHED_FIELDS = new Set([
  ...CANONICAL_FILM_FIELDS,
  "rowNumber",
]);

const CANONICAL_PROJECT_FIELDS = new Set([
  "createdAt",
  "dismissedRefs",
  "filmRefs",
  "id",
  "name",
  "pinned",
  "sourceHref",
  "sourceId",
  "sourceLabel",
  "sourceType",
  "status",
  "updatedAt",
]);

const CANONICAL_WORKFLOW_FIELDS = new Set([
  "auditEntryId",
  "baseRevision",
  "completedAt",
  "createdAt",
  "filmId",
  "id",
  "reopenedAt",
  "schemaVersion",
  "source",
  "sourceRecordId",
  "steps",
  "summary",
]);

const CANONICAL_OPINION_REBUILD_FIELDS = new Set([
  "schemaVersion",
  "status",
  "startedAt",
  "finishedAt",
  "films",
  "watchlist",
  "watchedOther",
  "entityNotes",
  "localRanks",
  "rankingReviews",
  "awardReviews",
  "sourceConflicts",
]);
const CANONICAL_OPINION_REBUILD_FILM_FIELDS = new Set([
  "awards",
  "rating",
  "ratingValue",
  "ratingModifier",
  "rank",
  "yearRank",
  "decadeRank",
  "centuryRank",
  "allTimeRank",
  "suppressAllTimeRank",
  "rankingGroupId",
  "rankingGroupTitle",
  "rankConfirmed",
  "review",
  "wantToRewatch",
  "rewatchTier",
  "musicScore",
  "musicRating",
  "musicRatingValue",
  "franchiseRanks",
]);
const CANONICAL_OPINION_REBUILD_WATCHLIST_FIELDS = new Set([
  "tier",
  "order",
  "franchiseRanks",
]);
const CANONICAL_OPINION_REBUILD_WATCHED_FIELDS = new Set([
  "rating",
  "ratingValue",
  "wantToRewatch",
  "rewatchTier",
  "franchiseRanks",
]);

const CANONICAL_SECRET_KEY =
  /^(?:api[-_]?key|access[-_]?token|client[-_]?secret|credential|oauth[-_]?token)$/i;

function canonicalIsRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// state-shape.js loads before this file (see entry-loader.js) and defines
// the identical JSON-round-trip deep clone as window.cloneRecord.
const canonicalClone = window.cloneRecord;

function canonicalEmptyDocument() {
  return {
    canonicalSchemaVersion: window.OSKARS_CANONICAL_SCHEMA_VERSION,
    years: {},
    officialResults: {},
    collectionAwards: { director: {}, franchise: {} },
    watchlist: [],
    watchedFilms: [],
    intakeWorkflows: [],
    rankingReviews: { years: {}, decades: {}, centuries: {}, allTime: {} },
    awardReviews: { years: {} },
    opinionRebuildSession: null,
    projects: [],
    watchlistProjectSources: {},
    peopleAliases: {},
    rejectedPersonAliases: [],
    declinedOfficialWatchlistAdds: [],
    personPortraits: {},
    franchiseLinks: {},
    directorLinks: {},
    entityNotes: {
      people: {},
      periods: {},
      franchises: {},
      tags: {},
      categories: {},
      projects: {},
    },
    localRanks: {
      franchises: {},
      people: {},
      tags: {},
    },
    editLog: [],
  };
}

function canonicalLegacyMigration(source) {
  let migrated = canonicalEmptyDocument();
  migrated.years = source.years || {};
  migrated.officialResults = source.officialResults || {};
  migrated.collectionAwards = source.collectionAwards || {
    director: {},
    franchise: {},
  };
  migrated.watchlist = source.watchlist || [];
  migrated.watchedFilms = source.watchedFilms || source.watchedOther || [];
  migrated.intakeWorkflows = source.intakeWorkflows || [];
  migrated.rankingReviews = source.rankingReviews || migrated.rankingReviews;
  migrated.awardReviews = source.awardReviews || migrated.awardReviews;
  migrated.opinionRebuildSession = source.opinionRebuildSession || null;
  migrated.projects = source.projects || [];
  migrated.watchlistProjectSources = source.watchlistProjectSources || {};
  migrated.peopleAliases = source.peopleAliases || {};
  migrated.rejectedPersonAliases = source.rejectedPersonAliases || [];
  migrated.declinedOfficialWatchlistAdds =
    source.declinedOfficialWatchlistAdds || [];
  migrated.personPortraits = source.personPortraits || {};
  migrated.franchiseLinks = source.franchiseLinks || {};
  migrated.directorLinks = source.directorLinks || {};
  migrated.entityNotes = source.entityNotes || migrated.entityNotes;
  migrated.localRanks = source.localRanks || migrated.localRanks;
  migrated.editLog = source.editLog || [];
  canonicalNormalizeLegacyMusicScoreFields(migrated);
  return migrated;
}

/**
 * Migrates a legacy or supported canonical document without mutating its input.
 * @param {Object} source Parsed dataset or legacy application snapshot.
 * @returns {Object} Current-version canonical dataset.
 * @throws {Error} When the declared schema version is unsupported.
 */
window.migrateCanonicalData = function (source) {
  if (!canonicalIsRecord(source))
    throw new Error("Canonical dataset must be an object");
  let version = source.canonicalSchemaVersion;
  if (version === undefined || version === null || version === 0)
    return canonicalLegacyMigration(canonicalClone(source));
  if (!Number.isInteger(version) || version < 0)
    throw new Error("Unsupported canonical schema version");
  if (version > window.OSKARS_CANONICAL_SCHEMA_VERSION)
    throw new Error(
      `Canonical schema version ${version} is newer than supported ` +
        `version ${window.OSKARS_CANONICAL_SCHEMA_VERSION}`,
    );
  let migrated = canonicalClone(source);
  if (version === 1) {
    let defaults = canonicalEmptyDocument();
    CANONICAL_TOP_LEVEL_KEYS.forEach((key) => {
      if (migrated[key] === undefined) migrated[key] = defaults[key];
    });
  }
  canonicalNormalizeLegacyMusicScoreFields(migrated);
  return migrated;
};

function canonicalNormalizeLegacyMusicScoreFields(document) {
  if (!canonicalIsRecord(document)) return;
  Object.values(document.years || {}).forEach((period) => {
    (period?.films || []).forEach((film) => {
      if (
        film &&
        Object.prototype.hasOwnProperty.call(film, "personalScore")
      ) {
        if (film.musicScore === undefined) {
          film.musicScore = film.personalScore;
        }
        delete film.personalScore;
      }
    });
  });
  (document.watchedFilms || []).forEach((film) => {
    if (
      film &&
      Object.prototype.hasOwnProperty.call(film, "personalScore")
    ) {
      if (film.musicScore === undefined) {
        film.musicScore = film.personalScore;
      }
      delete film.personalScore;
    }
  });
}

function canonicalError(errors, path, message) {
  errors.push({ path, message });
}

function canonicalCheckRecord(errors, value, path) {
  if (canonicalIsRecord(value)) return true;
  canonicalError(errors, path, "must be an object");
  return false;
}

function canonicalCheckArray(errors, value, path) {
  if (Array.isArray(value)) return true;
  canonicalError(errors, path, "must be an array");
  return false;
}

function canonicalCheckString(errors, value, path, required = false) {
  if (typeof value === "string" && (!required || value.trim())) return true;
  canonicalError(errors, path, required ? "must be a non-empty string" : "must be a string");
  return false;
}

function canonicalCheckAllowedFields(errors, value, path, allowed) {
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key))
      canonicalError(
        errors,
        `${path}.${key}`,
        "is not a supported canonical field",
      );
  });
}

function canonicalCheckJson(errors, value, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) canonicalError(errors, path, "must be a finite number");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => canonicalCheckJson(errors, item, `${path}[${index}]`));
    return;
  }
  if (canonicalIsRecord(value)) {
    Object.entries(value).forEach(([key, child]) => {
      if (CANONICAL_SECRET_KEY.test(key))
        canonicalError(
          errors,
          `${path}.${key}`,
          "must not contain a device secret",
        );
      canonicalCheckJson(errors, child, `${path}.${key}`);
    });
    return;
  }
  canonicalError(errors, path, "must be JSON data");
}

function canonicalValidatePoster(errors, poster, path) {
  if (poster === null || poster === undefined) return;
  if (!canonicalCheckRecord(errors, poster, path)) return;
  let allowed = new Set(["fetchedAt", "providerId", "source", "sourceUrl", "url"]);
  canonicalCheckAllowedFields(errors, poster, path, allowed);
  Object.entries(poster).forEach(([key, value]) =>
    canonicalCheckString(errors, value, `${path}.${key}`),
  );
}

function canonicalValidateFranchises(errors, franchises, path) {
  if (franchises === undefined) return;
  if (!canonicalCheckArray(errors, franchises, path)) return;
  let allowed = new Set([
    "id",
    "name",
    "parentChain",
    "parentChainIds",
    "parentChainNames",
    "parentId",
    "parentIds",
    "parentName",
    "parentNames",
    "rank",
  ]);
  franchises.forEach((membership, index) => {
    let itemPath = `${path}[${index}]`;
    if (!canonicalCheckRecord(errors, membership, itemPath)) return;
    canonicalCheckAllowedFields(errors, membership, itemPath, allowed);
    canonicalCheckString(errors, membership.name, `${itemPath}.name`, true);
  });
}

function canonicalValidateAwards(errors, awards, path) {
  if (awards === undefined) return;
  if (!canonicalCheckArray(errors, awards, path)) return;
  let allowed = new Set([
    "category",
    "detail",
    "periodType",
    "placement",
    "recipientText",
    "recipients",
    "year",
  ]);
  awards.forEach((award, index) => {
    let itemPath = `${path}[${index}]`;
    if (!canonicalCheckRecord(errors, award, itemPath)) return;
    canonicalCheckAllowedFields(errors, award, itemPath, allowed);
    canonicalCheckString(errors, award.category, `${itemPath}.category`, true);
    canonicalCheckString(errors, award.year, `${itemPath}.year`, true);
    if (!Number.isInteger(award.placement) || award.placement < 1)
      canonicalError(errors, `${itemPath}.placement`, "must be a positive integer");
    if (
      award.recipients !== undefined &&
      canonicalCheckArray(errors, award.recipients, `${itemPath}.recipients`)
    ) {
      award.recipients.forEach((recipient, recipientIndex) => {
        let recipientPath = `${itemPath}.recipients[${recipientIndex}]`;
        if (!canonicalCheckRecord(errors, recipient, recipientPath)) return;
        canonicalCheckAllowedFields(
          errors,
          recipient,
          recipientPath,
          new Set(["name", "personId"]),
        );
        canonicalCheckString(errors, recipient.name, `${recipientPath}.name`, true);
        canonicalCheckString(errors, recipient.personId, `${recipientPath}.personId`);
      });
    }
  });
}

function canonicalValidateFilm(errors, film, path, allowed) {
  if (!canonicalCheckRecord(errors, film, path)) return;
  canonicalCheckAllowedFields(errors, film, path, allowed);
  canonicalCheckString(errors, film.id, `${path}.id`, true);
  canonicalCheckString(errors, film.title, `${path}.title`, true);
  if (typeof film.year !== "string" && typeof film.year !== "number")
    canonicalError(errors, `${path}.year`, "must be a string or number");
  ["directors", "tags"].forEach((field) => {
    if (
      film[field] !== undefined &&
      film[field] !== null &&
      (!Array.isArray(film[field]) ||
        film[field].some((value) => typeof value !== "string"))
    )
      canonicalError(errors, `${path}.${field}`, "must be an array of strings");
  });
  [
    "adaptation",
    "adaptationSource",
    "country",
    "dateWatched",
    "director",
    "genre",
    "letterboxdUrl",
    "medium",
    "normalizedTitle",
    "platform",
    "primaryCountry",
    "rankingGroupId",
    "rankingGroupTitle",
    "rating",
    "ratingModifier",
    "review",
    "screenplayType",
    "swedishTitle",
    "tmdbId",
    "type",
    "url",
  ].forEach((field) => {
    if (film[field] !== undefined && film[field] !== null)
      canonicalCheckString(errors, film[field], `${path}.${field}`);
  });
  [
    "allTimeRank",
    "centuryRank",
    "decadeRank",
    "musicRatingValue",
    "order",
    "rank",
    "ratingValue",
    "rowNumber",
    "runtimeMinutes",
    "views",
    "yearRank",
  ].forEach((field) => {
    if (
      film[field] !== undefined &&
      film[field] !== null &&
      !Number.isFinite(film[field])
    )
      canonicalError(errors, `${path}.${field}`, "must be a finite number");
  });
  if (
    film.musicScore !== undefined &&
    film.musicScore !== null &&
    typeof film.musicScore !== "string" &&
    !Number.isFinite(film.musicScore)
  )
    canonicalError(
      errors,
      `${path}.musicScore`,
      "must be a string or finite number",
    );
  ["rankConfirmed", "suppressAllTimeRank", "wantToRewatch"].forEach((field) => {
    if (
      film[field] !== undefined &&
      film[field] !== null &&
      typeof film[field] !== "boolean"
    )
      canonicalError(errors, `${path}.${field}`, "must be a boolean");
  });
  if (
    film.liveAction !== undefined &&
    film.liveAction !== null &&
    typeof film.liveAction !== "boolean" &&
    typeof film.liveAction !== "string"
  )
    canonicalError(errors, `${path}.liveAction`, "must be a string or boolean");
  if (
    film.tier !== undefined &&
    film.tier !== null &&
    !["", "S", "A", "B", "C", "D", "E", "F"].includes(film.tier)
  )
    canonicalError(errors, `${path}.tier`, "has an unsupported watchlist tier");
  ["compositeParts"].forEach((field) => {
    if (film[field] === undefined || film[field] === null) return;
    if (!canonicalCheckArray(errors, film[field], `${path}.${field}`)) return;
    film[field].forEach((reference, index) => {
      let referencePath = `${path}.${field}[${index}]`;
      if (!canonicalCheckRecord(errors, reference, referencePath)) return;
      canonicalCheckAllowedFields(
        errors,
        reference,
        referencePath,
        new Set(["id", "title", "year"]),
      );
      canonicalCheckString(errors, reference.id, `${referencePath}.id`, true);
      canonicalCheckString(
        errors,
        reference.title,
        `${referencePath}.title`,
        true,
      );
    });
  });
  if (film.canonicalComposite !== undefined && film.canonicalComposite !== null) {
    let referencePath = `${path}.canonicalComposite`;
    if (canonicalCheckRecord(errors, film.canonicalComposite, referencePath)) {
      canonicalCheckAllowedFields(
        errors,
        film.canonicalComposite,
        referencePath,
        new Set(["id", "title", "year"]),
      );
      canonicalCheckString(
        errors,
        film.canonicalComposite.id,
        `${referencePath}.id`,
        true,
      );
      canonicalCheckString(
        errors,
        film.canonicalComposite.title,
        `${referencePath}.title`,
        true,
      );
    }
  }
  canonicalValidatePoster(errors, film.poster, `${path}.poster`);
  canonicalValidateFranchises(errors, film.franchises, `${path}.franchises`);
  canonicalValidateAwards(errors, film.awards, `${path}.awards`);
}

function canonicalValidateProjects(errors, projects) {
  if (!canonicalCheckArray(errors, projects, "$.projects")) return;
  projects.forEach((project, index) => {
    let path = `$.projects[${index}]`;
    if (!canonicalCheckRecord(errors, project, path)) return;
    canonicalCheckAllowedFields(errors, project, path, CANONICAL_PROJECT_FIELDS);
    canonicalCheckString(errors, project.id, `${path}.id`, true);
    canonicalCheckString(errors, project.name, `${path}.name`, true);
    ["filmRefs", "dismissedRefs"].forEach((field) => {
      if (project[field] === undefined) return;
      let refsPath = `${path}.${field}`;
      if (!canonicalCheckArray(errors, project[field], refsPath)) return;
      project[field].forEach((ref, refIndex) => {
        let refPath = `${refsPath}[${refIndex}]`;
        if (!canonicalCheckRecord(errors, ref, refPath)) return;
        canonicalCheckAllowedFields(
          errors,
          ref,
          refPath,
          new Set(["id", "projectOrder", "rank", "sourceId", "type"]),
        );
        canonicalCheckString(errors, ref.id, `${refPath}.id`, true);
        if (
          !["archive", "watchlist", "watched", "official"].includes(ref.type)
        )
          canonicalError(
            errors,
            `${refPath}.type`,
            "must be archive, watchlist, watched, or official",
          );
        if (ref.sourceId !== undefined)
          canonicalCheckString(errors, ref.sourceId, `${refPath}.sourceId`);
      });
    });
  });
}

function canonicalValidateOfficialResults(errors, sources) {
  if (!canonicalCheckRecord(errors, sources, "$.officialResults")) return;
  Object.entries(sources).forEach(([sourceId, source]) => {
    let sourcePath = `$.officialResults.${sourceId}`;
    if (!canonicalCheckRecord(errors, source, sourcePath)) return;
    canonicalCheckAllowedFields(
      errors,
      source,
      sourcePath,
      new Set(["id", "name", "periods", "sourceRevision"]),
    );
    canonicalCheckString(errors, source.id, `${sourcePath}.id`, true);
    canonicalCheckString(errors, source.name, `${sourcePath}.name`, true);
    canonicalCheckString(
      errors,
      source.sourceRevision,
      `${sourcePath}.sourceRevision`,
      true,
    );
    if (source.id !== sourceId)
      canonicalError(errors, `${sourcePath}.id`, "must match its source key");
    if (!canonicalCheckRecord(errors, source.periods, `${sourcePath}.periods`))
      return;
    Object.entries(source.periods).forEach(([periodKey, period]) => {
      let periodPath = `${sourcePath}.periods.${periodKey}`;
      if (!canonicalCheckRecord(errors, period, periodPath)) return;
      canonicalCheckAllowedFields(
        errors,
        period,
        periodPath,
        new Set(["ceremony", "nominations", "periodType", "sourceUrl"]),
      );
      if (!["years", "decades", "centuries", "allTime"].includes(period.periodType))
        canonicalError(
          errors,
          `${periodPath}.periodType`,
          "has an unsupported period type",
        );
      canonicalCheckString(errors, period.sourceUrl, `${periodPath}.sourceUrl`);
      if (period.ceremony !== undefined)
        canonicalCheckString(errors, period.ceremony, `${periodPath}.ceremony`, true);
      if (!canonicalCheckArray(errors, period.nominations, `${periodPath}.nominations`))
        return;
      let nominationIds = new Set();
      let categoryWinners = new Map();
      let populatedCategories = new Set();
      period.nominations.forEach((nomination, index) => {
        let nominationPath = `${periodPath}.nominations[${index}]`;
        if (!canonicalCheckRecord(errors, nomination, nominationPath)) return;
        canonicalCheckAllowedFields(
          errors,
          nomination,
          nominationPath,
          new Set([
            "category",
            "country",
            "detail",
            "filmRef",
            "id",
            "originalTitle",
            "recipient",
            "sourceTitle",
            "sourceCategory",
            "tmdbId",
            "winner",
          ]),
        );
        ["id", "category", "sourceTitle"].forEach((field) =>
          canonicalCheckString(
            errors,
            nomination[field],
            `${nominationPath}.${field}`,
            true,
          ),
        );
        ["recipient", "detail", "sourceCategory", "country", "originalTitle", "tmdbId"].forEach((field) => {
          if (nomination[field] !== undefined)
            canonicalCheckString(
              errors,
              nomination[field],
              `${nominationPath}.${field}`,
            );
        });
        if (typeof nomination.winner !== "boolean")
          canonicalError(errors, `${nominationPath}.winner`, "must be a boolean");
        if (typeof nomination.category === "string") {
          populatedCategories.add(nomination.category);
          if (nomination.winner === true)
            categoryWinners.set(
              nomination.category,
              (categoryWinners.get(nomination.category) || 0) + 1,
            );
        }
        if (nominationIds.has(nomination.id))
          canonicalError(errors, `${nominationPath}.id`, "must be unique in its period");
        nominationIds.add(nomination.id);
        if (nomination.filmRef !== undefined) {
          let refPath = `${nominationPath}.filmRef`;
          if (canonicalCheckRecord(errors, nomination.filmRef, refPath)) {
            canonicalCheckAllowedFields(
              errors,
              nomination.filmRef,
              refPath,
              new Set(["id", "title", "year"]),
            );
            ["id", "title", "year"].forEach((field) =>
              canonicalCheckString(
                errors,
                nomination.filmRef[field],
                `${refPath}.${field}`,
                true,
              ),
            );
          }
        }
      });
      populatedCategories.forEach((category) => {
        if ((categoryWinners.get(category) || 0) < 1)
          canonicalError(
            errors,
            `${periodPath}.nominations`,
            `${category} must have at least one winner`,
          );
      });
    });
  });
}

function canonicalValidateCollectionAwards(errors, collections) {
  if (!canonicalCheckRecord(errors, collections, "$.collectionAwards")) return;
  canonicalCheckAllowedFields(
    errors,
    collections,
    "$.collectionAwards",
    new Set(["director", "franchise"]),
  );
  ["director", "franchise"].forEach((type) => {
    let typePath = `$.collectionAwards.${type}`;
    if (!canonicalCheckRecord(errors, collections[type], typePath)) return;
    Object.entries(collections[type]).forEach(([id, bracket]) => {
      let path = `${typePath}.${id}`;
      if (!canonicalCheckRecord(errors, bracket, path)) return;
      canonicalCheckAllowedFields(
        errors,
        bracket,
        path,
        new Set([
          "collectionId",
          "collectionName",
          "collectionType",
          "nominations",
          "sourceUrl",
        ]),
      );
      if (bracket.collectionType !== type)
        canonicalError(errors, `${path}.collectionType`, "must match its type key");
      if (bracket.collectionId !== id)
        canonicalError(errors, `${path}.collectionId`, "must match its collection key");
      canonicalCheckString(errors, bracket.collectionName, `${path}.collectionName`, true);
      canonicalCheckString(errors, bracket.sourceUrl, `${path}.sourceUrl`);
      if (!canonicalCheckArray(errors, bracket.nominations, `${path}.nominations`))
        return;
      bracket.nominations.forEach((nomination, index) => {
        let nominationPath = `${path}.nominations[${index}]`;
        if (!canonicalCheckRecord(errors, nomination, nominationPath)) return;
        canonicalCheckAllowedFields(
          errors,
          nomination,
          nominationPath,
          new Set(["category", "detail", "placement", "recipient", "sourceTitle"]),
        );
        canonicalCheckString(errors, nomination.category, `${nominationPath}.category`, true);
        canonicalCheckString(errors, nomination.sourceTitle, `${nominationPath}.sourceTitle`, true);
        if (
          !Number.isInteger(nomination.placement) ||
          nomination.placement < 1 ||
          nomination.placement > 10
        )
          canonicalError(errors, `${nominationPath}.placement`, "must be an integer from 1 to 10");
        if (nomination.recipient !== undefined)
          canonicalCheckString(errors, nomination.recipient, `${nominationPath}.recipient`);
        if (nomination.detail !== undefined)
          canonicalCheckString(errors, nomination.detail, `${nominationPath}.detail`);
      });
    });
  });
}

function canonicalValidateWorkflows(errors, workflows) {
  if (!canonicalCheckArray(errors, workflows, "$.intakeWorkflows")) return;
  workflows.forEach((workflow, index) => {
    let path = `$.intakeWorkflows[${index}]`;
    if (!canonicalCheckRecord(errors, workflow, path)) return;
    canonicalCheckAllowedFields(errors, workflow, path, CANONICAL_WORKFLOW_FIELDS);
    canonicalCheckString(errors, workflow.id, `${path}.id`, true);
    canonicalCheckString(errors, workflow.filmId, `${path}.filmId`, true);
    canonicalCheckString(errors, workflow.createdAt, `${path}.createdAt`, true);
    canonicalCheckString(errors, workflow.baseRevision, `${path}.baseRevision`, true);
    if (workflow.schemaVersion !== 1)
      canonicalError(errors, `${path}.schemaVersion`, "must be 1");
    if (!["watchlist-transition", "fresh"].includes(workflow.source))
      canonicalError(errors, `${path}.source`, "must be watchlist-transition or fresh");
    ["sourceRecordId", "completedAt", "reopenedAt", "summary", "auditEntryId"].forEach(
      (field) => {
        if (workflow[field] !== undefined)
          canonicalCheckString(errors, workflow[field], `${path}.${field}`);
      },
    );
    if (String(workflow.summary || "").length > 1000)
      canonicalError(errors, `${path}.summary`, "must be at most 1000 characters");
    if (
      workflow.source === "watchlist-transition" &&
      !String(workflow.sourceRecordId || "").trim()
    )
      canonicalError(
        errors,
        `${path}.sourceRecordId`,
        "is required for a watchlist transition",
      );
    if (workflow.steps === undefined) {
      canonicalError(errors, `${path}.steps`, "is required");
    } else {
      let stepsPath = `${path}.steps`;
      if (!canonicalCheckRecord(errors, workflow.steps, stepsPath)) return;
      canonicalCheckAllowedFields(
        errors,
        workflow.steps,
        stepsPath,
        new Set(["rating", "ranking", "awards"]),
      );
      ["rating", "ranking"].forEach((stepName) => {
        let step = workflow.steps[stepName];
        if (step === undefined) {
          canonicalError(errors, `${stepsPath}.${stepName}`, "is required");
          return;
        }
        let stepPath = `${stepsPath}.${stepName}`;
        if (!canonicalCheckRecord(errors, step, stepPath)) return;
        canonicalCheckAllowedFields(
          errors,
          step,
          stepPath,
          new Set(["completedAt", "decisionRef", "resultRef", "status"]),
        );
        let statuses =
          stepName === "rating"
            ? ["pending", "complete"]
            : ["pending", "complete", "not-applicable"];
        if (!statuses.includes(step.status))
          canonicalError(errors, `${stepPath}.status`, "has an unsupported status");
        ["completedAt", "decisionRef", "resultRef"].forEach((field) => {
          if (step[field] !== undefined)
            canonicalCheckString(errors, step[field], `${stepPath}.${field}`);
        });
      });
      if (workflow.steps.awards === undefined) {
        canonicalError(errors, `${stepsPath}.awards`, "is required");
      } else {
        let awardsPath = `${stepsPath}.awards`;
        let awards = workflow.steps.awards;
        if (!canonicalCheckRecord(errors, awards, awardsPath)) return;
        canonicalCheckAllowedFields(
          errors,
          awards,
          awardsPath,
          new Set(["year", "decade", "century", "allTime"]),
        );
        ["year", "decade", "century", "allTime"].forEach((level) => {
          if (awards[level] === undefined)
            canonicalError(errors, `${awardsPath}.${level}`, "is required");
        });
        Object.entries(awards).forEach(([level, step]) => {
          let stepPath = `${awardsPath}.${level}`;
          if (!canonicalCheckRecord(errors, step, stepPath)) return;
          canonicalCheckAllowedFields(
            errors,
            step,
            stepPath,
            new Set(["completedAt", "decisionRef", "resultRef", "status"]),
          );
          if (!["pending", "complete", "none", "not-applicable"].includes(step.status))
            canonicalError(errors, `${stepPath}.status`, "has an unsupported status");
          ["completedAt", "decisionRef", "resultRef"].forEach((field) => {
            if (step[field] !== undefined)
              canonicalCheckString(errors, step[field], `${stepPath}.${field}`);
          });
        });
      }
    }
  });
}

/**
 * Validates the complete canonical contract and reports actionable JSON paths.
 * @param {Object} source Current-version canonical dataset.
 * @returns {{valid: boolean, errors: Array<{path: string, message: string}>}} Validation result.
 */
window.validateCanonicalData = function (source) {
  let errors = [];
  if (!canonicalCheckRecord(errors, source, "$")) return { valid: false, errors };
  canonicalCheckAllowedFields(errors, source, "$", new Set(CANONICAL_TOP_LEVEL_KEYS));
  if (source.canonicalSchemaVersion !== window.OSKARS_CANONICAL_SCHEMA_VERSION)
    canonicalError(
      errors,
      "$.canonicalSchemaVersion",
      `must be ${window.OSKARS_CANONICAL_SCHEMA_VERSION}`,
    );
  if (canonicalCheckRecord(errors, source.years, "$.years")) {
    Object.entries(source.years).forEach(([key, period]) => {
      let path = `$.years.${key}`;
      if (!canonicalCheckRecord(errors, period, path)) return;
      canonicalCheckAllowedFields(
        errors,
        period,
        path,
        new Set(["films", "periodType", "sourceUrl"]),
      );
      if (
        period.periodType !== undefined &&
        !["years", "decades", "centuries", "allTime"].includes(
          period.periodType,
        )
      )
        canonicalError(
          errors,
          `${path}.periodType`,
          "has an unsupported period type",
        );
      if (canonicalCheckArray(errors, period.films, `${path}.films`))
        period.films.forEach((film, index) =>
          canonicalValidateFilm(
            errors,
            film,
            `${path}.films[${index}]`,
            CANONICAL_FILM_FIELDS,
          ),
        );
    });
  }
  canonicalValidateOfficialResults(errors, source.officialResults);
  canonicalValidateCollectionAwards(errors, source.collectionAwards);
  if (canonicalCheckArray(errors, source.watchlist, "$.watchlist"))
    source.watchlist.forEach((film, index) =>
      canonicalValidateFilm(
        errors,
        film,
        `$.watchlist[${index}]`,
        CANONICAL_WATCHLIST_FIELDS,
      ),
    );
  if (canonicalCheckArray(errors, source.watchedFilms, "$.watchedFilms"))
    source.watchedFilms.forEach((film, index) =>
      canonicalValidateFilm(
        errors,
        film,
        `$.watchedFilms[${index}]`,
        CANONICAL_WATCHED_FIELDS,
      ),
    );
  canonicalValidateWorkflows(errors, source.intakeWorkflows);
  canonicalValidateProjects(errors, source.projects);
  [
    "watchlistProjectSources",
    "peopleAliases",
    "personPortraits",
    "franchiseLinks",
    "directorLinks",
    "entityNotes",
    "localRanks",
  ].forEach((key) => canonicalCheckRecord(errors, source[key], `$.${key}`));
  if (source.rankingReviews !== undefined)
    canonicalCheckRecord(errors, source.rankingReviews, "$.rankingReviews");
  if (source.awardReviews !== undefined)
    canonicalCheckRecord(errors, source.awardReviews, "$.awardReviews");
  if (
    source.opinionRebuildSession !== null &&
    source.opinionRebuildSession !== undefined
  ) {
    if (
      canonicalCheckRecord(
        errors,
        source.opinionRebuildSession,
        "$.opinionRebuildSession",
      )
    ) {
      let session = source.opinionRebuildSession;
      canonicalCheckAllowedFields(
        errors,
        session,
        "$.opinionRebuildSession",
        CANONICAL_OPINION_REBUILD_FIELDS,
      );
      if (session.schemaVersion !== 1)
        canonicalError(
          errors,
          "$.opinionRebuildSession.schemaVersion",
          "must be 1",
        );
      if (!["active", "complete"].includes(session.status))
        canonicalError(
          errors,
          "$.opinionRebuildSession.status",
          "must be active or complete",
        );
      if (typeof session.startedAt !== "string" || !session.startedAt)
        canonicalError(
          errors,
          "$.opinionRebuildSession.startedAt",
          "must be a non-empty string",
        );
      if (
        session.status === "complete" &&
        (typeof session.finishedAt !== "string" || !session.finishedAt)
      )
        canonicalError(
          errors,
          "$.opinionRebuildSession.finishedAt",
          "must be a non-empty string for a completed rebuild",
        );
      [
        "films",
        "watchlist",
        "watchedOther",
        "entityNotes",
        "localRanks",
        "rankingReviews",
        "awardReviews",
      ].forEach((key) =>
        canonicalCheckRecord(
          errors,
          session[key],
          `$.opinionRebuildSession.${key}`,
        ),
      );
      canonicalCheckArray(
        errors,
        session.sourceConflicts,
        "$.opinionRebuildSession.sourceConflicts",
      );
      [
        ["films", CANONICAL_OPINION_REBUILD_FILM_FIELDS],
        ["watchlist", CANONICAL_OPINION_REBUILD_WATCHLIST_FIELDS],
        ["watchedOther", CANONICAL_OPINION_REBUILD_WATCHED_FIELDS],
      ].forEach(([key, allowed]) => {
        Object.entries(session[key] || {}).forEach(([recordId, snapshot]) => {
          let path = `$.opinionRebuildSession.${key}.${recordId}`;
          if (canonicalCheckRecord(errors, snapshot, path))
            canonicalCheckAllowedFields(errors, snapshot, path, allowed);
        });
      });
    }
  }
  if (
    canonicalCheckArray(
      errors,
      source.rejectedPersonAliases,
      "$.rejectedPersonAliases",
    ) &&
    source.rejectedPersonAliases.some((value) => typeof value !== "string")
  )
    canonicalError(errors, "$.rejectedPersonAliases", "must contain only strings");
  if (
    canonicalCheckArray(
      errors,
      source.declinedOfficialWatchlistAdds,
      "$.declinedOfficialWatchlistAdds",
    ) &&
    source.declinedOfficialWatchlistAdds.some(
      (value) => typeof value !== "string",
    )
  )
    canonicalError(
      errors,
      "$.declinedOfficialWatchlistAdds",
      "must contain only strings",
    );
  canonicalCheckArray(errors, source.editLog, "$.editLog");
  canonicalCheckJson(errors, source, "$");
  return { valid: errors.length === 0, errors };
};

/**
 * Throws one readable validation error containing every failing JSON path.
 * @param {Object} source Canonical dataset.
 * @returns {Object} The same valid dataset.
 */
window.assertCanonicalData = function (source) {
  let result = window.validateCanonicalData(source);
  if (result.valid) return source;
  let error = new Error(
    `Invalid canonical dataset:\n${result.errors
      .map((entry) => `${entry.path}: ${entry.message}`)
      .join("\n")}`,
  );
  error.code = "OSKARS_INVALID_CANONICAL_DATA";
  error.validationErrors = result.errors;
  throw error;
};

/**
 * Selects canonical fields from runtime state and migrates them to the current contract.
 * @param {OskarsState|Object} [source] Runtime state; defaults to `window.state`.
 * @param {{clone?: boolean}} [options] Snapshot controls.
 * @returns {Object} Current canonical document.
 */
window.getCanonicalData = function (source = window.state, options = {}) {
  let canonical = {
    canonicalSchemaVersion: window.OSKARS_CANONICAL_SCHEMA_VERSION,
    years: source.years || {},
    officialResults: source.officialResults || {},
    collectionAwards: source.collectionAwards || {
      director: {},
      franchise: {},
    },
    watchlist: source.watchlist || [],
    watchedFilms: source.watchedFilms || source.watchedOther || [],
    intakeWorkflows: source.intakeWorkflows || [],
    rankingReviews: source.rankingReviews || canonicalEmptyDocument().rankingReviews,
    awardReviews: source.awardReviews || canonicalEmptyDocument().awardReviews,
    opinionRebuildSession: source.opinionRebuildSession || null,
    projects: source.projects || [],
    watchlistProjectSources: source.watchlistProjectSources || {},
    peopleAliases: source.peopleAliases || {},
    rejectedPersonAliases: source.rejectedPersonAliases || [],
    declinedOfficialWatchlistAdds: source.declinedOfficialWatchlistAdds || [],
    personPortraits: source.personPortraits || {},
    franchiseLinks: source.franchiseLinks || {},
    directorLinks: source.directorLinks || {},
    entityNotes: source.entityNotes || canonicalEmptyDocument().entityNotes,
    localRanks: source.localRanks || canonicalEmptyDocument().localRanks,
    editLog: source.editLog || [],
  };
  return options.clone === false ? canonical : window.migrateCanonicalData(canonical);
};

function canonicalNormalize(value) {
  if (Array.isArray(value)) return value.map(canonicalNormalize);
  if (!canonicalIsRecord(value)) {
    if (typeof value === "string") return value.replace(/\r\n?/g, "\n");
    if (Object.is(value, -0)) return 0;
    return value;
  }
  let normalized = {};
  Object.keys(value).sort().forEach((key) => {
    if (value[key] !== undefined) normalized[key] = canonicalNormalize(value[key]);
  });
  return normalized;
}

/**
 * Produces byte-stable, normalized canonical JSON with a trailing newline.
 * @param {OskarsState|Object} [source] Runtime, legacy, or canonical data.
 * @returns {string} Deterministically formatted canonical JSON.
 */
window.serializeCanonicalData = function (source = window.state) {
  let canonical = source.canonicalSchemaVersion !== undefined
    ? window.migrateCanonicalData(source)
    : window.getCanonicalData(source);
  window.assertCanonicalData(canonical);
  return `${JSON.stringify(canonicalNormalize(canonical), null, 2)}\n`;
};

/**
 * Parses, migrates, and validates canonical JSON without mutating live state.
 * @param {string} text Canonical or legacy snapshot JSON.
 * @returns {Object} Current valid canonical dataset.
 */
window.parseCanonicalData = function (text) {
  let canonical = window.migrateCanonicalData(JSON.parse(text));
  return window.assertCanonicalData(canonical);
};

/**
 * Adapts canonical ownership names to the current runtime state shape.
 * @param {Object} source Valid current canonical dataset.
 * @returns {Object} Runtime source state without derived indexes.
 */
window.canonicalDataToRuntimeState = function (source) {
  let canonical = window.assertCanonicalData(window.migrateCanonicalData(source));
  return {
    dataVersion: window.OSKARS_BUNDLED_DATA_VERSION || 0,
    creditSchemaVersion: 3,
    centuryRangeVersion: 1,
    adaptationSourceVersion: 1,
    watchlistOrderVersion: 1,
    groupedRankProjectionVersion: 1,
    watchedDateVersion: 1,
    viewingFactsVersion: 1,
    years: canonical.years,
    officialResults: canonical.officialResults,
    collectionAwards: canonical.collectionAwards,
    watchlist: canonical.watchlist,
    watchedOther: canonical.watchedFilms,
    intakeWorkflows: canonical.intakeWorkflows,
    rankingReviews: canonical.rankingReviews,
    awardReviews: canonical.awardReviews,
    opinionRebuildSession: canonical.opinionRebuildSession,
    projects: canonical.projects,
    watchlistProjectSources: canonical.watchlistProjectSources,
    peopleAliases: canonical.peopleAliases,
    rejectedPersonAliases: canonical.rejectedPersonAliases,
    declinedOfficialWatchlistAdds: canonical.declinedOfficialWatchlistAdds,
    personPortraits: canonical.personPortraits,
    franchiseLinks: canonical.franchiseLinks,
    directorLinks: canonical.directorLinks,
    entityNotes: canonical.entityNotes,
    localRanks: canonical.localRanks,
    editLog: canonical.editLog,
  };
};

// --- Public-profile schema and privacy policy (issue #246) ---------------
//
// A read-only public profile is built by copying IN allowlisted fields from
// a valid canonical dataset, never by cloning everything and deleting the
// private parts — a denylist/hiding approach is explicitly not the privacy
// boundary here. Every canonical top-level section and every canonical
// film field must have an explicit classification below; the self-checks
// immediately after each list throw at load time (not just in tests) if a
// future canonical field or section is ever added without one, so the
// unsafe case is a fresh field silently becoming public by omission.

window.OSKARS_PUBLIC_SCHEMA_VERSION = 1;

// Sections disclosed in full (subject to the per-film field allowlist below
// for years/watchedFilms) whenever a public profile is built.
const CANONICAL_PUBLIC_SECTIONS = new Set([
  "years",
  "officialResults",
  "collectionAwards",
  "watchedFilms",
  "peopleAliases",
  "personPortraits",
  "franchiseLinks",
  "directorLinks",
]);

// Sections only included when the owner explicitly opts in (see
// buildPublicProjection's `options.optIn`). Not sensitive text, but
// curation metadata whose public value depends on which other sections are
// published, so it defaults out rather than defaulting in.
const CANONICAL_OPT_IN_SECTIONS = new Set(["localRanks"]);

// Sections that never appear in a public profile at all, regardless of
// options. watchlist is "the complete watchlist" the issue names
// explicitly; intakeWorkflows/editLog are process and edit-history audit
// trails (editLog's free-form changes/context/undo payloads routinely
// embed the exact private content — reviews, notes, whole watchlist
// records, source spreadsheet ids — this is disclosing, so exclusion is
// the only safe option, not per-field redaction); projects and
// watchlistProjectSources reference private watchlist items by id and
// would otherwise leak their existence; entityNotes is the app's literal
// "notes" feature; rejectedPersonAliases is internal curation housekeeping
// with no public value; declinedOfficialWatchlistAdds references the
// private watchlist the same way watchlistProjectSources does, and is
// itself just curation housekeeping for the shared-archive auto-add
// reconciliation, with no public value either.
const CANONICAL_PRIVATE_SECTIONS = new Set([
  "watchlist",
  "intakeWorkflows",
  "rankingReviews",
  "awardReviews",
  "opinionRebuildSession",
  "projects",
  "watchlistProjectSources",
  "rejectedPersonAliases",
  "declinedOfficialWatchlistAdds",
  "entityNotes",
  "editLog",
]);

(function assertSectionDisclosureClassificationComplete() {
  let classified = new Set([
    ...CANONICAL_PUBLIC_SECTIONS,
    ...CANONICAL_OPT_IN_SECTIONS,
    ...CANONICAL_PRIVATE_SECTIONS,
  ]);
  let missing = CANONICAL_TOP_LEVEL_KEYS.filter(
    (key) => key !== "canonicalSchemaVersion" && !classified.has(key),
  );
  if (missing.length)
    throw new Error(
      `Every canonical top-level section must have a public-profile disclosure ` +
        `classification (issue #246). Missing: ${missing.join(", ")}.`,
    );
})();

// Per-film fields excluded from public disclosure even though the film
// record's section is otherwise public: viewing facts (dateWatched,
// platform, views), opinion fields (musicScore and its separate musicRating
// star rating), rewatch intent (wantToRewatch, rewatchTier), free personal
// prose (review — functionally a note despite its name), and genre (unused by
// any writer anywhere in this codebase; excluded conservatively rather than
// guessed at).
const CANONICAL_PRIVATE_FILM_FIELDS = new Set([
  "dateWatched",
  "genre",
  "musicRating",
  "musicRatingValue",
  "musicScore",
  "platform",
  "review",
  "rewatchTier",
  "views",
  "wantToRewatch",
]);

const CANONICAL_PUBLIC_FILM_FIELDS = new Set([
  "adaptation",
  "adaptationSource",
  "allTimeRank",
  "awards",
  "canonicalComposite",
  "centuryRank",
  "compositeParts",
  "country",
  "decadeRank",
  "director",
  "directors",
  "franchises",
  "id",
  "letterboxdUrl",
  "liveAction",
  "medium",
  "normalizedTitle",
  "poster",
  "primaryCountry",
  "rank",
  "rankConfirmed",
  "rankingGroupId",
  "rankingGroupTitle",
  "rating",
  "ratingModifier",
  "ratingValue",
  "runtimeMinutes",
  "screenplayType",
  "suppressAllTimeRank",
  "swedishTitle",
  "tags",
  "title",
  "tmdbId",
  "type",
  "url",
  "year",
  "yearRank",
]);

(function assertFilmFieldDisclosureClassificationComplete() {
  let missing = [...CANONICAL_FILM_FIELDS].filter(
    (field) =>
      !CANONICAL_PUBLIC_FILM_FIELDS.has(field) &&
      !CANONICAL_PRIVATE_FILM_FIELDS.has(field),
  );
  let overlap = [...CANONICAL_PUBLIC_FILM_FIELDS].filter((field) =>
    CANONICAL_PRIVATE_FILM_FIELDS.has(field),
  );
  if (missing.length || overlap.length)
    throw new Error(
      `Every canonical film field must have exactly one public-profile ` +
        `disclosure classification (issue #246). Missing: ` +
        `${missing.join(", ") || "none"}. Classified as both: ` +
        `${overlap.join(", ") || "none"}.`,
    );
})();

const CANONICAL_PUBLIC_TOP_LEVEL_KEYS = [
  "publicSchemaVersion",
  ...CANONICAL_PUBLIC_SECTIONS,
  ...CANONICAL_OPT_IN_SECTIONS,
];

function stripToAllowedFields(record, allowed) {
  let projected = {};
  allowed.forEach((field) => {
    if (record?.[field] !== undefined) projected[field] = record[field];
  });
  return projected;
}

function filterUrlOnlyRecord(record) {
  let filtered = {};
  Object.entries(record || {}).forEach(([key, value]) => {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) filtered[key] = value;
  });
  return filtered;
}

function publicSectionRecordCount(value) {
  if (Array.isArray(value)) return value.length;
  if (canonicalIsRecord(value)) return Object.keys(value).length;
  return 0;
}

function yearsFilmCount(years) {
  return Object.values(years || {}).reduce(
    (sum, period) => sum + (period?.films?.length || 0),
    0,
  );
}

function entityScopedCount(scoped) {
  if (!canonicalIsRecord(scoped)) return 0;
  return Object.values(scoped).reduce(
    (sum, bucket) => sum + (canonicalIsRecord(bucket) ? Object.keys(bucket).length : 0),
    0,
  );
}

/**
 * Projects a canonical dataset into the allowlisted public-profile document.
 * Built by copying in only disclosed fields/sections — never by cloning
 * everything and deleting private parts.
 * @param {Object} canonical Valid current canonical dataset.
 * @param {{optIn?: Array<string>|Set<string>}} [options] Owner-selected opt-in sections.
 * @returns {Object} Public-profile document.
 */
window.buildPublicProjection = function (canonical, options = {}) {
  let optIn = options.optIn instanceof Set ? options.optIn : new Set(options.optIn || []);
  let years = {};
  Object.entries(canonical.years || {}).forEach(([key, period]) => {
    years[key] = {
      ...(period?.periodType !== undefined ? { periodType: period.periodType } : {}),
      ...(period?.sourceUrl !== undefined ? { sourceUrl: period.sourceUrl } : {}),
      films: (period?.films || []).map((film) =>
        stripToAllowedFields(film, CANONICAL_PUBLIC_FILM_FIELDS),
      ),
    };
  });
  let projection = {
    publicSchemaVersion: window.OSKARS_PUBLIC_SCHEMA_VERSION,
    years,
    officialResults: canonicalClone(canonical.officialResults || {}),
    collectionAwards: canonicalClone(canonical.collectionAwards || {
      director: {},
      franchise: {},
    }),
    watchedFilms: (canonical.watchedFilms || []).map((film) =>
      stripToAllowedFields(film, CANONICAL_PUBLIC_FILM_FIELDS),
    ),
    peopleAliases: canonicalClone(canonical.peopleAliases || {}),
    personPortraits: canonicalClone(canonical.personPortraits || {}),
    franchiseLinks: filterUrlOnlyRecord(canonical.franchiseLinks),
    directorLinks: filterUrlOnlyRecord(canonical.directorLinks),
  };
  if (optIn.has("localRanks") && canonical.localRanks)
    projection.localRanks = canonicalClone(canonical.localRanks);
  return projection;
};

/**
 * Validates a public-profile document against the allowlisted public
 * contract, reporting actionable JSON paths. Reuses the canonical
 * validation primitives with a narrower per-section allowlist, so nothing
 * private-only ever validates successfully here.
 * @param {Object} source Public-profile document.
 * @returns {{valid: boolean, errors: Array<{path: string, message: string}>}} Validation result.
 */
window.validatePublicData = function (source) {
  let errors = [];
  if (!canonicalCheckRecord(errors, source, "$")) return { valid: false, errors };
  canonicalCheckAllowedFields(errors, source, "$", new Set(CANONICAL_PUBLIC_TOP_LEVEL_KEYS));
  if (source.publicSchemaVersion !== window.OSKARS_PUBLIC_SCHEMA_VERSION)
    canonicalError(
      errors,
      "$.publicSchemaVersion",
      `must be ${window.OSKARS_PUBLIC_SCHEMA_VERSION}`,
    );
  if (canonicalCheckRecord(errors, source.years, "$.years")) {
    Object.entries(source.years).forEach(([key, period]) => {
      let path = `$.years.${key}`;
      if (!canonicalCheckRecord(errors, period, path)) return;
      canonicalCheckAllowedFields(
        errors,
        period,
        path,
        new Set(["films", "periodType", "sourceUrl"]),
      );
      if (canonicalCheckArray(errors, period.films, `${path}.films`))
        period.films.forEach((film, index) =>
          canonicalValidateFilm(
            errors,
            film,
            `${path}.films[${index}]`,
            CANONICAL_PUBLIC_FILM_FIELDS,
          ),
        );
    });
  }
  canonicalValidateOfficialResults(errors, source.officialResults);
  if (source.collectionAwards !== undefined)
    canonicalValidateCollectionAwards(errors, source.collectionAwards);
  if (canonicalCheckArray(errors, source.watchedFilms, "$.watchedFilms"))
    source.watchedFilms.forEach((film, index) =>
      canonicalValidateFilm(
        errors,
        film,
        `$.watchedFilms[${index}]`,
        CANONICAL_PUBLIC_FILM_FIELDS,
      ),
    );
  ["peopleAliases", "personPortraits", "franchiseLinks", "directorLinks"].forEach(
    (key) => canonicalCheckRecord(errors, source[key], `$.${key}`),
  );
  if (source.localRanks !== undefined)
    canonicalCheckRecord(errors, source.localRanks, "$.localRanks");
  canonicalCheckJson(errors, source, "$");
  return { valid: errors.length === 0, errors };
};

/**
 * Throws one readable validation error containing every failing JSON path.
 * @param {Object} source Public-profile document.
 * @returns {Object} The same valid document.
 */
window.assertPublicData = function (source) {
  let result = window.validatePublicData(source);
  if (result.valid) return source;
  let error = new Error(
    `Invalid public-profile dataset:\n${result.errors
      .map((entry) => `${entry.path}: ${entry.message}`)
      .join("\n")}`,
  );
  error.code = "OSKARS_INVALID_PUBLIC_DATA";
  error.validationErrors = result.errors;
  throw error;
};

/**
 * Derives a public-profile URL slug from an owner-chosen display name
 * (issue #253) - the display name is the single source of truth, so the
 * publish panel never needs a separately-typed, driftable slug field.
 * Shared between the Account page (name entry, slug preview) and the Data
 * page (publish panel), both of which load this module unconditionally.
 * @param {string} name Owner-chosen public profile display name.
 * @returns {string} URL-safe slug, empty if name has no alphanumeric content.
 */
window.publicProfileSlugify = function (name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

/**
 * Builds a publication preview organized by disclosed section and record
 * count, so an owner can inspect exactly what would be published before
 * doing so.
 * @param {Object} canonical Valid current canonical dataset.
 * @param {{optIn?: Array<string>|Set<string>}} [options] Owner-selected opt-in sections.
 * @returns {{projection: Object, sections: Array<Object>, valid: boolean, errors: Array}} Preview.
 */
window.publicProjectionPreview = function (canonical, options = {}) {
  let optIn = options.optIn instanceof Set ? options.optIn : new Set(options.optIn || []);
  let projection = window.buildPublicProjection(canonical, options);
  let sections = [
    {
      section: "years",
      disclosure: "public",
      includedRecordCount: yearsFilmCount(projection.years),
      totalRecordCount: yearsFilmCount(canonical.years),
    },
    {
      section: "officialResults",
      disclosure: "public",
      includedRecordCount: publicSectionRecordCount(projection.officialResults),
      totalRecordCount: publicSectionRecordCount(canonical.officialResults),
    },
    {
      section: "collectionAwards",
      disclosure: "public",
      includedRecordCount: publicSectionRecordCount(projection.collectionAwards),
      totalRecordCount: publicSectionRecordCount(canonical.collectionAwards),
    },
    {
      section: "watchedFilms",
      disclosure: "public",
      includedRecordCount: projection.watchedFilms.length,
      totalRecordCount: (canonical.watchedFilms || []).length,
    },
    {
      section: "peopleAliases",
      disclosure: "public",
      includedRecordCount: publicSectionRecordCount(projection.peopleAliases),
      totalRecordCount: publicSectionRecordCount(canonical.peopleAliases),
    },
    {
      section: "personPortraits",
      disclosure: "public",
      includedRecordCount: publicSectionRecordCount(projection.personPortraits),
      totalRecordCount: publicSectionRecordCount(canonical.personPortraits),
    },
    {
      section: "franchiseLinks",
      disclosure: "public",
      includedRecordCount: publicSectionRecordCount(projection.franchiseLinks),
      totalRecordCount: publicSectionRecordCount(canonical.franchiseLinks),
    },
    {
      section: "directorLinks",
      disclosure: "public",
      includedRecordCount: publicSectionRecordCount(projection.directorLinks),
      totalRecordCount: publicSectionRecordCount(canonical.directorLinks),
    },
    {
      section: "localRanks",
      disclosure: optIn.has("localRanks") ? "opt-in (included)" : "opt-in (excluded)",
      includedRecordCount: optIn.has("localRanks")
        ? entityScopedCount(projection.localRanks)
        : 0,
      totalRecordCount: entityScopedCount(canonical.localRanks),
    },
    {
      section: "watchlist",
      disclosure: "private",
      includedRecordCount: 0,
      totalRecordCount: (canonical.watchlist || []).length,
    },
    {
      section: "intakeWorkflows",
      disclosure: "private",
      includedRecordCount: 0,
      totalRecordCount: (canonical.intakeWorkflows || []).length,
    },
    {
      section: "projects",
      disclosure: "private",
      includedRecordCount: 0,
      totalRecordCount: (canonical.projects || []).length,
    },
    {
      section: "watchlistProjectSources",
      disclosure: "private",
      includedRecordCount: 0,
      totalRecordCount: publicSectionRecordCount(canonical.watchlistProjectSources),
    },
    {
      section: "rejectedPersonAliases",
      disclosure: "private",
      includedRecordCount: 0,
      totalRecordCount: (canonical.rejectedPersonAliases || []).length,
    },
    {
      section: "entityNotes",
      disclosure: "private",
      includedRecordCount: 0,
      totalRecordCount: entityScopedCount(canonical.entityNotes),
    },
    {
      section: "editLog",
      disclosure: "private",
      includedRecordCount: 0,
      totalRecordCount: (canonical.editLog || []).length,
    },
  ];
  let validation = window.validatePublicData(projection);
  return { projection, sections, valid: validation.valid, errors: validation.errors };
};

/**
 * Produces byte-stable, normalized public-profile JSON with a trailing
 * newline, mirroring serializeCanonicalData's determinism guarantees.
 * @param {Object} canonical Valid current canonical dataset.
 * @param {{optIn?: Array<string>|Set<string>}} [options] Owner-selected opt-in sections.
 * @returns {string} Deterministically formatted public-profile JSON.
 */
window.serializePublicData = function (canonical, options = {}) {
  let projection = window.buildPublicProjection(canonical, options);
  window.assertPublicData(projection);
  return `${JSON.stringify(canonicalNormalize(projection), null, 2)}\n`;
};

/**
 * Produces a stable, content-addressed, filename-safe revision id for a
 * validated public-profile document (issue #253's publish pipeline) —
 * reuses canonicalDataRevision()'s deterministic hash, which is already
 * fully generic over any JSON-like value, so publishing byte-identical
 * content twice reproduces the same revision id rather than minting a new
 * one. Unlike canonicalDataRevision() (never used as a filename elsewhere),
 * this id becomes a literal `<revisionId>.json` filename in the published
 * repository, so its colons are replaced — `:` is illegal in Windows
 * filenames and unusual even where it's technically legal.
 * @param {Object} publicData Public-profile document (buildPublicProjection()'s output).
 * @returns {string} Filename-safe revision id.
 */
window.publicDataRevision = function (publicData) {
  return window.canonicalDataRevision(publicData).replace(/:/g, "-");
};

/**
 * Hydrates a validated public-profile document (buildPublicProjection()'s
 * output) into browsable runtime state, for a viewer-mode session browsing
 * another owner's published profile (issue #256). Deliberately does not
 * reuse hydrateState()/browserPersistenceToRuntimeState(): those stamp
 * draftMetadata with a base revision and dirty tracking that assumes the
 * hydrated data is a private canonical draft eligible for reconciliation
 * and publication, which public-profile data never is. This path sets
 * draftMetadata to null and isPublicProfileView to true instead, and never
 * touches persistence — window.save() already refuses to write anything in
 * viewer mode (src/core/persistence.js), so this state can only ever live
 * for the current tab.
 * @param {Object} publicData Public-profile document to hydrate.
 * @param {{slug?: string, ownerName?: string, revision?: string, publishedAt?: string}} [meta]
 *   Manifest-resolved profile identity (issue #253) stashed as
 *   `state.publicProfileMeta` for UI attribution; omitted fields default to
 *   empty strings rather than being left undefined.
 * @returns {OskarsState} Hydrated, non-persistable viewer state.
 * @throws {Error} `OSKARS_INVALID_PUBLIC_DATA` when publicData fails validation.
 */
window.hydratePublicProfileState = function (publicData, meta = {}) {
  window.assertPublicData(publicData);
  let runtimeSource = {
    dataVersion: window.OSKARS_BUNDLED_DATA_VERSION || 0,
    creditSchemaVersion: 3,
    centuryRangeVersion: 1,
    adaptationSourceVersion: 1,
    watchlistOrderVersion: 1,
    groupedRankProjectionVersion: 1,
    watchedDateVersion: 1,
    viewingFactsVersion: 1,
    years: publicData.years,
    officialResults: publicData.officialResults,
    collectionAwards: publicData.collectionAwards || {
      director: {},
      franchise: {},
    },
    watchedOther: publicData.watchedFilms,
    peopleAliases: publicData.peopleAliases,
    personPortraits: publicData.personPortraits,
    franchiseLinks: publicData.franchiseLinks,
    directorLinks: publicData.directorLinks,
    ...(publicData.localRanks ? { localRanks: publicData.localRanks } : {}),
  };
  window.migrateCreditSchema?.(runtimeSource);
  window.state = Object.assign(window.createEmptyState(), runtimeSource);
  window.state.years = runtimeSource.years;
  window.state.draftMetadata = null;
  window.state.isPublicProfileView = true;
  window.state.publicProfileMeta = {
    slug: String(meta.slug || ""),
    ownerName: String(meta.ownerName || ""),
    revision: String(meta.revision || ""),
    publishedAt: String(meta.publishedAt || ""),
  };
  if (window.rebuildAggregates) window.rebuildAggregates();
  return window.state;
};
