/** @file Browser download helpers for Data, Profile, and Data tools: JSON/text exports and timestamped filenames. */

/**
 * Triggers a browser download of a JSON-serializable value.
 * @param {*} value Data to serialize and download.
 * @param {string} filename Output file name.
 */
window.downloadJson = function (value, filename) {
  let url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  let link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * Triggers a browser download of a plain text or CSV file.
 * @param {string} text Text content to download.
 * @param {string} filename Output file name.
 * @param {string} [mimeType="text/plain;charset=utf-8"] MIME type.
 */
window.downloadTextFile = function (
  text,
  filename,
  mimeType = "text/plain;charset=utf-8",
) {
  let url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  let link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * Builds a deterministic timestamped filename.
 * @param {string} prefix Filename prefix.
 * @param {string} [extension="json"] File extension without dot.
 * @returns {string} Timestamped filename.
 */
window.stampedFilename = function (prefix, extension = "json") {
  let stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${stamp}.${extension}`;
};
