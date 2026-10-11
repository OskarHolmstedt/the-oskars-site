/** @file Owns account profiles, portable account backups, and account deletion. */

(function () {
  /**
   * Loads the signed-in user's own profile row - auto-created
   * by the handle_new_user() trigger on signup, so this always finds a row
   * once signed in.
   * @returns {Promise<{id: string, display_name: string|null, public_slug: string|null}|null>}
   */
  window.loadSupabaseProfile = async function () {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") return null;

    let { data, error } = await ready.client
      .from("profiles")
      .select(
        "id, display_name, public_slug, letterboxd_username, letterboxd_last_synced_at",
      )
      .eq("id", authState.user.id)
      .single();
    if (error) throw error;
    return data;
  };

  /**
   * Sets the signed-in user's public-profile display name. No eligibility
   * check on this write - profiles carries no security-sensitive column
   * (see the profiles RLS policy comment), so any authenticated user may
   * set their own.
   * @param {string} displayName
   * @returns {Promise<{id: string, display_name: string|null}>}
   */
  window.setSupabaseProfileDisplayName = async function (displayName) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") throw new Error("Not signed in.");

    let { data, error } = await ready.client
      .from("profiles")
      .update({ display_name: displayName || null })
      .eq("id", authState.user.id)
      .select("id, display_name")
      .single();
    if (error) throw error;
    return data;
  };

  /**
   * Sets the signed-in user's Letterboxd username and optional last synced timestamp .
   * @param {string|null} username
   * @param {string|null} [lastSyncedAt]
   * @returns {Promise<{id: string, letterboxd_username: string|null, letterboxd_last_synced_at: string|null}>}
   */
  window.setSupabaseProfileLetterboxd = async function (
    username,
    lastSyncedAt = undefined,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") throw new Error("Not signed in.");

    let patch = {
      letterboxd_username: username ? String(username).trim() : null,
    };
    if (lastSyncedAt !== undefined) {
      patch.letterboxd_last_synced_at = lastSyncedAt;
    }

    let { data, error } = await ready.client
      .from("profiles")
      .update(patch)
      .eq("id", authState.user.id)
      .select(
        "id, display_name, public_slug, letterboxd_username, letterboxd_last_synced_at",
      )
      .single();
    if (error) throw error;
    return data;
  };

  /**
   * Updates the signed-in user's Letterboxd last-synced timestamp .
   * @param {string} lastSyncedAt ISO timestamp
   * @returns {Promise<{id: string, letterboxd_last_synced_at: string|null}>}
   */
  window.updateSupabaseProfileLetterboxdLastSynced = async function (
    lastSyncedAt,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") throw new Error("Not signed in.");

    let { data, error } = await ready.client
      .from("profiles")
      .update({ letterboxd_last_synced_at: lastSyncedAt })
      .eq("id", authState.user.id)
      .select("id, letterboxd_last_synced_at")
      .single();
    if (error) throw error;
    return data;
  };

  /**
   * Every table `delete_my_account()` cascades through when it deletes the
   * `auth.users` row - verified directly against every
   * `references auth.users(id) on delete cascade` table across the schema
   * migrations, not just the narrower set the Data page's restore-format
   * backup (`the-oskars-supabase-backup`) already covers. Deliberately
   * excludes `eligibility`: it cascade-deletes too, but carries no
   * client-facing policy at all (see its own table comment in
   * 20260830000000_initial_schema.sql) - an ordinary authenticated user
   * cannot select it directly, and it holds an internal gating flag, not
   * anything the account authored.
   */
  const SUPABASE_ACCOUNT_BACKUP_TABLES = [
    ["profiles", "*", ["id"]],
    ["watched", "*", ["id"]],
    ["watchlist", "*", ["position", "id"]],
    ["tags", "*", ["id"]],
    ["film_tags", "*", ["film_id", "tag_id"]],
    ["rankings", "*, ranking_entries(*)", ["id"]],
    [
      "personal_awards",
      "*, personal_nominations(*, personal_nomination_recipients(*))",
      ["id"],
    ],
    ["collections", "*, collection_items(*)", ["id"]],
    ["projects", "*", ["id"]],
    [
      "local_ranks",
      "*",
      ["collection_kind", "collection_id", "position", "film_id"],
    ],
    ["ranking_pair_reviews", "*", ["scope", "film_id_a", "film_id_b"]],
    ["award_reviews", "*", ["year", "category"]],
    ["award_pool_exclusions", "*", ["year", "film_id"]],
    ["collection_ballots", "*", ["id"]],
    ["entity_notes", "*", ["id"]],
    ["declined_official_watchlist_adds", "*", ["film_id"]],
    ["intake_workflows", "*", ["id"]],
  ];

  /**
   * Builds a portable backup of every per-user table the signed-in account owns before destructive account operations.
   * @returns {Promise<{format: string, version: number, exportedAt: string, account: {id: string, email: string|null}, tables: Object}>}
   */
  window.buildSupabaseAccountBackup = async function () {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") throw new Error("Not signed in.");
    let client = ready.client;
    let tableRows = await Promise.all(
      SUPABASE_ACCOUNT_BACKUP_TABLES.map(([table, select, orderColumns]) =>
        window.supabaseWorkspaceContext.fetchAllSupabaseRows((withCount) => {
          let query = client
            .from(table)
            .select(select, withCount ? { count: "exact" } : undefined);
          for (let column of orderColumns) query = query.order(column);
          return query;
        }),
      ),
    );
    let tables = {};
    SUPABASE_ACCOUNT_BACKUP_TABLES.forEach(([table], index) => {
      tables[table] = tableRows[index];
    });
    return {
      format: "the-oskars-account-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      account: { id: authState.user.id, email: authState.user.email || null },
      tables,
    };
  };

  /**
   * Permanently deletes the signed-in Supabase account and its app-owned data.
   * @returns {Promise<void>}
   */
  window.deleteSupabaseAccount = async function () {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") throw new Error("Not signed in.");
    let { error } = await ready.client.rpc("delete_my_account");
    if (error) throw error;
  };
})();
