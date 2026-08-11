/**
 * @file Owns the shared nomination-placement plan contract, preview text,
 * confirmation boundary, stale-plan guard, and atomic application.
 */

(function () {
  function ui(fallback, values = {}) {
    if (window.uiText) return window.uiText(fallback, values);
    return Object.entries(values).reduce(
      (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
      fallback,
    );
  }

  function sourceSignature(value) {
    return JSON.stringify(value === undefined ? null : value);
  }

  function placementText(value) {
    return Number(value) > 0 ? `#${Number(value)}` : ui("Not placed");
  }

  function changeLabel(change) {
    return change.kind === "added"
      ? ui("Added")
      : change.kind === "removed"
        ? ui("Removed")
        : ui("Moved");
  }

  /**
   * Normalizes a planner's operation-specific fields onto the shared placement
   * plan contract and captures signatures for stale-plan detection.
   * @param {Object} values Planner fields.
   * @returns {NominationPlacementPlan} Normalized plan.
   */
  window.createNominationPlacementPlan = function (values = {}) {
    let nextPeriods = values.nextPeriods || {};
    let sourceSignatures = {};
    let signatureKeys = new Set([
      ...Object.keys(nextPeriods),
      ...(values.sourceKeys || []).map(String),
    ]);
    signatureKeys.forEach((key) => {
      sourceSignatures[key] = sourceSignature(window.state.years?.[key]);
    });
    let errors = (values.errors || []).filter(Boolean);
    return {
      operation: values.operation || "reorder",
      ok: values.ok !== false && errors.length === 0,
      periodType: values.periodType || "years",
      periodKey: String(values.periodKey || ""),
      category: String(values.category || ""),
      changes: values.changes || [],
      notes: (values.notes || []).filter(Boolean),
      warnings: (values.warnings || []).filter(Boolean),
      errors,
      nextPeriods,
      sourceSignatures,
      editType: values.editType || "award placement edit",
      heading: String(values.heading || "").trim(),
      summary: String(values.summary || "").trim(),
      sheetHint: String(values.sheetHint || "").trim(),
      context: values.context || {},
      logChanges: values.logChanges || [],
      result: values.result || {},
      applied: false,
    };
  };

  /**
   * Formats every proposed placement change and validation finding for review.
   * @param {NominationPlacementPlan} plan Placement plan.
   * @returns {string} Multi-line preview text.
   */
  window.nominationPlacementPlanText = function (plan) {
    let heading = plan.heading
      ? ui(plan.heading)
      : plan.operation === "insert"
        ? ui("Add nomination?")
        : plan.operation === "merge"
          ? ui("Merge annual category?")
        : plan.operation === "delete"
          ? ui("Delete nomination?")
          : ui("Reorder nominations?");
    let lines = [
      heading,
      "",
      [plan.periodKey, plan.category].filter(Boolean).join(" · "),
    ];
    if (plan.changes.length) {
      lines.push("", ui("Changes"));
      plan.changes.forEach((change) => {
        lines.push(
          `${changeLabel(change)} · ${change.title}: ${placementText(change.before)} → ${placementText(change.after)}`,
        );
      });
    } else {
      lines.push("", ui("No placement changes."));
    }
    if (plan.notes.length)
      lines.push("", ui("Details"), ...plan.notes.map((item) => `• ${item}`));
    if (plan.warnings.length)
      lines.push("", ui("Warnings"), ...plan.warnings.map((item) => `• ${item}`));
    if (plan.errors.length)
      lines.push("", ui("Blocked"), ...plan.errors.map((item) => `• ${item}`));
    return lines.join("\n");
  };

  /**
   * Shows a blocking alert or confirmation preview without applying the plan.
   * @param {NominationPlacementPlan} plan Placement plan.
   * @returns {boolean} Whether the user confirmed a valid plan.
   */
  window.confirmNominationPlacementPlan = function (plan) {
    let text = window.nominationPlacementPlanText(plan);
    if (!plan.ok) {
      window.alert?.(text);
      return false;
    }
    return window.confirm ? window.confirm(text) : true;
  };

  function editLogChanges(plan) {
    let placements = plan.changes.map((change) => ({
      field: `${change.title} placement`,
      before: Number(change.before) > 0 ? String(change.before) : "",
      after: Number(change.after) > 0 ? String(change.after) : "",
    }));
    return [...placements, ...(plan.logChanges || [])];
  }

  /**
   * Atomically applies a confirmed, still-current placement plan, rebuilds
   * derived state once, and records one complete edit-log entry.
   * @param {NominationPlacementPlan} plan Confirmed placement plan.
   * @returns {Object} Application outcome.
   */
  window.applyNominationPlacementPlan = function (plan) {
    if (!plan?.ok || plan.applied)
      return { ok: false, reason: ui("Placement plan is not applicable.") };
    let stale = Object.keys(plan.sourceSignatures).some(
      (key) =>
        sourceSignature(window.state.years?.[key]) !==
        plan.sourceSignatures[key],
    );
    if (stale)
      return {
        ok: false,
        reason: ui("Nomination data changed. Preview the operation again."),
      };
    let undoPreflight = window.createNominationPeriodsUndo?.(plan.nextPeriods);
    if (!undoPreflight?.ok)
      return {
        ok: false,
        reason: ui(
          "A safe undo snapshot could not be recorded for this operation.",
        ),
      };

    let previousPeriods = {};
    Object.keys(plan.nextPeriods).forEach((key) => {
      previousPeriods[key] =
        window.state.years?.[key] === undefined
          ? undefined
          : window.cloneRecord(window.state.years[key]);
    });
    let previousEditLog = window.cloneRecord(window.state.editLog || []);
    try {
      Object.entries(plan.nextPeriods).forEach(([key, period]) => {
        window.state.years[key] = window.cloneRecord(period);
      });
      window.markAggregatesDirty?.("nomination placement plan applied");
      window.ensureAggregatesFresh?.();
      let appliedPeriods = {};
      Object.keys(plan.nextPeriods).forEach((key) => {
        appliedPeriods[key] = window.state.years?.[key];
      });
      let undoResult = window.createNominationPeriodsUndo?.(appliedPeriods, {
        beforePeriods: previousPeriods,
      });
      if (!undoResult?.ok)
        throw new Error(
          ui("A safe undo snapshot could not be recorded for this operation."),
        );
      let auditEntry = null;
      if (window.recordEdit) {
        auditEntry = window.recordEdit({
          type: plan.editType,
          summary: plan.summary,
          sheetHint: plan.sheetHint,
          changes: editLogChanges(plan),
          context: plan.context,
          undo: undoResult.payload,
        });
        if (!auditEntry.undo)
          throw new Error(
            ui("A safe undo snapshot could not be recorded for this operation."),
          );
      }
      plan.applied = true;
      return Object.assign({ ok: true, plan, auditEntry }, plan.result || {});
    } catch (error) {
      Object.entries(previousPeriods).forEach(([key, period]) => {
        if (period === undefined) delete window.state.years[key];
        else window.state.years[key] = period;
      });
      window.state.editLog = previousEditLog;
      window.markAggregatesDirty?.("nomination placement plan rolled back");
      window.ensureAggregatesFresh?.();
      throw error;
    }
  };
})();
