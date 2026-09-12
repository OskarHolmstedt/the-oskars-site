/**
 * @file Normalizes award recipients, person identity, credit details, and legacy credit schema.
 */

/** Returns an award's role, song, or work detail. @param {AwardRecord|null} award Award. @returns {string} Detail text. */
window.awardDetail = function (award) {
  return String(award?.detail ?? award?.role ?? "").trim();
};

/** Removes a trailing parenthetical person disambiguator. @param {*} value Name value. @returns {string} Display name. */
window.stripPersonDisambiguator = function (value) {
  return String(value || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
};

/** Splits recipient text into person names. @param {*} value Recipient text. @returns {string[]} Names. */
window.splitRecipientNames = function (value) {
  let original = String(value || "").trim();
  if (!original) return [];
  let protectedSuffixes = original.replace(
    /,\s*((?:Jr|Sr)\.?|II|III|IV)\b/gi,
    " $1",
  );
  return protectedSuffixes
    .split(/\s*(?:,|;|\||\/|\s+&\s+|\s+and\s+)\s*/i)
    .map(window.stripPersonDisambiguator)
    .filter(Boolean);
};

/** Resolves a recipient name or id through the current person-alias map. @param {*} value Recipient name or id. @returns {string} Canonical person id. */
window.resolveAwardRecipientPersonId = function (value) {
  let variantId = window.normalizePersonName(value);
  if (!variantId) return "";
  let canonicalName = window.state?.peopleAliases?.[variantId] || value;
  return window.normalizePersonName(canonicalName);
};

/** Returns normalized, deduplicated award recipients. @param {AwardRecord|CollectionAwardNomination|OfficialNomination|null} award Award. @returns {AwardRecipient[]} Recipients. */
window.awardRecipients = function (award) {
  if (!award) return [];
  let records = Array.isArray(award.recipients)
    ? award.recipients
    : window.splitRecipientNames(award.recipientText ?? award.recipient);
  let seen = new Set();
  return records
    .map((record) => {
      let name = String(
        typeof record === "string" ? record : record?.name || "",
      ).trim();
      let personId = window.normalizePersonName(
        typeof record === "string" ? name : record?.personId || name,
      );
      return { name, personId };
    })
    .filter(
      (record) =>
        record.name &&
        record.personId &&
        !seen.has(record.personId) &&
        seen.add(record.personId),
    );
};

/** Resolves and deduplicates an award's recipients through the current person-alias map without mutating the award. @param {AwardRecord|CollectionAwardNomination|OfficialNomination|null} award Award. @returns {AwardRecipient[]} Canonical recipients. */
window.resolveAwardRecipients = function (award) {
  let seen = new Set();
  return window
    .awardRecipients(award)
    .map((recipient) => {
      let variantId = window.normalizePersonName(recipient.personId);
      let canonicalName =
        window.state?.peopleAliases?.[variantId] || recipient.name;
      return {
        name: canonicalName,
        personId: window.resolveAwardRecipientPersonId(recipient.personId),
      };
    })
    .filter(
      (recipient) =>
        recipient.personId &&
        !seen.has(recipient.personId) &&
        seen.add(recipient.personId),
    );
};

/** Returns the preserved display text for award recipients. @param {AwardRecord|null} award Award. @returns {string} Recipient text. */
window.awardRecipientText = function (award) {
  if (!award) return "";
  return String(
    award.recipientText ??
      award.recipient ??
      window
        .awardRecipients(award)
        .map((record) => record.name)
        .join(", "),
  ).trim();
};

/** Sets structured and display recipient values on an award. @param {AwardRecord} award Award. @param {string|AwardRecipient[]} value Recipients. @param {Object} [options] Controls. @returns {AwardRecord} Updated award. */
window.setAwardRecipients = function (award, value, options = {}) {
  let originalText = Array.isArray(value)
    ? value
        .map((record) => (typeof record === "string" ? record : record?.name))
        .filter(Boolean)
        .join(", ")
    : String(value || "").trim();
  award.recipients = Array.isArray(value)
    ? value.map((record) =>
        typeof record === "string" ? { name: record } : record,
      )
    : window.splitRecipientNames(originalText).map((name) => ({ name }));
  award.recipients = window.awardRecipients(award);
  award.recipientText = String(options.recipientText ?? originalText).trim();
  delete award.recipient;
  return award;
};

/** Builds reusable recipient suggestions from shared film credits and the owner's previous nominations. Covers every category in window.AWARD_CATEGORY_CREDIT_JOBS (not just Best Director) - a role's shared credit rows apply to whichever category(ies) share that role, e.g. one "screenwriter" credit row backs both Best Original Screenplay and Best Adapted Screenplay. @param {{credits?: Object[], nominations?: Object[]}} source Raw Supabase candidate-credit rows. @returns {Map<string, Object[]>} Suggestions keyed by film and category. */
window.buildAwardCandidateCreditIndex = function (source = {}) {
  let index = new Map();
  let byRole = new Map(); // "filmId\nrole" -> [{name, order}]
  let categoriesByRole = new Map();
  Object.entries(window.AWARD_CATEGORY_CREDIT_JOBS || {}).forEach(
    ([category, mapping]) => {
      let categories = categoriesByRole.get(mapping.role) || [];
      categories.push(category);
      categoriesByRole.set(mapping.role, categories);
    },
  );

  let add = (filmId, category, option) => {
    let recipient = String(option.recipient || "").trim();
    if (!filmId || !category || !recipient) return;
    let key = `${filmId}\n${category}`;
    let options = index.get(key) || [];
    let identity = `${recipient.toLocaleLowerCase("en")}\n${String(option.detail || "").toLocaleLowerCase("en")}`;
    if (!options.some((candidate) => candidate.identity === identity))
      options.push({ ...option, recipient, identity });
    index.set(key, options);
  };

  (source.credits || []).forEach((credit) => {
    let role = String(credit.role || "").toLowerCase();
    let name = String(credit.people?.name || "").trim();
    if (!credit.film_id || !name || !categoriesByRole.has(role)) return;
    let key = `${credit.film_id}\n${role}`;
    let entries = byRole.get(key) || [];
    if (!entries.some((entry) => entry.name.toLowerCase() === name.toLowerCase()))
      entries.push({ name, order: Number(credit.billing_order) || 0 });
    byRole.set(key, entries);
  });
  byRole.forEach((entries, key) => {
    let [filmId, role] = key.split("\n");
    entries.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "en"));
    (categoriesByRole.get(role) || []).forEach((category) => {
      add(filmId, category, {
        recipient: entries.map((entry) => entry.name).join(", "),
        detail: "",
        source: "shared-credit",
      });
    });
  });

  (source.nominations || []).forEach((nomination) => {
    let recipients = (nomination.personal_nomination_recipients || [])
      .map((row) => String(row.recipient_name || "").trim())
      .filter(Boolean);
    if (!recipients.length) return;
    add(nomination.film_id, nomination.category, {
      recipient: recipients.join(", "),
      detail: String(nomination.detail || "").trim(),
      source: "personal-nomination",
    });
  });
  return index;
};

/** Returns known recipient choices for one film/category, preferring canonical shared credits over a merely-similar past personal nomination. @param {Map<string, Object[]>} index Candidate-credit index. @param {string} filmId Film UUID. @param {string} category Award category. @returns {Object[]} Recipient/detail choices. */
window.awardCandidateCreditOptions = function (index, filmId, category) {
  let options = index?.get(`${filmId}\n${category}`) || [];
  let shared = options.filter((option) => option.source === "shared-credit");
  if (shared.length) options = shared;
  return options
    .map(({ recipient, detail, source }) => ({ recipient, detail, source }))
    .sort(
      (left, right) =>
        left.recipient.localeCompare(right.recipient, "en") ||
        left.detail.localeCompare(right.detail, "en"),
    );
};

/** Normalizes an award's legacy or structured recipients in place. @param {AwardRecord|null} award Award. @returns {AwardRecord|null} Normalized award. */
window.normalizeAwardRecipients = function (award) {
  if (!award) return award;
  let text = window.awardRecipientText(award);
  return window.setAwardRecipients(
    award,
    Array.isArray(award.recipients) ? award.recipients : text,
    {
      recipientText: text,
    },
  );
};

/** Builds an order-independent recipient identity key. @param {AwardRecord} award Award. @returns {string} Recipient key. */
window.awardRecipientKey = function (award) {
  return window
    .resolveAwardRecipients(award)
    .map((record) => record.personId)
    .sort()
    .join("\n");
};

/** Migrates stored award credits to the current schema. @param {OskarsState|null} data State. @returns {OskarsState|null} Migrated state. */
window.migrateCreditSchema = function (data) {
  if (!data) return data;
  let version = Number(data.creditSchemaVersion || 1);
  Object.values(data.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      (film.awards || []).forEach((award) => {
        if (version < 2) {
          let oldRole = String(award.role || award.detail || "").trim();
          if (award.category === "Best Song") {
            award.detail = String(award.recipient || "").trim();
            award.recipient = oldRole;
          } else {
            award.detail = oldRole;
          }
          delete award.role;
        }
        if (version < 3 || !Array.isArray(award.recipients))
          window.normalizeAwardRecipients(award);
      });
    });
  });
  data.creditSchemaVersion = 3;
  return data;
};
