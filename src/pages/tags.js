/** @file Renders the archive and watchlist tag index. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();
  let tags = window.getFilmTagIndex();
  let sortValues = new Set(["title", "count", "rating"]);
  let requestedSort = window.pageQueryParam("sort");
  let sort = sortValues.has(requestedSort) ? requestedSort : "title";
  let requestedOrder = window.pageQueryParam("order");

  function defaultOrderForSort(value) {
    return value === "title" ? "asc" : "desc";
  }

  let order =
    requestedOrder === "asc" || requestedOrder === "desc"
      ? requestedOrder
      : defaultOrderForSort(sort);

  function tagsViewHref(next = {}) {
    let nextSort = next.sort || sort;
    let nextOrder = next.order || order;
    let params = [];
    if (nextSort !== "title") params.push(`sort=${encodeURIComponent(nextSort)}`);
    if (nextOrder !== defaultOrderForSort(nextSort))
      params.push(`order=${encodeURIComponent(nextOrder)}`);
    return `tags.html${params.length ? `?${params.join("&")}` : ""}`;
  }

  function sortedTags() {
    return [...tags].sort((left, right) => {
      if (sort === "rating") {
        let leftRatings = left.ratingStatistics;
        let rightRatings = right.ratingStatistics;
        if (!leftRatings.ratedCount && rightRatings.ratedCount) return 1;
        if (leftRatings.ratedCount && !rightRatings.ratedCount) return -1;
        if (leftRatings.ratedCount && rightRatings.ratedCount) {
          let ratingResult = leftRatings.mean - rightRatings.mean;
          if (order === "desc") ratingResult = -ratingResult;
          if (ratingResult) return ratingResult;
          let sampleResult = rightRatings.ratedCount - leftRatings.ratedCount;
          if (sampleResult) return sampleResult;
        }
        return left.name.localeCompare(right.name);
      }
      let result =
        sort === "count"
          ? left.films.length - right.films.length
          : left.name.localeCompare(right.name);
      if (order === "desc") result = -result;
      return result || left.name.localeCompare(right.name);
    });
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("tags:render");
    let orderedTags = sortedTags();
    let cards = orderedTags
      .map(
        (tag) =>
          `<article class="browse-index-card tag-index-card"><h2><a href="${escape(window.tagPageUrl(tag.name))}">${escape(tag.name)}</a></h2><div><b>${tag.films.length}</b> ${escape(ui(tag.films.length === 1 ? "film" : "films"))}${tag.watchlist?.length ? ` · <b>${tag.watchlist.length}</b> watchlist` : ""}</div><div><b>${escape(window.formatAverageRating(tag.ratingStatistics.mean))}</b> ${escape(ui("average rating"))} · <b>${escape(tag.ratingStatistics.ratedCount)}</b> ${escape(ui("rated"))}</div>${window.renderSourceProjectAction("tag", tag.name, { escape, compact: true })}</article>`,
      )
      .join("");
    document.title = `${ui("Tags")} · The Oskars`;
    let header = window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Tags"))}</h1><p>${escape(ui("Personal collections and themes across the film library."))}</p>`,
    });
    document.getElementById("tagsPage").innerHTML =
      `${header}${orderedTags.length ? `<form class="tags-controls"><label>${escape(ui("Sort"))} <select data-tags-sort><option value="title"${sort === "title" ? " selected" : ""}>${escape(ui("Title"))}</option><option value="count"${sort === "count" ? " selected" : ""}>${escape(ui("Watched film count"))}</option><option value="rating"${sort === "rating" ? " selected" : ""}>${escape(ui("Average rating"))}</option></select></label>${window.renderChronologyControl({ order, href: tagsViewHref({ order: order === "asc" ? "desc" : "asc" }), escape, iconOnly: true, title: order === "asc" ? ui("Sort descending") : ui("Sort ascending") })}</form>` : ""}<div class="browse-index-grid tag-index-grid">${cards || `<div class="detail-empty">${escape(ui("No film tags yet. Add them from a film’s Edit mode."))}</div>`}</div>`;
    document
      .getElementById("tagsPage")
      .querySelectorAll?.("[data-start-project-source]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          window.startProjectFromSourceAndOpen(
            button.dataset.startProjectSource,
            button.dataset.projectSourceId,
          );
        });
      });
    document
      .getElementById("tagsPage")
      .querySelector?.("[data-tags-sort]")
      ?.addEventListener("change", (event) => {
        sort = sortValues.has(event.target.value) ? event.target.value : "title";
        order = defaultOrderForSort(sort);
        window.location.href = tagsViewHref();
      });
    finishRenderTimer?.(`${tags.length} tags`);
  }

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
