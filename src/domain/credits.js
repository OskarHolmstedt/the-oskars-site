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

/** Builds a normalized person identity key. @param {*} value Name value. @returns {string} Person key. */
window.personIdentityKey = function (value) {
  return window.normalizeTitle(window.stripPersonDisambiguator(value));
};

/** Builds a recipient person id. @param {*} value Name value. @returns {string} Person id. */
window.recipientPersonId = function (value) {
  return window.personIdentityKey(value);
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
    .split(/\s*(?:,|;|\/|\s+&\s+|\s+and\s+)\s*/i)
    .map(window.stripPersonDisambiguator)
    .filter(Boolean);
};

/** Returns normalized, deduplicated award recipients. @param {AwardRecord|null} award Award. @returns {AwardRecipient[]} Recipients. */
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
      let personId = window.recipientPersonId(
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
    .awardRecipients(award)
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
