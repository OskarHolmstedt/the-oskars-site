/** @file Resolves imported official award recipients to existing canonical people on demand. */

(function () {
  const ACADEMY_SOURCE_ID = "academy-awards";

  function recipientNeedles(person, targetIds) {
    let values = [person?.name, ...(person?.aliases || []), ...targetIds];
    Object.entries(window.state?.peopleAliases || {}).forEach(
      ([variantId, canonicalName]) => {
        if (targetIds.has(window.resolveAwardRecipientPersonId(canonicalName)))
          values.push(variantId);
      },
    );
    return [
      ...new Set(
        values
          .map((value) =>
            String(value || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      ),
    ];
  }

  /**
   * Resolves one official recipient field to canonical person ids.
   * @param {string} recipient Imported recipient text.
   * @returns {string[]} Deduplicated canonical person ids.
   */
  window.officialRecipientPersonIds = function (recipient) {
    return window
      .resolveAwardRecipients({ recipient })
      .map((record) => record.personId);
  };

  /**
   * Derives one existing person's record from one imported official source.
   * @param {PersonRecord} person Existing derived person.
   * @param {string} sourceId Official-results source id.
   * @returns {OfficialPersonRecord} Matched official record.
   */
  window.officialPersonRecord = function (person, sourceId) {
    let source = window.state?.officialResults?.[sourceId] || null;
    let targetIds = new Set(
      [person?.id, ...(person?.aliases || [])]
        .map(window.resolveAwardRecipientPersonId)
        .filter(Boolean),
    );
    let needles = recipientNeedles(person, targetIds);
    let recipientIdCache = new Map();
    let credits = [];
    let seen = new Set();

    Object.entries(source?.periods || {}).forEach(([periodKey, period]) => {
      let representedYears = window.officialResultPeriodYears(periodKey);
      let representedYearSet = new Set(representedYears);
      (period?.nominations || []).forEach((nomination, index) => {
        let recipient = String(nomination.recipient || "");
        if (
          !recipient ||
          !needles.some((needle) => recipient.toLowerCase().includes(needle))
        )
          return;
        let recipientIds = recipientIdCache.get(recipient);
        if (!recipientIds) {
          recipientIds = window.officialRecipientPersonIds(recipient);
          recipientIdCache.set(recipient, recipientIds);
        }
        if (!recipientIds.some((personId) => targetIds.has(personId))) return;
        let key = `${periodKey}\n${nomination.id || index}`;
        if (seen.has(key)) return;
        seen.add(key);
        let filmRef = nomination.filmRef;
        let compatibleFilm =
          filmRef?.id && representedYearSet.has(String(filmRef.year || ""))
            ? filmRef
            : null;
        credits.push({
          nominationId: nomination.id || key,
          periodKey,
          ceremony: String(period.ceremony || ""),
          category: nomination.category,
          winner: Boolean(nomination.winner),
          filmId: compatibleFilm?.id || "",
          filmTitle: nomination.sourceTitle,
          filmYear: compatibleFilm?.year || representedYears[0] || "",
          recipient,
          detail: String(nomination.detail || ""),
          sourceCategory: String(nomination.sourceCategory || ""),
          sourceUrl: String(period.sourceUrl || ""),
        });
      });
    });

    credits.sort(
      (left, right) =>
        left.periodKey.localeCompare(right.periodKey, undefined, {
          numeric: true,
        }) ||
        window.categorySortIndex(left.category) -
          window.categorySortIndex(right.category) ||
        Number(right.winner) - Number(left.winner) ||
        window.compareEnglishTitles(left.filmTitle, right.filmTitle),
    );
    return {
      sourceId,
      source,
      personId: person?.id || "",
      credits,
      wins: credits.filter((credit) => credit.winner).length,
      nominations: credits.length,
      periodKeys: [...new Set(credits.map((credit) => credit.periodKey))],
    };
  };

  /**
   * Derives every populated official-source record that matches a person.
   * @param {PersonRecord} person Existing derived person.
   * @returns {OfficialPersonRecord[]} Matched records, Academy Awards first.
   */
  window.officialPersonRecords = function (person) {
    return Object.keys(window.state?.officialResults || {})
      .sort((left, right) => {
        if (left === ACADEMY_SOURCE_ID) return -1;
        if (right === ACADEMY_SOURCE_ID) return 1;
        let leftName = window.state.officialResults[left]?.name || left;
        let rightName = window.state.officialResults[right]?.name || right;
        return window.compareEnglishTitles(leftName, rightName);
      })
      .map((sourceId) => window.officialPersonRecord(person, sourceId))
      .filter((record) => record.nominations > 0);
  };

  /**
   * Derives the Academy Awards record retained for compatibility.
   * @param {PersonRecord} person Existing derived person.
   * @returns {OfficialPersonOscarRecord} Matched Academy Awards record.
   */
  window.officialPersonOscarRecord = function (person) {
    return window.officialPersonRecord(person, ACADEMY_SOURCE_ID);
  };
})();
