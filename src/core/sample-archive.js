/**
 * @file A small, unmistakably fictional canonical archive (issue #252),
 * offered as the "sample archive" first-run onboarding choice. Every film,
 * person, and award below is invented for this purpose and is not part of
 * the private canonical dataset - except officialResults, which is the same
 * real, bundled Academy Awards reference data every fresh state gets
 * (issue #277), included so the sample demonstrates that comparison too.
 */

window.OSKARS_SAMPLE_ARCHIVE = {
  canonicalSchemaVersion: 1,
  years: {
    1994: {
      periodType: "years",
      films: [
        {
          id: "1994::the-paper-lantern",
          title: "The Paper Lantern",
          year: "1994",
          director: "Priya Anand (fictional)",
          medium: "live-action",
          awards: [
            { category: "Best Picture", year: "1994", placement: 1 },
            {
              category: "Best Director",
              year: "1994",
              placement: 1,
              recipients: [
                {
                  name: "Priya Anand (fictional)",
                  personId: "priya anand (fictional)",
                },
              ],
            },
          ],
        },
        {
          id: "1994::midnight-crossing",
          title: "Midnight Crossing",
          year: "1994",
          director: "Tomas Reyk (fictional)",
          medium: "live-action",
          awards: [{ category: "Best Picture", year: "1994", placement: 2 }],
        },
      ],
    },
    2003: {
      periodType: "years",
      films: [
        {
          id: "2003::glasswing",
          title: "Glasswing",
          year: "2003",
          director: "Nora Belin (fictional)",
          medium: "animation",
          awards: [
            { category: "Best Picture", year: "2003", placement: 1 },
            {
              category: "Best Original Screenplay",
              year: "2003",
              placement: 1,
            },
          ],
        },
      ],
    },
    2012: {
      periodType: "years",
      films: [
        {
          id: "2012::the-longest-tide",
          title: "The Longest Tide",
          year: "2012",
          director: "Marcus Oyelaran (fictional)",
          medium: "live-action",
          awards: [{ category: "Best Picture", year: "2012", placement: 3 }],
        },
      ],
    },
    2021: {
      periodType: "years",
      films: [
        {
          id: "2021::seventeen-postcards",
          title: "Seventeen Postcards",
          year: "2021",
          director: "Elin Vosberg (fictional)",
          medium: "live-action",
          awards: [
            { category: "Best Picture", year: "2021", placement: 1 },
            {
              category: "Best Actress",
              year: "2021",
              placement: 1,
              recipients: [
                {
                  name: "Dana Okafor (fictional)",
                  personId: "dana okafor (fictional)",
                },
              ],
            },
          ],
        },
        {
          id: "2021::circuit-breaker",
          title: "Circuit Breaker",
          year: "2021",
          director: "Sam Whitlock (fictional)",
          medium: "live-action",
          awards: [{ category: "Best Picture", year: "2021", placement: 2 }],
        },
      ],
    },
  },
  // The real Academy Awards record isn't fictional like the rest of this
  // archive - it's the same bundled reference data every fresh state gets
  // (issue #277), included here too so the sample demonstrates the Real
  // Oscars comparison feature.
  officialResults: JSON.parse(
    JSON.stringify(window.OSKARS_BUNDLED_OFFICIAL_RESULTS || {}),
  ),
  collectionAwards: { director: {}, franchise: {} },
  watchlist: [
    {
      id: "watchlist::the-quiet-orbit",
      title: "The Quiet Orbit",
      year: "2024",
      director: "Fictional Director",
      tier: "A",
    },
  ],
  watchedFilms: [],
  intakeWorkflows: [],
  projects: [],
  watchlistProjectSources: {},
  peopleAliases: {},
  rejectedPersonAliases: [],
  personPortraits: {},
  franchiseLinks: {},
  directorLinks: {},
  entityNotes: {
    people: {},
    periods: {},
    franchises: {},
    tags: {},
    categories: {},
    projects: {},
  },
  localRanks: { franchises: {}, people: {}, tags: {} },
  editLog: [],
};
