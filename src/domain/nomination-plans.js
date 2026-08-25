/**
 * @file Owns the shared nomination-placement plan contract, preview text,
 * visible review boundary, stale-plan guard, and atomic application.
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

  /** Opens a focused placement review and calls the supplied action once accepted. @param {NominationPlacementPlan} plan Placement plan. @param {() => void} onApply Apply callback. @returns {boolean} Whether a valid review was opened. */
  window.reviewNominationPlacementPlan = function (plan, onApply) {
    if (!plan.ok) {
      window.alert?.(window.nominationPlacementPlanText(plan));
      return false;
    }
    let escape = window.pageEscape || ((value) => String(value ?? ""));
    let dialog = document.createElement("dialog");
    dialog.className = "nomination-placement-review";
    let heading = plan.heading
      ? ui(plan.heading)
      : plan.operation === "insert"
        ? ui("Add nomination?")
        : plan.operation === "merge"
          ? ui("Merge annual category?")
          : plan.operation === "delete"
            ? ui("Delete nomination?")
            : ui("Reorder nominations?");
    let changes = plan.changes.length
      ? `<ul>${plan.changes
          .map(
            (change) =>
              `<li><strong>${escape(changeLabel(change))}: ${escape(change.title)}</strong><span>${escape(placementText(change.before))} → ${escape(placementText(change.after))}</span></li>`,
          )
          .join("")}</ul>`
      : `<p>${escape(ui("No placement changes."))}</p>`;
    let supportingSection = (title, items, classes = "") =>
      items.length
        ? `<section class="${escape(classes)}"><h3>${escape(ui(title))}</h3><ul>${items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul></section>`
        : "";
    dialog.innerHTML = `<form method="dialog"><h2>${escape(heading)}</h2><p>${escape([plan.periodKey, plan.category].filter(Boolean).join(" · "))}</p>${changes}${supportingSection("Details", plan.notes)}${supportingSection("Warnings", plan.warnings, "nomination-placement-review-warning")}<div class="data-actions"><button type="submit" value="apply" data-nomination-review-apply>${escape(ui("Use these changes"))}</button><button type="submit" value="cancel">${escape(ui("Cancel"))}</button></div></form>`;
    let finished = false;
    function finish(apply) {
      if (finished) return;
      finished = true;
      dialog.remove();
      if (apply) onApply?.();
    }
    dialog.addEventListener("close", () => finish(dialog.returnValue === "apply"));
    dialog.addEventListener("cancel", () => finish(false));
    document.body.appendChild(dialog);
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    return true;
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
   * Atomically applies a reviewed, still-current placement plan, rebuilds
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
