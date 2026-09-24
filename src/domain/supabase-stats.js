/** @file Reads the private compact Stats projection and applies the established canonical film and statistics semantics without mutating the shared shell. */

/** Builds Stats models from versioned narrow SQL inputs using the canonical merger. @param {Object} source Compact Stats projection. @param {Object|null} [officialFallback] Bundled Academy source when live Academy data is absent. @returns {Object} Viewing and award agreement models. */
window.buildSupabaseStatsModel = function (source, officialFallback = null) {
  if (source?.version !== 1) throw new Error("Unsupported Stats response.");
  let shaped = window.buildLegacyStateFromSupabaseHydration(source);
  let store = { years: shaped.years, filmsById: {} };
  for (let [year, period] of Object.entries(shaped.years)) {
    for (let film of period.films || []) {
      window.addFilmToStore(year, film, { store });
    }
  }
  let films = Object.values(store.filmsById);
  let finishStatistics = window.startOskarsPerformance?.("stats:statistics");
  let statistics = window.viewingStatistics(films);
  finishStatistics?.();
  let finishAwards = window.startOskarsPerformance?.("stats:awardEntries");
  let personalEntries = films.flatMap((film) =>
    (film.awards || [])
      .filter((award) => window.getAwardPeriodType(award) === "years")
      .map((award) => ({ film, award })),
  );
  finishAwards?.();
  let finishAgreement = window.startOskarsPerformance?.("stats:collect");
  let agreement = window.officialAwardAgreementStatistics({
    personalEntries,
    officialSource: source.hasLiveAcademy
      ? source.officialSource
      : officialFallback,
  });
  finishAgreement?.();
  return { statistics, agreement };
};

/** Reads one versioned private Stats snapshot; public pages use their existing anonymous loader. @returns {Promise<Object>} Compact Stats inputs. */
window.loadSupabaseStatsProjection = async function () {
  if (window.resolveActiveProfileSlug?.() || window.state?.isPublicProfileView)
    throw new Error("Private Stats are unavailable in public mode.");
  let auth = await window.resolveSupabaseAuthState();
  if (auth.status !== "signed-in")
    throw new Error("Sign in to view statistics.");
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client.rpc("read_stats_projection");
  if (error) throw error;
  if (data?.version !== 1) throw new Error("Unsupported Stats response.");
  return data;
};
