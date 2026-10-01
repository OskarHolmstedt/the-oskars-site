/**
 * @file Background job execution client and durable runner for metadata
 * batches (issue #595, #499).
 *
 * Provides database RPC wrappers for atomic job enqueue, bounded claims with
 * worker leases (FOR UPDATE SKIP LOCKED), result recording with retry backoff,
 * cancellation, and authoritative film metadata writes. Also provides the
 * core headless worker execution loop usable by both Supabase Edge Functions
 * and Node integration test runners.
 */

/**
 * Asynchronously triggers the hosted metadata consumer Edge Function in Supabase.
 * @param {Object} client Supabase client instance.
 * @returns {Promise<void>}
 */
window.triggerHostedMetadataConsumer = async function (client) {
  if (!client) return;
  try {
    if (typeof client.functions?.invoke === "function") {
      client.functions
        .invoke("metadata-consumer", { body: {} })
        .catch((err) => {
          console.warn("Hosted metadata consumer trigger notice:", err);
        });
    }
  } catch (err) {
    console.warn("Could not trigger hosted metadata consumer:", err);
  }
};

/**
 * Creates a durable background metadata job and enqueues all candidate items atomically.
 * @param {Object} client Supabase client instance.
 * @param {'film_metadata'|'person_portrait'|'film_gaps'} kind Job category.
 * @param {Object[]} items Candidate item payloads with stable item_key/id.
 * @param {string} [idempotencyKey] Optional unique key to prevent duplicate jobs.
 * @param {number} [version=1] Intent payload schema version.
 * @returns {Promise<{job_id: string, status: string, total_items: number, existing: boolean}>}
 */
window.createBackgroundMetadataJob = async function (
  client,
  kind,
  items,
  idempotencyKey = null,
  version = 1,
) {
  if (!client) throw new Error("Supabase client is required.");
  if (!items?.length) throw new Error("No items provided for background job.");
  let { data, error } = await client.rpc("create_background_metadata_job", {
    p_kind: kind,
    p_items: items,
    p_idempotency_key: idempotencyKey,
    p_version: version,
  });
  if (error) throw error;
  window.triggerHostedMetadataConsumer(client);
  return data;
};

/**
 * Claims a bounded batch of pending or expired-lease job items for a worker.
 * @param {Object} client Supabase client instance.
 * @param {string} workerId Unique worker process/instance identifier.
 * @param {number} [batchSize=10] Maximum items to claim.
 * @param {number} [leaseSeconds=60] Duration in seconds before lease expires.
 * @returns {Promise<{item_id: string, job_id: string, job_kind: string, job_version: number, user_id: string, item_key: string, payload: Object, attempts: number}[]>}
 */
window.claimBackgroundJobItems = async function (
  client,
  workerId,
  batchSize = 10,
  leaseSeconds = 60,
) {
  if (!client) throw new Error("Supabase client is required.");
  let { data, error } = await client.rpc("claim_background_job_items", {
    p_worker_id: workerId,
    p_batch_size: batchSize,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  return data || [];
};

/**
 * Records the execution result of an individual job item, advancing parent job progress.
 * @param {Object} client Supabase client instance.
 * @param {string} itemId Item UUID.
 * @param {string} workerId Worker identifier matching the claim.
 * @param {boolean} success Whether the item processing succeeded.
 * @param {Object|null} [result=null] Durable result payload if successful.
 * @param {string|null} [errorMessage=null] Error details if failed.
 * @returns {Promise<Object>} Updated parent job summary.
 */
window.recordBackgroundJobItemResult = async function (
  client,
  itemId,
  workerId,
  success,
  result = null,
  errorMessage = null,
) {
  if (!client) throw new Error("Supabase client is required.");
  let { data, error } = await client.rpc("record_background_job_item_result", {
    p_item_id: itemId,
    p_worker_id: workerId,
    p_success: success,
    p_result: result,
    p_error: errorMessage,
  });
  if (error) throw error;
  return data;
};

/**
 * Cancels a background job and all its pending/processing items.
 * @param {Object} client Supabase client instance.
 * @param {string} jobId Job UUID.
 * @returns {Promise<boolean>} True when successfully cancelled.
 */
window.cancelBackgroundJob = async function (client, jobId) {
  if (!client) throw new Error("Supabase client is required.");
  let { data, error } = await client.rpc("cancel_background_job", {
    p_job_id: jobId,
  });
  if (error) throw error;
  return Boolean(data);
};

/**
 * Retries failed or cancelled items for a durable background job.
 * @param {Object} client Supabase client instance.
 * @param {string} jobId Job UUID.
 * @returns {Promise<{job_id: string, status: string, retried_items: number, processed_items: number, total_items: number}>}
 */
window.retryBackgroundJob = async function (client, jobId) {
  if (!client) throw new Error("Supabase client is required.");
  let { data, error } = await client.rpc("retry_background_job", {
    p_job_id: jobId,
  });
  if (error) throw error;
  window.triggerHostedMetadataConsumer(client);
  return data;
};

/**
 * Lists background jobs for the authenticated user with optional filtering.
 * @param {Object} client Supabase client instance.
 * @param {Object} [options] Filter options.
 * @param {'film_metadata'|'person_portrait'|'film_gaps'} [options.kind] Optional job kind filter.
 * @param {string|string[]} [options.status] Optional status or statuses filter.
 * @param {number} [options.limit=10] Maximum jobs to return.
 * @returns {Promise<Object[]>}
 */
window.listBackgroundJobs = async function (client, options = {}) {
  if (!client) throw new Error("Supabase client is required.");
  let query = client
    .from("background_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options.limit || 10);
  if (options.kind) {
    query = query.eq("kind", options.kind);
  }
  if (options.status) {
    if (Array.isArray(options.status)) {
      query = query.in("status", options.status);
    } else {
      query = query.eq("status", options.status);
    }
  }
  let { data, error } = await query;
  if (error) throw error;
  return data || [];
};

/**
 * Fetches the most recent active (pending or processing) background job for the authenticated user.
 * @param {Object} client Supabase client instance.
 * @param {'film_metadata'|'person_portrait'|'film_gaps'} [kind] Optional job kind filter.
 * @returns {Promise<Object|null>} The active job record or null if none active.
 */
window.getActiveBackgroundJob = async function (client, kind = null) {
  if (!client) throw new Error("Supabase client is required.");
  let query = client
    .from("background_jobs")
    .select("*")
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (kind) {
    query = query.eq("kind", kind);
  }
  let { data, error } = await query;
  if (error) throw error;
  return data?.[0] || null;
};

/**
 * Fetches a single background job record by its UUID.
 * @param {Object} client Supabase client instance.
 * @param {string} jobId Job UUID.
 * @returns {Promise<Object>} The job record.
 */
window.getBackgroundJob = async function (client, jobId) {
  if (!client) throw new Error("Supabase client is required.");
  let { data, error } = await client
    .from("background_jobs")
    .select(
      "id, user_id, kind, status, version, idempotency_key, total_items, processed_items, found_items, failed_items, error, created_at, started_at, finished_at, cancelled_at",
    )
    .eq("id", jobId)
    .single();
  if (error) throw error;
  return data;
};

/**
 * Fetches a background job record alongside its items.
 * @param {Object} client Supabase client instance.
 * @param {string} jobId Job UUID.
 * @param {Object} [options] Optional query filters.
 * @param {string} [options.columns] Comma-separated list of item columns to select. Defaults to lightweight set.
 * @param {string|string[]} [options.status] Optional item status or array of statuses to filter.
 * @returns {Promise<{job: Object, items: Object[]}>}
 */
window.getBackgroundJobDetails = async function (client, jobId, options = {}) {
  if (!client) throw new Error("Supabase client is required.");
  let job = await window.getBackgroundJob(client, jobId);

  let columns =
    options.columns || "id, item_key, status, payload, error, result";
  let query = client
    .from("background_job_items")
    .select(columns)
    .eq("job_id", jobId);

  if (options.status) {
    if (Array.isArray(options.status)) {
      query = query.in("status", options.status);
    } else {
      query = query.eq("status", options.status);
    }
  }

  let { data: items, error: itemsErr } = await query.order("created_at", {
    ascending: true,
  });
  if (itemsErr) throw itemsErr;

  return { job, items: items || [] };
};

/**
 * Atomically writes fetched film metadata to the shared catalog, respecting
 * authoritative write protections and fill-gaps classification rules.
 * @param {Object} client Supabase client instance.
 * @param {string} filmId Film UUID.
 * @param {Object} metadata Metadata payload (poster_url, country, runtime, classification, directors).
 * @returns {Promise<Object>} Outcome summary.
 */
window.applyBackgroundFilmMetadata = async function (client, filmId, metadata) {
  if (!client) throw new Error("Supabase client is required.");
  let { data, error } = await client.rpc("apply_background_film_metadata", {
    p_film_id: filmId,
    p_metadata: metadata,
  });
  if (error) throw error;
  return data;
};

/**
 * Executes a single bounded headless worker batch against pending background jobs.
 * @param {Object} client Supabase client instance.
 * @param {Object} options Worker options.
 * @param {string} options.workerId Unique worker ID.
 * @param {number} [options.batchSize=10] Max items to claim.
 * @param {number} [options.leaseSeconds=60] Lease timeout.
 * @param {(kind: string, payload: Object) => Promise<Object|null>} options.lookup Async item lookup function.
 * @param {(kind: string, itemKey: string, result: Object) => Promise<void>} [options.apply] Optional custom apply override.
 * @returns {Promise<{claimed: number, processed: number, succeeded: number, failed: number, items: Object[]}>}
 */
window.runBackgroundMetadataBatchWorker = async function (client, options) {
  let workerId =
    options.workerId || `worker-${Math.random().toString(36).slice(2, 9)}`;
  let batchSize = options.batchSize || 10;
  let leaseSeconds = options.leaseSeconds || 60;

  let claimed = await window.claimBackgroundJobItems(
    client,
    workerId,
    batchSize,
    leaseSeconds,
  );

  let summary = {
    claimed: claimed.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    items: [],
  };

  for (let item of claimed) {
    try {
      let payload = item.payload;
      let filmJob =
        item.job_kind === "film_metadata" || item.job_kind === "film_gaps";
      if (filmJob && !options.apply) {
        let prepared = await client.rpc("prepare_background_film_lookup", {
          p_film_id: item.item_key,
        });
        if (prepared.error) throw prepared.error;
        payload = prepared.data;
        if (!payload)
          throw new Error("Film lookup preparation returned no data");
      }
      let skipped =
        filmJob &&
        (payload?.tmdb_id || payload?.tmdb_tv_ref) &&
        !payload?.requested_fields?.length;
      let lookupResult = skipped
        ? { ...payload, checked_fields: [], skipped: true }
        : await options.lookup(item.job_kind, payload);
      if (!lookupResult) {
        await window.recordBackgroundJobItemResult(
          client,
          item.item_id,
          workerId,
          false,
          null,
          "No match found.",
        );
        summary.failed += 1;
        summary.items.push({
          item_id: item.item_id,
          item_key: item.item_key,
          job_kind: item.job_kind,
          payload: item.payload,
          status: "failed",
          result: null,
          error: "No match found.",
        });
      } else {
        if (skipped) {
          // A queued item may have been resolved since it was created.
        } else if (options.apply) {
          await options.apply(item.job_kind, item.item_key, lookupResult);
        } else if (
          item.job_kind === "film_metadata" ||
          item.job_kind === "film_gaps"
        ) {
          let applied = await window.applyBackgroundFilmMetadata(
            client,
            item.item_key,
            lookupResult,
          );
          if (applied?.success === false)
            throw new Error(applied.error || "Metadata was not saved");
          if (applied?.tmdb_field_outcomes)
            lookupResult.tmdb_field_outcomes = applied.tmdb_field_outcomes;
        } else if (item.job_kind === "person_portrait") {
          let { error: portraitErr } = await client.rpc(
            "save_person_tmdb_portrait",
            {
              p_person_id: item.item_key,
              p_tmdb_id: Number(lookupResult.tmdbId || lookupResult.providerId),
              p_portrait_url: lookupResult.url || lookupResult.poster?.url,
            },
          );
          if (portraitErr) throw portraitErr;
        }

        await window.recordBackgroundJobItemResult(
          client,
          item.item_id,
          workerId,
          true,
          lookupResult,
          null,
        );
        summary.succeeded += 1;
        summary.items.push({
          item_id: item.item_id,
          item_key: item.item_key,
          job_kind: item.job_kind,
          payload: item.payload,
          status: "completed",
          result: lookupResult,
          error: null,
        });
      }
    } catch (err) {
      let errorMsg = String(err?.message || err);
      await window.recordBackgroundJobItemResult(
        client,
        item.item_id,
        workerId,
        false,
        null,
        errorMsg,
      );
      summary.failed += 1;
      summary.items.push({
        item_id: item.item_id,
        item_key: item.item_key,
        job_kind: item.job_kind,
        payload: item.payload,
        status: "failed",
        result: null,
        error: errorMsg,
      });
    }
    summary.processed += 1;
  }

  return summary;
};

/**
 * Lists missing supported fields not previously unavailable for this identity.
 * @param {Object} film Catalog row with identity, metadata, credits and lookup outcomes.
 * @returns {string[]} Fields eligible for a TMDB lookup.
 */
window.tmdbFetchFields = function (film) {
  let reference =
    film.tmdb_tv_ref || (film.tmdb_id ? `movie:${film.tmdb_id}` : null);
  let outcomes = film.tmdb_field_outcomes?.[reference] || {};
  let fields = [
    "poster_url",
    "country",
    "runtime_minutes",
    "directors",
    "original_language",
    "year",
  ];
  if (!film.tmdb_tv_ref) fields.push("medium", "screenplay_type");
  return fields.filter((field) => {
    if (outcomes[field] === "unavailable") return false;
    if (field === "directors")
      return !(
        film.credits?.some((c) => c.role === "director") ||
        film.directors?.length ||
        film.director
      );
    return !film[field] || film[field] === "unknown";
  });
};
