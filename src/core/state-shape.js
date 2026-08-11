/**
 * @file Canonical shape of the global application state (`window.state`):
 * the empty-state factory, the persisted subset, and the shared typedefs
 * for the record shapes used throughout the app. Every other file refers
 * to these types by name (`FilmRecord`, `WatchlistItem`, ...) instead of
 * re-describing the shapes. APP_OVERVIEW.md ("State And Data Format")
 * holds the prose description; this file is the machine-readable one.
 */

/**
 * Normalized poster or portrait image reference. Produced by
 * `normalizePosterRecord` (src/domain/posters.js); never hand-built.
 * @typedef {Object} PosterRecord
 * @property {string} url Image URL (always http/https).
 * @property {'tmdb'|'wikimedia'|'manual'} source Which provider supplied it.
 * @property {string} sourceUrl Human-facing page for the image, or ''.
 * @property {string} providerId Provider-side id (e.g. TMDB id), or ''.
 * @property {string} fetchedAt ISO timestamp of when it was fetched.
 */

/**
 * One credited recipient on an award.
 * @typedef {Object} AwardRecipient
 * @property {string} name Display name as credited.
 * @property {string} personId Normalized person id (`normalizePersonName`).
 */

/**
 * One award/nomination on a film. Lives in `FilmRecord.awards`.
 * @typedef {Object} AwardRecord
 * @property {string} category Canonical category name (e.g. "Best Director").
 * @property {number} placement 1-based placement inside the category.
 * @property {string} year Period key ("1999", "1990s", "1900s", "alltime").
 * @property {'years'|'decades'|'centuries'|'allTime'} periodType
 *   Disambiguates identical keys such as decade "2000s" vs century "2000s".
 * @property {AwardRecipient[]} recipients Structured recipients.
 * @property {string} recipientText Original recipient cell text.
 * @property {string} detail Role name, song title, or other work context.
 */

/**
 * One franchise membership stored on a film or watchlist item. Direct
 * parent(s) only in `parentId(s)`; the full ancestor lineage (outermost
 * first, ending in the direct parent) in `parentChainIds`/`Names`.
 * @typedef {Object} FranchiseMembership
 * @property {string} id Normalized franchise id (`normalizeFranchiseId`).
 * @property {string} name Display name.
 * @property {string} parentId Direct parent id, or ''.
 * @property {string} parentName Direct parent name, or ''.
 * @property {string[]} parentIds All direct parents (plural for crossovers).
 * @property {string[]} parentNames Display names matching `parentIds`.
 * @property {string[]} parentChainIds Full ancestor id chain, outermost first.
 * @property {string[]} parentChainNames Display names matching `parentChainIds`.
 * @property {number|null} rank This row's position under the sheet header it
 *   was listed under (never an ancestor-level rank).
 */

/**
 * A canonical archive film. Stored in source period records
 * (`state.years[key].films`) and indexed into the derived `state.filmsById`.
 * @typedef {Object} FilmRecord
 * @property {string} id Usually `${year}::${normalized title}`.
 * @property {string} title
 * @property {string} [normalizedTitle] Cached `normalizeTitle(title)`.
 * @property {string} year Four-digit year as a string.
 * @property {string} [director] Raw credited director text.
 * @property {string[]} [directors] Split director names.
 * @property {string} [rating] Star rating text (e.g. "★★★★—").
 * @property {number} [ratingValue] Numeric star count.
 * @property {string} [ratingModifier] Rating suffix/modifier, if any.
 * @property {number} [allTimeRank]
 * @property {number} [centuryRank]
 * @property {number} [decadeRank]
 * @property {number} [yearRank]
 * @property {number} [rank] Rank within its source period record.
 * @property {string} [tmdbId]
 * @property {string} [country] Possibly multiple production countries.
 * @property {string} [primaryCountry] Single normalized country used for
 *   Best International Picture eligibility.
 * @property {'live-action'|'animation'|'hybrid'|'unknown'} [medium]
 * @property {'original'|'adapted'|'unknown'} [screenplayType]
 * @property {string} [adaptationSource]
 * @property {string} [swedishTitle]
 * @property {string} [type] Ranked-list Type cell (usually "Film").
 * @property {string} [platform] Viewing platform from the ranked list.
 * @property {number} [runtimeMinutes]
 * @property {string} [dateWatched] Canonical `YYYY-MM-DD`, '' or raw text.
 * @property {number} [views]
 * @property {boolean} [wantToRewatch] True when the watched film is on the rewatchlist.
 * @property {'S'|'A'|'B'|'C'|'D'|'E'|'F'|''} [rewatchTier] Rewatch priority, reusing the watchlist's interest tiers.
 * @property {number} [personalScore] Ranked-list Score column (musical score).
 * @property {string} [globalRank]
 * @property {string} [url] Generic film URL.
 * @property {string} [letterboxdUrl]
 * @property {string} [rankingGroupId] Shared all-time ranking group id.
 * @property {string} [rankingGroupTitle]
 * @property {boolean} [rankConfirmed] False once `resetRankingToDefaultOrder`
 *   drops a film back to the mechanical default order; missing/true means
 *   its rank reflects a deliberate placement (via `moveRankedFilmWithinRating`
 *   or the pre-existing archive, which is confirmed by default).
 * @property {Array<{id: string, title: string}>} [compositeParts] Component
 *   film refs on a canonical composite film.
 * @property {{id: string, title: string}|null} [canonicalComposite] Canonical
 *   film ref on a component film.
 * @property {boolean} [suppressAllTimeRank] True for explicitly unranked
 *   (`-`) ranked-list rows.
 * @property {PosterRecord|null} [poster]
 * @property {string[]} [tags]
 * @property {FranchiseMembership[]} [franchises]
 * @property {string} [review]
 * @property {AwardRecord[]} [awards]
 * @property {Record<string, FilmProfessionCredit[]>} [peopleByProfession]
 *   Derived by `rebuildPeopleIndex`; keyed by profession.
 */

/**
 * Rating statistics derived from exact 1–30 grades and normalized to a bounded five-point scale for display.
 * @typedef {Object} RatingStatistics
 * @property {number} totalCount
 * @property {number} ratedCount
 * @property {number} coveragePercent
 * @property {number|null} mean
 * @property {number|null} variance Population variance for rated films.
 * @property {number|null} standardDeviation Population standard deviation.
 * @property {number|null} minimum
 * @property {number|null} maximum
 */

/**
 * One externally sourced historical award nomination, separate from personal placements.
 * @typedef {Object} OfficialNomination
 * @property {string} id Deterministic identity within its source period.
 * @property {string} category Canonical category name.
 * @property {boolean} winner Whether the source marks this nomination as the winner.
 * @property {string} sourceTitle Film title exactly as imported.
 * @property {string} [sourceCategory] Source category retained when several historical categories map to one app category.
 * @property {string} [recipient] Credited recipient text.
 * @property {string} [detail] Role, work, or other credited detail.
 * @property {{id: string, title: string, year: string}} [filmRef] Existing canonical film match.
 */

/**
 * One imported official-results period.
 * @typedef {Object} OfficialResultsPeriod
 * @property {string} periodType Canonical period type.
 * @property {string} sourceUrl Source URL carried by the bracket metadata.
 * @property {string} [ceremony] Source ceremony number for long-form historical imports.
 * @property {OfficialNomination[]} nominations Deterministically sorted results.
 */

/**
 * One isolated external awards source and its refreshed periods.
 * @typedef {Object} OfficialResultsSource
 * @property {string} id Stable source id.
 * @property {string} name Display name.
 * @property {string} sourceRevision Deterministic identity of all stored periods.
 * @property {Record<string, OfficialResultsPeriod>} periods Period results keyed by source period.
 */

/**
 * One film and its personal award placement in a period view.
 * @typedef {Object} PeriodAwardEntry
 * @property {FilmRecord} film
 * @property {AwardRecord} award
 */

/**
 * One canonical category's personal-winner comparison with official winners.
 * @typedef {Object} OfficialAwardCategoryComparison
 * @property {string} category
 * @property {PeriodAwardEntry|null} personalWinner
 * @property {string[]} personalFilmIds Canonical/source ids representing the personal winner.
 * @property {OfficialNomination[]} officialWinners
 * @property {OfficialNomination[]} comparableOfficialWinners Year-compatible winners with canonical film references.
 * @property {'agreement'|'disagreement'|'unresolved'} status
 */

/**
 * Derived personal-vs-official agreement for one annual award period.
 * @typedef {Object} OfficialAwardPeriodComparison
 * @property {string} periodKey
 * @property {string[]} representedYears
 * @property {OfficialAwardCategoryComparison[]} categories
 * @property {Map<string, OfficialAwardCategoryComparison>} categoriesByName
 * @property {number} matches
 * @property {number} differences
 * @property {number} comparedCount
 * @property {number} agreementPercent
 */

/**
 * One category's comparison result for an official annual period.
 * @typedef {Object} OfficialAwardCategoryPeriodComparison
 * @property {string} periodKey
 * @property {string[]} representedYears
 * @property {OfficialAwardCategoryComparison} categoryComparison
 * @property {OfficialAwardPeriodComparison} periodComparison
 * @property {'agreement'|'disagreement'|'unresolved'} status
 */

/**
 * Derived personal-vs-official agreement across one category's history.
 * @typedef {Object} OfficialAwardCategoryHistoryComparison
 * @property {string} category
 * @property {OfficialAwardCategoryPeriodComparison[]} periods
 * @property {Map<string, OfficialAwardCategoryPeriodComparison>} periodsByKey
 * @property {number} matches
 * @property {number} differences
 * @property {number} comparedCount
 * @property {number} agreementPercent
 */

/**
 * One grouped row in the overall awards agreement breakdown.
 * @typedef {Object} OfficialAwardAgreementBreakdown
 * @property {string} key Canonical category or decade key.
 * @property {number} matches
 * @property {number} differences
 * @property {number} comparedCount
 * @property {number} agreementPercent
 */

/**
 * Overall personal-vs-official agreement across comparable category-periods.
 * @typedef {Object} OfficialAwardAgreementStatistics
 * @property {number} matches
 * @property {number} differences
 * @property {number} comparedCount
 * @property {number} agreementPercent
 * @property {number} categoryCount
 * @property {number} periodCount
 * @property {OfficialAwardAgreementBreakdown[]} categoryRows
 * @property {OfficialAwardAgreementBreakdown[]} decadeRows
 */

/**
 * One official Academy Awards nomination matched to an existing person.
 * @typedef {Object} OfficialPersonCredit
 * @property {string} nominationId
 * @property {string} periodKey
 * @property {string} ceremony
 * @property {string} category
 * @property {boolean} winner
 * @property {string} filmId Year-compatible canonical film id, or ''.
 * @property {string} filmTitle Imported film title.
 * @property {string} filmYear Compatible film/reference year or represented period year.
 * @property {string} recipient Full imported recipient text.
 * @property {string} detail Imported role/work detail.
 * @property {string} sourceCategory
 * @property {string} sourceUrl
 */

/**
 * Derived real Oscar record for one existing person.
 * @typedef {Object} OfficialPersonOscarRecord
 * @property {OfficialResultsSource|null} source
 * @property {string} personId
 * @property {OfficialPersonCredit[]} credits
 * @property {number} wins
 * @property {number} nominations
 * @property {string[]} periodKeys
 */

/**
 * Stable entity reference carried by a shared search entry.
 * @typedef {Object} SearchTarget
 * @property {'film'|'watchlist'|'project'|'person'|'song'|'role'|'franchise'|'category'|'tag'|'period'} type
 * @property {string} id Canonical entity id or typed period key.
 */

/**
 * One reusable entry in the aggregate-version-cached search index.
 * @typedef {Object} SearchEntry
 * @property {string} type User-facing result type.
 * @property {string} name Primary searchable label.
 * @property {string} meta Secondary display and search context.
 * @property {string} [searchText] Additional non-displayed searchable text.
 * @property {string[]} [aliasNames] Alternate primary labels.
 * @property {string} [year] Source record year for film pickers.
 * @property {SearchTarget} target Stable typed entity reference.
 * @property {string} href Internal entity URL.
 */

/**
 * Derived per-film, per-profession person summary on
 * `FilmRecord.peopleByProfession`.
 * @typedef {Object} FilmProfessionCredit
 * @property {string} id Person id.
 * @property {string} name
 * @property {string[]} details Role names / song titles for this film.
 * @property {Array<{category: string, period: string, placement: number}>} awards
 */

/**
 * One to-watch item in `state.watchlist`.
 * @typedef {Object} WatchlistItem
 * @property {string} id
 * @property {string} title
 * @property {string} year
 * @property {string} [letterboxdUrl]
 * @property {string} [tmdbId]
 * @property {string} [swedishTitle]
 * @property {'S'|'A'|'B'|'C'|'D'|'E'|'F'|''} [tier] Interest tier; tiers are
 *   guard buckets for order edits.
 * @property {number} [order] Optional numeric global watchlist order.
 * @property {string} [director]
 * @property {number|string} [runtimeMinutes]
 * @property {string} [adaptationSource]
 * @property {string} [platform]
 * @property {string[]} [tags]
 * @property {FranchiseMembership[]} [franchises]
 * @property {PosterRecord|null} [poster]
 */

/**
 * A rated franchise/director sheet row that matches no archive film
 * (e.g. a miniseries). Kept in `state.watchedOther`, separate from both
 * the archive and the watchlist.
 * @typedef {Object} WatchedOtherEntry
 * @property {string} id `${year}::${normalized title}`.
 * @property {string} title
 * @property {string} year
 * @property {string} type Usually 'unknown'.
 * @property {string} rating Star rating text.
 * @property {number} [ratingValue]
 * @property {string} director
 * @property {FranchiseMembership[]} franchises
 * @property {number} rowNumber Source sheet row.
 * @property {string} [normalizedTitle]
 * @property {string} [tmdbId]
 * @property {string} [letterboxdUrl]
 * @property {string} [swedishTitle]
 * @property {string[]} [directors]
 * @property {string[]} [tags]
 * @property {PosterRecord|null} [poster]
 * @property {number} [runtimeMinutes]
 * @property {'live-action'|'animation'|'hybrid'|'unknown'} [medium]
 * @property {'original'|'adapted'|'unknown'} [screenplayType]
 * @property {string} [adaptationSource]
 * @property {string} [country]
 * @property {string} [primaryCountry]
 * @property {string} [platform]
 * @property {string} [dateWatched]
 * @property {number} [views]
 * @property {'plus'|'dot'|'minus'|''} [ratingModifier]
 */

/**
 * A canonical, resumable watched-film editorial intake. Domain values remain
 * on the film, ranking, and award records; this record owns completion state
 * and references only.
 * @typedef {Object} WatchedFilmIntake
 * @property {number} schemaVersion Workflow schema version (currently 1).
 * @property {string} id Stable workflow id.
 * @property {string} filmId Stable watched or archive film id.
 * @property {'watchlist-transition'|'fresh'} source Entry path.
 * @property {string} [sourceRecordId] Originating watchlist record id.
 * @property {string} createdAt ISO creation timestamp.
 * @property {string} [baseRevision] Canonical revision the draft was based on.
 * @property {Object} steps Per-step and per-award-level completion decisions.
 * @property {string} [completedAt] ISO explicit-completion timestamp.
 * @property {string} [reopenedAt] ISO deliberate-reopen timestamp.
 * @property {string} [summary] Bounded completion summary derived from domain records.
 * @property {string} [auditEntryId] Canonical edit-log linkage.
 */

/**
 * One film reference inside a project's watch queue.
 * @typedef {Object} ProjectFilmRef
 * @property {'archive'|'watchlist'|'watched'|'official'} type Which store or official-results collection `id` points into.
 * @property {string} id Film or watchlist item id.
 * @property {number} projectOrder Queue position local to this project.
 */

/**
 * A watch project in `state.projects`. Progress is derived, never stored.
 * @typedef {Object} ProjectRecord
 * @property {string} id
 * @property {string} name
 * @property {'person'|'franchise'|'tag'|'watchlist-filter'|'watch-goal'|'official-results'|'custom'} sourceType
 * @property {string} sourceId Source entity id; '' for custom projects.
 * @property {string} sourceLabel
 * @property {ProjectFilmRef[]} filmRefs
 * @property {string} createdAt ISO timestamp.
 * @property {string} updatedAt ISO timestamp.
 * @property {'active'|'complete'|'archived'} status
 * @property {boolean} pinned
 * @property {string} [sourceHref] Detail URL for a source-backed project.
 * @property {ProjectFilmRef[]} [dismissedRefs] Source references excluded on refresh.
 */

/**
 * One distinct film derived from an imported official-results period.
 * @typedef {Object} OfficialFilmCompletionRecord
 * @property {string} id Period-scoped normalized film identity.
 * @property {string} title Imported display title.
 * @property {string} year Resolved or source-period release year.
 * @property {string} periodKey Official source period.
 * @property {boolean} winner Whether the film won at least one category.
 * @property {string[]} categories Canonical nominated categories.
 * @property {string[]} winnerCategories Canonical categories the film won.
 * @property {boolean} watched Whether the current watched archive resolves the film.
 * @property {FilmRecord|null} watchedFilm Resolved watched record.
 * @property {'archive'|'watched'|''} watchedType Resolved watched store.
 * @property {WatchlistItem|null} watchlistItem Resolved current watchlist item.
 * @property {string} href Best current film or official-period URL.
 */

/**
 * Overall Academy Awards watched-film completion model.
 * @typedef {Object} OfficialOscarCompletion
 * @property {OfficialResultsSource|null} source Imported Academy Awards source.
 * @property {string[]} periodKeys Imported source periods with nominations.
 * @property {OfficialFilmCompletionRecord[]} films Distinct period-scoped films.
 * @property {Map<string, OfficialFilmCompletionRecord>} filmsById Film lookup.
 * @property {Object} winners Overall winning-film completion group.
 * @property {Object} nominees Overall nominated-film completion group.
 * @property {Object[]} periods Per-period winner and nominee completion groups.
 * @property {Object[]} categories Per-category winner and nominee groups.
 * @property {Object|null} bestPicture Best Picture category group.
 */

/**
 * Source period record in `state.years`, keyed by period key
 * ("1950", "1970s", "1900s", "alltime").
 * @typedef {Object} PeriodSourceRecord
 * @property {FilmRecord[]} films Source film records for the period.
 * @property {'years'|'decades'|'centuries'|'allTime'} [periodType]
 * @property {string} [sourceUrl] The bracket sheet's row-3 period URL.
 */

/**
 * Lightweight film reference inside the derived period index
 * (`state.periods[type][key].films`); the canonical film object lives in
 * `state.filmsById`. Carries `id` plus whatever per-period metadata
 * `addToPeriod` was given (typically `rank`).
 * @typedef {Object} PeriodFilmEntry
 * @property {string} id Film id.
 * @property {number} [rank] Rank within this period.
 */

/**
 * One row in a mixed watched/watchlist listing (tag, period, and franchise
 * pages): exactly one of `film` or `item` is set, and pages may carry extra
 * page-specific properties alongside. Resolved onto comparable sort values
 * by `filmAxisSortValue` (src/ui/page-utils.js).
 * @typedef {Object} FilmAxisRecord
 * @property {FilmRecord} [film] Watched film, when the row is watched.
 * @property {WatchlistItem} [item] Watchlist item, when the row is unwatched.
 */

/**
 * A lightweight typed reference accepted by comparison URL and resolver APIs.
 * @typedef {Object} CompareTargetReference
 * @property {'film'|'person'|'franchise'|'tag'|'project'|'period'|'category'|'song'|'role'} type
 * @property {string} id Canonical id in the type's namespace.
 */

/**
 * One resolved comparison target on the compare page: a film, person,
 * franchise, tag, project, period, category, song, or role normalized onto one capability shape
 * by `resolveCompareTarget` (src/domain/compare-targets.js).
 * @typedef {Object} CompareTarget
 * @property {'film'|'person'|'franchise'|'tag'|'project'|'period'|'category'|'song'|'role'} type
 * @property {string} id Canonical id in the type's namespace; period ids are `type:key`.
 * @property {string} displayName
 * @property {string} url Detail-page URL for the target.
 * @property {Object} record Underlying record (FilmRecord, PersonRecord, ...).
 * @property {string[]} filmIds Deduplicated watched-film ids the target represents.
 * @property {string[]} watchlistIds Deduplicated watchlist item ids the target represents.
 * @property {Record<string, string|number>} metrics Display metrics keyed by label.
 * @property {RatingStatistics} ratingStatistics Statistics over represented watched films.
 */

/**
 * Pairwise represented-item overlap between two compare targets.
 * @typedef {Object} CompareTargetOverlap
 * @property {string[]} sharedFilmIds Watched films represented by both targets.
 * @property {string[]} leftOnlyFilmIds Watched films represented only by the left target.
 * @property {string[]} rightOnlyFilmIds Watched films represented only by the right target.
 * @property {string[]} sharedWatchlistIds Watchlist items represented by both targets.
 * @property {string[]} leftOnlyWatchlistIds Watchlist items represented only by the left target.
 * @property {string[]} rightOnlyWatchlistIds Watchlist items represented only by the right target.
 */

/**
 * One proposed nomination placement change inside a previewable plan.
 * @typedef {Object} NominationPlacementChange
 * @property {string} filmId Canonical or source film id.
 * @property {string} title Film title.
 * @property {number|null} before Placement before applying the plan.
 * @property {number|null} after Placement after applying the plan.
 * @property {'added'|'moved'|'removed'} kind Change kind.
 */

/**
 * Non-persisted dry-run result for one nomination placement operation.
 * @typedef {Object} NominationPlacementPlan
 * @property {'insert'|'reorder'|'delete'|'merge'} operation Operation kind.
 * @property {boolean} ok Whether the plan is valid and applicable.
 * @property {string} periodType Award period type.
 * @property {string} periodKey Award period key.
 * @property {string} category Award category.
 * @property {NominationPlacementChange[]} changes Proposed placement changes.
 * @property {string[]} notes Preview details specific to the operation.
 * @property {string[]} warnings Non-blocking validation findings.
 * @property {string[]} errors Blocking validation findings.
 * @property {Record<string, PeriodSourceRecord>} nextPeriods Planned source-period replacements.
 * @property {Record<string, string>} sourceSignatures Source snapshots used by the stale-plan guard.
 * @property {string} editType Edit-log type.
 * @property {string} summary Edit-log summary.
 * @property {string} sheetHint Sheet-oriented target hint.
 * @property {Object} context Edit-log context.
 * @property {EditLogChange[]} logChanges Additional non-placement log changes.
 * @property {Object} result Operation-specific result fields.
 * @property {boolean} applied Whether the plan was already applied.
 */

/**
 * One normalized field change stored in an edit-log entry.
 * @typedef {Object} EditLogChange
 * @property {string} field User-facing field label.
 * @property {string} before Normalized previous value.
 * @property {string} after Normalized new value.
 */

/**
 * Stable target identity for an edit-log entry.
 * @typedef {Object} EditLogTarget
 * @property {'film'|'watchlist'|'nomination'|'project'|'alias'|'note'|'import'|'other'} type Target kind.
 * @property {string} id Target identifier when one is available.
 * @property {string} label Human-readable target label.
 */

/**
 * One typed field restoration inside a reversible-undo payload. Values are
 * plain JSON data (string, number, boolean, null, or string array) in the
 * exact shape the owning domain setter accepts - never display strings and
 * never code.
 * @typedef {Object} EditLogUndoField
 * @property {string} key Domain setter field key.
 * @property {string} label User-facing field label.
 * @property {string|number|boolean|null|string[]} before Typed value before the edit (the value undo restores).
 * @property {string|number|boolean|null|string[]} after Typed value the edit produced (validated against current state).
 */

/**
 * Declarative field-level reversible payload persisted on an edit-log entry.
 * @typedef {Object} EditLogFieldUndoPayload
 * @property {number} version Payload contract version.
 * @property {'film-metadata'|'watchlist-metadata'|'entity-note'} kind Supported undo kind.
 * @property {Record<string, string>} target Entity identity keys for the kind.
 * @property {EditLogUndoField[]} fields Complete set of typed field restorations.
 */

/**
 * One full changed-film record stored at its exact source-period position.
 * @typedef {Object} NominationUndoFilmSnapshot
 * @property {string} key Stable film identity plus duplicate occurrence.
 * @property {number} index Source-period film-array position.
 * @property {FilmRecord} record Complete source film record.
 */

/**
 * Compact before/after delta for one structurally changed source period.
 * Full-period signatures guard unchanged records against intervening edits.
 * @typedef {Object} NominationUndoPeriodSnapshot
 * @property {string} key Source period key.
 * @property {boolean} beforeExists
 * @property {boolean} afterExists
 * @property {string} beforeSignature
 * @property {string} afterSignature
 * @property {Object|null} beforeMetadata Period fields other than `films`.
 * @property {Object|null} afterMetadata Period fields other than `films`.
 * @property {NominationUndoFilmSnapshot[]} beforeFilms
 * @property {NominationUndoFilmSnapshot[]} afterFilms
 */

/**
 * One nomination-level reversal preview row.
 * @typedef {Object} NominationUndoAction
 * @property {string} periodKey Source period containing the record.
 * @property {string} category Award category, or ''.
 * @property {string} title Film title, or ''.
 * @property {string} label Complete source/period/category/film label.
 * @property {string} before Value restored by undo.
 * @property {string} after Current value produced by the original edit.
 */

/**
 * Bounded structural nomination payload persisted on an edit-log entry.
 * @typedef {Object} EditLogNominationUndoPayload
 * @property {number} version Payload contract version.
 * @property {'nomination-periods'} kind Structural undo kind.
 * @property {NominationUndoPeriodSnapshot[]} periods Affected source deltas.
 * @property {NominationUndoAction[]} actions Reversal preview rows.
 */

/**
 * Bounded before/after snapshot for one atomic watchlist lifecycle transition.
 * @typedef {Object} EditLogWatchlistTransitionUndoPayload
 * @property {number} version Payload contract version.
 * @property {'watchlist-transition'} kind Structural undo kind.
 * @property {Object} watchlist Removed watchlist record and membership signatures.
 * @property {Object} target Resolved archive or watched identity.
 * @property {Object} watched Non-archive watched before/after records.
 * @property {Object[]} archiveFilms Changed archive source records.
 * @property {Object[]} projects Changed project records.
 * @property {Object[]} sources Changed watchlist project source records.
 * @property {Object} workflow Created intake workflow snapshot.
 * @property {Object} draftMetadata Draft marker before/after records.
 * @property {string[]} actions Previewed transition descriptions.
 */

/**
 * Declarative reversible payload. Entries without a validated payload are not
 * undoable; application always validates the recorded after-state first.
 * @typedef {EditLogFieldUndoPayload|EditLogNominationUndoPayload|EditLogWatchlistTransitionUndoPayload} EditLogUndoPayload
 */

/**
 * One user edit prepared for review and copy-back to a source sheet.
 * @typedef {Object} EditLogEntry
 * @property {string} id Timestamp-prefixed unique id.
 * @property {string} timestamp Creation time as an ISO timestamp.
 * @property {string} type Edit kind.
 * @property {string} summary User-facing description.
 * @property {string} sheetHint Source-sheet guidance.
 * @property {EditLogChange[]} changes Normalized changed fields.
 * @property {string} appliedAt Applied time as an ISO timestamp, or ''.
 * @property {Object} context Caller-owned entity context.
 * @property {EditLogTarget} [target] Stable target identity; inferred for legacy entries.
 * @property {EditLogUndoPayload|null} [undo] Reversible payload; absent or null when the edit is not undoable.
 * @property {string} [undoneAt] Undo time as an ISO timestamp, or ''.
 * @property {string} [undoEntryId] Id of the linked undo audit entry, or ''.
 */

/**
 * Bounded structured context stored by a committed import audit entry.
 * @typedef {Object} ImportHistoryContext
 * @property {'json'|'google-sheets'|'other'} sourceKind Stable source kind.
 * @property {string} source Human-readable source label.
 * @property {'merge'|'replace'} mode Committed import mode.
 * @property {'completed'|'completed-with-warnings'|'partial'} outcome Import outcome.
 * @property {string} completedAt Completion time as an ISO timestamp.
 * @property {Record<string, number>} counts Core affected-record counts.
 * @property {Object[]} ranges Bounded configured-range summaries.
 * @property {number} rangeCount Total configured-range count.
 * @property {string[]} warnings Bounded warning text.
 * @property {number} warningCount Total warning count.
 * @property {string[]} periods Bounded affected period keys.
 * @property {number} periodCount Total affected-period count.
 * @property {Object[]} restoredSections Bounded JSON replacement section counts.
 * @property {number} restoredSectionCount Total restored-section count.
 * @property {Object[]} ignoredSections Bounded JSON merge ignored-section counts.
 * @property {number} ignoredSectionCount Total ignored-section count.
 */

/**
 * One in-memory timing measurement exposed to the browser and audit tooling.
 * @typedef {Object} OskarsPerformanceEntry
 * @property {string} label Stable timer label.
 * @property {number} duration Elapsed milliseconds.
 * @property {string} extra Optional diagnostic context.
 * @property {string} path Page path and query at measurement time.
 * @property {string} timestamp Measurement time as an ISO timestamp.
 */

/**
 * Stops a performance measurement and records its elapsed duration.
 * @callback OskarsPerformanceStop
 * @param {string} [extra] Optional diagnostic context.
 * @returns {number} Elapsed milliseconds.
 */

/**
 * One configured Google Sheets range and the importer that owns it.
 * @typedef {Object} GoogleSheetRangeSpec
 * @property {string} key Stable configuration and report key.
 * @property {'list'|'table'|'watchlist'|'franchises'|'directors'} importType
 * @property {'years'|'decades'|'centuries'|'allTime'|null} [periodTypeHint]
 * @property {string} range Google Sheets A1 range.
 */

/**
 * One raw source-row sample whose field did not land after import.
 * @typedef {Object} ImportConsistencySample
 * @property {number} rowNumber One-based sheet row number.
 * @property {string} title Source title.
 * @property {string} year Source year, or ''.
 * @property {string} [value] Source field value when applicable.
 */

/**
 * Presence-only comparison of one imported field against resulting state.
 * @typedef {Object} ImportConsistencyCheck
 * @property {string} field Stable field key.
 * @property {string} label User-facing field label.
 * @property {number} sourceCount Source rows carrying the field.
 * @property {number} missingCount Source values missing after import.
 * @property {ImportConsistencySample[]} samples Bounded missing-value samples.
 */

/**
 * One metadata batch result returned by image and metadata fetchers.
 * @typedef {Object} MetadataBatchResult
 * @property {number} attempted Items attempted.
 * @property {number} found Items updated.
 * @property {number} failed Failed lookups.
 * @property {number} skipped Previously attempted items skipped.
 * @property {Array<{id: string, title: string, year: string, reason: string}>} failures
 * @property {Array<{id: string, title: string, year: string, reason: string}>} skippedItems
 */

/**
 * Import outcome shared by parsers, Google Sheets orchestration, JSON
 * transfer, report rendering, and the compact persisted snapshot.
 * @typedef {Object} ImportReport
 * @property {string} source User-facing import source.
 * @property {'merge'|'replace'|'foundation'} [mode] Import proposal mode.
 * @property {string} [rangeKey] Stable Google Sheets range key.
 * @property {string} [sheetRange] Google Sheets A1 range.
 * @property {number} [sheetRows] Visible source-row count.
 * @property {number} filmsParsed
 * @property {number} filmsAdded
 * @property {number} filmsMerged
 * @property {number} awardsAdded
 * @property {number} awardsRejected
 * @property {number} [ruleWarnings]
 * @property {number} skipped
 * @property {string[]} periods Imported period keys.
 * @property {string[]} warnings User-facing non-fatal warnings.
 * @property {Object[]} ruleViolations Rejected data-rule details.
 * @property {Object[]} titleVariants Matched title variants.
 * @property {Object[]} [ruleWarningDetails]
 * @property {Object[]} [skippedDetails]
 * @property {ImportConsistencyCheck[]} [consistency]
 * @property {Object[]} [rangeSummaries]
 * @property {Object[]} [eligibilitySummaries]
 * @property {Object[]} [restoredSections]
 * @property {Object[]} [ignoredSections]
 * @property {Object[]} [proposalChanges] Canonical section and record changes.
 * @property {Record<string, number>} [detailTotals] Pre-compaction detail counts.
 * @property {string} [generatedAt] Snapshot generation time as an ISO timestamp.
 * @property {boolean} [preview] Whether the report represents a dry run.
 * @property {boolean|Promise<boolean>} [persisted] Replacement persistence result.
 */

/**
 * One linkable metadata facet on a compare target (country, year, tag, ...).
 * @typedef {Object} CompareFacetEntry
 * @property {string} key Dedupe/equality key.
 * @property {string} label Display label.
 * @property {string} href Link target, or '' when not linkable.
 */

/**
 * One credit on a derived person record.
 * @typedef {Object} PersonCredit
 * @property {'film'|'award'} source Directing credit vs award recipient.
 * @property {string} filmId
 * @property {string} filmTitle
 * @property {string} filmYear
 * @property {string} period Award period key, or the film year.
 * @property {string} category Award category, or 'Director'.
 * @property {number|null} placement
 * @property {string} profession
 * @property {string} originalCredit Raw credited text.
 * @property {string} [detail] Role/song detail.
 * @property {string} [subjectType] Credit subject type, if any.
 * @property {string} [subjectId] Credit subject id, if any.
 */

/**
 * Aggregate award statistics (`calculateAwardStats`, src/domain/stats.js).
 * @typedef {Object} AwardStats
 * @property {number} wins Placement-1 count.
 * @property {number} second Placement-2 count.
 * @property {number} third Placement-3 count.
 * @property {number} nominations Total awards counted.
 * @property {number} awardScore
 * @property {number} normalizedAwardScore
 * @property {'Big 5'|'Big 4'|''} bigWin
 */

/**
 * Per-period-type award scores (`calculateAwardsScores`).
 * @typedef {Object} AwardScores
 * @property {number} year
 * @property {number} decade
 * @property {number} century
 * @property {number} allTime
 */

/**
 * Derived person record in `state.peopleById` (built by
 * `rebuildPeopleIndex`; read through `ensurePeopleIndex()`).
 * @typedef {Object} PersonRecord
 * @property {string} id Normalized canonical name.
 * @property {string} name Canonical display name.
 * @property {PosterRecord|null} portrait
 * @property {string} sourceUrl Directors-sheet lane URL, or ''.
 * @property {string[]} aliases Credited name variants seen.
 * @property {string[]} professions
 * @property {PersonCredit[]} credits
 * @property {string[]} filmIds Watched archive film ids.
 * @property {string[]} watchlistIds Known unwatched film ids.
 * @property {AwardStats} stats Annual-award statistics.
 * @property {AwardScores} awardScores
 * @property {RatingStatistics} ratingStatistics Complete watched-filmography rating statistics.
 */

/**
 * Derived role/song subject record in `state.creditSubjectsById`
 * (read through `ensureCreditSubjects()`).
 * @typedef {Object} CreditSubjectRecord
 * @property {string} id
 * @property {string} type Subject type (e.g. role vs song).
 * @property {string} title The role name or song title.
 * @property {Array<{id: string, title: string, year: string}>} films
 * @property {Array<{id: string, name: string}>} people
 * @property {Object[]} appearances
 * @property {Object[]} awards
 * @property {AwardStats} [stats]
 * @property {RatingStatistics} ratingStatistics Represented watched-film rating statistics.
 */

/**
 * Derived franchise record in `state.franchisesById` (built lazily by
 * `rebuildFranchiseIndex`; read through `ensureFranchiseIndex()`).
 * @typedef {Object} FranchiseRecord
 * @property {string} id
 * @property {string} name
 * @property {string} parentId First direct parent, or ''.
 * @property {string} parentName
 * @property {string[]} parentIds All direct parents (crossovers).
 * @property {string[]} parentNames
 * @property {string[]} childIds Sorted by child name.
 * @property {string} sourceUrl Franchise-sheet lane URL, or ''.
 * @property {Array<{filmId: string, rank: number|null, direct: boolean}>} films
 *   Rolled up through the ancestor chain; sorted by all-time rank/year/title.
 * @property {Array<{itemId: string, rank: number|null, direct: boolean}>} watchlistFilms
 * @property {RatingStatistics} ratingStatistics Rolled-up watched-film rating statistics.
 */

/**
 * Derived archive/watchlist collection for one normalized tag.
 * @typedef {Object} TagRecord
 * @property {string} name
 * @property {FilmRecord[]} films Unique watched films.
 * @property {WatchlistItem[]} watchlist Unique watchlist items.
 * @property {RatingStatistics} ratingStatistics Watched-film rating statistics.
 */

/**
 * Session-only reviewed import candidate.
 * @typedef {Object} ImportProposal
 * @property {number} schemaVersion Proposal contract version.
 * @property {'preview'|'applied'} status Session state.
 * @property {'google-sheets'|'json'|'delimited'|'official-results'} sourceKind Source family.
 * @property {'merge'|'replace'|'foundation'|'refresh'} mode Proposal behavior.
 * @property {string} sourceRevision Deterministic source identity.
 * @property {Object} sourceConfig Non-secret source configuration.
 * @property {string} baseCandidateRevision Local candidate identity at preview.
 * @property {string} basePublishedRevision Published base carried by the draft.
 * @property {string} candidateRevision Proposed canonical identity.
 * @property {OskarsState} candidateState Temporary proposed runtime state.
 * @property {Object[]} changes Canonical section/record changes.
 * @property {{valid: boolean, errors: Array<{path: string, message: string}>}} validation Canonical findings.
 * @property {ImportReport} report Itemized preview diagnostics.
 * @property {boolean} allowed Whether proposal can be applied.
 * @property {string} createdAt Preview time as an ISO timestamp.
 */

/**
 * Device-local convenience record for the one-time Sheets foundation.
 * @typedef {Object} ImportFoundation
 * @property {number} schemaVersion Record contract version.
 * @property {string} sourceKind Source family.
 * @property {string} sourceRevision Deterministic source identity.
 * @property {Object} sourceConfig Bounded non-secret configuration.
 * @property {string} baseRevision Published base at apply time.
 * @property {string} candidateRevision Applied canonical candidate identity.
 * @property {string} establishedAt Apply time as an ISO timestamp.
 * @property {string} status Apply/verification status.
 * @property {string} [publishedRevision] Later observed published identity.
 * @property {string} [verifiedAt] Later verification time.
 */

/**
 * Latest local attempt to stage or verify a canonical publication candidate.
 * @typedef {Object} PublicationAttempt
 * @property {string} attemptedAt Attempt time as an ISO timestamp.
 * @property {'download'|'selected-file'} method Transfer method.
 * @property {'candidate-downloaded'|'candidate-written'|'cancelled'|'failed'|'verified'} status Non-authoritative staging or later verification result.
 * @property {string} candidateRevision Candidate identity.
 * @property {string} observedRevision Publication identity observed at the attempt.
 * @property {string} [verifiedAt] Later matching startup time.
 * @property {string} [error] Failure detail.
 */

/**
 * The global application state (`window.state`). Browser persistence separates
 * canonical draft data, draft metadata, device preferences, and local state;
 * everything under "Derived" is rebuilt after every load.
 * @typedef {Object} OskarsState
 * @property {number} dataVersion Migration marker.
 * @property {number} creditSchemaVersion Migration marker.
 * @property {number} centuryRangeVersion Migration marker.
 * @property {number} adaptationSourceVersion Migration marker.
 * @property {number} watchlistOrderVersion Migration marker.
 * @property {number} groupedRankProjectionVersion Migration marker.
 * @property {number} watchedDateVersion Migration marker.
 * @property {number} viewingFactsVersion Migration marker.
 * @property {Record<string, PeriodSourceRecord>} years Source period records
 *   keyed by period key ("1950", "1970s", "1900s", "alltime").
 * @property {Record<string, OfficialResultsSource>} officialResults External historical results by source id.
 * @property {string} view Selected home/period view.
 * @property {number} leaderboardLimit
 * @property {string} peopleSearch People-page search text.
 * @property {string} peopleSort
 * @property {string} peopleProfession
 * @property {Record<string, string>} peopleAliases Variant id -> canonical name.
 * @property {Record<string, PosterRecord>} personPortraits Person id -> portrait.
 * @property {Record<string, string>} franchiseLinks Franchise id -> sheet lane URL.
 * @property {Record<string, string>} directorLinks Person id -> sheet lane URL.
 * @property {{posterFailures: number, portraitFailures: number}} imageImportStats
 * @property {EditLogEntry[]} editLog Sheet edit-log entries.
 * @property {ProjectRecord[]} projects
 * @property {string} activeProjectId Project surfaced on the home page.
 * @property {Record<string, Object>} watchlistProjectSources Stored
 *   watchlist-filter project sources keyed by project id.
 * @property {{people: Object, periods: Object, franchises: Object, tags: Object, categories: Object, projects: Object}} entityNotes
 *   Free-text notes keyed by entity id, per entity kind.
 * @property {{franchises: Record<string, string[]>, people: Record<string, string[]>, tags: Record<string, string[]>}} localRanks
 *   Explicit within-collection film order, keyed by entity id per collection
 *   kind (issue #165) - independent of the implicit global-rank-derived
 *   order every collection page also still supports. Missing/partial
 *   entries fall back to that implicit order (`mergeLocalRankOrder`,
 *   `src/domain/local-rank.js`).
 * @property {string[]} rejectedPersonAliases
 * @property {WatchlistItem[]} watchlist
 * @property {WatchedOtherEntry[]} watchedOther
 * @property {WatchedFilmIntake[]} intakeWorkflows Versioned watched-film intake records.
 * @property {{baseRevision: string, dirty: boolean, changedAt?: string, reason?: string, publishedRevision?: string, reconciliationStatus?: string, requiredAction?: string, lastCanonicalCheckAt?: string, publication?: PublicationAttempt}|null} draftMetadata Local unpublished-draft, publication attempt, and canonical reconciliation marker.
 * @property {ImportFoundation|null} importFoundation One-time local Sheets foundation source/configuration record.
 * @property {Object[]} sourceConflicts Cross-source rating/tier conflicts.
 * @property {{checkedAt: string, ranges: Array<{key: string, checks: ImportConsistencyCheck[]}>}|null} importConsistency Persisted consistency checks.
 * @property {ImportReport|null} lastImportReport Compact persisted import report.
 * @property {string} yearFilmScope 'nominees' or 'all'.
 * @property {string} filmMediumFilter
 * @property {string} filmScreenplayFilter
 * @property {string} selectedPeriodType
 * @property {string[]} selectedYears
 * @property {Record<string, FilmRecord>} filmsById Derived canonical film store.
 * @property {Record<string, PersonRecord>} peopleById Derived; use `ensurePeopleIndex()`.
 * @property {number} peopleIndexVersion Aggregate version the people index matches.
 * @property {Object[]} peopleCreditIssues Ambiguous-credit warnings.
 * @property {Object[]|null} personAliasCandidates Cached alias suggestions.
 * @property {Record<string, CreditSubjectRecord>} creditSubjectsById Derived;
 *   use `ensureCreditSubjects()`.
 * @property {number} creditSubjectsVersion
 * @property {Record<string, FranchiseRecord>} franchisesById Derived lazily;
 *   use `ensureFranchiseIndex()`.
 * @property {number} franchiseIndexVersion
 * @property {{years: Record<string, {films: PeriodFilmEntry[]}>, decades: Record<string, {films: PeriodFilmEntry[]}>, centuries: Record<string, {films: PeriodFilmEntry[]}>, allTime: {films: PeriodFilmEntry[]}}} periods
 *   Derived period index of lightweight film entries.
 * @property {number} [aggregateVersion] Incremented on every aggregate rebuild.
 */

/**
 * Creates a fresh, empty application state.
 * @returns {OskarsState}
 */
window.createEmptyState = function () {
  return {
    dataVersion: 0,
    creditSchemaVersion: 3,
    centuryRangeVersion: 0,
    adaptationSourceVersion: 0,
    watchlistOrderVersion: 0,
    groupedRankProjectionVersion: 0,
    watchedDateVersion: 0,
    viewingFactsVersion: 0,
    years: {},
    officialResults: {},
    view: "category",
    leaderboardLimit: 25,
    peopleSearch: "",
    peopleSort: "wins",
    peopleProfession: "all",
    peopleAliases: {},
    personPortraits: {},
    franchiseLinks: {},
    directorLinks: {},
    imageImportStats: { posterFailures: 0, portraitFailures: 0 },
    editLog: [],
    projects: [],
    activeProjectId: "",
    watchlistProjectSources: {},
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
    rejectedPersonAliases: [],
    watchlist: [],
    watchedOther: [],
    intakeWorkflows: [],
    draftMetadata: null,
    importFoundation: null,
    sourceConflicts: [],
    importConsistency: null,
    lastImportReport: null,
    yearFilmScope: "nominees",
    filmMediumFilter: "all",
    filmScreenplayFilter: "all",
    selectedPeriodType: "year",
    selectedYears: [],
    filmsById: {},
    peopleById: {},
    peopleIndexVersion: -1,
    peopleCreditIssues: [],
    personAliasCandidates: null,
    creditSubjectsById: {},
    creditSubjectsVersion: -1,
    franchisesById: {},
    franchiseIndexVersion: -1,
    periods: { years: {}, decades: {}, centuries: {}, allTime: { films: [] } },
  };
};

/** @type {OskarsState} */
window.state = window.createEmptyState();

/**
 * Deep-clones a plain-data record via JSON round-trip.
 * @template T
 * @param {T} value JSON-safe value (no functions, Maps, or cycles).
 * @returns {T}
 */
window.cloneRecord = function (value) {
  return JSON.parse(JSON.stringify(value));
};

// The legacy full snapshot remains the backward-compatible backup shape.
// IndexedDB/localStorage use getBrowserPersistenceState below.
/**
 * Snapshots the backward-compatible full browser backup shape.
 * @returns {Object} Plain persistable state (no derived indexes).
 */
window.getSerializableState = function () {
  return {
    dataVersion: window.state.dataVersion || 0,
    creditSchemaVersion: window.state.creditSchemaVersion || 3,
    centuryRangeVersion: window.state.centuryRangeVersion || 0,
    adaptationSourceVersion: window.state.adaptationSourceVersion || 0,
    watchlistOrderVersion: window.state.watchlistOrderVersion || 0,
    groupedRankProjectionVersion:
      window.state.groupedRankProjectionVersion || 0,
    watchedDateVersion: window.state.watchedDateVersion || 0,
    viewingFactsVersion: window.state.viewingFactsVersion || 0,
    years: window.state.years,
    officialResults: window.state.officialResults || {},
    view: window.state.view,
    leaderboardLimit: window.state.leaderboardLimit,
    peopleSearch: window.state.peopleSearch,
    peopleSort: window.state.peopleSort,
    peopleProfession: window.state.peopleProfession,
    peopleAliases: window.state.peopleAliases,
    personPortraits: window.state.personPortraits,
    franchiseLinks: window.state.franchiseLinks || {},
    directorLinks: window.state.directorLinks || {},
    imageImportStats: window.state.imageImportStats,
    editLog: window.state.editLog || [],
    projects: window.state.projects || [],
    activeProjectId: window.state.activeProjectId || "",
    watchlistProjectSources: window.state.watchlistProjectSources || {},
    entityNotes: window.state.entityNotes,
    localRanks: window.state.localRanks,
    rejectedPersonAliases: window.state.rejectedPersonAliases,
    watchlist: window.state.watchlist,
    watchedOther: window.state.watchedOther || [],
    intakeWorkflows: window.state.intakeWorkflows || [],
    draftMetadata: window.state.draftMetadata || null,
    importFoundation: window.state.importFoundation || null,
    sourceConflicts: window.state.sourceConflicts || [],
    importConsistency: window.state.importConsistency || null,
    lastImportReport: window.state.lastImportReport || null,
    yearFilmScope: window.state.yearFilmScope,
    filmMediumFilter: window.state.filmMediumFilter,
    filmScreenplayFilter: window.state.filmScreenplayFilter,
    selectedPeriodType: window.state.selectedPeriodType,
    selectedYears: window.state.selectedYears,
  };
};

window.OSKARS_WORKSPACE_SCHEMA_VERSION = 1;

/**
 * Returns device-local UI preferences separately from canonical domain data.
 * @param {OskarsState} [source] Runtime state.
 * @returns {Object} Preferences.
 */
window.getDevicePreferences = function (source = window.state) {
  return {
    activeProjectId: source.activeProjectId || "",
    view: source.view,
    leaderboardLimit: source.leaderboardLimit,
    peopleSearch: source.peopleSearch,
    peopleSort: source.peopleSort,
    peopleProfession: source.peopleProfession,
    yearFilmScope: source.yearFilmScope,
    filmMediumFilter: source.filmMediumFilter,
    filmScreenplayFilter: source.filmScreenplayFilter,
    selectedPeriodType: source.selectedPeriodType,
    selectedYears: source.selectedYears || [],
  };
};

/**
 * Returns local migrations and diagnostics that never enter canonical JSON.
 * @param {OskarsState} [source] Runtime state.
 * @returns {Object} Local state.
 */
window.getLocalWorkspaceState = function (source = window.state) {
  return {
    migrations: {
      dataVersion: source.dataVersion || 0,
      creditSchemaVersion: source.creditSchemaVersion || 3,
      centuryRangeVersion: source.centuryRangeVersion || 0,
      adaptationSourceVersion: source.adaptationSourceVersion || 0,
      watchlistOrderVersion: source.watchlistOrderVersion || 0,
      groupedRankProjectionVersion: source.groupedRankProjectionVersion || 0,
      watchedDateVersion: source.watchedDateVersion || 0,
      viewingFactsVersion: source.viewingFactsVersion || 0,
    },
    diagnostics: {
      imageImportStats: source.imageImportStats || {},
      sourceConflicts: source.sourceConflicts || [],
      importConsistency: source.importConsistency || null,
      lastImportReport: source.lastImportReport || null,
      importFoundation: source.importFoundation || null,
    },
  };
};

/**
 * Produces a stable lightweight revision for canonical comparison.
 * @param {Object} canonical Canonical document.
 * @returns {string} Revision.
 */
window.canonicalDataRevision = function (canonical) {
  let hash = 2166136261;
  let length = 0;
  function append(text) {
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
      length += 1;
    }
  }
  function visit(value, arrayEntry = false) {
    if (Array.isArray(value)) {
      append("[");
      value.forEach((entry, index) => {
        if (index) append(",");
        visit(entry, true);
      });
      append("]");
      return;
    }
    if (value && typeof value === "object") {
      append("{");
      let first = true;
      Object.keys(value)
        .sort()
        .forEach((key) => {
          if (value[key] === undefined) return;
          if (!first) append(",");
          first = false;
          append(JSON.stringify(key));
          append(":");
          visit(value[key]);
        });
      append("}");
      return;
    }
    if (typeof value === "string") value = value.replace(/\r\n?/g, "\n");
    if (Object.is(value, -0)) value = 0;
    let serialized = JSON.stringify(value);
    append(serialized === undefined && arrayEntry ? "null" : serialized || "null");
  }
  visit(canonical);
  return `fnv1a32:${(hash >>> 0).toString(16)}:${length}`;
};

/**
 * Tests whether canonical candidate data differs from its recorded base.
 * @param {Object} canonical Candidate.
 * @param {string} baseRevision Base revision.
 * @returns {boolean} Whether dirty.
 */
window.canonicalDraftDiffersFromBase = function (canonical, baseRevision) {
  return !baseRevision || window.canonicalDataRevision(canonical) !== baseRevision;
};

/**
 * Builds the versioned IndexedDB/localStorage workspace envelope.
 * @param {OskarsState} [source] Runtime state.
 * @returns {Object} Workspace.
 */
window.getBrowserPersistenceState = function (source = window.state) {
  let canonical = window.getCanonicalData(source, { clone: false });
  let existing = source.draftMetadata || {};
  let baseRevision = String(
    existing.baseRevision || window.canonicalDataRevision(canonical),
  );
  let metadata = {
    baseRevision,
    dirty: Boolean(existing.dirty),
    lastLocalSaveAt: new Date().toISOString(),
    ...(existing.changedAt ? { changedAt: existing.changedAt } : {}),
    ...(existing.reason ? { reason: existing.reason } : {}),
    ...(existing.lastPublishedRevision
      ? { lastPublishedRevision: existing.lastPublishedRevision }
      : {}),
    ...(existing.publishedRevision
      ? { publishedRevision: existing.publishedRevision }
      : {}),
    ...(existing.reconciliationStatus
      ? { reconciliationStatus: existing.reconciliationStatus }
      : {}),
    ...(existing.requiredAction
      ? { requiredAction: existing.requiredAction }
      : {}),
    ...(existing.lastCanonicalCheckAt
      ? { lastCanonicalCheckAt: existing.lastCanonicalCheckAt }
      : {}),
    ...(existing.publication
      ? { publication: window.cloneRecord(existing.publication) }
      : {}),
  };
  source.draftMetadata = window.cloneRecord(metadata);
  return {
    workspaceSchemaVersion: window.OSKARS_WORKSPACE_SCHEMA_VERSION,
    draft: { data: canonical, metadata },
    preferences: window.getDevicePreferences(source),
    local: window.getLocalWorkspaceState(source),
  };
};

/**
 * Migrates a persisted workspace or legacy snapshot to runtime source state.
 * @param {Object} stored Stored value.
 * @returns {Object} Runtime source.
 */
window.browserPersistenceToRuntimeState = function (stored) {
  if (
    stored?.workspaceSchemaVersion !== undefined &&
    stored.workspaceSchemaVersion !== window.OSKARS_WORKSPACE_SCHEMA_VERSION
  )
    throw new Error(
      `Workspace schema version ${stored.workspaceSchemaVersion} is not supported`,
    );
  if (
    stored?.workspaceSchemaVersion === window.OSKARS_WORKSPACE_SCHEMA_VERSION &&
    stored.draft?.data
  ) {
    let runtime = window.canonicalDataToRuntimeState(stored.draft.data);
    let migrations = stored.local?.migrations || {};
    let diagnostics = stored.local?.diagnostics || {};
    return Object.assign(runtime, migrations, stored.preferences || {}, diagnostics, {
      draftMetadata: window.cloneRecord(stored.draft.metadata || null),
    });
  }
  let legacy = Object.assign({}, stored || {});
  let existing = legacy.draftMetadata || {};
  let canonical = window.getCanonicalData(legacy);
  legacy.draftMetadata = {
    baseRevision: String(
      existing.baseRevision || window.canonicalDataRevision(canonical),
    ),
    dirty: Boolean(existing.dirty),
    lastLocalSaveAt: new Date().toISOString(),
    ...(existing.changedAt ? { changedAt: existing.changedAt } : {}),
    ...(existing.reason
      ? { reason: existing.reason }
      : { reason: "legacy-workspace-migration" }),
    ...(existing.lastPublishedRevision
      ? { lastPublishedRevision: existing.lastPublishedRevision }
      : {}),
    ...(existing.publishedRevision
      ? { publishedRevision: existing.publishedRevision }
      : {}),
    ...(existing.reconciliationStatus
      ? { reconciliationStatus: existing.reconciliationStatus }
      : {}),
    ...(existing.requiredAction
      ? { requiredAction: existing.requiredAction }
      : {}),
    ...(existing.lastCanonicalCheckAt
      ? { lastCanonicalCheckAt: existing.lastCanonicalCheckAt }
      : {}),
    ...(existing.publication
      ? { publication: window.cloneRecord(existing.publication) }
      : {}),
  };
  return legacy;
};
