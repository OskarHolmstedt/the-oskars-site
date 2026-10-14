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
   * Loads the user profiles followed by the signed-in user, along with mutual friendship status.
   * @returns {Promise<Array<{id: string, follower_id: string, following_id: string, created_at: string, profile: {display_name: string|null, public_slug: string|null}, isMutualFriend: boolean}>>}
   */
  window.listSupabaseFollowing = async function () {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") return [];

    let [followingRes, followersRes] = await Promise.all([
      ready.client
        .from("user_follows")
        .select(
          "id, follower_id, following_id, created_at, following:profiles!user_follows_following_id_fkey(id, display_name, public_slug)",
        )
        .eq("follower_id", authState.user.id)
        .order("created_at", { ascending: false }),
      ready.client
        .from("user_follows")
        .select("follower_id")
        .eq("following_id", authState.user.id),
    ]);

    if (followingRes.error) {
      // Fallback without explicit fkey alias if PostgREST schema cache needs it
      let fallback = await ready.client
        .from("user_follows")
        .select("id, follower_id, following_id, created_at")
        .eq("follower_id", authState.user.id)
        .order("created_at", { ascending: false });
      if (fallback.error) throw fallback.error;
      let targetIds = (fallback.data || []).map((r) => r.following_id);
      let profilesMap = new Map();
      if (targetIds.length) {
        let profilesRes = await ready.client
          .from("profiles")
          .select("id, display_name, public_slug")
          .in("id", targetIds);
        if (!profilesRes.error) {
          (profilesRes.data || []).forEach((p) => profilesMap.set(p.id, p));
        }
      }
      let followerIds = new Set(
        (followersRes.data || []).map((r) => r.follower_id),
      );
      return (fallback.data || []).map((row) => ({
        ...row,
        profile: profilesMap.get(row.following_id) || null,
        isMutualFriend: followerIds.has(row.following_id),
      }));
    }

    let followerIds = new Set(
      (followersRes.data || []).map((r) => r.follower_id),
    );
    return (followingRes.data || []).map((row) => ({
      ...row,
      profile: row.following || null,
      isMutualFriend: followerIds.has(row.following_id),
    }));
  };

  /**
   * Follows a user by their user ID.
   * @param {string} followingId Target user UUID.
   * @returns {Promise<Object>}
   */
  window.followSupabaseUser = async function (followingId) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") throw new Error("Not signed in.");

    let { data, error } = await ready.client
      .from("user_follows")
      .insert({
        follower_id: authState.user.id,
        following_id: followingId,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  };

  /**
   * Unfollows a user by their user ID.
   * @param {string} followingId Target user UUID.
   * @returns {Promise<void>}
   */
  window.unfollowSupabaseUser = async function (followingId) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") throw new Error("Not signed in.");

    let { error } = await ready.client
      .from("user_follows")
      .delete()
      .eq("follower_id", authState.user.id)
      .eq("following_id", followingId);
    if (error) throw error;
  };

  /**
   * Checks whether the signed-in user follows a target user or public slug.
   * @param {string} targetSlugOrId Public slug or UUID of the target.
   * @returns {Promise<{isFollowing: boolean, isMutualFriend: boolean, targetUserId: string|null}>}
   */
  window.checkSupabaseFollowing = async function (targetSlugOrId) {
    let ready = await window.ensureSupabaseClient();
    if (!ready)
      return { isFollowing: false, isMutualFriend: false, targetUserId: null };
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in" || !targetSlugOrId) {
      return { isFollowing: false, isMutualFriend: false, targetUserId: null };
    }

    let isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        targetSlugOrId,
      );
    let targetUserId = isUuid ? targetSlugOrId : null;
    if (!isUuid) {
      let { data: profile } = await ready.client
        .from("profiles")
        .select("id")
        .eq("public_slug", targetSlugOrId)
        .maybeSingle();
      targetUserId = profile?.id || null;
    }

    if (!targetUserId || targetUserId === authState.user.id) {
      return { isFollowing: false, isMutualFriend: false, targetUserId };
    }

    let [followingRes, followersRes] = await Promise.all([
      ready.client
        .from("user_follows")
        .select("id")
        .eq("follower_id", authState.user.id)
        .eq("following_id", targetUserId)
        .maybeSingle(),
      ready.client
        .from("user_follows")
        .select("id")
        .eq("follower_id", targetUserId)
        .eq("following_id", authState.user.id)
        .maybeSingle(),
    ]);

    return {
      isFollowing: Boolean(followingRes.data),
      isMutualFriend: Boolean(followingRes.data && followersRes.data),
      targetUserId,
    };
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
    ["watchlist_order_groups", "*", ["id"]],
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
    ["user_follows", "*", ["id"]],
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
