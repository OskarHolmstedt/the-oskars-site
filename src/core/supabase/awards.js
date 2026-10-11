/** @file Owns personal nominations, recipients, award reviews, and ballot exclusions. */

(function () {
  const PERSONAL_NOMINATION_SELECT =
    "id, category, placement, film_id, detail, films(id, tmdb_id, tmdb_tv_ref, title, year, poster_url), personal_nomination_recipients(recipient_name)";

  /**
   * Finds or creates the signed-in user's personal award scope under its
   * unique owner, scope type, and scope constraint.
   * @param {Object} client Ready Supabase client.
   * @param {string} scope
   * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
   * @returns {Promise<string>} The personal_awards row's id.
   */
  async function getOrCreateSupabasePersonalAwardId(client, scope, scopeType) {
    let { data: existing, error: selectError } = await client
      .from("personal_awards")
      .select("id")
      .eq("scope", scope)
      .eq("scope_type", scopeType)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existing) return existing.id;

    let { data: created, error: insertError } = await client
      .from("personal_awards")
      .insert({ scope, scope_type: scopeType })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code === "23505") {
        let { data: retryExisting, error: retryError } = await client
          .from("personal_awards")
          .select("id")
          .eq("scope", scope)
          .eq("scope_type", scopeType)
          .single();
        if (retryError) throw retryError;
        return retryExisting.id;
      }
      throw insertError;
    }
    return created.id;
  }

  /**
   * Loads the signed-in user's personal nominations for one scope and
   * category, ordered by placement, joined with films. Not cached, same
   * page-specific-fetch posture as loadSupabaseRanking().
   * @param {string} scope
   * @param {string} category
   * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
   * @returns {Promise<{personalAwardId: string, nominations: Object[]}|{personalAwardId: null, nominations: []}>}
   */
  window.loadSupabasePersonalNominations = async function (
    scope,
    category,
    scopeType,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in")
      return { personalAwardId: null, nominations: [] };

    let personalAwardId = await getOrCreateSupabasePersonalAwardId(
      ready.client,
      scope,
      scopeType,
    );
    let { data, error } = await ready.client
      .from("personal_nominations")
      .select(PERSONAL_NOMINATION_SELECT)
      .eq("personal_award_id", personalAwardId)
      .eq("category", category)
      .order("placement");
    if (error) throw error;
    return { personalAwardId, nominations: data };
  };

  /**
   * Loads shared crew credits (every role backing a category in
   * window.AWARD_CATEGORY_CREDIT_JOBS, not just director) and the owner's
   * prior nomination credits for a set of ballot-candidate films, in
   * batches of films rather than one request per film/card.
   * @param {string[]} filmIds Film UUIDs.
   * @returns {Promise<{credits: Object[], nominations: Object[]}>}
   */
  window.loadSupabaseAwardCandidateCredits = async function (filmIds) {
    let ids = [...new Set((filmIds || []).filter(Boolean))];
    if (!ids.length) return { credits: [], nominations: [] };
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in")
      return { credits: [], nominations: [] };
    let roles = [
      ...new Set(
        Object.values(window.AWARD_CATEGORY_CREDIT_JOBS || {}).map(
          (mapping) => mapping.role,
        ),
      ),
    ];
    if (!roles.length) roles = ["director"];
    // A film has many credit rows, so fewer films per request keeps each
    // response under PostgREST's row cap.
    let [credits, nominations] = await Promise.all([
      window.supabaseWorkspaceContext.selectInChunks(
        ids,
        (chunk) =>
          ready.client
            .from("credits")
            .select("film_id, role, billing_order, people(name)")
            .in("film_id", chunk)
            .in("role", roles)
            .order("billing_order"),
        40,
      ),
      window.supabaseWorkspaceContext.selectInChunks(ids, (chunk) =>
        ready.client
          .from("personal_nominations")
          .select(
            "film_id, category, detail, personal_nomination_recipients(recipient_name)",
          )
          .in("film_id", chunk),
      ),
    ]);
    return { credits, nominations };
  };

  /**
   * Removes one personal nomination, straight through to Supabase.
   * @param {string} nominationId
   */
  window.removeSupabasePersonalNomination = async function (nominationId) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error } = await ready.client
      .from("personal_nominations")
      .delete()
      .eq("id", nominationId);
    if (error) throw error;
  };

  /**
   * Loads the films hidden from every candidate pool for one annual ballot.
   * @param {number|string} year Awards year.
   * @returns {Promise<string[]>} Hidden film UUIDs.
   */
  window.loadSupabaseAwardPoolExclusions = async function (year) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let rows = await window.supabaseWorkspaceContext.fetchAllSupabaseRows(
      (count) =>
        ready.client
          .from("award_pool_exclusions")
          .select("film_id", count ? { count: "exact" } : undefined)
          .eq("year", Number(year))
          .order("film_id"),
    );
    return rows.map((row) => row.film_id);
  };

  /**
   * Saves a film hidden from every category in one annual ballot.
   * @param {number|string} year Awards year.
   * @param {string} filmId Film UUID.
   */
  window.hideSupabaseAwardPoolFilm = async function (year, filmId) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error } = await ready.client
      .from("award_pool_exclusions")
      .upsert(
        { year: Number(year), film_id: filmId },
        { onConflict: "user_id,year,film_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  };

  /**
   * Restores all globally hidden candidate films for one annual ballot.
   * @param {number|string} year Awards year.
   */
  window.clearSupabaseAwardPoolExclusions = async function (year) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error } = await ready.client
      .from("award_pool_exclusions")
      .delete()
      .eq("year", Number(year));
    if (error) throw error;
  };

  /**
   * Loads the review status for one year and category, or null when it has never been reviewed.
   * @param {number|string} year
   * @param {string} category
   * @returns {Promise<{status: 'complete'|'none', reviewed_at: string}|null>}
   */
  window.loadSupabaseAwardReview = async function (year, category) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { data, error } = await ready.client
      .from("award_reviews")
      .select("status, reviewed_at")
      .eq("year", Number(year))
      .eq("category", category)
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  /**
   * Marks an annual category deliberately complete or reviewed with no
   * nominees.
   * @param {number|string} year
   * @param {string} category
   * @param {'complete'|'none'} status
   */
  window.setSupabaseAwardReview = async function (year, category, status) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error } = await ready.client.from("award_reviews").upsert(
      {
        year: Number(year),
        category,
        status,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,year,category" },
    );
    if (error) throw error;
  };

  /**
   * Clears a stored annual outcome when ballot contents change.
   * @param {number|string} year
   * @param {string} category
   */
  window.reopenSupabaseAwardReview = async function (year, category) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error } = await ready.client
      .from("award_reviews")
      .delete()
      .eq("year", Number(year))
      .eq("category", category);
    if (error) throw error;
  };

  /**
   * Bulk marks multiple annual categories as reviewed.
   * @param {Array<{year: number, category: string, status: 'complete'|'none', reviewed_at: string}>} reviews
   * @returns {Promise<void>}
   */
  window.bulkSetSupabaseAwardReviews = async function (reviews) {
    if (!reviews?.length) return;
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error } = await ready.client
      .from("award_reviews")
      .upsert(reviews, { onConflict: "user_id,year,category" });
    if (error) throw error;
  };

  /**
   * Clears every stored annual outcome for one year.
   * @param {number|string} year
   * @returns {Promise<void>}
   */
  window.reopenAllSupabaseAwardReviews = async function (year) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error } = await ready.client
      .from("award_reviews")
      .delete()
      .eq("year", Number(year));
    if (error) throw error;
  };

  /**
   * Loads every annual category outcome for the signed-in user. Build uses this
   * one batched read across all years instead of issuing one query per category
   * per year through supabaseAnnualAwardReviewProgress().
   * @returns {Promise<SupabaseAwardReview[]>}
   */
  window.loadSupabaseAwardReviews = async function () {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") return [];
    let { data, error } = await ready.client
      .from("award_reviews")
      .select("year, category, status, reviewed_at")
      .order("year")
      .order("category");
    if (error) throw error;
    return data;
  };

  /**
   * Loads annual award review progress alongside existing personal nominations.
   * @param {number|string} year
   * @returns {Promise<{personalAwardId: string|null, total: number, reviewed: number, complete: boolean, nextCategory: string, categories: Object[], winners: Object[]}>}
   */
  window.supabaseAnnualAwardReviewProgress = async function (year) {
    let categoryNames = window.getOrderedCategories?.() || [];
    // Resolves (or creates) this year's personal_awards row, then batches
    // personal nominations across all categories and award reviews for this year
    // into two parallel queries instead of fanning out 36 separate category reads.
    let ready = await window.ensureSupabaseClient();
    let authState = ready ? await window.resolveSupabaseAuthState() : null;
    let personalAwardId =
      ready && authState?.status === "signed-in"
        ? await getOrCreateSupabasePersonalAwardId(
            ready.client,
            String(year),
            "years",
          )
        : null;
    let [nominationsRes, reviewsRes] = await Promise.all([
      personalAwardId
        ? ready.client
            .from("personal_nominations")
            .select(PERSONAL_NOMINATION_SELECT)
            .eq("personal_award_id", personalAwardId)
            .order("placement")
        : Promise.resolve({ data: [], error: null }),
      ready && authState?.status === "signed-in"
        ? ready.client
            .from("award_reviews")
            .select("year, category, status, reviewed_at")
            .eq("year", Number(year))
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (nominationsRes.error) throw nominationsRes.error;
    if (reviewsRes.error) throw reviewsRes.error;

    let nominationsByCategory = new Map();
    for (let nomination of nominationsRes.data || []) {
      let list = nominationsByCategory.get(nomination.category);
      if (!list) {
        list = [];
        nominationsByCategory.set(nomination.category, list);
      }
      list.push(nomination);
    }

    let reviewsByCategory = new Map();
    for (let review of reviewsRes.data || []) {
      reviewsByCategory.set(review.category, review);
    }

    let categories = categoryNames.map((category) => {
      let nominations = nominationsByCategory.get(category) || [];
      let review = reviewsByCategory.get(category) || null;
      let winner =
        nominations.find((entry) => Number(entry.placement) === 1) || null;
      return {
        category,
        nominations,
        review,
        reviewed: Boolean(review),
        winner,
      };
    });
    return {
      personalAwardId,
      total: categories.length,
      reviewed: categories.filter((entry) => entry.reviewed).length,
      complete:
        categories.length > 0 && categories.every((entry) => entry.reviewed),
      nextCategory: categories.find((entry) => !entry.reviewed)?.category || "",
      categories,
      winners: categories.map((entry) => entry.winner).filter(Boolean),
    };
  };

  /**
   * Inserts a personal nomination with atomic placement-bump cascade
   *  via the insert_personal_nomination RPC - see its
   * migration for the exact bump/capacity-truncation contract.
   * @param {string} personalAwardId
   * @param {string} category
   * @param {number} placement
   * @param {number} capacity
   * @param {string} filmId
   * @param {string} detail
   * @param {string[]} recipients
   * @returns {Promise<Object>} The inserted personal_nominations row.
   */
  window.insertSupabasePersonalNomination = async function (
    personalAwardId,
    category,
    placement,
    capacity,
    filmId,
    detail,
    recipients,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { data, error } = await ready.client.rpc("insert_personal_nomination", {
      p_personal_award_id: personalAwardId,
      p_category: category,
      p_placement: placement,
      p_capacity: capacity,
      p_film_id: filmId,
      p_detail: detail || "",
      p_recipients: [
        ...new Set(
          (recipients || []).map((name) => name.trim()).filter(Boolean),
        ),
      ],
    });
    if (error) throw error;
    return data;
  };

  /**
   * Deletes a personal nomination through the scoped RPC and marks its category review provisional.
   * @param {string} personalAwardId
   * @param {string} category
   * @param {number} placement
   * @param {string} filmId
   */
  window.deleteSupabasePersonalNomination = async function (
    personalAwardId,
    category,
    placement,
    filmId,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error } = await ready.client.rpc("delete_personal_nomination", {
      p_personal_award_id: personalAwardId,
      p_category: category,
      p_placement: placement,
      p_film_id: filmId,
    });
    if (error) throw error;
  };

  /**
   * Moves an already-placed personal nomination to a different placement in
   * the same category, atomically shifting every nomination between the old
   * and new spot, via the move_personal_nomination RPC - see its migration
   * for the exact shift contract. For reordering an existing nominee;
   * insertSupabasePersonalNomination() above is for adding one from the pool.
   * @param {string} personalAwardId
   * @param {string} category
   * @param {number} fromPlacement
   * @param {number} toPlacement
   * @param {string} filmId
   */
  window.moveSupabasePersonalNomination = async function (
    personalAwardId,
    category,
    fromPlacement,
    toPlacement,
    filmId,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error } = await ready.client.rpc("move_personal_nomination", {
      p_personal_award_id: personalAwardId,
      p_category: category,
      p_from_placement: fromPlacement,
      p_to_placement: toPlacement,
      p_film_id: filmId,
    });
    if (error) throw error;
  };

  /**
   * Updates one nomination's detail field (role name, song title, or
   * other work-specific context) directly - no placement change, so no
   * bump cascade needed.
   * @param {string} nominationId
   * @param {string} detail
   */
  window.updateSupabaseNominationDetail = async function (
    nominationId,
    detail,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error } = await ready.client
      .from("personal_nominations")
      .update({ detail: detail || null, updated_at: new Date().toISOString() })
      .eq("id", nominationId);
    if (error) throw error;
  };

  /**
   * Replaces one nomination's recipient list entirely (full delete then
   * insert, matching setSupabaseLocalRankOrder's own replace semantics).
   * @param {string} nominationId
   * @param {string[]} recipients
   * @returns {Promise<string[]>} New recipients left as plain text, with no catalog or TMDB person.
   */
  window.updateSupabaseNominationRecipients = async function (
    nominationId,
    recipients,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();

    let names = Array.from(
      new Set((recipients || []).map((name) => name.trim()).filter(Boolean)),
    );

    let { data: existingRows, error: selectError } = await ready.client
      .from("personal_nomination_recipients")
      .select("recipient_name")
      .eq("nomination_id", nominationId);
    if (selectError) throw selectError;

    let existingNames = new Set(
      (existingRows || []).map((r) => r.recipient_name),
    );
    let toAdd = names.filter((name) => !existingNames.has(name));
    let toDelete = (existingRows || []).filter(
      (r) => !names.includes(r.recipient_name),
    );

    let notAdded = [];
    if (toAdd.length) {
      await window.ensureCatalogIdentity?.();
      // A recipient links the existing person with that name, or else the
      // person TMDB finds for it; a name matching neither stays as plain
      // text, since no person is created without a TMDB ID. A lookup failure
      // also leaves plain text rather than blocking the award edit.
      let rows = [];
      for (let recipient_name of toAdd) {
        let personId = null;
        try {
          ({ personId } = await window.resolveSupabaseCatalogPerson(
            ready.client,
            { name: recipient_name },
          ));
        } catch (err) {
          console.warn(`Could not identify recipient "${recipient_name}"`, err);
        }
        if (!personId) notAdded.push(recipient_name);
        rows.push({
          nomination_id: nominationId,
          recipient_name,
          person_id: personId,
        });
      }
      let { error: insertError } = await ready.client
        .from("personal_nomination_recipients")
        .upsert(rows, {
          onConflict: "nomination_id,recipient_name",
          ignoreDuplicates: true,
        });
      if (insertError) throw insertError;
    }

    if (toDelete.length) {
      let { error: deleteError } = await ready.client
        .from("personal_nomination_recipients")
        .delete()
        .eq("nomination_id", nominationId)
        .in(
          "recipient_name",
          toDelete.map((r) => r.recipient_name),
        );
      if (deleteError) throw deleteError;
    }

    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    return notAdded;
  };

  /**
   * Writes the reviewed placement plan's single award category atomically.
   * @param {NominationPlacementPlan} plan Validated, applied placement plan.
   * @returns {Promise<void>} Resolves when the category is persisted.
   */
  window.persistSupabaseNominationPlacementPlan = async function (plan) {
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    if (!plan?.ok || !plan.applied)
      throw new Error("Apply a reviewed nomination plan before saving it.");
    let period = plan.nextPeriods[plan.periodKey];
    if (!period) throw new Error("Nomination period is missing.");
    let nominations = [];
    for (let film of period.films || []) {
      for (let award of film.awards || []) {
        if (
          award.category !== plan.category ||
          String(award.year) !== plan.periodKey ||
          window.getAwardPeriodType(award, period.periodType) !==
            plan.periodType
        )
          continue;
        if (!film.supabaseFilmId)
          throw new Error("Refresh the nominated film before editing it.");
        nominations.push({
          film_id: film.supabaseFilmId,
          placement: Number(award.placement),
          detail: window.awardDetail(award),
          recipients: (award.recipients || [])
            .map((person) =>
              typeof person === "string" ? person : person.name,
            )
            .filter(Boolean),
        });
      }
    }
    nominations.sort((a, b) => a.placement - b.placement);
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let { error } = await ready.client.rpc("replace_personal_award_category", {
      p_scope: plan.periodKey,
      p_scope_type: plan.periodType,
      p_category: plan.category,
      p_nominations: nominations,
    });
    if (error) throw error;
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    window.invalidateCachedSupabaseHydrationSource?.();
  };
})();
