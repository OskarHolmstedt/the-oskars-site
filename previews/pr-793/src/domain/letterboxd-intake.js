/**
 * @file Coordinates Letterboxd RSS feed parsing, freshness detection, and automatic
 * watched-film Intake creation (issue #668).
 */

(function () {
  /**
   * Decodes basic XML and HTML character entities in feed text.
   * @param {string} text Raw text containing entities.
   * @returns {string} Unescaped text.
   */
  function decodeEntities(text) {
    return String(text || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
  }

  /**
   * Parses standard Letterboxd RSS XML into structured diary entry records.
   * @param {string} xmlText Raw XML string from Letterboxd RSS.
   * @returns {Array<{title: string, year: number|null, watchedDate: string|null, pubDate: string|null, rewatch: boolean, rating: number|null, tmdbId: number|null, link: string, guid: string}>}
   */
  window.parseLetterboxdRssXml = function (xmlText) {
    let items = [];
    let itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(String(xmlText || ""))) !== null) {
      let block = match[1];
      let getTag = (name) => {
        let tagMatch = new RegExp(
          `<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,
          "i",
        ).exec(block);
        return tagMatch ? decodeEntities(tagMatch[1].trim()) : "";
      };

      let rawYear = getTag("letterboxd:filmYear");
      let rawRating = getTag("letterboxd:memberRating");
      let rawTmdb = getTag("tmdb:movieId");
      let rawRewatch = getTag("letterboxd:rewatch");
      let filmTitle = getTag("letterboxd:filmTitle") || getTag("title");

      items.push({
        title: filmTitle,
        year: rawYear ? parseInt(rawYear, 10) : null,
        watchedDate: getTag("letterboxd:watchedDate") || null,
        pubDate: getTag("pubDate") || null,
        rewatch: rawRewatch.toLowerCase() === "yes",
        rating: rawRating ? parseFloat(rawRating) : null,
        tmdbId: rawTmdb ? parseInt(rawTmdb, 10) : null,
        link: getTag("link"),
        guid: getTag("guid"),
      });
    }
    return items;
  };

  /**
   * Fetches the user's recent Letterboxd diary entries via the Supabase Edge Function
   * or a configured proxy.
   * @param {string} username Letterboxd profile handle.
   * @returns {Promise<{ok: boolean, entries?: Array<Object>, reason?: string, error?: string}>}
   */
  window.fetchLetterboxdRssEntries = async function (username) {
    let cleanUser = String(username || "")
      .trim()
      .toLowerCase();
    if (!cleanUser) return { ok: false, reason: "empty_username" };

    let ready = await window.ensureSupabaseClient?.();
    if (ready?.client?.functions) {
      try {
        let { data, error } = await ready.client.functions.invoke(
          "letterboxd-rss",
          {
            body: { username: cleanUser },
          },
        );
        if (!error && data?.ok) return data;
        if (data && !data.ok) return data;
      } catch (invokeErr) {
        // Fallback below if edge function is unreachable or not running locally
      }
    }

    // Secondary fallback: configured proxy or direct fetch if permissible
    let proxyBase = window.LETTERBOXD_PROXY_BASE;
    if (proxyBase) {
      try {
        let res = await fetch(
          `${proxyBase}?username=${encodeURIComponent(cleanUser)}`,
        );
        if (res.ok) {
          let json = await res.json();
          if (json?.ok) return json;
        }
      } catch (err) {}
    }

    return { ok: false, reason: "edge_function_unavailable" };
  };

  /**
   * Checks whether a film identity matches an existing watched or watchlist record.
   * @param {Object} candidate Film candidate with title, year, tmdbId.
   * @param {Array<Object>} list List of watched or watchlist items.
   * @returns {Object|null} Matching item if found.
   */
  function findExistingMatch(candidate, list) {
    if (!candidate || !list?.length) return null;
    let targetTmdb = candidate.tmdbId ? Number(candidate.tmdbId) : null;
    let targetTitle =
      window.comparableFilmTitle?.(candidate.title) ||
      candidate.title.toLowerCase();
    let targetYear = candidate.year ? String(candidate.year) : "";

    for (let item of list) {
      let film = item.films || item.film || item;
      let filmTmdb =
        film.tmdb_id || film.tmdbId
          ? Number(film.tmdb_id || film.tmdbId)
          : null;
      if (targetTmdb && filmTmdb && targetTmdb === filmTmdb) return item;

      let filmTitle =
        window.comparableFilmTitle?.(film.title) ||
        (film.title || "").toLowerCase();
      let filmYear = String(film.year || "");
      if (targetTitle && filmTitle && targetTitle === filmTitle) {
        if (!targetYear || !filmYear || targetYear === filmYear) return item;
      }
    }
    return null;
  }

  /**
   * Performs an automated sync against the user's Letterboxd RSS feed: detects new
   * diary watches, moves watchlist items or creates fresh Intakes, and updates the sync timestamp.
   * @param {Object} [options]
   * @param {boolean} [options.force] Whether to bypass the 10-minute session debounce.
   * @returns {Promise<{status: string, createdCount?: number, latestWorkflowId?: string, reason?: string}>}
   */
  window.syncLetterboxdIntakes = async function (options = {}) {
    let ready = await window.ensureSupabaseClient?.();
    if (!ready) return { status: "not_configured" };

    let authState = await window.resolveSupabaseAuthState?.();
    if (authState?.status !== "signed-in") return { status: "signed_out" };

    let profile = await window.loadSupabaseProfile?.();
    let username = profile?.letterboxd_username;
    if (!username) return { status: "no_username" };

    let debounceKey = "oskars-lb-sync-time";
    let lastChecked = 0;
    try {
      lastChecked = Number(sessionStorage.getItem(debounceKey) || 0);
    } catch (e) {}

    let now = Date.now();
    let tenMinutes = 10 * 60 * 1000;
    if (!options.force && now - lastChecked < tenMinutes) {
      return { status: "debounced" };
    }

    try {
      sessionStorage.setItem(debounceKey, String(now));
    } catch (e) {}

    let feedResult = await window.fetchLetterboxdRssEntries(username);
    if (!feedResult?.ok || !feedResult.entries?.length) {
      return { status: "fetch_failed", reason: feedResult?.reason || "empty" };
    }

    // Work with entries chronologically (oldest to newest) so earlier watches are intaked first
    let entries = [...feedResult.entries].sort((a, b) => {
      let timeA = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      let timeB = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return timeA - timeB;
    });

    let lastSyncedAt = profile.letterboxd_last_synced_at
      ? new Date(profile.letterboxd_last_synced_at).getTime()
      : null;

    let candidateEntries;
    if (lastSyncedAt) {
      candidateEntries = entries.filter((entry) => {
        let entryTime = entry.pubDate ? new Date(entry.pubDate).getTime() : 0;
        return entryTime > lastSyncedAt;
      });
    } else {
      // If never synced before, intake only the most recent entry to establish sync
      // without flooding the user's queue before a full initial import.
      candidateEntries = entries.slice(-1);
    }

    if (!candidateEntries.length) {
      return { status: "up_to_date", createdCount: 0 };
    }

    // Ensure we have current workspace lists to check duplicates
    let workspace = await window.loadSupabaseWorkspace?.();
    let watchedList = workspace?.watched || [];
    let watchlist = workspace?.watchlist || [];

    let createdCount = 0;
    let latestWorkflowId = null;
    let latestPubDate = profile.letterboxd_last_synced_at;

    for (let entry of candidateEntries) {
      let existingWatched = findExistingMatch(entry, watchedList);
      if (existingWatched) {
        // Film is already watched. If this is marked as a rewatch on Letterboxd,
        // we can preserve the record without raising a duplicate intake error.
        if (entry.pubDate) latestPubDate = entry.pubDate;
        continue;
      }

      let existingWatchlist = findExistingMatch(entry, watchlist);
      try {
        let workflow = null;
        if (existingWatchlist) {
          workflow = await window.createSupabaseWatchlistWatchedIntake(
            existingWatchlist.id,
            {
              rating: entry.rating || undefined,
              dateWatched: entry.watchedDate || undefined,
              views: entry.rewatch ? 2 : 1,
            },
          );
        } else {
          workflow = await window.createSupabaseFreshWatchedIntake({
            title: entry.title,
            year: entry.year || 2026,
            tmdbId: entry.tmdbId || undefined,
            rating: entry.rating || undefined,
            dateWatched: entry.watchedDate || undefined,
            views: entry.rewatch ? 2 : 1,
          });
        }

        if (workflow?.id) {
          try {
            await window.updateSupabaseIntakeWorkflow?.(workflow, {
              summary: "Letterboxd sync",
            });
          } catch (sumErr) {}
          createdCount += 1;
          latestWorkflowId = workflow.id;
        }
      } catch (creationError) {
        console.warn(
          "Could not create intake for Letterboxd entry",
          entry.title,
          creationError,
        );
      }

      if (entry.pubDate) {
        latestPubDate = entry.pubDate;
      }
    }

    if (latestPubDate && latestPubDate !== profile.letterboxd_last_synced_at) {
      await window.updateSupabaseProfileLetterboxdLastSynced?.(
        new Date(latestPubDate).toISOString(),
      );
    }

    if (createdCount > 0) {
      window.refreshSupabaseWorkspace?.();
    }

    return {
      status: "synced",
      createdCount,
      latestWorkflowId,
    };
  };
})();
