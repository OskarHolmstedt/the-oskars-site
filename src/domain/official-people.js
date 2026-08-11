/** @file Resolves imported official award recipients to existing canonical people on demand. */

(function () {
  const SOURCE_ID = "academy-awards";

  function canonicalPersonId(name) {
    let variantId = window.personIdentityKey(name);
    if (!variantId) return "";
    let canonicalName = window.state?.peopleAliases?.[variantId] || name;
    return window.personIdentityKey(canonicalName);
  }

  function recipientNames(value) {
    return String(value || "")
      .split("|")
      .flatMap((part) => window.splitRecipientNames(part))
      .map((name) => name.trim())
      .filter(Boolean);
  }

  function recipientNeedles(person, targetIds) {
    let values = [person?.name, ...(person?.aliases || []), ...targetIds];
    Object.entries(window.state?.peopleAliases || {}).forEach(
      ([variantId, canonicalName]) => {
        if (targetIds.has(canonicalPersonId(canonicalName)))
          values.push(variantId);
      },
    );
    return [
      ...new Set(
        values
          .map((value) => String(value || "").trim().toLowerCase())
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
    return [
      ...new Set(
        recipientNames(recipient).map(canonicalPersonId).filter(Boolean),
      ),
    ];
  };

  /**
   * Derives one existing person's record from imported Academy Awards results.
   * @param {PersonRecord} person Existing derived person.
   * @returns {OfficialPersonOscarRecord} Matched official record.
   */
  window.officialPersonOscarRecord = function (person) {
    let source = window.state?.officialResults?.[SOURCE_ID] || null;
    let targetIds = new Set(
      [person?.id, ...(person?.aliases || [])]
        .map(canonicalPersonId)
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
        if (
          !recipientIds.some((personId) => targetIds.has(personId))
        )
          return;
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
      source,
      personId: person?.id || "",
      credits,
      wins: credits.filter((credit) => credit.winner).length,
      nominations: credits.length,
      periodKeys: [...new Set(credits.map((credit) => credit.periodKey))],
    };
  };
})();
