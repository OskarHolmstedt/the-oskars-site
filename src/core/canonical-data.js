/**
 * @file Defines the versioned canonical dataset contract, pure migrations,
 * path-aware validation, runtime adaptation, and deterministic serialization.
 */

window.OSKARS_CANONICAL_SCHEMA_VERSION = 1;

const CANONICAL_TOP_LEVEL_KEYS = [
  "canonicalSchemaVersion",
  "years",
  "officialResults",
  "watchlist",
  "watchedFilms",
  "intakeWorkflows",
  "projects",
  "watchlistProjectSources",
  "peopleAliases",
  "rejectedPersonAliases",
  "personPortraits",
  "franchiseLinks",
  "directorLinks",
  "entityNotes",
  "localRanks",
  "editLog",
];

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
  "globalRank",
  "id",
  "letterboxdUrl",
  "liveAction",
  "medium",
  "normalizedTitle",
  "personalScore",
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

const CANONICAL_SECRET_KEY =
  /^(?:api[-_]?key|access[-_]?token|client[-_]?secret|credential|oauth[-_]?token)$/i;

function canonicalIsRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalEmptyDocument() {
  return {
    canonicalSchemaVersion: window.OSKARS_CANONICAL_SCHEMA_VERSION,
    years: {},
    officialResults: {},
    watchlist: [],
    watchedFilms: [],
    intakeWorkflows: [],
    projects: [],
    watchlistProjectSources: {},
    peopleAliases: {},
    rejectedPersonAliases: [],
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
  migrated.watchlist = source.watchlist || [];
  migrated.watchedFilms = source.watchedFilms || source.watchedOther || [];
  migrated.intakeWorkflows = source.intakeWorkflows || [];
  migrated.projects = source.projects || [];
  migrated.watchlistProjectSources = source.watchlistProjectSources || {};
  migrated.peopleAliases = source.peopleAliases || {};
  migrated.rejectedPersonAliases = source.rejectedPersonAliases || [];
  migrated.personPortraits = source.personPortraits || {};
  migrated.franchiseLinks = source.franchiseLinks || {};
  migrated.directorLinks = source.directorLinks || {};
  migrated.entityNotes = source.entityNotes || migrated.entityNotes;
  migrated.localRanks = source.localRanks || migrated.localRanks;
  migrated.editLog = source.editLog || [];
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
  return migrated;
};

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
    "globalRank",
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
    "order",
    "personalScore",
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
          new Set(["id", "projectOrder", "rank", "type"]),
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
            "detail",
            "filmRef",
            "id",
            "recipient",
            "sourceTitle",
            "sourceCategory",
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
        ["recipient", "detail", "sourceCategory"].forEach((field) => {
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
  if (
    canonicalCheckArray(
      errors,
      source.rejectedPersonAliases,
      "$.rejectedPersonAliases",
    ) &&
    source.rejectedPersonAliases.some((value) => typeof value !== "string")
  )
    canonicalError(errors, "$.rejectedPersonAliases", "must contain only strings");
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
    watchlist: source.watchlist || [],
    watchedFilms: source.watchedFilms || source.watchedOther || [],
    intakeWorkflows: source.intakeWorkflows || [],
    projects: source.projects || [],
    watchlistProjectSources: source.watchlistProjectSources || {},
    peopleAliases: source.peopleAliases || {},
    rejectedPersonAliases: source.rejectedPersonAliases || [],
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
    watchlist: canonical.watchlist,
    watchedOther: canonical.watchedFilms,
    intakeWorkflows: canonical.intakeWorkflows,
    projects: canonical.projects,
    watchlistProjectSources: canonical.watchlistProjectSources,
    peopleAliases: canonical.peopleAliases,
    rejectedPersonAliases: canonical.rejectedPersonAliases,
    personPortraits: canonical.personPortraits,
    franchiseLinks: canonical.franchiseLinks,
    directorLinks: canonical.directorLinks,
    entityNotes: canonical.entityNotes,
    localRanks: canonical.localRanks,
    editLog: canonical.editLog,
  };
};
