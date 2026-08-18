/** @file Country name/code alias resolution, flag emoji, and filter-link rendering. */

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
