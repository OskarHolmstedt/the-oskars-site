/**
 * @file Validates, plans, and applies safe undo for edit-log entries that
 * carry a declarative reversible payload (`EditLogUndoPayload`). Payloads are
 * plain persisted data - never code - and application always re-validates the
 * payload's `after` values against the live target, routes restores through
 * the owning domain setters, records a linked undo audit entry, and keeps the
 * original entry with its undo outcome instead of erasing history.
 */

(function () {
  const NOMINATION_UNDO_MAX_PERIODS = 24;
  const NOMINATION_UNDO_MAX_FILM_SNAPSHOTS = 256;
  const NOMINATION_UNDO_MAX_ACTIONS = 512;
  const NOMINATION_UNDO_MAX_BYTES = 1024 * 1024;

  function stableJson(value) {
    if (value === null || typeof value !== "object")
      return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }

  function nominationPeriodSignature(value) {
    let json = stableJson(value === undefined ? null : value);
    let first = 2166136261;
    let second = 2654435769;
    for (let index = 0; index < json.length; index += 1) {
      let code = json.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 2246822519);
    }
    return `${json.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
  }

  function plainJsonValue(value) {
    if (value === null) return true;
    if (["string", "number", "boolean"].includes(typeof value)) return true;
    if (Array.isArray(value)) return value.every(plainJsonValue);
    if (!value || typeof value !== "object") return false;
    let prototype = Object.getPrototypeOf(value);
    return (
      (prototype === Object.prototype || prototype === null) &&
      Object.values(value).every(plainJsonValue)
    );
  }

  function periodMetadata(period) {
    if (!period || typeof period !== "object") return null;
    let metadata = {};
    Object.keys(period).forEach((key) => {
      if (key !== "films") metadata[key] = window.cloneRecord(period[key]);
    });
    return metadata;
  }

  function structuralFilmIdentity(film) {
    return [
      String(film?.id || ""),
      String(film?.year || ""),
      window.normalizeTitle?.(film?.title) ||
        String(film?.title || "").toLowerCase(),
    ].join("\n");
  }

  function indexedStructuralFilms(period) {
    let occurrences = new Map();
    return (period?.films || []).map((film, index) => {
      let identity = structuralFilmIdentity(film);
      let occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity, occurrence + 1);
      return {
        key: `${identity}\n${occurrence}`,
        index,
        record: window.cloneRecord(film),
      };
    });
  }

  function changedStructuralFilms(before, after) {
    let beforeEntries = indexedStructuralFilms(before);
    let afterEntries = indexedStructuralFilms(after);
    let beforeByKey = new Map(beforeEntries.map((entry) => [entry.key, entry]));
    let afterByKey = new Map(afterEntries.map((entry) => [entry.key, entry]));
    let changedKeys = new Set();
    [...beforeByKey.keys(), ...afterByKey.keys()].forEach((key) => {
      if (
        stableJson(beforeByKey.get(key)?.record ?? null) !==
        stableJson(afterByKey.get(key)?.record ?? null)
      )
        changedKeys.add(key);
    });
    return {
      beforeFilms: beforeEntries.filter((entry) => changedKeys.has(entry.key)),
      afterFilms: afterEntries.filter((entry) => changedKeys.has(entry.key)),
    };
  }

  function structuralAwardCredit(award) {
    let recipients =
      window.awardRecipientText?.(award) ||
      award?.recipientText ||
      award?.recipient ||
      (award?.recipients || []).map((recipient) => recipient?.name).join(", ");
    return [recipients, award?.detail || award?.role || ""]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" · ");
  }

  function structuralAwardText(award) {
    if (!award) return "Not nominated";
    let placement = Number(award.placement);
    let credit = structuralAwardCredit(award);
    return [placement > 0 ? `#${placement}` : "Not placed", credit]
      .filter(Boolean)
      .join(" · ");
  }

  function indexedStructuralAwards(film) {
    let occurrences = new Map();
    let byKey = new Map();
    (film?.awards || []).forEach((award) => {
      let identity = [
        String(award?.year || ""),
        String(award?.periodType || ""),
        String(award?.category || ""),
      ].join("\n");
      let occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity, occurrence + 1);
      byKey.set(`${identity}\n${occurrence}`, award);
    });
    return byKey;
  }

  function structuralPeriodActions(periodKey, beforeFilms, afterFilms) {
    let beforeByKey = new Map(beforeFilms.map((entry) => [entry.key, entry]));
    let afterByKey = new Map(afterFilms.map((entry) => [entry.key, entry]));
    let actions = [];
    [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].forEach(
      (filmKey) => {
        let beforeFilm = beforeByKey.get(filmKey)?.record;
        let afterFilm = afterByKey.get(filmKey)?.record;
        let title = beforeFilm?.title || afterFilm?.title || "Untitled";
        let beforeAwards = indexedStructuralAwards(beforeFilm);
        let afterAwards = indexedStructuralAwards(afterFilm);
        [...new Set([...beforeAwards.keys(), ...afterAwards.keys()])].forEach(
          (awardKey) => {
            let beforeAward = beforeAwards.get(awardKey);
            let afterAward = afterAwards.get(awardKey);
            if (
              stableJson(beforeAward ?? null) === stableJson(afterAward ?? null)
            )
              return;
            let award = beforeAward || afterAward;
            let awardPeriod = String(award?.year || periodKey);
            let category = String(award?.category || "Nomination");
            actions.push({
              periodKey,
              category,
              title,
              label: `${periodKey} source · ${awardPeriod} · ${category} · ${title}`,
              before: structuralAwardText(beforeAward),
              after: structuralAwardText(afterAward),
            });
          },
        );
      },
    );
    return actions;
  }

  function normalizeStructuralFilmSnapshots(entries) {
    if (!Array.isArray(entries)) return null;
    let normalized = [];
    for (let entry of entries) {
      let key = String(entry?.key || "");
      let index = Number(entry?.index);
      if (
        !key ||
        !Number.isInteger(index) ||
        index < 0 ||
        !entry?.record ||
        !plainJsonValue(entry.record)
      )
        return null;
      normalized.push({
        key,
        index,
        record: window.cloneRecord(entry.record),
      });
    }
    return normalized;
  }

  function normalizeNominationPeriodsUndo(payload) {
    if (Number(payload?.version) !== 1) return null;
    let periods = Array.isArray(payload.periods) ? payload.periods : [];
    let actions = Array.isArray(payload.actions) ? payload.actions : [];
    if (
      !periods.length ||
      periods.length > NOMINATION_UNDO_MAX_PERIODS ||
      actions.length > NOMINATION_UNDO_MAX_ACTIONS
    )
      return null;
    let seenKeys = new Set();
    let filmSnapshotCount = 0;
    let normalizedPeriods = [];
    for (let period of periods) {
      let key = String(period?.key || "").trim();
      let beforeFilms = normalizeStructuralFilmSnapshots(period?.beforeFilms);
      let afterFilms = normalizeStructuralFilmSnapshots(period?.afterFilms);
      if (
        !key ||
        seenKeys.has(key) ||
        typeof period?.beforeExists !== "boolean" ||
        typeof period?.afterExists !== "boolean" ||
        !String(period?.beforeSignature || "") ||
        !String(period?.afterSignature || "") ||
        !beforeFilms ||
        !afterFilms ||
        (period.beforeMetadata !== null &&
          !plainJsonValue(period.beforeMetadata)) ||
        (period.afterMetadata !== null && !plainJsonValue(period.afterMetadata))
      )
        return null;
      seenKeys.add(key);
      filmSnapshotCount += beforeFilms.length + afterFilms.length;
      normalizedPeriods.push({
        key,
        beforeExists: period.beforeExists,
        afterExists: period.afterExists,
        beforeSignature: String(period.beforeSignature),
        afterSignature: String(period.afterSignature),
        beforeMetadata:
          period.beforeMetadata === null
            ? null
            : window.cloneRecord(period.beforeMetadata),
        afterMetadata:
          period.afterMetadata === null
            ? null
            : window.cloneRecord(period.afterMetadata),
        beforeFilms,
        afterFilms,
      });
    }
    if (filmSnapshotCount > NOMINATION_UNDO_MAX_FILM_SNAPSHOTS) return null;
    let normalizedActions = [];
    for (let action of actions) {
      let periodKey = String(action?.periodKey || "").trim();
      let category = String(action?.category || "").trim();
      let title = String(action?.title || "").trim();
      let label = String(action?.label || "").trim();
      if (!periodKey || !seenKeys.has(periodKey) || !label) return null;
      normalizedActions.push({
        periodKey,
        category,
        title,
        label,
        before: String(action?.before || ""),
        after: String(action?.after || ""),
      });
    }
    let normalized = {
      version: 1,
      kind: "nomination-periods",
      periods: normalizedPeriods,
      actions: normalizedActions,
    };
    if (JSON.stringify(normalized).length > NOMINATION_UNDO_MAX_BYTES)
      return null;
    return normalized;
  }

  /**
   * Creates a bounded structural undo payload for source-period replacements.
   * @param {Record<string, PeriodSourceRecord>} nextPeriods Replacement periods.
   * @param {Object} [options] Explicit before-period snapshots.
   * @returns {{ok: boolean, payload: EditLogUndoPayload|null, reason: string}} Payload result.
   */
  window.createNominationPeriodsUndo = function (
    nextPeriods = {},
    options = {},
  ) {
    let periods = [];
    let actions = [];
    Object.entries(nextPeriods).forEach(([key, after]) => {
      let before = Object.prototype.hasOwnProperty.call(
        options.beforePeriods || {},
        key,
      )
        ? options.beforePeriods[key]
        : window.state.years?.[key];
      if (stableJson(before ?? null) === stableJson(after ?? null)) return;
      let changed = changedStructuralFilms(before, after);
      periods.push({
        key,
        beforeExists: before !== undefined,
        afterExists: after !== undefined,
        beforeSignature: nominationPeriodSignature(before),
        afterSignature: nominationPeriodSignature(after),
        beforeMetadata: periodMetadata(before),
        afterMetadata: periodMetadata(after),
        beforeFilms: changed.beforeFilms,
        afterFilms: changed.afterFilms,
      });
      let periodActions = structuralPeriodActions(
        key,
        changed.beforeFilms,
        changed.afterFilms,
      );
      actions.push(
        ...(periodActions.length
          ? periodActions
          : [
              {
                periodKey: key,
                category: "",
                title: "",
                label: `${key} source period`,
                before: before === undefined ? "Absent" : "Previous metadata",
                after: after === undefined ? "Absent" : "Changed metadata",
              },
            ]),
      );
    });
    let payload = normalizeNominationPeriodsUndo({
      version: 1,
      kind: "nomination-periods",
      periods,
      actions,
    });
    return {
      ok: Boolean(payload),
      payload,
      reason: payload ? "" : "snapshot-limit",
    };
  };

  function plainUndoValue(value) {
    if (value === null) return true;
    let type = typeof value;
    if (type === "string" || type === "number" || type === "boolean")
      return true;
    return (
      Array.isArray(value) && value.every((item) => typeof item === "string")
    );
  }

  function comparableUndoValue(value) {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value))
      return value.map((item) => String(item ?? "").trim());
    if (typeof value === "string") return value.trim();
    return value;
  }

  function undoValuesEqual(left, right) {
    return (
      JSON.stringify(comparableUndoValue(left)) ===
      JSON.stringify(comparableUndoValue(right))
    );
  }

  function displayUndoValue(value) {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return value.filter(Boolean).join(", ");
    return String(value).trim();
  }

  function noteStoreForUndo(scope) {
    let notes = window.state.entityNotes;
    return notes && typeof notes === "object" ? notes[scope] || {} : {};
  }

  let EDIT_UNDO_KINDS = {
    "nomination-periods": {
      structural: true,
      plan: planNominationPeriodsUndo,
      apply: applyNominationPeriodsUndo,
    },
    "film-metadata": {
      targetKeys: ["filmId"],
      // Kept in sync with FILM_UNDO_FIELD_LABELS
      // (src/domain/film-metadata-editing.js) - normalizeEditLogUndo()
      // nulls out the *entire* payload if any field it contains isn't in
      // this set, so a key present in one but not the other silently
      // disables undo for any edit touching it. title/year added
      // together with that file's own allowlist (issue #454) - a film's
      // id no longer derives from them, so restoring either is now an
      // unambiguous field write. rewatchTier was already in the other
      // allowlist but missing here - a pre-existing instance of the same
      // gap, fixed alongside since it's the identical bug.
      fieldKeys: new Set([
        "title",
        "year",
        "director",
        "rating",
        "country",
        "primaryCountry",
        "url",
        "medium",
        "screenplayType",
        "adaptationSource",
        "review",
        "tags",
        "franchises",
        "wantToRewatch",
        "rewatchTier",
      ]),
      resolve(target) {
        return (
          window.findFilmById?.(target.filmId) ||
          window.findWatchedFilmById?.(target.filmId) ||
          null
        );
      },
      read(film, key) {
        if (key === "wantToRewatch") return Boolean(film.wantToRewatch);
        if (key === "tags") return [...(film.tags || [])];
        if (key === "franchises")
          return window.formatFranchiseMemberships(film.franchises);
        return String(film[key] ?? "").trim();
      },
      apply(film, restores) {
        let values = Object.assign(
          window.filmMetadataFormValues(film),
          restores,
        );
        return Boolean(
          window.updateFilmMetadata(film.id, values, { log: false }),
        );
      },
    },
    "watchlist-metadata": {
      targetKeys: ["watchlistId"],
      fieldKeys: new Set([
        "tier",
        "director",
        "tags",
        "franchises",
        "letterboxdUrl",
        "tmdbId",
        "country",
        "runtimeMinutes",
        "medium",
        "screenplayType",
        "adaptationSource",
        "swedishTitle",
        "platform",
      ]),
      resolve(target) {
        return window.findWatchlistItemById?.(target.watchlistId) || null;
      },
      read(item, key) {
        if (key === "tags") return [...(item.tags || [])];
        if (key === "franchises")
          return window.formatFranchiseMemberships(item.franchises);
        if (key === "runtimeMinutes") return item.runtimeMinutes ?? "";
        return String(item[key] ?? "").trim();
      },
      apply(item, restores) {
        return Boolean(
          window.setWatchlistMetadata(item.id, restores, {
            log: false,
            save: false,
          }),
        );
      },
    },
    "entity-note": {
      targetKeys: ["noteScope", "noteKey"],
      fieldKeys: new Set(["note"]),
      resolve(target) {
        return { scope: target.noteScope, key: target.noteKey };
      },
      read(note, key) {
        return String(noteStoreForUndo(note.scope)[note.key] || "").trim();
      },
      apply(note, restores) {
        let value = String(restores.note || "").trim();
        window.state.entityNotes ||= {};
        window.state.entityNotes[note.scope] ||= {};
        if (value) window.state.entityNotes[note.scope][note.key] = value;
        else delete window.state.entityNotes[note.scope][note.key];
        return true;
      },
    },
  };

  /**
   * Validates and normalizes a caller-supplied reversible payload into the
   * persisted declarative shape, or rejects it entirely. Unknown kinds,
   * missing identity keys, field keys outside the kind's whitelist, and
   * non-plain values all invalidate the whole payload - a partially
   * reversible payload is never stored.
   * @param {Object} [payload] Candidate EditLogUndoPayload fields.
   * @returns {EditLogUndoPayload|null} Normalized payload, or null.
   */
  window.normalizeEditLogUndo = function (payload) {
    if (!payload || typeof payload !== "object") return null;
    if (payload.kind === "nomination-periods")
      return normalizeNominationPeriodsUndo(payload);
    let kind = EDIT_UNDO_KINDS[payload.kind];
    if (!kind) return null;
    let target = {};
    for (let key of kind.targetKeys) {
      let value = String(payload.target?.[key] || "").trim();
      if (!value) return null;
      target[key] = value;
    }
    let fields = Array.isArray(payload.fields) ? payload.fields : [];
    if (!fields.length) return null;
    let normalized = [];
    for (let field of fields) {
      let key = String(field?.key || "").trim();
      if (
        !kind.fieldKeys.has(key) ||
        !plainUndoValue(field.before ?? null) ||
        !plainUndoValue(field.after ?? null)
      )
        return null;
      normalized.push({
        key,
        label: String(field.label || key).trim(),
        before: field.before ?? "",
        after: field.after ?? "",
      });
    }
    return { version: 1, kind: payload.kind, target, fields: normalized };
  };

  function structuralUndoPeriodState(snapshot) {
    let current = window.state.years?.[snapshot.key];
    let exists = current !== undefined;
    return {
      current,
      stale:
        exists !== snapshot.afterExists ||
        nominationPeriodSignature(current) !== snapshot.afterSignature,
    };
  }

  function planNominationPeriodsUndo(entry) {
    let stalePeriods = new Set();
    entry.undo.periods.forEach((snapshot) => {
      if (structuralUndoPeriodState(snapshot).stale)
        stalePeriods.add(snapshot.key);
    });
    let actions = entry.undo.actions.map((action, index) => ({
      key: `${action.periodKey}:${index}`,
      periodKey: action.periodKey,
      category: action.category,
      label: action.label,
      current: action.after,
      restore: action.before,
      stale: stalePeriods.has(action.periodKey),
    }));
    entry.undo.periods.forEach((snapshot) => {
      if (
        actions.some((action) => action.periodKey === snapshot.key) ||
        !stalePeriods.has(snapshot.key)
      )
        return;
      actions.push({
        key: `${snapshot.key}:period`,
        periodKey: snapshot.key,
        category: "",
        label: `${snapshot.key} source period`,
        current: "Changed after this edit",
        restore: "Recorded previous source period",
        stale: true,
      });
    });
    return {
      ok: stalePeriods.size === 0,
      reason: stalePeriods.size ? "stale" : "",
      entry,
      actions,
      affectedPeriods: entry.undo.periods.map((snapshot) => snapshot.key),
    };
  }

  function restoreNominationPeriod(snapshot) {
    if (!snapshot.beforeExists) return { ok: true, value: undefined };
    let current = window.cloneRecord(window.state.years[snapshot.key]);
    let films = [...(current?.films || [])];
    let afterFilms = [...snapshot.afterFilms].sort(
      (left, right) => right.index - left.index,
    );
    for (let entry of afterFilms) {
      if (stableJson(films[entry.index] ?? null) !== stableJson(entry.record))
        return { ok: false };
      films.splice(entry.index, 1);
    }
    [...snapshot.beforeFilms]
      .sort((left, right) => left.index - right.index)
      .forEach((entry) => {
        films.splice(entry.index, 0, window.cloneRecord(entry.record));
      });
    let value = Object.assign({}, window.cloneRecord(snapshot.beforeMetadata), {
      films,
    });
    if (nominationPeriodSignature(value) !== snapshot.beforeSignature)
      return { ok: false };
    return { ok: true, value };
  }

  function applyNominationPeriodsUndo(payload) {
    let replacements = new Map();
    for (let snapshot of payload.periods) {
      if (structuralUndoPeriodState(snapshot).stale) return false;
      let restored = restoreNominationPeriod(snapshot);
      if (!restored.ok) return false;
      replacements.set(snapshot.key, restored.value);
    }
    let previous = new Map(
      payload.periods.map((snapshot) => [
        snapshot.key,
        window.state.years?.[snapshot.key] === undefined
          ? undefined
          : window.cloneRecord(window.state.years[snapshot.key]),
      ]),
    );
    try {
      replacements.forEach((period, key) => {
        if (period === undefined) delete window.state.years[key];
        else window.state.years[key] = window.cloneRecord(period);
      });
      window.markAggregatesDirty?.("structural nomination undo applied");
      window.ensureAggregatesFresh?.();
      return true;
    } catch (error) {
      previous.forEach((period, key) => {
        if (period === undefined) delete window.state.years[key];
        else window.state.years[key] = period;
      });
      window.markAggregatesDirty?.("structural nomination undo rolled back");
      window.ensureAggregatesFresh?.();
      throw error;
    }
  }

  /**
   * Reports whether an edit-log entry is currently offered for undo.
   * @param {EditLogEntry} entry Edit-log entry.
   * @returns {{status: 'ready'|'undone'|'unsupported'}} Availability status.
   */
  window.editUndoState = function (entry) {
    if (!entry || typeof entry !== "object") return { status: "unsupported" };
    if (entry.undoneAt) return { status: "undone" };
    if (!entry.undo || !EDIT_UNDO_KINDS[entry.undo.kind])
      return { status: "unsupported" };
    return { status: "ready" };
  };

  /**
   * Plans an undo without mutating data or history: resolves the target,
   * reads every current value, and validates it against the payload's
   * `after` values so intervening edits surface as a stale plan.
   * @param {string} entryId Edit-log entry id.
   * @returns {Object} Plan with `ok`, `reason`, `entry`, and per-field `actions` (`key`, `label`, `current`, `restore`, `stale`).
   */
  window.planEditUndo = function (entryId) {
    let entry = (window.state.editLog || []).find(
      (candidate) => candidate.id === String(entryId || ""),
    );
    if (!entry) return { ok: false, reason: "missing-entry" };
    let status = window.editUndoState(entry).status;
    if (status === "undone")
      return { ok: false, reason: "already-undone", entry };
    if (status !== "ready") return { ok: false, reason: "unsupported", entry };
    let kind = EDIT_UNDO_KINDS[entry.undo.kind];
    if (kind.structural) return kind.plan(entry);
    let record = kind.resolve(entry.undo.target);
    if (!record) return { ok: false, reason: "missing-target", entry };
    let stale = false;
    let actions = entry.undo.fields.map((field) => {
      let current = kind.read(record, field.key);
      let fieldStale = !undoValuesEqual(current, field.after);
      stale = stale || fieldStale;
      return {
        key: field.key,
        label: field.label,
        current: displayUndoValue(current),
        restore: displayUndoValue(field.before),
        stale: fieldStale,
      };
    });
    if (stale) return { ok: false, reason: "stale", entry, actions };
    return { ok: true, reason: "", entry, actions };
  };

  /**
   * Applies a planned undo atomically: re-plans, routes every restored field
   * through the owning domain setter in one pass, records a linked undo
   * audit entry, and marks the original entry undone. Does not save; the
   * caller persists once. A failed plan is returned unchanged and nothing is
   * mutated.
   * @param {string} entryId Edit-log entry id.
   * @returns {Object} The plan, extended with `auditEntry` on success.
   */
  window.applyEditUndo = function (entryId) {
    let plan = window.planEditUndo(entryId);
    if (!plan.ok) return plan;
    let entry = plan.entry;
    let kind = EDIT_UNDO_KINDS[entry.undo.kind];
    if (kind.structural) {
      if (!kind.apply(entry.undo))
        return {
          ok: false,
          reason: "apply-failed",
          entry,
          actions: plan.actions,
        };
    } else {
      let record = kind.resolve(entry.undo.target);
      let restores = {};
      entry.undo.fields.forEach((field) => {
        restores[field.key] = field.before;
      });
      if (!kind.apply(record, restores))
        return {
          ok: false,
          reason: "apply-failed",
          entry,
          actions: plan.actions,
        };
    }
    let auditEntry = window.recordEdit({
      type: "undo",
      summary: `Undo · ${entry.summary}`,
      sheetHint: entry.sheetHint,
      changes: plan.actions.map((action) => ({
        field: action.label,
        before: action.current,
        after: action.restore,
      })),
      target: window.normalizeEditLogTarget(entry),
      context: Object.assign({}, entry.context, { undoOf: entry.id }),
    });
    entry.undoneAt = auditEntry.timestamp;
    entry.undoEntryId = auditEntry.id;
    plan.auditEntry = auditEntry;
    return plan;
  };
})();
