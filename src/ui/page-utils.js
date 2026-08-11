/** @file Owns shared page formatting, sorting, URL, control, rating, country, credit, and link helpers. */

/** Escapes a value for HTML text or attribute output. @param {*} value Value to escape. @returns {string} */
window.pageEscape = function (value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
};

/** Reads and decodes one query parameter. @param {string} name Parameter name. @returns {string} */
window.pageQueryParam = function (name) {
  let decode = (value) =>
    decodeURIComponent(String(value || "").replace(/\+/g, " "));
  let match = String(window.location?.search || "")
    .replace(/^\?/, "")
    .split("&")
    .map((part) => part.split("="))
    .find((parts) => decode(parts[0] || "") === name);
  return match ? decode(match.slice(1).join("=") || "") : "";
};

// Turns a watch-queue reason (src/domain/watch-queue.js, issue #160) into
// one full, independently localizable sentence per reason type, rather than
// gluing a translated lead-in to a translated fragment (composed sentences
// don't reliably hold together across languages). Shared by Discover's
// "Surprise me" picker (issue #161) and the watchlist view's queue panel
// (issue #163) so the two surfaces describe a pick identically.
/** Formats a watch-queue pick reason for display. @param {import('../domain/watch-queue.js').WatchQueueReason} reason Reason to format. @returns {string} */
window.watchQueueReasonText = function (reason) {
  let ui =
    window.uiText ||
    ((text, values = {}) =>
      text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""));
  if (
    reason?.type === "director-completion" ||
    reason?.type === "franchise-completion"
  )
    return ui("Picked because it is closest to finishing {name}.", {
      name: reason.params.name,
    });
  if (reason?.type === "tag-match")
    return ui('Picked because it is tagged "{tag}".', {
      tag: reason.params.tag,
    });
  if (reason?.type === "highest-tier")
    return reason.params.tier
      ? ui("Picked because it is top tier ({tier}).", {
          tier: reason.params.tier,
        })
      : ui("Picked because it is next in watchlist order.");
  if (reason?.type === "random")
    return reason.params.tier
      ? ui(
          "Picked because it is tied with others at tier {tier}, so it was picked at random.",
          { tier: reason.params.tier },
        )
      : ui(
          "Picked because it is tied with others for last place, so it was picked at random.",
        );
  return "";
};

/** Renders the copy-view-link button. @param {Object} [options] Escaping options. @returns {string} */
window.renderCopyViewLinkButton = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = window.uiText || ((text) => text);
  return `<button type="button" class="sort-order-button copy-view-link" data-copy-view-link>${escape(ui("Copy view link"))}</button>`;
};

/** Copies a view URL through the Clipboard API or a document fallback. @param {string} [href] URL to copy. @returns {Promise<boolean>} */
window.copyViewLink = async function (href = window.location?.href) {
  let value = String(href || "");
  if (!value) return false;
  if (window.navigator?.clipboard?.writeText) {
    try {
      await window.navigator.clipboard.writeText(value);
      return true;
    } catch (err) {}
  }
  if (!window.document?.createElement || !window.document?.execCommand)
    return false;
  let textarea = window.document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  window.document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = window.document.execCommand("copy");
  } catch (err) {}
  textarea.remove();
  return copied;
};

/** Renders an award placement as a medal or escaped number. @param {*} placement Placement value. @returns {string} */
window.pagePlacement = function (placement) {
  return placementEmoji[placement] || `<b>${window.pageEscape(placement)}</b>`;
};

/** Builds a surname-first person sort key. @param {*} value Person name. @returns {string} */
window.personSurnameSortKey = function (value) {
  let name = String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
  let withoutSuffix = name
    .replace(/,\s*((?:Jr|Sr)\.?|II|III|IV)\b/gi, "")
    .trim();
  let parts = withoutSuffix.split(" ").filter(Boolean);
  if (parts.length <= 1) return withoutSuffix;
  let surname = parts[parts.length - 1];
  let given = parts.slice(0, -1).join(" ");
  return `${surname}, ${given}`;
};

/** Compares person names by surname-first keys. @param {*} left Left name. @param {*} right Right name. @returns {number} */
window.comparePersonNamesBySurname = function (left, right) {
  return (
    String(window.personSurnameSortKey(left)).localeCompare(
      String(window.personSurnameSortKey(right)),
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    ) ||
    String(left || "").localeCompare(String(right || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
};

/** Builds an English title sort key with leading articles moved last. @param {*} value Title or titled object. @returns {string} */
window.englishTitleSortKey = function (value) {
  let title = String(
    value && typeof value === "object" ? value.title : value || "",
  )
    .normalize("NFKC")
    .trim();
  let articleMatch = title.match(/^(the|an|a)\s+(.+)$/i);
  if (!articleMatch) return title;
  return `${articleMatch[2]}, ${articleMatch[1]}`;
};

/** Compares English titles while ignoring leading articles. @param {*} left Left title. @param {*} right Right title. @returns {number} */
window.compareEnglishTitles = function (left, right) {
  return (
    String(window.englishTitleSortKey(left)).localeCompare(
      String(window.englishTitleSortKey(right)),
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    ) ||
    String(
      left && typeof left === "object" ? left.title : left || "",
    ).localeCompare(
      String(right && typeof right === "object" ? right.title : right || ""),
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    )
  );
};

window.countryAliases = {
  argentina: { code: "AR", name: "Argentina" },
  australia: { code: "AU", name: "Australia" },
  austria: { code: "AT", name: "Austria" },
  belgium: { code: "BE", name: "Belgium" },
  brazil: { code: "BR", name: "Brazil" },
  canada: { code: "CA", name: "Canada" },
  chile: { code: "CL", name: "Chile" },
  china: { code: "CN", name: "China" },
  colombia: { code: "CO", name: "Colombia" },
  cuba: { code: "CU", name: "Cuba" },
  czechia: { code: "CZ", name: "Czechia" },
  "czech republic": { code: "CZ", name: "Czechia" },
  denmark: { code: "DK", name: "Denmark" },
  egypt: { code: "EG", name: "Egypt" },
  finland: { code: "FI", name: "Finland" },
  france: { code: "FR", name: "France" },
  germany: { code: "DE", name: "Germany" },
  greece: { code: "GR", name: "Greece" },
  hongkong: { code: "HK", name: "Hong Kong" },
  "hong kong": { code: "HK", name: "Hong Kong" },
  hungary: { code: "HU", name: "Hungary" },
  iceland: { code: "IS", name: "Iceland" },
  india: { code: "IN", name: "India" },
  indonesia: { code: "ID", name: "Indonesia" },
  iran: { code: "IR", name: "Iran" },
  ireland: { code: "IE", name: "Ireland" },
  israel: { code: "IL", name: "Israel" },
  italy: { code: "IT", name: "Italy" },
  japan: { code: "JP", name: "Japan" },
  mexico: { code: "MX", name: "Mexico" },
  netherlands: { code: "NL", name: "Netherlands" },
  "the netherlands": { code: "NL", name: "Netherlands" },
  "new zealand": { code: "NZ", name: "New Zealand" },
  norway: { code: "NO", name: "Norway" },
  philippines: { code: "PH", name: "Philippines" },
  poland: { code: "PL", name: "Poland" },
  portugal: { code: "PT", name: "Portugal" },
  romania: { code: "RO", name: "Romania" },
  russia: { code: "RU", name: "Russia" },
  "soviet union": { code: "SU", name: "Soviet Union" },
  senegal: { code: "SN", name: "Senegal" },
  "south africa": { code: "ZA", name: "South Africa" },
  "south korea": { code: "KR", name: "South Korea" },
  korea: { code: "KR", name: "South Korea" },
  spain: { code: "ES", name: "Spain" },
  sweden: { code: "SE", name: "Sweden" },
  switzerland: { code: "CH", name: "Switzerland" },
  taiwan: { code: "TW", name: "Taiwan" },
  thailand: { code: "TH", name: "Thailand" },
  turkey: { code: "TR", name: "Turkey" },
  ukraine: { code: "UA", name: "Ukraine" },
  "united kingdom": { code: "GB", name: "United Kingdom" },
  uk: { code: "GB", name: "United Kingdom" },
  "u k": { code: "GB", name: "United Kingdom" },
  britain: { code: "GB", name: "United Kingdom" },
  "great britain": { code: "GB", name: "United Kingdom" },
  england: { code: "GB", name: "United Kingdom" },
  scotland: { code: "GB", name: "United Kingdom" },
  wales: { code: "GB", name: "United Kingdom" },
  "united states": { code: "US", name: "United States" },
  "united states of america": { code: "US", name: "United States" },
  usa: { code: "US", name: "United States" },
  "u s": { code: "US", name: "United States" },
  "u s a": { code: "US", name: "United States" },
  america: { code: "US", name: "United States" },
  us: { code: "US", name: "United States" },
  vietnam: { code: "VN", name: "Vietnam" },
  "viet nam": { code: "VN", name: "Vietnam" },
};

/** Builds a normalized country-alias lookup key. @param {*} country Country value. @returns {string} */
window.countryAliasKey = function (country) {
  return String(country || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
};

/** Resolves a country name or code to a two-letter code. @param {*} country Country value. @returns {string} */
window.countryCodeFor = function (country) {
  let raw = String(country || "").trim();
  if (!raw) return "";
  let key = window.countryAliasKey(raw);
  let alias = window.countryAliases[key];
  return alias?.code || (/^[a-z]{2}$/i.test(raw) ? raw.toUpperCase() : "");
};

/** Resolves a country alias or code to its display name. @param {*} country Country value. @returns {string} */
window.normalizeCountryName = function (country) {
  let raw = String(country || "").trim();
  if (!raw) return "";
  let key = window.countryAliasKey(raw);
  let alias = window.countryAliases[key];
  if (alias?.name) return alias.name;
  let code = /^[a-z]{2}$/i.test(raw) ? raw.toUpperCase() : "";
  let codeAlias =
    code &&
    Object.values(window.countryAliases).find((record) => record.code === code);
  if (codeAlias?.name) return codeAlias.name;
  return raw;
};

/** Returns a country's flag emoji when its code is known. @param {*} country Country value. @returns {string} */
window.countryFlagEmoji = function (country) {
  let code = window.countryCodeFor(country);
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return code.replace(/./g, (letter) =>
    String.fromCodePoint(127397 + letter.charCodeAt(0)),
  );
};

/** Returns unique flag emoji for a country list. @param {*} value Country list value. @returns {string} */
window.countryFlagList = function (value) {
  let countries = window.countryListValues(value);
  let flags = countries.map(window.countryFlagEmoji).filter(Boolean);
  return [...new Set(flags)].join(" ");
};

/** Parses and deduplicates a country list. @param {*} value Country list value. @returns {string[]} */
window.countryListValues = function (value) {
  let seen = new Set();
  return String(value || "")
    .split(/\s*(?:,|\/|;|&|\band\b|\+)\s*/i)
    .map(window.normalizeCountryName)
    .filter(
      (country) =>
        country &&
        !seen.has(window.countryAliasKey(country)) &&
        seen.add(window.countryAliasKey(country)),
    );
};

/** Resolves the primary country from a film or country value. @param {*} filmOrValue Film record or country value. @returns {string} */
window.primaryCountryValue = function (filmOrValue) {
  if (filmOrValue && typeof filmOrValue === "object") {
    return (
      window.normalizeCountryName(filmOrValue.primaryCountry) ||
      window.countryListValues(filmOrValue.country)[0] ||
      ""
    );
  }
  return window.countryListValues(filmOrValue)[0] || "";
};

/** Builds the all-time film URL filtered to a country. @param {*} country Country value. @returns {string} */
window.countryFilterUrl = function (country) {
  let countryValue = window.normalizeCountryName(country);
  return `${window.periodPageUrl("alltime", "alltime")}&view=films&scope=all&country=${encodeURIComponent(countryValue)}`;
};

/** Renders normalized countries with flag emoji. @param {*} value Country list value. @param {(value:*) => string} [escape] HTML escaper. @returns {string} */
window.renderCountryWithFlags = function (value, escape = window.pageEscape) {
  let countries = window.countryListValues(value);
  if (!countries.length) return "";
  let text = countries.join(", ");
  let flags = window.countryFlagList(countries.join(", "));
  return `${flags ? `<span class="country-flags" aria-hidden="true">${escape(flags)}</span> ` : ""}${escape(text)}`;
};

/** Renders countries as flag-bearing filter links. @param {*} value Country list value. @param {(value:*) => string} [escape] HTML escaper. @returns {string} */
window.renderCountryLinks = function (value, escape = window.pageEscape) {
  let countries = window.countryListValues(value);
  if (!countries.length) return "";
  return countries
    .map((country) => {
      let flag = window.countryFlagEmoji(country);
      return `<a class="country-link" href="${escape(window.countryFilterUrl(country))}">${flag ? `<span class="country-flags" aria-hidden="true">${escape(flag)}</span> ` : ""}${escape(country)}</a>`;
    })
    .join(", ");
};

/** Reads the validated list-or-grid view mode. @param {'list'|'grid'} [defaultMode] Fallback mode. @returns {'list'|'grid'} */
window.filmViewMode = function (defaultMode = "grid") {
  let view = window.pageQueryParam("view");
  return view === "list" || view === "grid"
    ? view
    : String(defaultMode || "grid");
};

// Split-vs-combined mode for pages that render separate watched and
// watchlist blocks (issue #52): 'split' keeps the two sections, 'combined'
// merges them into one list/grid sorted by the page's shared comparator.
/** Returns the current split-or-combined sections mode. @returns {'split'|'combined'} */
window.sectionsViewMode = function () {
  return window.pageQueryParam("sections") === "combined"
    ? "combined"
    : "split";
};

/** Renders the shared list/grid view toggle. @param {Object} [options] Mode, URLs, labels, classes, and escaping options. @returns {string} */
window.renderFilmViewToggle = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let view = String(options.view || "grid");
  let listUrl = String(options.listUrl || "#");
  let gridUrl = String(options.gridUrl || "#");
  let classes = ["film-view-toggle", options.classes || ""]
    .filter(Boolean)
    .join(" ");
  let ui = window.uiText || ((text) => text);
  let ariaLabel = String(options.ariaLabel || ui("Film display"));
  let listLabel = ui("List view");
  let gridLabel = ui("Grid view");
  let listMode = options.live ? ' data-film-view-mode="list"' : "";
  let gridMode = options.live ? ' data-film-view-mode="grid"' : "";
  return `<nav class="${escape(classes)}" aria-label="${escape(ariaLabel)}"><a href="${escape(listUrl)}" class="${view === "list" ? "active" : ""}" title="${escape(listLabel)}" aria-label="${escape(listLabel)}"${listMode}>☷</a><a href="${escape(gridUrl)}" class="${view === "grid" ? "active" : ""}" title="${escape(gridLabel)}" aria-label="${escape(gridLabel)}"${gridMode}>▦</a></nav>`;
};

/** Renders the shared bulk watchlist-tier selector and apply button. @param {Object} [options] Tier, count, and escaping options. @returns {string} */
window.renderWatchlistBulkTierControl = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let value = window.normalizeWatchlistTier?.(options.value) || "";
  let count = Number(options.count) || 0;
  let optionsHtml = [
    `<option value=""${value ? "" : " selected"}>${escape(ui("Unset"))}</option>`,
  ]
    .concat(
      (window.WATCHLIST_TIERS || []).map(
        (tier) =>
          `<option value="${escape(tier)}"${value === tier ? " selected" : ""}>${escape(tier)}</option>`,
      ),
    )
    .join("");
  return `<span class="watchlist-bulk-tier-control"><label>${escape(ui("Set filtered interest"))} <select data-watchlist-bulk-tier>${optionsHtml}</select></label><button type="button" class="sort-order-button" data-watchlist-bulk-tier-apply ${count ? "" : "disabled"}>${escape(ui("Apply"))}</button></span>`;
};

function watchlistBulkEntryItem(entry) {
  return entry?.item || entry;
}

/**
 * Previews and confirms a bulk watchlist-tier change.
 * @param {Object[]} entries Watchlist items or wrapper entries.
 * @param {string} nextTier Normalized target tier.
 * @returns {Object} Confirmation result and changed entries.
 */
window.confirmWatchlistBulkTierChange = function (entries, nextTier) {
  let ui = window.uiText || ((text) => text);
  let changed = (entries || []).filter((entry) => {
    let item = watchlistBulkEntryItem(entry);
    return item && window.normalizeWatchlistTier?.(item.tier) !== nextTier;
  });
  if (!changed.length) return { ok: false, changed };
  let label = nextTier || ui("Unset");
  let titles = changed.slice(0, 12).map((entry) => {
    let item = watchlistBulkEntryItem(entry);
    return `${item.title}${item.year ? ` (${item.year})` : ""}`;
  });
  let more =
    changed.length > titles.length
      ? `\n+${changed.length - titles.length} ${ui("more")}`
      : "";
  let message = `${ui("Set filtered interest to {tier}?", { tier: label })}\n\n${window.uiCount?.(changed.length, "film", "films") || `${changed.length} films`}\n${titles.join("\n")}${more}`;
  return { ok: window.confirm ? window.confirm(message) : true, changed };
};

/**
 * Confirms and applies a bulk watchlist-tier change.
 * @param {Object[]} entries Watchlist items or wrapper entries.
 * @param {string} nextTier Target tier.
 * @param {Object} [options] Persistence options.
 * @returns {Object} Bulk update result.
 */
window.applyWatchlistBulkTierChange = function (
  entries,
  nextTier,
  options = {},
) {
  let ui = window.uiText || ((text) => text);
  let tier = window.normalizeWatchlistTier?.(nextTier) || "";
  let preview = window.confirmWatchlistBulkTierChange(entries, tier);
  if (!preview.changed.length) {
    window.alert?.(ui("No filtered films need that interest change."));
    return { ok: false, changed: 0, cancelled: true };
  }
  if (!preview.ok)
    return { ok: false, changed: preview.changed.length, cancelled: true };
  let ids = preview.changed
    .map((entry) => {
      let item = watchlistBulkEntryItem(entry);
      return item?.id || window.watchlistItemId?.(item);
    })
    .filter(Boolean);
  let result = window.setWatchlistTierForItems?.(ids, tier, { save: false });
  if (!result?.ok) {
    if (result?.reason) window.alert?.(result.reason);
    return result || { ok: false };
  }
  if (options.save !== false)
    window.save?.({ immediate: true, rebuild: false });
  return result;
};

/**
 * Binds the standardized bulk-tier select and apply button within a page container.
 * @param {{container:Element, entries:() => Object[], rerender:(outcome:{tier:string, result:Object}) => *}} options Page-specific entry and rerender hooks.
 * @returns {{apply:(nextTier?:string) => Object, value:() => string, destroy:() => void}} Controller methods for direct use and cleanup.
 */
window.bindWatchlistBulkTierControl = function (options = {}) {
  let container = options.container;
  let selectedTier = "";

  function apply(nextTier = selectedTier) {
    selectedTier = window.normalizeWatchlistTier?.(nextTier) || "";
    let result = window.applyWatchlistBulkTierChange?.(
      options.entries?.() || [],
      selectedTier,
    );
    if (result?.ok) options.rerender?.({ tier: selectedTier, result });
    return result || { ok: false };
  }

  function onChange(event) {
    let select = event.target?.closest?.("[data-watchlist-bulk-tier]");
    if (select)
      selectedTier = window.normalizeWatchlistTier?.(select.value) || "";
  }

  function onClick(event) {
    let button = event.target?.closest?.("[data-watchlist-bulk-tier-apply]");
    if (button && !button.disabled) apply();
  }

  container?.addEventListener("change", onChange);
  container?.addEventListener("click", onClick);
  return {
    apply,
    value: () => selectedTier,
    destroy() {
      container?.removeEventListener?.("change", onChange);
      container?.removeEventListener?.("click", onClick);
    },
  };
};

/** Builds a deterministic unsigned shuffle value. @param {*} key Item key. @param {string} [seed] Shuffle seed. @returns {number} */
window.seededShuffleValue = function (key, seed = "") {
  let text = `${seed}::${key}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

// A fresh, unique-enough seed for a "reshuffle" action - every multi-film
// view's shuffle button generates one of these so each click lands on a
// genuinely different order, not just the page's initial load order.
/** Generates a fresh shuffle seed for a user action. @returns {string} */
window.freshShuffleSeed = function () {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

/** Compares two keys in a deterministic seeded shuffle. @param {*} leftKey Left key. @param {*} rightKey Right key. @param {string} [seed] Shuffle seed. @returns {number} */
window.compareBySeededShuffle = function (leftKey, rightKey, seed = "") {
  return (
    window.seededShuffleValue(leftKey, seed) -
    window.seededShuffleValue(rightKey, seed)
  );
};

/** Renders an all-time Top 250 marker when eligible. @param {FilmRecord} film Film record. @returns {string} */
window.renderTop250Marker = function (film) {
  let rank = Number(film?.allTimeRank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 250) return "";
  return `<span class="top-250-marker" title="Top 250 · All-time rank ${rank}" aria-label="Top 250, all-time rank ${rank}"><span aria-hidden="true">★</span><small>${rank}</small></span>`;
};

/** Extracts the numeric component of a period key. @param {*} value Period value. @returns {number} */
window.pagePeriodNumber = function (value) {
  return Number(String(value || "").replace(/[^0-9]/g, "")) || 0;
};

/** Parses stored or rendered film rating fields. @param {*} value Rating value or film-like record. @returns {Object} Numeric value and modifier. */
window.parseFilmRating = function (value) {
  if (value && typeof value === "object") {
    let storedValue = Number(value.ratingValue);
    if (storedValue >= 0.5 && storedValue <= 5) {
      return {
        value: storedValue,
        modifier: ["plus", "dot", "minus"].includes(value.ratingModifier)
          ? value.ratingModifier
          : "",
      };
    }
    value = value.rating;
  }
  let rawText = String(value || "").trim();
  let normalizedText = rawText.normalize("NFKC");
  let starCount = (rawText.match(/★/g) || []).length;
  let rating =
    starCount + (/[½]|1\s*[\u2044/]\s*2/.test(rawText) ? 0.5 : 0);
  if (!starCount) {
    // Typed shorthand ("4.5-", "4+", "3."): a plain decimal number,
    // optionally followed by a modifier glyph, instead of literal stars.
    let shorthand = normalizedText.match(
      /^(\d+(?:[.,]\d+)?)\s*[+＋\-–—•·.]?$/,
    );
    let numeric = shorthand ? Number(shorthand[1].replace(",", ".")) : NaN;
    if (Number.isFinite(numeric) && numeric > 0)
      rating = Math.round(numeric * 2) / 2;
  }
  let modifier = /[+＋]\s*$/.test(normalizedText)
    ? "plus"
    : /[•·.]\s*$/.test(rawText)
      ? "dot"
      : /[-–—]\s*$/.test(rawText)
        ? "minus"
        : "";
  return {
    value: rating >= 0.5 && rating <= 5 ? rating : 0,
    modifier,
  };
};

/** Renders a normalized star rating. @param {*} value Rating value or film-like record. @returns {string} */
window.renderFilmRating = function (value) {
  let parsed = window.parseFilmRating(value);
  if (!parsed.value) return "";
  let fullStars = Math.floor(parsed.value);
  let halfStar = parsed.value % 1 ? "½" : "";
  let modifier =
    parsed.modifier === "plus"
      ? "＋"
      : parsed.modifier === "dot"
        ? "•"
        : parsed.modifier === "minus"
          ? "—"
          : "";
  return `${"★".repeat(fullStars)}${halfStar}${modifier}`;
};

/**
 * Renders a star-rating input: a plain, fully keyboard-editable text field
 * (accepting literal star glyphs or typed shorthand like "4.5-") paired with
 * a clickable/sweepable star bar and a minus/dot/plus modifier toggle. Call
 * window.enhanceRatingInputs() on the containing element after inserting
 * this markup to wire up the pointer controls.
 * @param {Object} [options] Field controls.
 * @param {string} [options.name] Input name attribute.
 * @param {string} [options.value] Initial rating text.
 * @param {string} [options.id] Explicit element id (auto-generated otherwise).
 * @param {boolean} [options.required] Whether the text input is required.
 * @returns {string} Rating input widget markup.
 */
window.renderRatingInput = function (options = {}) {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let name = options.name || "rating";
  let id = options.id || `rating-input-${Math.random().toString(36).slice(2, 9)}`;
  let stars = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<button type="button" class="rating-input-star" data-rating-star="${n}" tabindex="-1" aria-hidden="true"><span class="rating-input-star-fill" aria-hidden="true">★</span><span class="rating-input-star-mask" aria-hidden="true" style="width:0%">★</span></button>`,
    )
    .join("");
  let modifiers = [
    ["minus", "−", ui("Rate slightly lower")],
    ["dot", "•", ui("Rate exactly")],
    ["plus", "＋", ui("Rate slightly higher")],
  ]
    .map(
      ([mod, glyph, label]) =>
        `<button type="button" class="rating-input-mod" data-rating-mod="${mod}" tabindex="-1" aria-hidden="true" aria-label="${escape(label)}">${glyph}</button>`,
    )
    .join("");
  return `<div class="rating-input" data-rating-input>
    <input type="text" name="${escape(name)}" id="${escape(id)}" class="rating-input-text" value="${escape(options.value || "")}" placeholder="★★★★ / 4.5-" autocomplete="off"${options.required ? " required" : ""}>
    <div class="rating-input-controls">
      <div class="rating-input-stars" role="presentation">${stars}</div>
      <div class="rating-input-mods" role="presentation">${modifiers}</div>
    </div>
  </div>`;
};

/**
 * Wires up rating-input widgets within a container so the star bar and
 * modifier toggle stay in sync with their underlying text field. Idempotent
 * (safe to call again after a re-render).
 * @param {Element} container Root element containing rendered rating-input widgets.
 */
window.enhanceRatingInputs = function (container) {
  (container?.querySelectorAll?.("[data-rating-input]") || []).forEach(
    (widget) => {
      if (widget.dataset.ratingInputReady) return;
      widget.dataset.ratingInputReady = "1";
      let input = widget.querySelector(".rating-input-text");
      let starsRow = widget.querySelector(".rating-input-stars");
      let starButtons = Array.from(widget.querySelectorAll("[data-rating-star]"));
      let modButtons = Array.from(widget.querySelectorAll("[data-rating-mod]"));

      function currentParsed() {
        return window.parseFilmRating(input.value);
      }

      function rowValueFromEvent(event) {
        let rect = starsRow.getBoundingClientRect();
        if (!rect.width) return currentParsed().value;
        let ratio = Math.min(
          1,
          Math.max(0, (event.clientX - rect.left) / rect.width),
        );
        return Math.min(5, Math.max(0.5, Math.round(ratio * 5 * 2) / 2));
      }

      function paint(previewValue) {
        let parsed = currentParsed();
        let displayValue = previewValue === undefined ? parsed.value : previewValue;
        starButtons.forEach((button) => {
          let n = Number(button.dataset.ratingStar);
          let fill = Math.min(1, Math.max(0, displayValue - (n - 1)));
          let mask = button.querySelector(".rating-input-star-mask");
          if (mask) mask.style.width = `${fill * 100}%`;
          button.classList.toggle("is-preview", previewValue !== undefined);
        });
        modButtons.forEach((button) => {
          let active =
            previewValue === undefined &&
            parsed.value > 0 &&
            button.dataset.ratingMod === parsed.modifier;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
      }

      function applyValue(nextValue, modifier) {
        let parsed = currentParsed();
        let nextModifier = modifier !== undefined ? modifier : parsed.modifier;
        input.value = nextValue
          ? window.renderFilmRating({
              ratingValue: nextValue,
              ratingModifier: nextModifier,
            })
          : "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }

      starsRow.addEventListener("mousemove", (event) => {
        paint(rowValueFromEvent(event));
      });
      starsRow.addEventListener("mouseleave", () => paint());
      starsRow.addEventListener("click", (event) => {
        let picked = rowValueFromEvent(event);
        let parsed = currentParsed();
        applyValue(picked === parsed.value ? 0 : picked);
      });

      modButtons.forEach((button) => {
        button.addEventListener("click", () => {
          let parsed = currentParsed();
          if (!parsed.value) return;
          let mod = button.dataset.ratingMod;
          applyValue(parsed.value, parsed.modifier === mod ? "" : mod);
        });
      });

      input.addEventListener("input", () => paint());
      paint();
    },
  );
};

/** Normalizes a film's rating text, value, and modifier in place. @param {FilmRecord|null|undefined} film Film record. @returns {FilmRecord|null|undefined} */
window.normalizeFilmRatingFields = function (film) {
  if (!film) return film;
  let parsed = window.parseFilmRating(film);
  if (parsed.value) {
    film.ratingValue = parsed.value;
    film.ratingModifier = parsed.modifier || "";
    film.rating = window.renderFilmRating(film);
  } else {
    delete film.ratingValue;
    delete film.ratingModifier;
    film.rating = String(film.rating || "").trim();
  }
  return film;
};

/** Returns the numeric star value of a rating. @param {*} value Rating value. @returns {number} */
window.filmRatingValue = function (value) {
  return window.parseFilmRating(value).value;
};

/** Returns the exact ordinal grade from 1 through 30 for a rated value, or zero when unrated. @param {*} value Rating value. @returns {number} */
window.filmRatingGrade = function (value) {
  let parsed = window.parseFilmRating(value);
  if (!parsed.value) return 0;
  let modifierGrade =
    parsed.modifier === "minus" ? 1 : parsed.modifier === "plus" ? 3 : 2;
  return (Math.round(parsed.value * 2) - 1) * 3 + modifierGrade;
};

/** Converts an exact grade from 1 through 30 back to a star value and modifier. @param {*} grade Rating grade. @returns {Object|null} Film-like rating fields, or null for an invalid grade. */
window.filmRatingFromGrade = function (grade) {
  let numericGrade = Number(grade);
  if (!Number.isInteger(numericGrade) || numericGrade < 1 || numericGrade > 30)
    return null;
  let index = numericGrade - 1;
  return {
    ratingValue: (Math.floor(index / 3) + 1) / 2,
    ratingModifier: ["minus", "dot", "plus"][index % 3],
  };
};

/** Returns the bounded five-point score derived from the exact 1–30 grade. @param {*} value Rating value. @returns {number} */
window.filmRatingScore = function (value) {
  return window.filmRatingGrade(value) / 6;
};

/** Returns the exact integer grade used to sort ratings. @param {*} value Rating value. @returns {number} */
window.filmRatingSortValue = function (value) {
  return window.filmRatingGrade(value);
};

/**
 * Resolves one sort-axis value for a mixed watched/watchlist row, mapping
 * both record types onto one comparable scale per axis: `rank` is the
 * all-time rank (unranked and watchlist rows sort last), `rating` is the
 * star rating for watched films and the interest tier normalized onto the
 * same higher-is-better direction for watchlist items, and the award axes
 * (`wins`/`nominations`/`score`) count 0 for watchlist rows, which carry no
 * awards of their own yet.
 * @param {FilmAxisRecord} record Row to resolve.
 * @param {'year'|'rank'|'rating'|'wins'|'nominations'|'score'} axis Sort axis.
 * @returns {number} Comparable value on the axis's natural ascending scale.
 */
window.filmAxisSortValue = function (record, axis) {
  let film = record?.film;
  if (axis === "year") return Number((film || record?.item)?.year || 0);
  if (axis === "rank") {
    let rank = Number(film?.allTimeRank);
    return Number.isFinite(rank) && rank > 0 ? rank : 999999;
  }
  if (axis === "rating") {
    if (film) return window.filmRatingScore(film.rating) || 0;
    let tierRank = window.watchlistTierRank?.(record?.item?.tier);
    return Number.isFinite(tierRank) ? 6 - tierRank : -1;
  }
  if (axis === "wins")
    return film ? window.calculateAwardStats(film.awards || []).wins || 0 : 0;
  if (axis === "nominations")
    return film
      ? window.calculateAwardStats(film.awards || []).nominations || 0
      : 0;
  if (axis === "score")
    return film
      ? window.calculateAwardStats(film.awards || []).awardScore || 0
      : 0;
  return 0;
};

/**
 * Default direction for a film sort axis: axes where a higher value is
 * better (`rating`, `wins`, `nominations`, `score`) start descending so the
 * initial view is best-first; every other axis starts ascending.
 * @param {string} axis Sort axis.
 * @returns {'asc'|'desc'} Default order for the axis.
 */
window.defaultOrderForFilmAxis = function (axis) {
  return axis === "rating" ||
    axis === "wins" ||
    axis === "nominations" ||
    axis === "score"
    ? "desc"
    : "asc";
};

/**
 * Compares two mixed watched/watchlist rows on a shared sort axis:
 * `shuffle` runs the seeded shuffle over record ids, `title` compares
 * localized titles, and every other axis resolves through
 * `filmAxisSortValue`, tie-breaking by localized title A-Z regardless of
 * `order` so reversed views keep stable title runs.
 * @param {FilmAxisRecord} left Left row.
 * @param {FilmAxisRecord} right Right row.
 * @param {Object} options Comparison options.
 * @param {string} options.axis Any `filmAxisSortValue` axis, `title`, or `shuffle`.
 * @param {'asc'|'desc'} [options.order] Direction for the primary axis.
 * @param {string} [options.seed] Seed for the `shuffle` axis.
 * @returns {number} Negative when `left` sorts first.
 */
window.compareFilmAxisRecords = function (left, right, options = {}) {
  let title = (record) =>
    window.localizedFilmTitle?.(record?.film || record?.item) ||
    (record?.film || record?.item)?.title ||
    "";
  if (options.axis === "shuffle") {
    return window.compareBySeededShuffle(
      (left?.film || left?.item)?.id,
      (right?.film || right?.item)?.id,
      options.seed || "",
    );
  }
  let result =
    options.axis === "title"
      ? window.compareEnglishTitles(title(left), title(right))
      : window.filmAxisSortValue(left, options.axis) -
        window.filmAxisSortValue(right, options.axis);
  if (options.order === "desc") result = -result;
  if (options.axis === "title") return result;
  return result || window.compareEnglishTitles(title(left), title(right));
};

/**
 * Renders sorted award recipients as person links with optional overflow.
 * @param {AwardRecord} award Award record.
 * @param {Object} [options] Display limit and expanded-state options.
 * @returns {string}
 */
window.pageLinkedRecipients = function (award, options = {}) {
  let profession = window.PERSON_AWARD_PROFESSIONS[award.category];
  let recipients = [...window.awardRecipients(award)].sort((left, right) => {
    let leftName = state.peopleAliases?.[left.personId] || left.name;
    let rightName = state.peopleAliases?.[right.personId] || right.name;
    return window.comparePersonNamesBySurname(leftName, rightName);
  });
  if (!profession) return window.pageEscape(window.awardRecipientText(award));
  let links = recipients.map((recipient) => {
    let canonicalName =
      state.peopleAliases?.[recipient.personId] || recipient.name;
    let personId = window.normalizePersonName(canonicalName);
    return `<a class="table-film-link" href="${window.pageEscape(window.personPageUrl(personId))}">${window.pageEscape(canonicalName)}</a>`;
  });
  let limit = Math.max(1, Number(options.limit) || 2);
  if (links.length <= limit || options.expanded) return links.join(", ");
  let visible = links.slice(0, limit).join(", ");
  let hidden = links.slice(limit).join(", ");
  return `<span class="recipient-credit">${visible}<details class="recipient-overflow"><summary>+${links.length - limit} more</summary><span class="recipient-overflow-list">${hidden}</span></details></span>`;
};

function displayPersonName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return (
      value.name || value.displayName || value.personName || value.title || ""
    );
  }
  return value || "";
}

/**
 * Normalizes, sorts, and truncates a person-name list for compact display.
 * @param {*} value Person name input.
 * @param {Object} [options] Sort and display-limit options.
 * @returns {Object} Full, visible, hidden, and display name representations.
 */
window.compactNameList = function (value, options = {}) {
  let names = Array.isArray(value)
    ? value.map(displayPersonName)
    : typeof value === "object" && value
      ? [displayPersonName(value)]
      : window.parsePersonCredit?.(value)?.names ||
        window.splitRecipientNames?.(value) ||
        String(value || "").split(/\s*(?:,|&|\band\b)\s*/i);
  names = names.map((name) => String(name || "").trim()).filter(Boolean);
  if (options.sort !== false) names.sort(window.comparePersonNamesBySurname);
  let limit = Math.max(1, Number(options.limit) || 2);
  let visible = names.slice(0, limit);
  let hidden = names.slice(limit);
  let fullText = names.join(", ");
  let visibleText = visible.join(", ");
  return {
    names,
    visible,
    hidden,
    fullText,
    visibleText,
    overflowCount: hidden.length,
    displayText: hidden.length
      ? `${visibleText} +${hidden.length}`
      : visibleText,
  };
};

/**
 * Renders a compact escaped name list with its full value as a tooltip.
 * @param {*} value Person name input.
 * @param {Object} [options] Compaction and escaping options.
 * @returns {string}
 */
window.renderCompactNameListText = function (value, options = {}) {
  let escape = options.escape || window.pageEscape;
  let compact = window.compactNameList(value, options);
  if (!compact.fullText) return "";
  if (!compact.overflowCount) return escape(compact.fullText);
  return `<span class="compact-name-list" title="${escape(compact.fullText)}">${escape(compact.displayText)}</span>`;
};

/**
 * Renders canonical person links with optional compact overflow. Passing
 * `assumeIndexed: true` links straight to the person page without consulting
 * the people index - correct for watched-film credits, whose people are
 * always indexed, and it keeps light list renders from forcing an index
 * rebuild just to resolve link targets.
 * @param {*} value Person name input.
 * @param {Object} [options] Compaction, fallback, expansion, and escaping options.
 * @returns {string}
 */
window.renderLinkedPeopleNames = function (value, options = {}) {
  let escape = options.escape || window.pageEscape;
  let compact = window.compactNameList(value, options);
  let links = compact.names.map((name) => {
    let personId = window.normalizePersonName?.(name) || name.toLowerCase();
    let canonicalName = state.peopleAliases?.[personId] || name;
    let canonicalId = window.normalizePersonName?.(canonicalName) || personId;
    let href =
      options.assumeIndexed ||
      (window.ensurePeopleIndex?.() || state.peopleById || {})[canonicalId]
        ? window.personPageUrl(canonicalId)
        : options.watchlistDirectorFallback &&
            window.watchlistItemsByDirector?.(canonicalName).length
          ? window.watchlistDirectorPageUrl(canonicalName)
          : window.personPageUrl(canonicalId);
    return `<a class="table-film-link" href="${escape(href)}">${escape(canonicalName)}</a>`;
  });
  if (!links.length) return "";
  if (links.length <= compact.visible.length || options.expanded)
    return links.join(", ");
  let visible = links.slice(0, compact.visible.length).join(", ");
  let hidden = links.slice(compact.visible.length).join(", ");
  return `<span class="recipient-credit" title="${escape(compact.fullText)}">${visible}<details class="recipient-overflow compact-name-overflow"><summary>+${links.length - compact.visible.length} more</summary><span class="recipient-overflow-list">${hidden}</span></details></span>`;
};

/** Builds an all-time watchlist URL filtered to a director. @param {string} name Director name. @returns {string} */
window.watchlistDirectorPageUrl = function (name) {
  return `${window.periodPageUrl("alltime", "alltime")}&view=watchlist&director=${encodeURIComponent(String(name || "").trim())}`;
};

// One chip per *leaf* membership (see leafFranchiseMemberships), showing
// the full ancestor chain (e.g. "Marvel > MCU > Phase One") with every
// level individually linked, not just the direct parent — a franchise page
// can be nested arbitrarily deep. Each level also shows a derived "#N"
// (this film's position within that franchise's own films list), since the
// sheet only ever authors a rank at the one level a row was listed under,
// never for its ancestors. Pass filmId for an archive film or itemId for a
// watchlist-only one.
/**
 * Renders linked leaf franchise chains with derived positions at each level.
 * @param {FranchiseMembership[]} franchises Franchise memberships.
 * @param {Object} [options] Film or watchlist identity and escaping options.
 * @returns {string}
 */
window.renderFranchiseMembershipLinks = function (franchises, options = {}) {
  let escape = options.escape || window.pageEscape;
  let filmId = options.filmId || "";
  let itemId = options.itemId || "";
  let franchiseIndex =
    window.ensureFranchiseIndex?.() || window.state?.franchisesById || {};
  return window
    .leafFranchiseMemberships(franchises)
    .map((membership) => {
      let levelIds = [...(membership.parentChainIds || []), membership.id];
      let levelNames = [
        ...(membership.parentChainNames || []),
        membership.name,
      ];
      let crumbs = levelIds
        .map((id, index) => {
          let isLeaf = index === levelIds.length - 1;
          let franchise = franchiseIndex?.[id];
          let name = franchise?.name || levelNames[index] || id;
          let position = window.franchiseFilmPosition?.(franchise, {
            filmId,
            itemId,
          });
          let nameHtml = isLeaf
            ? `<strong>${escape(name)}</strong>`
            : escape(name);
          let link = `<a href="${escape(window.franchisePageUrl(id))}">${nameHtml}</a>${position ? `<span>#${position}</span>` : ""}`;
          return isLeaf ? link : `${link}<span aria-hidden="true"> › </span>`;
        })
        .join("");
      return `<div>${crumbs}</div>`;
    })
    .join("");
};

/**
 * Renders linked directors from a film or name collection. This is the
 * standard Director cell renderer for film collection tables: canonical
 * person links with compact `+X` overflow (default limit 2) and the full
 * name list as the tooltip - never a raw unlimited join. Directors without
 * a person page fall back to a director-filtered watchlist link.
 * @param {FilmRecord|string|string[]} filmOrNames Film or director names.
 * @param {Object} [options] Link and compaction options.
 * @returns {string}
 */
window.renderLinkedDirectors = function (filmOrNames, options = {}) {
  // A film-like record without director credits renders as empty, never as
  // the record itself masquerading as a name.
  let names = Array.isArray(filmOrNames)
    ? filmOrNames
    : filmOrNames?.directors?.length
      ? filmOrNames.directors
      : typeof filmOrNames === "object" && filmOrNames
        ? filmOrNames.director || ""
        : filmOrNames;
  return window.renderLinkedPeopleNames(
    names,
    Object.assign({ watchlistDirectorFallback: true }, options),
  );
};
