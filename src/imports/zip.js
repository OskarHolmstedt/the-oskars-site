/** @file Reads bounded ZIP archives in-browser for local file imports. */

(function () {
  let limits = Object.freeze({
    maximumArchiveBytes: 50 * 1024 * 1024,
    maximumEntries: 5000,
    maximumUncompressedBytes: 100 * 1024 * 1024,
    maximumSelectedFileBytes: 25 * 1024 * 1024,
  });
  let crcTable = null;

  function zipBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input))
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new Error("ZIP input must be binary data.");
  }

  function findEndOfCentralDirectory(view) {
    let minimum = Math.max(0, view.byteLength - 65557);
    for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    throw new Error("This file is not a valid ZIP archive.");
  }

  function defaultDecodeName(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  function relevantBasename(path, selectedNames) {
    let normalized = String(path || "").replace(/\\/g, "/");
    let basename = normalized.split("/").pop().toLowerCase();
    return selectedNames.has(basename) ? basename : "";
  }

  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1)
          value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        crcTable[index] = value >>> 0;
      }
    }
    let result = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1)
      result = crcTable[(result ^ bytes[index]) & 0xff] ^ (result >>> 8);
    return (result ^ 0xffffffff) >>> 0;
  }

  /**
   * Inspects a ZIP central directory without extracting its entries.
   * @param {ArrayBuffer|Uint8Array} input ZIP bytes.
   * @param {Object} [options] Selection and test controls.
   * @param {string[]} [options.selectedNames] Case-insensitive basenames to retain.
   * @param {(bytes: Uint8Array) => string} [options.decodeName] Filename decoder.
   * @returns {{bytes: Uint8Array, entries: Object[]}} Selected entry descriptors.
   */
  window.inspectZipArchive = function (input, options = {}) {
    let bytes = zipBytes(input);
    if (bytes.byteLength > limits.maximumArchiveBytes)
      throw new Error("The ZIP is larger than the 50 MiB import limit.");
    let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocdOffset = findEndOfCentralDirectory(view);
    let disk = view.getUint16(eocdOffset + 4, true);
    let centralDisk = view.getUint16(eocdOffset + 6, true);
    let diskEntries = view.getUint16(eocdOffset + 8, true);
    let entryCount = view.getUint16(eocdOffset + 10, true);
    let centralSize = view.getUint32(eocdOffset + 12, true);
    let centralOffset = view.getUint32(eocdOffset + 16, true);
    if (disk || centralDisk || diskEntries !== entryCount)
      throw new Error("Multi-disk ZIP archives are not supported.");
    if (
      entryCount === 0xffff ||
      centralSize === 0xffffffff ||
      centralOffset === 0xffffffff
    )
      throw new Error("ZIP64 archives are not supported.");
    if (entryCount > limits.maximumEntries)
      throw new Error("The ZIP contains more than 5,000 entries.");
    if (
      centralOffset + centralSize > eocdOffset ||
      centralOffset + centralSize > bytes.byteLength
    )
      throw new Error("The ZIP central directory is corrupt.");

    let selectedNames = new Set(
      (options.selectedNames || []).map((name) => String(name).toLowerCase()),
    );
    let decodeName = options.decodeName || defaultDecodeName;
    let selected = new Map();
    let totalUncompressed = 0;
    let offset = centralOffset;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > eocdOffset || view.getUint32(offset, true) !== 0x02014b50)
        throw new Error("The ZIP central directory is corrupt.");
      let flags = view.getUint16(offset + 8, true);
      let method = view.getUint16(offset + 10, true);
      let expectedCrc = view.getUint32(offset + 16, true);
      let compressedSize = view.getUint32(offset + 20, true);
      let uncompressedSize = view.getUint32(offset + 24, true);
      let nameLength = view.getUint16(offset + 28, true);
      let extraLength = view.getUint16(offset + 30, true);
      let commentLength = view.getUint16(offset + 32, true);
      let entryDisk = view.getUint16(offset + 34, true);
      let localOffset = view.getUint32(offset + 42, true);
      let nextOffset = offset + 46 + nameLength + extraLength + commentLength;
      if (nextOffset > eocdOffset)
        throw new Error("The ZIP central directory is corrupt.");
      if (
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        localOffset === 0xffffffff
      )
        throw new Error("ZIP64 archives are not supported.");
      if (entryDisk)
        throw new Error("Multi-disk ZIP archives are not supported.");
      if (flags & 1)
        throw new Error("Encrypted ZIP archives are not supported.");
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > limits.maximumUncompressedBytes)
        throw new Error("The ZIP expands beyond the 100 MiB import limit.");
      let path = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength));
      let basename = relevantBasename(path, selectedNames);
      if (basename) {
        if (selected.has(basename))
          throw new Error(`The ZIP contains more than one ${basename}.`);
        if (![0, 8].includes(method))
          throw new Error(`Unsupported ZIP compression method ${method} (${path}).`);
        if (uncompressedSize > limits.maximumSelectedFileBytes)
          throw new Error(`${basename} expands beyond the 25 MiB file limit.`);
        if (
          localOffset + 30 > bytes.byteLength ||
          view.getUint32(localOffset, true) !== 0x04034b50
        )
          throw new Error(`The ZIP entry header is corrupt (${path}).`);
        let localNameLength = view.getUint16(localOffset + 26, true);
        let localExtraLength = view.getUint16(localOffset + 28, true);
        let dataOffset = localOffset + 30 + localNameLength + localExtraLength;
        if (dataOffset + compressedSize > bytes.byteLength)
          throw new Error(`The ZIP entry data is truncated (${path}).`);
        selected.set(basename, {
          basename,
          path,
          method,
          compressedSize,
          uncompressedSize,
          expectedCrc,
          dataOffset,
        });
      }
      offset = nextOffset;
    }
    if (offset !== centralOffset + centralSize)
      throw new Error("The ZIP central-directory size does not match its entries.");
    return { bytes, entries: [...selected.values()] };
  };

  async function defaultInflateRaw(bytes) {
    if (typeof DecompressionStream !== "function")
      throw new Error(
        "This browser cannot decompress Letterboxd ZIP files. Update the browser and try again.",
      );
    let stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /**
   * Extracts selected files from a bounded ZIP and verifies size and CRC-32.
   * @param {File|Blob|ArrayBuffer|Uint8Array} input ZIP file or bytes.
   * @param {Object} options Extraction controls.
   * @param {string[]} options.selectedNames Case-insensitive basenames to extract.
   * @param {(bytes: Uint8Array) => Promise<Uint8Array>} [options.inflateRaw] Raw-DEFLATE decoder.
   * @param {(bytes: Uint8Array) => string} [options.decodeName] Filename decoder.
   * @returns {Promise<Record<string, {path: string, bytes: Uint8Array}>>} Extracted files keyed by lowercase basename.
   */
  window.extractZipFiles = async function (input, options = {}) {
    let raw =
      input instanceof ArrayBuffer || ArrayBuffer.isView(input)
        ? input
        : await input.arrayBuffer();
    let archive = window.inspectZipArchive(raw, options);
    let inflateRaw = options.inflateRaw || defaultInflateRaw;
    let files = {};
    for (let entry of archive.entries) {
      let compressed = archive.bytes.subarray(
        entry.dataOffset,
        entry.dataOffset + entry.compressedSize,
      );
      let extracted =
        entry.method === 0
          ? new Uint8Array(compressed)
          : zipBytes(await inflateRaw(compressed));
      if (extracted.byteLength !== entry.uncompressedSize)
        throw new Error(`The extracted size does not match (${entry.path}).`);
      if (crc32(extracted) !== entry.expectedCrc)
        throw new Error(`The ZIP integrity check failed (${entry.path}).`);
      files[entry.basename] = { path: entry.path, bytes: extracted };
    }
    return files;
  };

  window.ZIP_IMPORT_LIMITS = limits;
  window.zipCrc32 = crc32;
})();
