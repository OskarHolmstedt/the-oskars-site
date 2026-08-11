/** @file Controls the dedicated watched-film intake queue, guided steps, and completion actions. */

(function () {
  let container = document.getElementById("intakePage");
  let ui =
    window.uiText ||
    ((text, values = {}) =>
      String(text).replace(/\{(\w+)\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
      ));
  let escape = window.pageEscape;
  let pendingRankingPlacement = null;
  let pendingAnnualPlacement = null;
  let pendingAnnualRecipientDraft = null;
  let draggedRankingFilmId = "";
  let draggedAnnualFilmId = "";

  function statusLabel(status) {
    return ui(
      {
        pending: "Pending",
        complete: "Complete",
        none: "Reviewed; none",
        "not-applicable": "Not applicable",
      }[status] || status,
    );
  }

  function periodHref(film, level, workflowId) {
    let year = window.filmConcreteYear?.(film.year) || String(film.year || "");
    let type = level;
    let key = year;
    if (level === "decade") key = window.getDecadeKey(year);
    if (level === "century") key = window.getCenturyKey(year);
    if (level === "allTime") {
      type = "alltime";
      key = "alltime";
    }
    return `${window.periodPageUrl(type, key)}&returnIntake=${encodeURIComponent(workflowId)}`;
  }

  function stepList(workflow) {
    let entries = [
      [ui("Rating and viewing facts"), workflow.steps.rating.status],
      [ui("Global ranking"), workflow.steps.ranking.status],
      ...["year", "decade", "century", "allTime"].map((level) => [
        ui("{level} awards", {
          level: ui(
            level === "allTime"
              ? "All-time"
              : level[0].toUpperCase() + level.slice(1),
          ),
        }),
        workflow.steps.awards[level].status,
      ]),
    ];
    return `<ol class="edit-log-change-list">${entries
      .map(
        ([label, status]) =>
          `<li><strong>${escape(label)}</strong><span>${escape(statusLabel(status))}</span></li>`,
      )
      .join("")}</ol>`;
  }

  function placementInsertionIndex(board, placement) {
    if (!placement) return 0;
    let targetIndex = board.candidates.findIndex(
      (film) => film.id === placement.targetFilmId,
    );
    return targetIndex < 0
      ? -1
      : targetIndex + (placement.position === "after" ? 1 : 0);
  }

  function placementForInsertionIndex(board, insertionIndex) {
    if (!board.candidates.length) return null;
    if (insertionIndex >= board.candidates.length) {
      let last = board.candidates[board.candidates.length - 1];
      return {
        workflowId: board.workflow.id,
        targetFilmId: last.id,
        position: "after",
      };
    }
    return {
      workflowId: board.workflow.id,
      targetFilmId: board.candidates[insertionIndex].id,
      position: "before",
    };
  }

  function rankingPlacement(board) {
    if (
      pendingRankingPlacement?.workflowId === board.workflow.id &&
      board.candidates.some(
        (film) => film.id === pendingRankingPlacement.targetFilmId,
      ) &&
      placementInsertionIndex(board, pendingRankingPlacement) >=
        board.constraint.minimumInsertionIndex &&
      placementInsertionIndex(board, pendingRankingPlacement) <=
        board.constraint.maximumInsertionIndex
    )
      return pendingRankingPlacement;
    return placementForInsertionIndex(
      board,
      board.constraint.maximumInsertionIndex,
    );
  }

  function rankingPlacementEntries(board, placement) {
    let entries = board.candidates.map((film, candidateIndex) => ({
      film,
      current: false,
      candidateIndex,
      anchor: board.constraint.anchor?.id === film.id,
    }));
    let current = { film: board.film, current: true };
    if (!placement) return [...entries, current];
    let index = entries.findIndex(
      (entry) => entry.film.id === placement.targetFilmId,
    );
    if (index < 0) return [...entries, current];
    entries.splice(placement.position === "after" ? index + 1 : index, 0, current);
    return entries;
  }

  function rankingPlacementAttributes(entry, board) {
    if (entry.current)
      return {
        draggable: "true",
        "data-intake-ranking-film": entry.film.id,
        "aria-label": ui("Drag {title} to its {level} position", {
          title: entry.film.title,
          level: ui(board.level),
        }),
      };
    let allowed =
      entry.candidateIndex >= board.constraint.minimumInsertionIndex &&
      entry.candidateIndex <= board.constraint.maximumInsertionIndex;
    return {
      ...(allowed ? { "data-intake-ranking-target": entry.film.id } : {}),
      ...(entry.anchor
        ? { "data-intake-ranking-anchor": board.constraint.sourceLevel }
        : {}),
    };
  }

  function rankingPlacementAction(entry, board) {
    if (entry.current)
      return `<span class="intake-ranking-current-label">${escape(ui("New film"))}</span>`;
    let allowed =
      entry.candidateIndex >= board.constraint.minimumInsertionIndex &&
      entry.candidateIndex <= board.constraint.maximumInsertionIndex;
    let sourceLevel = ui(
      board.constraint.sourceLevel === "year"
        ? "Year"
        : board.constraint.sourceLevel === "decade"
          ? "Decade"
          : "Century",
    );
    let anchor = entry.anchor
      ? `<span class="intake-ranking-anchor-label">${escape(ui("{level} anchor", { level: sourceLevel }))}</span>`
      : "";
    if (!allowed)
      return `${anchor}<button type="button" class="intake-ranking-place-button is-locked" disabled>${escape(ui("Locked by {level} decision", { level: sourceLevel.toLowerCase() }))}</button>`;
    return `${anchor}<button type="button" class="intake-ranking-place-button" data-intake-place-before="${escape(entry.film.id)}" aria-label="${escape(ui("Place {title} before {target}", { title: entry.intakeTitle, target: entry.film.title }))}">${escape(ui("Place here"))}</button>`;
  }

  function rankingPlacementGrid(entries, board) {
    return `<div class="film-grid period-film-grid intake-ranking-grid">${entries
      .map((entry, index) =>
        window.renderSharedFilmCard(entry.film, {
          classes: [
            "intake-ranking-card",
            entry.current ? "is-current" : "is-target",
            entry.anchor ? "is-anchor" : "",
          ],
          attributes: rankingPlacementAttributes(entry, board),
          openFilm: false,
          rankLabel: `${index + 1}.`,
          showYear: true,
          director:
            entry.film.director || (entry.film.directors || []).join(", "),
          bodyHtml: rankingPlacementAction(entry, board),
          escape,
        }),
      )
      .join("")}</div>`;
  }

  function rankingPlacementList(entries, board) {
    let rows = entries
      .map((entry, index) => {
        let attrs = Object.entries(rankingPlacementAttributes(entry, board))
          .map(([name, value]) => ` ${name}="${escape(value)}"`)
          .join("");
        let directors =
          entry.film.director || (entry.film.directors || []).join(", ");
        return `<tr class="intake-ranking-row ${entry.current ? "is-current" : "is-target"} ${entry.anchor ? "is-anchor" : ""}"${attrs}><td class="leaderboard-position">${index + 1}</td>${window.renderFilmIdentityCell(entry.film, { escape, year: true, allTimeRank: true })}<td class="film-people-cell">${window.renderLinkedDirectors(directors, { escape })}</td>${window.renderRatingTierCell({ film: entry.film }, { escape })}<td>${rankingPlacementAction(entry, board)}</td></tr>`;
      })
      .join("");
    return window.renderLeaderboardTable({
      headers: [ui("Rank"), ui("Film"), ui("Director"), ui("Rating"), ""].map(
        escape,
      ),
      rows,
      classes: ["intake-ranking-table"],
    });
  }

  function rankingBookend(film, label) {
    if (!film) return "";
    return `<div class="intake-ranking-bookend"><span>${escape(label)}</span>${window.renderSharedFilmCard(film, { classes: ["intake-ranking-bookend-card"], poster: false, openFilm: false, showYear: true, director: film.director || (film.directors || []).join(", "), escape })}</div>`;
  }

  function visualRankingGuide(workflow) {
    let board = window.watchedIntakeRankingBoard(workflow.id);
    if (!board.ok) {
      let level = ui(
        board.level === "decade"
          ? "Decade"
          : board.level === "century"
            ? "Century"
            : board.level === "allTime"
              ? "All-time"
              : "Year",
      );
      let sourceLevel = ui(
        board.constraint?.sourceLevel === "century"
          ? "Century"
          : board.constraint?.sourceLevel === "decade"
            ? "Decade"
            : "Year",
      );
      return `<section class="intake-ranking-board" data-intake-ranking-stale-anchor><span class="eyebrow">${escape(ui("{level} ranking", { level }))}</span><h3>${escape(ui("The recorded {level} anchor is no longer available", { level: sourceLevel.toLowerCase() }))}</h3><p>${escape(ui("Restore the referenced film or reopen the intake from the {level} step before continuing.", { level: sourceLevel.toLowerCase() }))}</p></section>`;
    }
    let placement = rankingPlacement(board);
    let entries = rankingPlacementEntries(board, placement);
    entries.forEach((entry) => {
      entry.intakeTitle = board.film.title;
    });
    let currentPosition = entries.findIndex((entry) => entry.current) + 1;
    let layout = window.pageQueryParam?.("layout") === "list" ? "list" : "grid";
    let pageUrl = window.intakePageUrl(workflow.id);
    let controls = window.renderFilmViewToggle({
      view: layout,
      listUrl: `${pageUrl}&layout=list`,
      gridUrl: `${pageUrl}&layout=grid`,
      ariaLabel: ui("{level} ranking display", {
        level: ui(
          board.level === "year"
            ? "Year"
            : board.level === "decade"
              ? "Decade"
              : board.level === "century"
                ? "Century"
                : "All-time",
        ),
      }),
      escape,
    });
    let hidden = placement
      ? `<input type="hidden" name="targetFilmId" value="${escape(placement.targetFilmId)}"><input type="hidden" name="position" value="${escape(placement.position)}">`
      : "";
    let isYear = board.level === "year";
    let levelLabel = ui(
      isYear
        ? "Year"
        : board.level === "decade"
          ? "Decade"
          : board.level === "century"
            ? "Century"
            : "All-time",
    );
    let sourceLabel = ui(
      board.constraint.sourceLevel === "year"
        ? "Year"
        : board.constraint.sourceLevel === "decade"
          ? "Decade"
          : "Century",
    );
    let nextLabel = ui(
      board.level === "year"
        ? "Decade"
        : board.level === "decade"
          ? "Century"
          : board.level === "century"
            ? "All-time"
            : "Annual awards",
    );
    let heading = ui(
      board.level === "allTime"
        ? "Place {title} among all {rating} films"
        : isYear
          ? "Place {title} among the {rating} films of {period}"
          : "Place {title} among the {rating} films of the {period}",
      {
        title: board.film.title,
        rating: window.renderFilmRating(board.film),
        period: board.scopeKey,
      },
    );
    let constraintText = isYear
      ? ui("The new film starts at the bottom. Drag it upward or use Place here, then continue when the order feels right.")
      : board.constraint.status === "unconstrained"
        ? ui("No {source} comparator existed, so the full {target} range is available.", {
            source: sourceLabel.toLowerCase(),
            target: levelLabel.toLowerCase(),
          })
        : ui(
            board.constraint.position === "before"
              ? "{source} decision: {title} must stay before {anchor}. Only positions through that anchor are available."
              : "{source} decision: {title} must stay after {anchor}. Only positions after that anchor are available.",
            { source: sourceLabel, title: board.film.title, anchor: board.constraint.anchor.title },
          );
    let bottomPlacement = placementForInsertionIndex(
      board,
      board.constraint.maximumInsertionIndex,
    );
    let overallBottomLocked =
      board.candidates.length &&
      board.constraint.maximumInsertionIndex < board.candidates.length
        ? `<button type="button" class="intake-ranking-bottom-button is-locked" disabled>${escape(ui("Overall bottom locked by {level} decision", { level: sourceLabel.toLowerCase() }))}</button>`
        : "";
    let footer = board.candidates.length
      ? board.level === "allTime"
        ? ui("Continue applies this position as the canonical global rank.")
        : ui("Your {level} decision narrows the next {next} board.", {
            level: levelLabel.toLowerCase(),
            next: nextLabel.toLowerCase(),
          })
      : ui("No same-rating films exist in this {level}, so this step will be marked not applicable.", {
          level: levelLabel.toLowerCase(),
        });
    return `<form class="intake-ranking-board" data-intake-ranking="${escape(workflow.id)}" data-intake-ranking-level="${escape(board.level)}"><div class="intake-ranking-heading"><div><span class="eyebrow">${escape(ui("{level} ranking", { level: levelLabel }))}</span><h3>${escape(heading)}</h3><p>${escape(constraintText)}</p></div>${controls}</div><div class="intake-ranking-bookends">${rankingBookend(board.bookends.higher, ui("Nearest higher rating"))}${rankingBookend(board.bookends.lower, ui("Nearest lower rating"))}</div>${layout === "list" ? rankingPlacementList(entries, board) : rankingPlacementGrid(entries, board)}<p class="intake-ranking-position" aria-live="polite">${escape(ui("Selected position: {position} of {count}", { position: currentPosition, count: entries.length }))}</p><button type="button" class="intake-ranking-bottom-button" data-intake-place-bottom="${escape(workflow.id)}" ${bottomPlacement ? "" : "disabled"}>${escape(ui(isYear || board.constraint.status === "unconstrained" ? "Place at bottom" : "Place at bottom of allowed range"))}</button>${overallBottomLocked}${hidden}<div class="intake-ranking-footer"><p>${escape(footer)}</p><button type="submit">${escape(ui("Continue to {level}", { level: nextLabel.toLowerCase() }))}</button></div></form>`;
  }

  // Returns null when nothing has been explicitly chosen and no default
  // placement fits (the category is full, issue #187) - the caller must not
  // invent a default position that silently displaces the current
  // last-place nominee - or when explicitly toggled off the board. An
  // explicit choice (drag-drop, "Place here", or "Place at bottom") always
  // produces a real 1..capacity placement, handled by the first branch below.
  function annualPlacement(guide) {
    let pending =
      pendingAnnualPlacement?.workflowId === guide.workflow.id &&
      pendingAnnualPlacement.category === guide.category
        ? pendingAnnualPlacement
        : null;
    if (pending?.off) return null;
    if (pending && Number(pending.placement) >= 1 && Number(pending.placement) <= guide.capacity)
      return Number(pending.placement);
    let bottom = guide.entries.reduce(
      (placement, entry) =>
        Math.max(placement, Number(entry.award.placement) + 1),
      1,
    );
    return bottom > guide.capacity ? null : bottom;
  }

  function annualNomineeCard(entry, guide, selectedPlacement) {
    let placement = Number(entry.award.placement);
    let displayedPlacement =
      placement >= selectedPlacement ? placement + 1 : placement;
    // Keep a bumped nominee visible at the bottom instead of hiding it, so
    // reconsidering the placement (or choosing "Previous"/toggling off)
    // before advancing doesn't require re-deriving who would be lost.
    let dropsOut = displayedPlacement > guide.capacity;
    let credit = window.renderPeriodAwardCredit?.(
      entry,
      guide.category,
      escape,
    );
    return `<div class="card intake-award-nominee${dropsOut ? " will-drop" : ""}" data-intake-award-target="${escape(placement)}"><span class="${window.placementEmoji[displayedPlacement] ? "rank medal" : "rank numeric"}">${window.placementEmoji[displayedPlacement] || escape(displayedPlacement)}</span>${credit ? `${credit}<span class="separator">—</span>` : ""}<a class="table-film-link${credit ? " nominee-film-link" : ""}" href="${escape(window.filmPageUrl(entry.film.id))}">${escape(entry.film.title)}</a>${dropsOut ? `<span class="intake-award-drop-label">${escape(ui("Drops out"))}</span>` : `<button type="button" class="intake-ranking-place-button" data-intake-award-place-before="${escape(placement)}" aria-label="${escape(ui("Nominate {title} before {target}", { title: guide.film.title, target: entry.film.title }))}">${escape(ui("Place here"))}</button>`}</div>`;
  }

  function periodWord(level) {
    return ui(level === "allTime" ? "all-time" : level);
  }

  function capitalizeWord(text) {
    return text ? text[0].toUpperCase() + text.slice(1) : text;
  }

  // Every placement control (place-here, place-bottom, the off-board
  // toggle, drag-drop) fully re-renders the award form, which would
  // otherwise silently drop whatever the reviewer already typed into
  // recipient/detail before choosing a position (issue #192). Snapshot the
  // in-progress text right before re-rendering so it survives.
  function captureAnnualRecipientDraft(workflowId, category) {
    let form = container.querySelector("[data-intake-annual-award]");
    if (
      !form ||
      form.dataset.intakeAnnualAward !== workflowId ||
      form.dataset.intakeAwardCategory !== category
    )
      return;
    pendingAnnualRecipientDraft = {
      workflowId,
      category,
      recipient: form.querySelector('[name="recipient"]')?.value || "",
      detail: form.querySelector('[name="detail"]')?.value || "",
    };
  }

  function annualAwardsGuide(workflow, level = "year") {
    let guide = window.watchedIntakeAnnualAwardsGuide(workflow.id, level);
    let levelWord = capitalizeWord(periodWord(level));
    if (!guide.ok)
      return `<section class="intake-award-review"><h3>${escape(ui("{level} awards review is unavailable", { level: levelWord }))}</h3><p>${escape(ui("Restore the film year or ranking decision before continuing."))}</p></section>`;
    if (!guide.current) {
      let nextLevel = ["year", "decade", "century", "allTime"][
        ["year", "decade", "century", "allTime"].indexOf(level) + 1
      ];
      let finishLabel = nextLevel
        ? ui("Continue to {level} awards", { level: periodWord(nextLevel) })
        : ui("Finish awards review");
      return `<section class="intake-award-review"><h3>${escape(ui("{level} awards review is ready to finish", { level: levelWord }))}</h3><p>${escape(ui("Every eligible category has been reviewed."))}</p><button type="button" data-intake-award-finish="${escape(workflow.id)}" data-intake-award-level="${escape(level)}">${escape(finishLabel)}</button></section>`;
    }
    let priorPlacementText = guide.priorPlacement
      ? ui("Placed #{placement} of {capacity} at {level} level.", {
          placement: guide.priorPlacement.placement,
          capacity: guide.priorPlacement.capacity,
          level: periodWord(guide.priorPlacement.level),
        })
      : "";
    let placement = annualPlacement(guide);
    // A full category with nothing explicitly chosen (issue #187), or the
    // film explicitly toggled off the board (issue #191): show every
    // existing nominee untouched and the new film waiting outside the
    // board, instead of inventing a default that silently bumps whoever
    // currently holds the last slot.
    let unplaced = placement === null;
    let boardFull =
      guide.entries.reduce(
        (bottom, entry) => Math.max(bottom, Number(entry.award.placement) + 1),
        1,
      ) > guide.capacity;
    let displayPlacement = unplaced ? Infinity : placement;
    let before = unplaced
      ? guide.entries
      : guide.entries.filter((entry) => Number(entry.award.placement) < placement);
    let after = unplaced
      ? []
      : guide.entries.filter((entry) => Number(entry.award.placement) >= placement);
    let currentCard = unplaced
      ? ""
      : `<div class="card intake-award-current" draggable="true" data-intake-award-film="${escape(guide.film.id)}" aria-label="${escape(ui("Drag {title} to its {category} position", { title: guide.film.title, category: window.localizedCategoryName?.(guide.category) || guide.category }))}"><span class="${window.placementEmoji[placement] ? "rank medal" : "rank numeric"}">${window.placementEmoji[placement] || escape(placement)}</span><span class="table-film-link">${escape(guide.film.title)}</span><span class="intake-ranking-current-label">${escape(ui("New nominee"))}</span></div>`;
    let unplacedCard = unplaced
      ? `<div class="intake-award-unplaced-row"><div class="card intake-award-current" draggable="true" data-intake-award-film="${escape(guide.film.id)}" aria-label="${escape(ui("Drag {title} onto a nominee below to nominate it in that position", { title: guide.film.title }))}"><span class="table-film-link">${escape(guide.film.title)}</span><span class="intake-ranking-current-label">${escape(boardFull ? ui("New nominee — not yet placed") : ui("Not nominating"))}</span></div></div>`
      : "";
    let warnings = guide.warnings.length
      ? `<ul class="intake-award-warnings">${guide.warnings
          .map((warning) => `<li>${escape(warning)}</li>`)
          .join("")}</ul>`
      : "";
    let recipientDraft =
      pendingAnnualRecipientDraft?.workflowId === workflow.id &&
      pendingAnnualRecipientDraft.category === guide.category
        ? pendingAnnualRecipientDraft
        : null;
    // Promoting a category into a broader level (decade/century/all-time)
    // prefills the recipient/detail from the nomination it's promoting, so
    // credit carries forward instead of being retyped blank each level
    // (issue #186).
    let sourceRecipient = guide.sourceAward
      ? window.awardRecipientText(guide.sourceAward)
      : "";
    let sourceDetail = guide.sourceAward
      ? window.awardDetail(guide.sourceAward)
      : "";
    let defaultRecipient =
      recipientDraft?.recipient ||
      sourceRecipient ||
      (guide.category === "Best Director"
        ? (guide.film.directors || []).join(", ") || guide.film.director || ""
        : "");
    let defaultDetail = recipientDraft?.detail || sourceDetail || "";
    // Only acting categories and Best Song take a second identifying field
    // (issue #192) - everywhere else the generic "detail" isn't meaningful,
    // so the field is left out of the form entirely rather than mislabeled.
    let subjectType = window.creditSubjectType(
      guide.category,
      window.PERSON_AWARD_PROFESSIONS[guide.category],
    );
    let detailFieldHtml =
      subjectType === "role"
        ? `<label class="data-field">${escape(ui("Role"))}<input name="detail" value="${escape(defaultDetail)}"></label>`
        : subjectType === "song"
          ? `<label class="data-field">${escape(ui("Song title"))}<input name="detail" value="${escape(defaultDetail)}"></label>`
          : "";
    let hasNominatedHere = guide.decisions.some(
      (decision) =>
        decision.category === guide.category && decision.action === "nominate",
    );
    let subtitleText =
      guide.multiNominee && hasNominatedHere
        ? ui("Add another nominee for this category, or move to the next category.")
        : ui("Place the watched film in this bracket, or move to the next category without nominating it.");
    let positionText = !unplaced
      ? ui("Selected nomination: #{position} of {capacity}", { position: placement, capacity: guide.capacity })
      : boardFull
        ? ui(
            "{category} is full ({capacity}/{capacity}). Drag the new nominee onto a film below, or use “Place here” or “Place at bottom” - the nominee it displaces will drop out.",
            {
              category: window.localizedCategoryName?.(guide.category) || guide.category,
              capacity: guide.capacity,
            },
          )
        : ui("Not nominating {title} for {category}. Choose a position to change your mind.", {
            title: guide.film.title,
            category: window.localizedCategoryName?.(guide.category) || guide.category,
          });
    return `<form class="intake-award-review" data-intake-annual-award="${escape(workflow.id)}" data-intake-award-category="${escape(guide.category)}" data-intake-award-level="${escape(level)}"><div class="intake-ranking-heading"><div><span class="eyebrow">${escape(ui("{level} awards", { level: levelWord }))}</span><h3>${escape(ui("Category {current} of {total}", { current: Math.min(guide.reviewed + 1, guide.eligible.length), total: guide.eligible.length }))}: ${escape(window.localizedCategoryName?.(guide.category) || guide.category)}</h3><p>${escape(subtitleText)}</p>${priorPlacementText ? `<p class="intake-award-prior-placement">${escape(priorPlacementText)}</p>` : ""}</div><a class="button-link" href="${escape(periodHref(guide.film, level, workflow.id))}">${escape(ui("Open full {level} bracket", { level: periodWord(level) }))}</a></div>${warnings}<div class="board full-width intake-award-board" data-category-board="${escape(guide.category)}"><a class="category-link" href="${escape(window.categoryPageUrl(guide.category))}"><b>${escape(window.localizedCategoryName?.(guide.category) || guide.category)}</b></a><div class="board-content"><div class="board-nominees">${before.map((entry) => annualNomineeCard(entry, guide, displayPlacement)).join("")}${currentCard}${after.map((entry) => annualNomineeCard(entry, guide, displayPlacement)).join("")}</div>${unplacedCard}</div></div><p class="intake-ranking-position" aria-live="polite">${escape(positionText)}</p><div class="intake-award-placement-actions"><button type="button" class="intake-ranking-bottom-button" data-intake-award-place-bottom="${escape(workflow.id)}">${escape(ui("Place at bottom"))}</button>${unplaced ? "" : `<button type="button" class="intake-ranking-bottom-button" data-intake-award-skip-placement="${escape(workflow.id)}">${escape(ui("Don't nominate"))}</button>`}</div><input type="hidden" name="placement" value="${escape(placement ?? "")}"><label class="data-field">${escape(ui("Recipient(s)"))}<input name="recipient" value="${escape(defaultRecipient)}"></label>${detailFieldHtml}<div class="intake-ranking-footer"><button type="button" class="button-secondary" data-intake-award-previous="${escape(workflow.id)}" data-intake-award-level="${escape(level)}" ${guide.decisions.length ? "" : "disabled"}>${escape(ui("Previous category"))}</button><button type="submit">${escape(ui("Next category"))}</button></div></form>`;
  }

  function guide(workflow) {
    let film = window.watchedIntakeFilm(workflow);
    if (!film)
      return `<p class="data-panel-status">${escape(ui("The watched film for this intake no longer exists."))}</p>`;
    if (workflow.completedAt)
      return `<section class="film-edit-section"><h3>${escape(ui("Completed intake"))}</h3><p>${escape(workflow.summary || ui("No completion summary recorded."))}</p><p class="data-panel-status">${escape(workflow.completedAt)}</p><button type="button" data-intake-reopen="${escape(workflow.id)}">${escape(ui("Reopen intake"))}</button></section>`;
    if (workflow.steps.rating.status !== "complete")
      return `<form class="data-form" data-intake-rating="${escape(workflow.id)}"><h3>${escape(ui("Next: confirm rating and viewing facts"))}</h3><label class="data-field">${escape(ui("Rating"))}${window.renderRatingInput({ value: film.rating || "", required: true })}</label><label class="data-field">${escape(ui("Date watched"))}<input name="dateWatched" type="date" value="${escape(film.dateWatched || "")}"></label><label class="data-field">${escape(ui("Platform"))}<input name="platform" value="${escape(film.platform || "")}"></label><label class="data-field">${escape(ui("Views"))}<input name="views" type="number" min="1" value="${escape(film.views || 1)}"></label><button type="submit">${escape(ui("Confirm rating"))}</button></form>`;
    if (workflow.steps.ranking.status === "pending") {
      let rankingGuide = window.watchedIntakeRankingGuide(workflow.id);
      if (["year", "decade", "century", "allTime"].includes(rankingGuide.level))
        return visualRankingGuide(workflow);
      let options = (rankingGuide.candidates || [])
        .map(
          (candidate) =>
            `<option value="${escape(candidate.id)}">#${escape(candidate.allTimeRank || "—")} ${escape(candidate.title)} (${escape(candidate.year || "")})</option>`,
        )
        .join("");
      return `<form class="data-form" data-intake-ranking="${escape(workflow.id)}"><h3>${escape(ui("Next: {level} ranking comparison", { level: ui(rankingGuide.level === "allTime" ? "all-time" : rankingGuide.level) }))}</h3><p>${escape(ui("Only films with the exact same rating are eligible. Earlier cohort decisions narrow the final global insertion."))}</p>${options ? `<label class="data-field">${escape(ui("Comparison film"))}<select name="targetFilmId">${options}</select></label><label class="data-field">${escape(ui("Place watched film"))}<select name="position"><option value="before">${escape(ui("Before comparison"))}</option><option value="after">${escape(ui("After comparison"))}</option></select></label>` : `<p class="data-panel-status">${escape(ui("No exact-rating films exist in this cohort; mark it not applicable."))}</p>`}<button type="submit">${escape(options ? ui("Record comparison") : ui("Mark not applicable"))}</button></form>`;
    }
    let awardLevel = ["year", "decade", "century", "allTime"].find(
      (level) => workflow.steps.awards[level].status === "pending",
    );
    if (awardLevel) return annualAwardsGuide(workflow, awardLevel);
    let completion = window.planWatchedIntakeCompletion(workflow.id);
    return `<section class="film-edit-section"><h3>${escape(ui("Ready to complete"))}</h3><p>${escape(completion.summary || "")}</p><button type="button" data-intake-complete="${escape(workflow.id)}">${escape(ui("Complete intake"))}</button></section>`;
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("intake:render");
    let workflows = window.state.intakeWorkflows || [];
    let requested = window.pageQueryParam?.("intake") || "";
    let selected =
      window.findWatchedIntakeWorkflow(requested) ||
      window.openWatchedIntakeWorkflows()[0] ||
      workflows[0] ||
      null;
    let queue = workflows
      .map((workflow) => {
        let film = window.watchedIntakeFilm(workflow);
        return `<a class="project-membership-card" href="${escape(window.intakePageUrl(workflow.id))}"><span><strong>${escape(film?.title || workflow.filmId)}</strong><small>${escape(workflow.source === "fresh" ? ui("Fresh watched film") : ui("From watchlist"))}</small></span><span class="project-status-badge project-status-badge--${workflow.completedAt ? "open" : "active"}">${escape(workflow.completedAt ? ui("Complete") : ui("Open"))}</span></a>`;
      })
      .join("");
    container.innerHTML = `<div class="edit-log-heading"><div><h2>${escape(ui("Watched-film intake"))}</h2><p>${escape(ui("Finish rating, one progressive global rank, and explicit awards review for every newly watched film."))}</p></div><details><summary class="button-link">${escape(ui("Add watched film"))}</summary><form class="data-form" data-fresh-watched-film><label class="data-field">${escape(ui("Title"))}<input name="title" required></label><label class="data-field">${escape(ui("Release year"))}<input name="year" type="number" min="1888" max="2100" required></label><label class="data-field">${escape(ui("Director(s)"))}<input name="director"></label><label class="data-field">TMDB ID<input name="tmdbId"></label><label class="data-field">${escape(ui("Rating"))}${window.renderRatingInput({})}</label><button type="submit">${escape(ui("Preview and add"))}</button></form></details></div><div class="project-membership-list">${queue || `<p>${escape(ui("No watched-film intakes yet."))}</p>`}</div>${selected ? `<section class="film-edit-section"><h3>${escape(window.watchedIntakeFilm(selected)?.title || selected.filmId)}</h3>${stepList(selected)}${guide(selected)}</section>` : ""}`;
    window.enhanceRatingInputs?.(container);
    finishRenderTimer?.(`${workflows.length} workflow(s)`);
  }

  async function persist() {
    let saving = window.save({ immediate: true });
    if (saving?.then) await saving;
    render();
  }

  container.addEventListener("submit", async (event) => {
    let freshForm = event.target.closest("[data-fresh-watched-film]");
    let ratingForm = event.target.closest("[data-intake-rating]");
    let rankingForm = event.target.closest("[data-intake-ranking]");
    let annualAwardForm = event.target.closest("[data-intake-annual-award]");
    if (!freshForm && !ratingForm && !rankingForm && !annualAwardForm) return;
    event.preventDefault();
    let values = Object.fromEntries(new FormData(event.target).entries());
    let result;
    if (freshForm) {
      let plan = window.planFreshWatchedFilm(values);
      if (!plan.ok) return alert(plan.errors.join("\n"));
      result = window.applyFreshWatchedFilm(plan, { save: false });
    } else if (ratingForm) {
      result = window.completeWatchedIntakeRating(
        ratingForm.dataset.intakeRating,
        values,
        { save: false },
      );
    } else if (rankingForm) {
      result = window.recordWatchedIntakeRankingDecision(
        rankingForm.dataset.intakeRanking,
        values,
        { save: false },
      );
      if (result?.ok) pendingRankingPlacement = null;
    } else {
      // "Next" is one action: nominate-and-advance when the film is
      // currently placed on the board, skip-and-advance when it isn't
      // (issue #191) - the board itself is the preview, so no separate
      // confirmation dialog.
      let awardLevel = annualAwardForm.dataset.intakeAwardLevel || "year";
      let workflowId = annualAwardForm.dataset.intakeAnnualAward;
      let category = annualAwardForm.dataset.intakeAwardCategory;
      if (values.placement) {
        let plan = window.planWatchedIntakeAnnualNomination(
          workflowId,
          values,
          awardLevel,
        );
        if (!plan.ok) {
          alert(window.nominationPlacementPlanText?.(plan) || ui("The nomination could not be applied."));
          return;
        }
        let applied = window.applyNominationPlacementPlan(plan);
        if (!applied.ok) {
          alert(applied.reason || ui("The nomination could not be applied."));
          return;
        }
        result = window.recordWatchedIntakeAnnualAwardDecision(
          workflowId,
          {
            category,
            action: "nominate",
            auditEntryId: applied.auditEntry?.id,
          },
          { save: false, level: awardLevel },
        );
      } else {
        result = window.recordWatchedIntakeAnnualAwardDecision(
          workflowId,
          { category, action: "skip" },
          { save: false, level: awardLevel },
        );
      }
      if (result?.ok) {
        pendingAnnualPlacement = null;
        pendingAnnualRecipientDraft = null;
      }
    }
    if (!result?.ok) {
      alert(
        result?.reason === "rating-required"
          ? ui("A valid rating is required before ranking.")
          : ui("The intake step could not be saved. Refresh and try again."),
      );
      return;
    }
    await persist();
  });

  container.addEventListener("click", async (event) => {
    let awardPlaceBefore = event.target.closest(
      "[data-intake-award-place-before]",
    );
    let awardPlaceBottom = event.target.closest(
      "[data-intake-award-place-bottom]",
    );
    if (awardPlaceBefore || awardPlaceBottom) {
      let form = event.target.closest("[data-intake-annual-award]");
      let guide = window.watchedIntakeAnnualAwardsGuide(
        form?.dataset.intakeAnnualAward,
        form?.dataset.intakeAwardLevel || "year",
      );
      if (guide.ok && guide.current) {
        let placement = awardPlaceBefore
          ? Number(awardPlaceBefore.dataset.intakeAwardPlaceBefore)
          : Math.min(
              guide.capacity,
              guide.entries.reduce(
                (bottom, entry) =>
                  Math.max(bottom, Number(entry.award.placement) + 1),
                1,
              ),
            );
        captureAnnualRecipientDraft(guide.workflow.id, guide.category);
        pendingAnnualPlacement = {
          workflowId: guide.workflow.id,
          category: guide.category,
          placement,
        };
        render();
      }
      return;
    }
    let awardSkipPlacement = event.target.closest(
      "[data-intake-award-skip-placement]",
    );
    if (awardSkipPlacement) {
      let form = event.target.closest("[data-intake-annual-award]");
      if (form) {
        captureAnnualRecipientDraft(
          form.dataset.intakeAnnualAward,
          form.dataset.intakeAwardCategory,
        );
        pendingAnnualPlacement = {
          workflowId: form.dataset.intakeAnnualAward,
          category: form.dataset.intakeAwardCategory,
          placement: null,
          off: true,
        };
        render();
      }
      return;
    }
    let awardPrevious = event.target.closest("[data-intake-award-previous]");
    if (awardPrevious) {
      let result = window.previousWatchedIntakeAnnualCategory(
        awardPrevious.dataset.intakeAwardPrevious,
        awardPrevious.dataset.intakeAwardLevel || "year",
        { save: false },
      );
      if (!result?.ok) {
        alert(ui("The intake step could not be saved. Refresh and try again."));
        return;
      }
      pendingAnnualPlacement = null;
      pendingAnnualRecipientDraft = null;
      await persist();
      return;
    }
    let awardFinish = event.target.closest("[data-intake-award-finish]");
    if (awardFinish) {
      let result = window.finishWatchedIntakeAnnualAwards(
        awardFinish.dataset.intakeAwardFinish,
        { save: false, level: awardFinish.dataset.intakeAwardLevel || "year" },
      );
      if (!result?.ok) {
        alert(ui("The intake step could not be saved. Refresh and try again."));
        return;
      }
      await persist();
      return;
    }
    let placeBefore = event.target.closest("[data-intake-place-before]");
    let placeBottom = event.target.closest("[data-intake-place-bottom]");
    if (placeBefore || placeBottom) {
      let workflow = window.findWatchedIntakeWorkflow(
        placeBottom?.dataset.intakePlaceBottom ||
          event.target.closest("[data-intake-ranking]")?.dataset.intakeRanking,
      );
      let board = window.watchedIntakeRankingBoard(workflow?.id);
      let target = placeBefore?.dataset.intakePlaceBefore;
      let position = "before";
      if (placeBottom) {
        let bottom = placementForInsertionIndex(
          board,
          board.constraint.maximumInsertionIndex,
        );
        target = bottom?.targetFilmId;
        position = bottom?.position;
      }
      if (board.ok && target) {
        pendingRankingPlacement = {
          workflowId: workflow.id,
          targetFilmId: target,
          position,
        };
        render();
      }
      return;
    }
    let complete = event.target.closest("[data-intake-complete]");
    let reopen = event.target.closest("[data-intake-reopen]");
    if (!complete && !reopen) return;
    let result = complete
      ? window.completeWatchedIntake(complete.dataset.intakeComplete, {
          save: false,
        })
      : window.reopenWatchedIntake(reopen.dataset.intakeReopen, {
          save: false,
        });
    if (!result?.ok) {
      alert(ui("The intake step could not be saved. Refresh and try again."));
      return;
    }
    await persist();
  });

  container.addEventListener("dragstart", (event) => {
    let annualFilm = event.target.closest("[data-intake-award-film]");
    if (annualFilm) {
      draggedAnnualFilmId = annualFilm.dataset.intakeAwardFilm;
      event.dataTransfer?.setData("text/plain", draggedAnnualFilmId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      annualFilm.classList.add("dragging");
      return;
    }
    let film = event.target.closest("[data-intake-ranking-film]");
    if (!film) return;
    draggedRankingFilmId = film.dataset.intakeRankingFilm;
    event.dataTransfer?.setData("text/plain", draggedRankingFilmId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    film.classList.add("dragging");
  });

  container.addEventListener("dragend", (event) => {
    event.target
      .closest("[data-intake-award-film]")
      ?.classList.remove("dragging");
    draggedAnnualFilmId = "";
    event.target
      .closest("[data-intake-ranking-film]")
      ?.classList.remove("dragging");
    draggedRankingFilmId = "";
  });

  container.addEventListener("dragover", (event) => {
    let annualTarget = event.target.closest("[data-intake-award-target]");
    if (annualTarget && draggedAnnualFilmId) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      annualTarget.classList.add("drop-target");
      return;
    }
    let target = event.target.closest("[data-intake-ranking-target]");
    if (!target || !draggedRankingFilmId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    target.classList.add("drop-target");
  });

  container.addEventListener("dragleave", (event) => {
    event.target
      .closest("[data-intake-award-target]")
      ?.classList.remove("drop-target");
    event.target
      .closest("[data-intake-ranking-target]")
      ?.classList.remove("drop-target");
  });

  container.addEventListener("drop", (event) => {
    let annualTarget = event.target.closest("[data-intake-award-target]");
    if (annualTarget && draggedAnnualFilmId) {
      event.preventDefault();
      let form = annualTarget.closest("[data-intake-annual-award]");
      captureAnnualRecipientDraft(
        form.dataset.intakeAnnualAward,
        form.dataset.intakeAwardCategory,
      );
      pendingAnnualPlacement = {
        workflowId: form.dataset.intakeAnnualAward,
        category: form.dataset.intakeAwardCategory,
        placement: Number(annualTarget.dataset.intakeAwardTarget),
      };
      draggedAnnualFilmId = "";
      render();
      return;
    }
    let target = event.target.closest("[data-intake-ranking-target]");
    if (!target || !draggedRankingFilmId) return;
    event.preventDefault();
    let form = target.closest("[data-intake-ranking]");
    pendingRankingPlacement = {
      workflowId: form.dataset.intakeRanking,
      targetFilmId: target.dataset.intakeRankingTarget,
      position: "before",
    };
    draggedRankingFilmId = "";
    render();
  });

  render();
})();
