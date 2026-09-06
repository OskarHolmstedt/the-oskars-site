/**
 * @file A scoped-down account gate for Supabase-backed pages (issue #414,
 * now backing the real rate-watched.html - issue #420), mirroring
 * src/core/account-access.js's planOskarsAccountAccess() pure-
 * function shape and renderOskarsAccountGate()'s general posture, but
 * deliberately much smaller: no bound-account-UID tracking, no navigation
 * handoff, no different-account detection. Those belonged to the previous
 * gate to protect against a *persistent local IndexedDB mirror* leaking a
 * previous account's data into a new session - supabase-workspace.js has
 * no such local persistence at all (its cache already clears itself on
 * account switch, issue #413), so there's nothing for that machinery to
 * guard here.
 *
 * Can only ever check "is someone signed in," never "is this account
 * eligible" - private.is_eligible() lives in a schema not in the exposed
 * API's schema list (supabase/config.toml), by deliberate design
 * (docs/supabase-backend-decision.md's "Auth and eligibility" section): a
 * client discovers ineligibility reactively, by a write/read coming back
 * empty, never by asking first. An ineligible signed-in user passes this
 * gate and then simply sees no films to rate.
 *
 * The signed-out landing content below (home welcome + six per-destination
 * teasers, issues #340/#346) was carried over from the pre-Supabase
 * src/core/account-access.js, deleted alongside the rest of the dead
 * Firebase subsystem (epic #428 Phase 3, commit c44d485) once this file
 * became the one gate every entry reaches. window.OSKARS_ENTRY
 * (entry-loader.js) is what lets that decision happen here without
 * threading an extra parameter through either renderSupabaseAccountGate()
 * call site.
 */

/**
 * Plans access to a Supabase-backed owner page without reading its data.
 * Pure function - Node-testable without any Supabase client involved.
 * @param {{configured?: boolean, authStatus?: string, user?: Object, error?: string}} input
 * @returns {{allowed: boolean, status: string, user?: Object, error?: string}}
 */
window.planSupabaseAccountGate = function (input) {
  if (!input.configured) return { allowed: false, status: "unconfigured" };
  if (input.authStatus !== "signed-in" || !input.user?.id)
    return {
      allowed: false,
      status: input.authStatus || "signed-out",
      ...(input.error ? { error: input.error } : {}),
    };
  return { allowed: true, status: "signed-in", user: input.user };
};

/**
 * Resolves the current Supabase account-gate decision, end to end.
 * @returns {Promise<{allowed: boolean, status: string, user?: Object, error?: string}>}
 */
window.resolveSupabaseAccountGate = async function () {
  let configured = Boolean(window.oskarsSupabaseConfigured?.());
  if (!configured) return window.planSupabaseAccountGate({ configured });
  let auth = await window.resolveSupabaseAuthState();
  return window.planSupabaseAccountGate({
    configured,
    authStatus: auth?.status,
    user: auth?.user,
    error: auth?.error,
  });
};

// Signed-out home/teaser hero poster deck - purely decorative (aria-hidden),
// unrelated to the visitor's own archive.
const SIGNED_OUT_POSTERS = [
  {
    title: "Portrait of a Lady on Fire",
    url: "https://image.tmdb.org/t/p/w500/rUDuOKpkKBHxx41BScqKej72iT3.jpg",
  },
  {
    title: "Apocalypse Now",
    url: "https://image.tmdb.org/t/p/w500/gQB8Y5RCMkv2zwzFHbUJX3kAhvA.jpg",
  },
  {
    title: "Dune",
    url: "https://image.tmdb.org/t/p/w500/4kJmUCE7mkVJjXa7A0g2rY4IGTm.jpg",
  },
  {
    title: "Little Women",
    url: "https://image.tmdb.org/t/p/w500/1ZzH1XMcKAe5NdrKL5MfcqZHHsZ.jpg",
  },
  {
    title: "Seven Samurai",
    url: "https://image.tmdb.org/t/p/w500/lOMGc8bnSwQhS4XyE1S99uH8NXf.jpg",
  },
];

/**
 * Shared hero markup for the signed-out home welcome and every per-page
 * teaser - same poster deck and layout, different copy.
 * @param {{eyebrow: string, heading: string, description: string}} copy
 */
function welcomeHeroHtml({ eyebrow, heading, description }) {
  let escape = window.pageEscape;
  let posters = SIGNED_OUT_POSTERS.map(
    (poster, index) =>
      `<span class="account-welcome-poster" style="--welcome-offset:${(index - 2) * 63}px;--welcome-mobile-offset:${(index - 2) * 44}px;--welcome-rotate:${(index - 2) * 5}deg" title="${escape(poster.title)}"><img src="${poster.url}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer"></span>`,
  ).join("");
  return `<section class="account-welcome-hero" aria-labelledby="accountWelcomeTitle">
      <div class="account-welcome-copy">
        <span class="eyebrow">${eyebrow}</span>
        <h1 id="accountWelcomeTitle">${heading}</h1>
        <p>${description}</p>
      </div>
      <div class="account-welcome-visual">
        <div class="account-welcome-poster-deck" aria-hidden="true">${posters}</div>
        <p class="account-welcome-attribution">Poster images from <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </div>
    </section>`;
}

/**
 * Shared sign-in call-to-action below every landing hero. Uses the same
 * [data-supabase-gate-button] hook the plain gate markup below uses, so
 * renderSupabaseAccountGate()'s one existing
 * renderGoogleSignInButtonForSupabase call wires all three content variants.
 */
function welcomeSignInHtml() {
  return `<section class="account-welcome-signin" aria-labelledby="accountWelcomeSignIn">
      <div><span class="eyebrow">Private by design</span><h2 id="accountWelcomeSignIn">Bring your archive with you</h2><p>Sign in to open your private workspace and keep it synchronized with your account.</p></div>
      <div class="account-welcome-signin-action"><div data-supabase-gate-button></div><p>No browser archive is loaded or uploaded until sign-in succeeds and you explicitly connect this browser.</p></div>
    </section>`;
}

function signedOutHomeContent() {
  return `<div class="account-welcome">
    ${welcomeHeroHtml({
      eyebrow: "Your personal film world",
      heading: "A home for the films you watch, rank, and remember.",
      description:
        "The Oskars turns a lifetime of watching into a living archive—your ratings, your awards, your watchlists, and the journeys still ahead.",
    })}
    <section class="account-welcome-features" aria-label="What The Oskars can do">
      <article><span aria-hidden="true">✦</span><h2>Keep your film life together</h2><p>Collect watched films, ratings, notes, people, franchises, and every detail you want to remember.</p></article>
      <article><span aria-hidden="true">★</span><h2>Build your own canon</h2><p>Rank films across years and eras, create personal award ballots, and see the taste that emerges.</p></article>
      <article><span aria-hidden="true">→</span><h2>Know what comes next</h2><p>Shape watchlists into focused projects, follow your progress, and always have a meaningful next film.</p></article>
    </section>
    ${welcomeSignInHtml()}
  </div>`;
}

/** True only for a signed-out visit to index.html's own <main class="home-shell">. */
function isSignedOutHome(access, host) {
  return Boolean(
    access?.status === "signed-out" &&
      host?.classList?.contains?.("home-shell"),
  );
}

// Signed-out previews for the six primary-destination pages besides Home: a
// scaled-down version of home's hero (no features strip) per page.
const SIGNED_OUT_TEASERS = {
  periods: {
    eyebrow: "Every era, mapped",
    heading: "Decades of awards, laid out year by year.",
    description:
      "Walk the full period matrix—every year, decade, and century—and open any of them onto its own awards, rankings, and film history.",
  },
  categories: {
    eyebrow: "Category by category",
    heading: "Every award category, its full history.",
    description:
      "Browse every category that shapes your personal Oskars and jump straight into any year's nominees, winners, and how your picks compare to the official record.",
  },
  franchises: {
    eyebrow: "Series, sagas, and sequels",
    heading: "Every franchise, tracked start to finish.",
    description:
      "See what you've watched, what's left, and how a whole series ranks against itself—from trilogies to decades-spanning sagas.",
  },
  watchlist: {
    eyebrow: "What's next",
    heading: "Your queue, ranked and ready.",
    description:
      "Hold everything you plan to watch with real interest tiers, then turn a filtered slice of it straight into your next watch project.",
  },
  watched: {
    eyebrow: "Everything you've seen",
    heading: "Every film you've watched, ranked and remembered.",
    description:
      "Your complete watched history in one place—ratings, rewatches, and the running average of the taste you've built over time.",
  },
  projects: {
    eyebrow: "Guided journeys",
    heading: "Turn a watchlist into a real plan.",
    description:
      "Queue up a director's filmography, a franchise, or a custom set as a workflow-ordered project, and follow your progress through it.",
  },
};

/**
 * Which of the six teasers (if any) a signed-out visit should show, from
 * window.OSKARS_ENTRY (entry-loader.js) plus, for the shared "period" entry,
 * the query string that disambiguates Watched from Watchlist.
 * @returns {string} A SIGNED_OUT_TEASERS key, or "" for no teaser.
 */
function signedOutTeaserKey() {
  let entry = String(window.OSKARS_ENTRY || "");
  if (Object.prototype.hasOwnProperty.call(SIGNED_OUT_TEASERS, entry))
    return entry;
  if (entry === "period") {
    let params = new URLSearchParams(window.location?.search || "");
    if (params.get("type") === "alltime" && params.get("view") === "watchlist")
      return "watchlist";
    if (params.get("type") === "alltime" && params.get("view") === "films")
      return "watched";
  }
  return "";
}

function signedOutTeaserContent(teaser) {
  return `<div class="account-welcome">${welcomeHeroHtml(teaser)}${welcomeSignInHtml()}</div>`;
}

/**
 * Renders a minimal sign-in/status gate into `container`. The transient
 * "loading" status is handled first and separately, non-destructively (see
 * inside) - every other status replaces `container`'s entire contents, since
 * the page's own controller script never loads while blocked. Reuses the
 * real Google sign-in button (renderGoogleSignInButtonForSupabase) rather
 * than a placeholder - the gate is only "done" once a real sign-in through
 * it actually works.
 *
 * A signed-out visit to the home page or one of six per-destination
 * teasers (Periods/Categories/Franchises/Watchlist/Watched/Projects) gets
 * the rich landing content instead of the plain message below, and keeps
 * the shared header visible in a decluttered "landing" mode
 * (data-account-landing) rather than the header-hidden treatment every
 * other blocked page still gets (data-site-header-pending). The header
 * toggle only runs once past the "loading" status too, so the
 * already-painted header (entry-loader.js's renderStaticSiteHeader) never
 * flashes hidden before a signed-in visit's real header renders.
 * @param {{allowed: boolean, status: string, error?: string}} access
 * @param {Element} container
 */
window.renderSupabaseAccountGate = function (access, container) {
  if (!container) return;
  let escape = window.pageEscape;
  if (access.status === "loading") {
    // Non-destructive, unlike every other status below: data.html already
    // has real static markup in <main> (named sections data.js later finds
    // by id) before any script runs, and this transient check resolves
    // before data.js ever loads - overwriting container.innerHTML here to
    // show a "checking" message would permanently destroy that markup for
    // a signed-in visit too, crashing data.js's first getElementById() call.
    // A small prepended overlay, cleaned up once access resolves (see the
    // matching call in entry-loader.js), covers the same "avoid a blank
    // flash on an empty-shell page" need without touching real content.
    let overlay = container.querySelector(
      "[data-supabase-account-gate-loading]",
    );
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.setAttribute("data-supabase-account-gate-loading", "");
      overlay.className = "account-gate";
      container.prepend(overlay);
    }
    overlay.innerHTML = `<p>${escape("Checking your account...")}</p>`;
    return;
  }
  container.querySelector("[data-supabase-account-gate-loading]")?.remove();
  if (access.allowed) return;
  let signedOutHome = isSignedOutHome(access, container);
  let teaserKey =
    !signedOutHome && access?.status === "signed-out"
      ? signedOutTeaserKey()
      : "";
  let signedOutLanding = signedOutHome || Boolean(teaserKey);
  let header = document.querySelector(".app-header");
  if (signedOutLanding) {
    header?.removeAttribute?.("data-site-header-pending");
    header?.setAttribute?.("data-account-landing", "");
    // renderStaticHeaderAuth() already ran once, before this gate could
    // know landing status, and baked in the compact icon button
    // (renderGoogleSignInButtonForSupabase checks data-account-landing
    // at call time, not reactively) - re-run it now that the attribute
    // is set, so the header's own button switches to the full pill.
    window.renderStaticHeaderAuth?.();
  } else {
    header?.removeAttribute?.("data-account-landing");
    header?.setAttribute?.("data-site-header-pending", "");
  }
  let messages = {
    unconfigured: "Supabase isn't configured for this deployment.",
    offline: "You appear to be offline - reconnect and reload.",
    error: access.error || "Something went wrong checking your account.",
  };
  let message =
    messages[access.status] ||
    "Sign in with Google to rate your watched films.";
  container.innerHTML = signedOutHome
    ? signedOutHomeContent()
    : teaserKey
      ? signedOutTeaserContent(SIGNED_OUT_TEASERS[teaserKey])
      : `<div class="account-gate">
    <p>${escape(message)}</p>
    <div data-supabase-gate-button></div>
  </div>`;
  if (access.status === "signed-out") {
    window.renderGoogleSignInButtonForSupabase?.(
      container.querySelector("[data-supabase-gate-button]"),
    );
    // A completed sign-in only updates the header's own small auth-status
    // button (entry-loader.js/site-header.js's own onSupabaseAuthChange
    // subscriptions) - nothing tells this blocked page to proceed, so
    // without this it silently sits on the gate until a manual reload.
    // Mirrors the pre-Supabase account-access.js's
    // continueOskarsAccountSignIn(), which did the same reload once a
    // sign-in was confirmed.
    window.onSupabaseAuthChange?.((user) => {
      if (user) window.location.reload();
    });
  }
};
