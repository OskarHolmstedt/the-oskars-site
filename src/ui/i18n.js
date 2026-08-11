/** @file Owns persisted locale selection, keyed and literal translations, interpolation, and localized labels. */

(function () {
  window.OSKARS_LOCALE_KEY = "oskars-locale";

  let translations = {
    "nav.home": { sv: "Hem" },
    "nav.periods": { sv: "Perioder" },
    "nav.categories": { sv: "Kategorier" },
    "nav.franchises": { sv: "Franchises" },
    "nav.watchlist": { sv: "Watchlist" },
    "nav.watched": { sv: "Sett" },
    "nav.projects": { sv: "Projekt" },
    "nav.compare": { sv: "Jämför" },
    "nav.editor": { sv: "Editor" },
    "nav.data": { sv: "Data" },
    "nav.intake": { sv: "Intag" },
    "action.view": { sv: "Visa" },
    "search.placeholder": { sv: "Sök" },
    "search.aria": { sv: "Sök i The Oskars" },
    "search.type.film": { sv: "Film" },
    "search.type.watchlist": { sv: "Watchlist" },
    "search.type.person": { sv: "Person" },
    "search.type.song": { sv: "Låt" },
    "search.type.role": { sv: "Roll" },
    "search.type.subfranchise": { sv: "Subfranchise" },
    "search.type.franchise": { sv: "Franchise" },
    "search.type.project": { sv: "Projekt" },
    "search.type.category": { sv: "Kategori" },
    "search.type.tag": { sv: "Tagg" },
    "search.type.year": { sv: "År" },
    "search.type.decade": { sv: "Årtionde" },
    "search.type.century": { sv: "Århundrade" },
    "search.type.period": { sv: "Period" },
    "search.meta.tier": { sv: "Tier" },
    "search.meta.inArchive": { sv: "Sedd" },
    "search.meta.watchlist": { sv: "Watchlist" },
    "search.meta.watched": { sv: "sedda" },
    "search.meta.open": { sv: "Öppet" },
    "search.meta.complete": { sv: "Klart" },
    "search.meta.archived": { sv: "Arkiverat" },
    "menu.categories": { sv: "Kategorier" },
    "menu.periods": { sv: "Perioder" },
    "menu.browsePeriods": { sv: "Bläddra bland alla perioder" },
    "menu.elsewhere": { sv: "Annat" },
    "menu.discover": { sv: "Upptäck" },
    "menu.showcase": { sv: "Utställning" },
    "menu.browseCategories": { sv: "Bläddra bland alla kategorier" },
    "menu.tags": { sv: "Taggar" },
    "menu.people": { sv: "Personer" },
    "menu.completion": { sv: "Färdigställande" },
    "menu.statistics": { sv: "Statistik" },
    "menu.openDirectory": { sv: "Öppna sidkatalog" },
    "theme.switch": { sv: "Byt färgtema" },
    "theme.switchTo": { sv: "Byt till {mode} läge" },
    "theme.light": { sv: "ljust" },
    "theme.dark": { sv: "mörkt" },
    "theme.papyrus": { sv: "papyrus" },
    "posterGrid.switchOn": { sv: "Visa endast affischer" },
    "posterGrid.switchOff": { sv: "Visa filmdetaljer" },
    "language.switchTo": { sv: "Switch to English" },
    "language.current": { sv: "Svenska" },
    "language.next": { sv: "EN" },
    "period.allTime": { sv: "All-time" },
  };

  let literalTranslations = {
    "{count} changes": { sv: "{count} ändringar" },
    "1 change": { sv: "1 ändring" },
    Aliases: { sv: "Alias" },
    "Applied time": { sv: "Tillämpningstid" },
    "All targets": { sv: "Alla mål" },
    Context: { sv: "Kontext" },
    "Entry id": { sv: "Post-id" },
    "Film metadata": { sv: "Filmmetadata" },
    Imports: { sv: "Importer" },
    Inspect: { sv: "Granska" },
    Nominations: { sv: "Nomineringar" },
    "No context recorded.": { sv: "Ingen kontext registrerad." },
    "No recorded changes.": { sv: "Inga registrerade ändringar." },
    Notes: { sv: "Anteckningar" },
    Other: { sv: "Övrigt" },
    Projects: { sv: "Projekt" },
    Target: { sv: "Mål" },
    "Target id": { sv: "Mål-id" },
    "Watchlist metadata": { sv: "Watchlistmetadata" },
    Undo: { sv: "Ångra" },
    Undone: { sv: "Ångrad" },
    Undoable: { sv: "Kan ångras" },
    "Not undoable": { sv: "Kan inte ångras" },
    "Undo of": { sv: "Ångrar post" },
    "Undo preview": { sv: "Förhandsgranska ångring" },
    "Confirm undo": { sv: "Bekräfta ångring" },
    Cancel: { sv: "Avbryt" },
    "Restores {count} field(s). Nothing changes until you confirm.": {
      sv: "Återställer {count} fält. Inget ändras förrän du bekräftar.",
    },
    "Blocked: the target changed after this edit.": {
      sv: "Blockerad: målet har ändrats efter denna redigering.",
    },
    "Blocked: the edited item no longer exists.": {
      sv: "Blockerad: den redigerade posten finns inte längre.",
    },
    "This edit was already undone.": {
      sv: "Denna redigering är redan ångrad.",
    },
    "This edit has no reversible payload.": {
      sv: "Denna redigering saknar återställningsdata.",
    },
    "Assign explicit decade placements. Blank placements are excluded.": {
      sv: "Tilldela uttryckliga årtiondeplaceringar. Tomma placeringar utesluts.",
    },
    "Build one decade category from its annual nominees.": {
      sv: "Bygg en årtiondekategori från de årliga nomineringarna.",
    },
    "Choose year": { sv: "Välj år" },
    "Credit source": { sv: "Källa för priskredit" },
    "Merge annual category": { sv: "Slå ihop årlig kategori" },
    "Merge annual category?": { sv: "Slå ihop årlig kategori?" },
    "Preview merge": { sv: "Förhandsgranska sammanslagning" },
    "This creates the decade category.": {
      sv: "Detta skapar årtiondekategorin.",
    },
    "This replaces {count} existing decade nomination(s) in this category.": {
      sv: "Detta ersätter {count} befintliga årtiondenominering(ar) i kategorin.",
    },
    "Assign explicit century placements. Blank placements are excluded.": {
      sv: "Tilldela uttryckliga århundradeplaceringar. Tomma placeringar utesluts.",
    },
    "Assign explicit all-time placements. Blank placements are excluded.": {
      sv: "Tilldela uttryckliga all-time-placeringar. Tomma placeringar utesluts.",
    },
    "Build one century category from its decade nominees.": {
      sv: "Bygg en århundradekategori från årtiondenomineringarna.",
    },
    "Build the all-time category from its century nominees.": {
      sv: "Bygg all-time-kategorin från århundradenomineringarna.",
    },
    "Choose decade": { sv: "Välj årtionde" },
    "Choose century": { sv: "Välj århundrade" },
    "Merge decade category": { sv: "Slå ihop årtiondekategori" },
    "Merge decade category?": { sv: "Slå ihop årtiondekategori?" },
    "Merge century category": { sv: "Slå ihop århundradekategori" },
    "Merge century category?": { sv: "Slå ihop århundradekategori?" },
    "This creates the century category.": {
      sv: "Detta skapar århundradekategorin.",
    },
    "This creates the all-time category.": {
      sv: "Detta skapar all-time-kategorin.",
    },
    "This replaces {count} existing century nomination(s) in this category.": {
      sv: "Detta ersätter {count} befintliga århundradenominering(ar) i kategorin.",
    },
    "This replaces {count} existing all-time nomination(s) in this category.": {
      sv: "Detta ersätter {count} befintliga all-time-nominering(ar) i kategorin.",
    },
    "A read-only summary of ratings, coverage, and viewing habits. Counts reflect the currently loaded archive.":
      {
        sv: "En skrivskyddad sammanfattning av betyg, täckning och tittarvanor. Antalen speglar det arkiv som är inläst.",
      },
    "Average rating": { sv: "Snittbetyg" },
    Avg: { sv: "Snitt" },
    "average rating": { sv: "snittbetyg" },
    "Standard deviation": { sv: "Standardavvikelse" },
    "standard deviation": { sv: "standardavvikelse" },
    "Rated coverage": { sv: "Betygstäckning" },
    coverage: { sv: "täckning" },
    "Award trends already have dedicated views at every scale.": {
      sv: "Pristrender har redan egna vyer på varje nivå.",
    },
    "Browse award categories": { sv: "Bläddra bland priskategorier" },
    "Browse award periods": { sv: "Bläddra bland prisperioder" },
    "How often your annual category winner matches the official Academy winner.": {
      sv: "Hur ofta din årliga kategorivinnare matchar den officiella Academy-vinnaren.",
    },
    "Overall agreement": { sv: "Total överensstämmelse" },
    "{matches} of {total} comparable category-periods": {
      sv: "{matches} av {total} jämförbara kategori-perioder",
    },
    "Comparable category-periods": { sv: "Jämförbara kategori-perioder" },
    "Categories compared": { sv: "Jämförda kategorier" },
    "Award periods compared": { sv: "Jämförda prisperioder" },
    Agreement: { sv: "Överensstämmelse" },
    Matches: { sv: "Matchningar" },
    Differences: { sv: "Skillnader" },
    "By decade": { sv: "Per årtionde" },
    "No comparable Oskars and Oscars winners yet.": {
      sv: "Inga jämförbara Oskars- och Oscarsvinnare ännu.",
    },
    "By release year": { sv: "Efter premiärår" },
    "By release decade": { sv: "Efter premiärårtionde" },
    "By release century": { sv: "Efter premiärårhundrade" },
    Coverage: { sv: "Täckning" },
    Distribution: { sv: "Fördelning" },
    "extra recorded views": { sv: "extra registrerade visningar" },
    "films watched": { sv: "sedda filmer" },
    "films with runtime": { sv: "filmer med speltid" },
    "known hours": { sv: "kända timmar" },
    Month: { sv: "Månad" },
    "No country data yet.": { sv: "Ingen landsdata ännu." },
    "No data yet.": { sv: "Ingen data ännu." },
    "No platform data yet.": { sv: "Ingen plattformsdata ännu." },
    "No ratings yet.": { sv: "Inga betyg ännu." },
    "No release-year data yet.": { sv: "Ingen premiärårsdata ännu." },
    "No view-count data yet.": { sv: "Ingen data om antal visningar ännu." },
    "No watch dates yet.": { sv: "Inga tittardatum ännu." },
    Platforms: { sv: "Plattformar" },
    Rated: { sv: "Betygsatta" },
    rated: { sv: "betygsatta" },
    "Ratings use 30 evenly spaced grades normalized to the five-point scale.": {
      sv: "Betyg använder 30 jämnt fördelade steg normaliserade till fempunktsskalan.",
    },
    Ratings: { sv: "Betyg" },
    "Recent watch months": { sv: "Senaste tittarmånaderna" },
    "Recorded views per film": { sv: "Registrerade visningar per film" },
    "Release decade": { sv: "Premiärårtionde" },
    "Release century": { sv: "Premiärårhundrade" },
    "rewatched films": { sv: "omtittade filmer" },
    Statistics: { sv: "Statistik" },
    "The archive by the numbers": { sv: "Arkivet i siffror" },
    "Top countries": { sv: "Vanligaste länderna" },
    Value: { sv: "Värde" },
    "view-adjusted hours": { sv: "visningsjusterade timmar" },
    "Viewing habits": { sv: "Tittarvanor" },
    "Viewing statistics": { sv: "Tittarstatistik" },
    "Watch dates describe one recorded viewing date per film; view counts and runtime are summarized separately.":
      {
        sv: "Tittardatum beskriver ett registrerat datum per film; antal visningar och speltid sammanfattas separat.",
      },
    "Watch years": { sv: "Tittarår" },
    "What the watched archive spans, including explicit unknown values.": {
      sv: "Vad det sedda arkivet omfattar, inklusive uttryckligen okända värden.",
    },
    "where runtime and views are both known": {
      sv: "där både speltid och visningar är kända",
    },
    "with a watch date": { sv: "med tittardatum" },
    "{hours} hours once each": { sv: "{hours} timmar, en gång vardera" },
    "2nd": { sv: "2:a" },
    "3rd": { sv: "3:a" },
    "A curated look at the films, people, and eras of this collection.": {
      sv: "En kurerad blick på samlingens filmer, människor och epoker.",
    },
    "Active project": { sv: "Aktivt projekt" },
    "Active projects": { sv: "Aktiva projekt" },
    Active: { sv: "Aktiva" },
    Add: { sv: "Lägg till" },
    "Add film": { sv: "Lägg till film" },
    "Add target": { sv: "Lägg till mål" },
    "Add nomination": { sv: "Lägg till nominering" },
    "Add nomination?": { sv: "Lägg till nominering?" },
    Added: { sv: "Tillagd" },
    Blocked: { sv: "Blockerad" },
    Moved: { sv: "Flyttad" },
    More: { sv: "Mer" },
    "No placement changes.": { sv: "Inga placeringsändringar." },
    "Nomination added.": { sv: "Nomineringen har lagts till." },
    "Nomination data changed. Preview the operation again.": {
      sv: "Nomineringsdata har ändrats. Förhandsgranska åtgärden igen.",
    },
    "A safe undo snapshot could not be recorded for this operation.": {
      sv: "En säker ångra-ögonblicksbild kunde inte sparas för den här åtgärden.",
    },
    "Nomination was not added.": { sv: "Nomineringen lades inte till." },
    "Not placed": { sv: "Inte placerad" },
    "Placement plan is not applicable.": {
      sv: "Placeringsplanen kan inte tillämpas.",
    },
    Removed: { sv: "Borttagen" },
    "Reorder nominations?": { sv: "Ändra ordning på nomineringar?" },
    "Add note": { sv: "Lägg till anteckning" },
    Note: { sv: "Anteckning" },
    "Save note": { sv: "Spara anteckning" },
    "Add memberships from a film page’s Edit mode.": {
      sv: "Lägg till medlemskap från en filmsidas redigeringsläge.",
    },
    "Adapted from": { sv: "Bygger på" },
    "All films": { sv: "Alla filmer" },
    "All countries": { sv: "Alla länder" },
    "All professions": { sv: "Alla yrken" },
    "All ratings": { sv: "Alla betyg" },
    "All sources": { sv: "Alla källor" },
    "All tiers": { sv: "Alla tiers" },
    "All centuries": { sv: "Alla århundraden" },
    "All decades": { sv: "Alla årtionden" },
    "Narrow period": { sv: "Begränsa period" },
    "Delete opinions": { sv: "Radera åsikter" },
    "Deleting...": { sv: "Raderar..." },
    Deleted: { sv: "Raderat" },
    "Delete all personal opinion data? This removes every award placement, rating, personal score, review, interest tier, and note, and resets the all-time order to the rating/release-year/title default. Films, watch history, and metadata stay. A backup downloads first.":
      {
        sv: "Radera all personlig åsiktsdata? Detta tar bort varje prisplacering, betyg, personlig poäng, recension, intressenivå och anteckning, och återställer all-time-ordningen till standarden betyg/utgivningsår/titel. Filmer, tittarhistorik och metadata behålls. En backup laddas ner först.",
      },
    "Delete nomination": { sv: "Ta bort nominering" },
    "Delete nomination?": { sv: "Ta bort nominering?" },
    "Delete {title} nomination": {
      sv: "Ta bort nomineringen för {title}",
    },
    "Removed {awards} award placements, {ratings} ratings, {scores} scores, {reviews} reviews, {rewatches} rewatch marks, {tiers} interest tiers, and {notes} notes, and reset {ranks} film rank(s) to the default order.":
      {
        sv: "Tog bort {awards} prisplaceringar, {ratings} betyg, {scores} poäng, {reviews} recensioner, {rewatches} omtittningsmarkeringar, {tiers} intressenivåer och {notes} anteckningar, och återställde {ranks} filmrankningar till standardordningen.",
      },
    "Queue tier": { sv: "Kö-tier" },
    "No queued films in this tier.": {
      sv: "Inga filmer i kön i den här tiern.",
    },
    "{count} removed film(s) stay out when refreshing from source.": {
      sv: "{count} borttagna filmer hålls utanför när projektet uppdateras från källan.",
    },
    "Restore removed films": { sv: "Återställ borttagna filmer" },
    "All years": { sv: "Alla år" },
    All: { sv: "Alla" },
    "All-time": { sv: "All-time" },
    "all-time #{rank}": { sv: "all-time #{rank}" },
    "All-time ranked": { sv: "All-time-rankad" },
    "All-time rank": { sv: "All-time-rankning" },
    "All-time score": { sv: "All-time-poäng" },
    "All-time top shelf": { sv: "All-time-topphyllan" },
    "Annual nominations": { sv: "Årsnomineringar" },
    "annual nominations": { sv: "årsnomineringar" },
    "Annual score": { sv: "Årspoäng" },
    "Annual award score": { sv: "Årlig prisklassepoäng" },
    "Annual wins": { sv: "Årsvinster" },
    Appearances: { sv: "Framträdanden" },
    Archived: { sv: "Arkiverad" },
    "Archived.": { sv: "Arkiverat." },
    Archive: { sv: "Arkivera" },
    "Archive match review": { sv: "Arkivmatchning" },
    Adapted: { sv: "Adapterat" },
    Animation: { sv: "Animation" },
    "animation among known films": { sv: "animation bland kända filmer" },
    Actor: { sv: "Skådespelare" },
    Actions: { sv: "Åtgärder" },
    "Any category": { sv: "Valfri kategori" },
    "Any medium": { sv: "Valfritt medium" },
    "Any period": { sv: "Valfri period" },
    "Any profession": { sv: "Valfritt yrke" },
    "Any rating": { sv: "Valfritt betyg" },
    "Any screenplay": { sv: "Valfritt manus" },
    "Any source": { sv: "Valfri källa" },
    "Any tier": { sv: "Valfri tier" },
    "Award category": { sv: "Priskategori" },
    "Award bracket": { sv: "Prisklasser" },
    "Award categories": { sv: "Priskategorier" },
    "Award credits": { sv: "Priscredits" },
    "Award footprint": { sv: "Prisavtryck" },
    "Award density": { sv: "Pristäthet" },
    "Award overlap": { sv: "Prisöverlapp" },
    Awards: { sv: "Priser" },
    "At least {rating}": { sv: "Minst {rating}" },
    "At most {rating}": { sv: "Högst {rating}" },
    "Browse posters": { sv: "Bläddra bland posters" },
    "Poster options": { sv: "Poster-val" },
    "Poster picker. Use the left and right arrow keys to change poster.": {
      sv: "Posterväljare. Använd vänster och höger piltangent för att byta poster.",
    },
    "Previous poster": { sv: "Föregående poster" },
    "Next poster": { sv: "Nästa poster" },
    "Use poster {number} of {count}": {
      sv: "Använd poster {number} av {count}",
    },
    "No TMDB posters were found for this film.": {
      sv: "Inga TMDB-posters hittades för den här filmen.",
    },
    "Save a TMDB credential under Data → Image settings, then try again.": {
      sv: "Spara en TMDB-nyckel under Data → Bildinställningar och försök igen.",
    },
    "TMDB could not be reached. Check your connection and try again.": {
      sv: "TMDB kunde inte nås. Kontrollera din anslutning och försök igen.",
    },
    "Browse franchises": { sv: "Bläddra bland franchises" },
    "Browse projects": { sv: "Bläddra bland projekt" },
    "Browse tags": { sv: "Bläddra bland taggar" },
    "Browseable franchises": { sv: "Bläddringsbara franchises" },
    "Browse every award category across years, decades, centuries, and all-time.":
      {
        sv: "Bläddra bland alla priskategorier över år, årtionden, århundraden och all-time.",
      },
    "Big wins": { sv: "Stora vinster" },
    "Bracket dominance": { sv: "Bracketdominans" },
    Cancel: { sv: "Avbryt" },
    "Canonical name": { sv: "Kanoniskt namn" },
    Categories: { sv: "Kategorier" },
    "Categories complete": { sv: "Kompletta kategorier" },
    Category: { sv: "Kategori" },
    "Category not found": { sv: "Kategorin hittades inte" },
    "Category note": { sv: "Kategorianteckning" },
    "Category display": { sv: "Kategorivisning" },
    "Credit not found": { sv: "Krediten hittades inte" },
    Century: { sv: "Århundrade" },
    "Century score": { sv: "Århundradepoäng" },
    "Century rank": { sv: "Århundraderankning" },
    Centuries: { sv: "Århundraden" },
    "Choose a film...": { sv: "Välj en film..." },
    "Choose filters if you like, then take a chance.": {
      sv: "Välj filter om du vill och ta en chans.",
    },
    "Chosen from {count} films": { sv: "Vald bland {count} filmer" },
    "Chosen from {count} people": { sv: "Vald bland {count} personer" },
    "Chosen from {count} watchlist films": {
      sv: "Vald bland {count} watchlist-filmer",
    },
    Cinematographer: { sv: "Fotograf" },
    Collaborators: { sv: "Medarbetare" },
    "Combine watched and watchlist into one list": {
      sv: "Kombinera sedda och watchlist i en lista",
    },
    "Collection profile": { sv: "Samlingsprofil" },
    "Collection distribution": { sv: "Samlingsfördelning" },
    Composer: { sv: "Kompositör" },
    Compare: { sv: "Jämför" },
    "Compare films": { sv: "Jämför filmer" },
    "Each selected pair appears once; counts include watched films and watchlist items.":
      {
        sv: "Varje valt par visas en gång; antalen omfattar sedda filmer och watchlist-filmer.",
      },
    "Film is not represented by this target": {
      sv: "Filmen representeras inte av det här målet",
    },
    "Film is represented by this target": {
      sv: "Filmen representeras av det här målet",
    },
    "No credited role in this film": {
      sv: "Ingen krediterad roll i den här filmen",
    },
    "Not represented in this period": {
      sv: "Inte representerad i den här perioden",
    },
    "Only first": { sv: "Bara den första" },
    "Only second": { sv: "Bara den andra" },
    Overview: { sv: "Översikt" },
    Pair: { sv: "Par" },
    "Recent comparisons": { sv: "Senaste jämförelser" },
    Relationship: { sv: "Relation" },
    Relationships: { sv: "Relationer" },
    "Represented in this period": {
      sv: "Representerad i den här perioden",
    },
    "Represented films": { sv: "Representerade filmer" },
    "period nominations": { sv: "periodnomineringar" },
    "shared films": { sv: "gemensamma filmer" },
    "shared watchlist": { sv: "gemensamma på watchlist" },
    "unique to first": { sv: "unika för den första" },
    "unique to second": { sv: "unika för den andra" },
    "Search watched films...": { sv: "Sök sedda filmer..." },
    "Search films, people, periods...": {
      sv: "Sök filmer, personer, perioder...",
    },
    "Search by title, year, or director.": {
      sv: "Sök på titel, år eller regissör.",
    },
    "Search by title, person, period, tag, franchise, or project.": {
      sv: "Sök på titel, person, period, tagg, franchise eller projekt.",
    },
    "No matching films.": { sv: "Inga matchande filmer." },
    "No matching targets.": { sv: "Inga matchande mål." },
    "No shared award categories.": { sv: "Inga gemensamma priskategorier." },
    "No shared represented films.": {
      sv: "Inga gemensamma representerade filmer.",
    },
    "Remove a film before adding another.": {
      sv: "Ta bort en film innan du lägger till en ny.",
    },
    "Remove a target before adding another.": {
      sv: "Ta bort ett mål innan du lägger till ett nytt.",
    },
    Complete: { sv: "Klart" },
    Completion: { sv: "Färdigställande" },
    Closed: { sv: "Stängt" },
    "Closed as complete.": { sv: "Stängt som klart." },
    "Close as complete": { sv: "Stäng som klart" },
    "Child franchises": { sv: "Subfranchises" },
    Competitions: { sv: "Tävlingar" },
    Context: { sv: "Kontext" },
    Country: { sv: "Land" },
    "Copy summary": { sv: "Kopiera sammanfattning" },
    "Copy view link": { sv: "Kopiera länk till vy" },
    "Costume designer": { sv: "Kostymdesigner" },
    Credit: { sv: "Credit" },
    Count: { sv: "Antal" },
    "Could not load The Oskars": { sv: "Kunde inte ladda The Oskars" },
    "Could not load project": { sv: "Kunde inte ladda projektet" },
    "Could not update {category} detail.": {
      sv: "Kunde inte uppdatera detaljen för {category}.",
    },
    "Could not update {category} recipients.": {
      sv: "Kunde inte uppdatera mottagare för {category}.",
    },
    "Clear director filter": { sv: "Rensa regissörsfilter" },
    "Data and backups": { sv: "Data och backup" },
    "Data health": { sv: "Datahälsa" },
    "Date watched": { sv: "Sedd datum" },
    Decade: { sv: "Årtionde" },
    "Decade score": { sv: "Årtiondepoäng" },
    "Decade rank": { sv: "Årtionderankning" },
    Decades: { sv: "Årtionden" },
    "Decades in this century": { sv: "Årtionden i detta århundrade" },
    Detail: { sv: "Detalj" },
    "Detail for {category}": { sv: "Detalj för {category}" },
    Details: { sv: "Detaljer" },
    "Duplicate film identity": { sv: "Duplicerad filmidentitet" },
    Editor: { sv: "Editor" },
    "Manual record creation. Contextual edits (film metadata, awards, rankings) happen on their own detail pages.":
      {
        sv: "Manuell postskapande. Kontextuella ändringar (filmmetadata, priser, rankningar) sker på deras egna detaljsidor.",
      },
    "Duplicate placement": { sv: "Duplicerad placering" },
    Direct: { sv: "Direkt" },
    "Direct competition among compared films": {
      sv: "Direkt konkurrens mellan jämförda filmer",
    },
    Director: { sv: "Regissör" },
    "Director(s)": { sv: "Regissör(er)" },
    "Director ranking": { sv: "Regissörsrankning" },
    Chronological: { sv: "Kronologisk" },
    "Derived from each film’s all-time rank.": {
      sv: "Baserat på varje films all-time-rankning.",
    },
    Discover: { sv: "Upptäck" },
    Display: { sv: "Visning" },
    "Move by dragging or choosing an exact destination; delete with ×.": {
      sv: "Flytta genom att dra eller välja en exakt placering; ta bort med ×.",
    },
    Edit: { sv: "Redigera" },
    "Edit {title}": { sv: "Redigera {title}" },
    "Edit bracket": { sv: "Redigera prisklass" },
    "Edit interest": { sv: "Redigera intresse" },
    "Edit ranking": { sv: "Redigera rankning" },
    "Review consistency": { sv: "Granska konsekvens" },
    "Ranking consistency review": { sv: "Konsekvensgranskning av rankning" },
    "Back to all-time ranking": { sv: "Tillbaka till all-time-rankning" },
    "Return to all-time ranking": { sv: "Tillbaka till all-time-rankning" },
    "Do you still prefer the film above this one?": {
      sv: "Föredrar du fortfarande filmen ovanför den här?",
    },
    "{count} reviewed this session · {remaining} pairs remain": {
      sv: "{count} granskade denna session · {remaining} par kvar",
    },
    "Currently ranked higher": { sv: "Rankad högre just nu" },
    "Currently ranked lower": { sv: "Rankad lägre just nu" },
    "Skip this pair": { sv: "Hoppa över det här paret" },
    "Nothing left to review": { sv: "Inget kvar att granska" },
    "Every adjacent pair sharing an exact rating has been reviewed this session, or there aren't two rated films to compare yet.":
      {
        sv: "Alla angränsande par med exakt samma betyg har granskats denna session, eller så finns det inte två betygsatta filmer att jämföra ännu.",
      },
    "Confirm the swap": { sv: "Bekräfta bytet" },
    'Move "{below}" to rank {aboveRank}, directly above "{above}".': {
      sv: 'Flytta "{below}" till plats {aboveRank}, direkt ovanför "{above}".',
    },
    "One of these films shares its rank with other tied films, which will move together.":
      {
        sv: "En av dessa filmer delar sin plats med andra filmer i samma delning, som flyttas tillsammans.",
      },
    "Apply swap": { sv: "Använd bytet" },
    "Ranking movement": { sv: "Rankningsförflyttning" },
    "All-time rank moved from {before} to {after}.": {
      sv: "All-time-placeringen flyttades från {before} till {after}.",
    },
    "All-time rank unchanged; only period ranks shifted.": {
      sv: "All-time-placeringen oförändrad; bara periodplaceringar ändrades.",
    },
    "+{count} more affected film(s) not shown.": {
      sv: "+{count} fler påverkade filmer visas inte.",
    },
    "View all-time ranking": { sv: "Visa all-time-rankning" },
    "all-time": { sv: "all-time" },
    year: { sv: "år" },
    decade: { sv: "årtionde" },
    century: { sv: "århundrade" },
    "Edits all-time order inside the same exact rating only.": {
      sv: "Ändrar all-time-ordningen bara inom exakt samma betyg.",
    },
    "Edits global watchlist order inside the same interest tier only.": {
      sv: "Ändrar global watchlist-ordning bara inom samma intressenivå.",
    },
    "Watchlist ordering moves are limited to the same interest tier.": {
      sv: "Watchlist-ordning kan bara ändras inom samma intressenivå.",
    },
    "Items can only move within the same group.": {
      sv: "Objekt kan bara flyttas inom samma grupp.",
    },
    "Edits this project queue only.": { sv: "Ändrar bara denna projektkö." },
    Film: { sv: "Film" },
    "Film count": { sv: "Antal filmer" },
    "Watched film count": { sv: "Antal sedda filmer" },
    "Film display": { sv: "Filmvisning" },
    "Completion display": { sv: "Färdigställandevisning" },
    "Completion pages": { sv: "Färdigställandesidor" },
    "Annual award slots across years with at least one watched film.": {
      sv: "Årliga prisplatser för år med minst en sedd film.",
    },
    "No annual award brackets with watched films yet.": {
      sv: "Inga årliga prisklasser med sedda filmer ännu.",
    },
    "Periods complete": { sv: "Perioder klara" },
    "Film filters": { sv: "Filmfilter" },
    "Film pages": { sv: "Filmsidor" },
    "Film relations": { sv: "Filmrelationer" },
    "Film series, universes, and overlapping collections": {
      sv: "Filmserier, universum och överlappande samlingar",
    },
    "Film metadata and credits": { sv: "Filmmetadata och credits" },
    "Film could not be updated.": { sv: "Filmen kunde inte uppdateras." },
    "Film URL": { sv: "Film-URL" },
    "Letterboxd URL": { sv: "Letterboxd-URL" },
    Films: { sv: "Filmer" },
    "{count} annual nominations": { sv: "{count} årsnomineringar" },
    "{count} films": { sv: "{count} filmer" },
    "Films shown": { sv: "Filmer som visas" },
    "Films I want to watch.": { sv: "Filmer jag vill se." },
    "Focused watch queues from directors, franchises, and watchlist filters.": {
      sv: "Fokuserade se-köer från regissörer, franchises och watchlist-filter.",
    },
    "Find metadata": { sv: "Hämta metadata" },
    Facet: { sv: "Fasett" },
    First: { sv: "Först" },
    "Find poster": { sv: "Hämta poster" },
    "Find portrait": { sv: "Hämta porträtt" },
    "No portrait was found.": { sv: "Inget porträtt hittades." },
    "Finding...": { sv: "Hämtar..." },
    "Finding…": { sv: "Hämtar…" },
    Findings: { sv: "Fynd" },
    "Finish editing": { sv: "Avsluta redigering" },
    "Finish interest": { sv: "Avsluta intresse" },
    "Finish order": { sv: "Avsluta ordning" },
    "Finish ranking": { sv: "Avsluta rankning" },
    "Forward within tiers": { sv: "Framåt inom tiers" },
    "Merge watchlist order": { sv: "Slå ihop watchlist-ordning" },
    "Merge order": { sv: "Slå ihop ordning" },
    "Merge local rank": { sv: "Slå ihop lokal rankning" },
    franchise: { sv: "franchise" },
    director: { sv: "regissör" },
    tag: { sv: "tagg" },
    collection: { sv: "samling" },
    "Collection not found": { sv: "Samlingen hittades inte" },
    "This collection needs at least two films to merge.": {
      sv: "Denna samling behöver minst två filmer för att slås ihop.",
    },
    "Splits {name}'s current local order into two groups, then decides film by film which one ranks higher until both are interleaved.":
      {
        sv: "Delar {name}s aktuella lokala ordning i två grupper och avgör sedan film för film vilken som rankas högre tills båda är sammanflätade.",
      },
    "Group A: {a} films · Group B: {b} films": {
      sv: "Grupp A: {a} filmer · Grupp B: {b} filmer",
    },
    "This becomes {name}'s new local rank order.": {
      sv: "Detta blir {name}s nya lokala rankningsordning.",
    },
    "{count} films reordered.": { sv: "{count} filmer omordnade." },
    "Back to {type}": { sv: "Tillbaka till {type}" },
    "Show queue": { sv: "Visa kö" },
    "Hide queue": { sv: "Dölj kö" },
    "No watchlist films match these filters.": {
      sv: "Inga watchlist-filmer matchar dessa filter.",
    },
    "A disposable queue recomputed from the current filters every time - nothing here is saved.":
      {
        sv: "En tillfällig kö som räknas om från de aktuella filtren varje gång - inget här sparas.",
      },
    "Whole tier": { sv: "Hela tiern" },
    "No interest tier has at least two watchlist films to merge.": {
      sv: "Ingen intressetier har minst två watchlist-filmer att slå ihop.",
    },
    "Both groups need at least one film, and can't be the same scope.": {
      sv: "Båda grupperna behöver minst en film och kan inte vara samma urval.",
    },
    "Nothing to merge yet": { sv: "Inget att slå ihop än" },
    "No interest tier has at least two watchlist films. Assign tiers on the watchlist page first.":
      {
        sv: "Ingen intressetier har minst två watchlist-filmer. Sätt tiers på watchlist-sidan först.",
      },
    "Interest tier": { sv: "Intressetier" },
    "Pick an interest tier and two groups within it - two years, a year and its decade, a decade and the rest of the tier - then decide film by film which one ranks higher. Everything outside the two groups keeps its exact position.":
      {
        sv: "Välj en intressetier och två grupper inom den - två år, ett år och dess årtionde, ett årtionde och resten av tiern - avgör sedan film för film vilken som rankas högre. Allt utanför de två grupperna behåller sin exakta plats.",
      },
    "Group A": { sv: "Grupp A" },
    "Group B": { sv: "Grupp B" },
    "Start merge": { sv: "Starta sammanslagning" },
    "Which one ranks higher?": { sv: "Vilken rankas högre?" },
    "{a} left in Group A, {b} left in Group B": {
      sv: "{a} kvar i Grupp A, {b} kvar i Grupp B",
    },
    or: { sv: "eller" },
    "Undo last choice": { sv: "Ångra senaste val" },
    "Cancel merge": { sv: "Avbryt sammanslagning" },
    "Merged order": { sv: "Sammanslagen ordning" },
    "This becomes the new relative order for these films within the tier; every other film keeps its exact position.":
      {
        sv: "Detta blir den nya inbördes ordningen för dessa filmer inom tiern; alla andra filmer behåller sin exakta plats.",
      },
    "Apply merged order": { sv: "Använd sammanslagen ordning" },
    "Start over": { sv: "Börja om" },
    "Merged order applied": { sv: "Sammanslagen ordning tillämpad" },
    "{count} reordered in tier {tier}.": {
      sv: "{count} omordnade i tier {tier}.",
    },
    "Review on the watchlist": { sv: "Granska på watchlist" },
    "Merge again": { sv: "Slå ihop igen" },
    "Back to watchlist": { sv: "Tillbaka till watchlist" },
    "Export PDF slides": { sv: "Exportera PDF-bildspel" },
    "Awards ceremony": { sv: "Prisceremoni" },
    "Category {current} of {total}": { sv: "Kategori {current} av {total}" },
    "Enter presentation mode": { sv: "Aktivera presentationsläge" },
    "Exit ceremony": { sv: "Avsluta ceremoni" },
    "Exit presentation mode": { sv: "Avsluta presentationsläge" },
    "Next category": { sv: "Nästa kategori" },
    "Next section": { sv: "Nästa sektion" },
    "No winner recorded": { sv: "Ingen vinnare registrerad" },
    "Previous category": { sv: "Föregående kategori" },
    "Previous section": { sv: "Föregående sektion" },
    "Reveal winner": { sv: "Visa vinnare" },
    "Run ceremony": { sv: "Kör ceremoni" },
    "Section navigation": { sv: "Sektionsnavigering" },
    "Step through {year}'s categories, revealing nominees before the winner.":
      {
        sv: "Gå igenom {year}s kategorier och visa nominerade innan vinnaren.",
      },
    "A curated look at {name}.": { sv: "En kurerad titt på {name}." },
    "A recap of what you watched in {year}.": {
      sv: "En sammanfattning av vad du såg under {year}.",
    },
    "Award winners": { sv: "Prisvinnare" },
    "Award winners you watched": { sv: "Prisvinnare du sett" },
    "Decades explored": { sv: "Utforskade årtionden" },
    "Films watched": { sv: "Sedda filmer" },
    "Films you watched that went on to win an award.": {
      sv: "Filmer du sett som senare vann ett pris.",
    },
    "Focus this showcase on…": { sv: "Fokusera utställningen på…" },
    "Nothing here has been watched yet.": { sv: "Inget här har setts än." },
    "Nothing was watched in {year} yet.": {
      sv: "Inget har setts under {year} än.",
    },
    "Or relive a year:": { sv: "Eller återuppliva ett år:" },
    "Project, franchise, person, tag, category, or period": {
      sv: "Projekt, franchise, person, tagg, kategori eller period",
    },
    "Return to the whole-archive showcase": {
      sv: "Återgå till utställningen för hela arkivet",
    },
    "Showcase not found": { sv: "Utställningen hittades inte" },
    "The highest all-time-ranked films you watched this year.": {
      sv: "De högst all-time-rankade filmerna du sett i år.",
    },
    "The release decades your viewing touched this year.": {
      sv: "De utgivningsårtionden din visning berörde i år.",
    },
    "This project, franchise, person, tag, category, period, or year could not be found.":
      {
        sv: "Detta projekt, franchise, person, tagg, kategori, period eller år kunde inte hittas.",
      },
    "Top ranked this year": { sv: "Högst rankade i år" },
    "Your {year} in film": { sv: "Ditt filmår {year}" },
    "{name}, on display": { sv: "{name} på utställning" },
    "‹ Whole archive": { sv: "‹ Hela arkivet" },
    Franchise: { sv: "Franchise" },
    "Franchise note": { sv: "Franchise-anteckning" },
    "Franchise display": { sv: "Franchisevisning" },
    "Franchise shelf": { sv: "Franchisehyllan" },
    franchises: { sv: "franchises" },
    directors: { sv: "regissörer" },
    projects: { sv: "projekt" },
    categories: { sv: "kategorier" },
    periods: { sv: "perioder" },
    "Franchise not found": { sv: "Franchise hittades inte" },
    "Franchise pages": { sv: "Franchise-sidor" },
    "Franchise film display": { sv: "Franchise-filmvisning" },
    "Franchise rank": { sv: "Franchise-rankning" },
    Franchises: { sv: "Franchises" },
    "Local rank": { sv: "Lokal rankning" },
    "Merge-sort tool": { sv: "Sammanslagningsverktyg" },
    "Drag to set this collection's independent local order.": {
      sv: "Dra för att sätta denna samlingens oberoende lokala ordning.",
    },
    "Parent franchise > Subfranchise | rank\nAnother franchise | rank": {
      sv: "Förälderfranchise > Subfranchise | rank\nEn annan franchise | rank",
    },
    "Parent franchise > Subfranchise | rank": {
      sv: "Förälderfranchise > Subfranchise | rank",
    },
    "One per line. Examples: James Bond | 5 or Marvel Cinematic Universe > Iron Man | 2. Chain as many levels as needed, e.g. Marvel > MCU > Infinity Saga > Phase 1 | 2 — each intermediate name is created automatically.":
      {
        sv: "En per rad. Exempel: James Bond | 5 eller Marvel Cinematic Universe > Iron Man | 2. Kedja så många nivåer som behövs, t.ex. Marvel > MCU > Infinity Saga > Phase 1 | 2 — varje mellanliggande namn skapas automatiskt.",
      },
    "Period, placement, and category define the bracket entry and remain structural. Recipients and details can be edited here.":
      {
        sv: "Period, placering och kategori definierar prisklassposten och förblir strukturella. Mottagare och detaljer kan redigeras här.",
      },
    "Adaptation source": { sv: "Adaptationskälla" },
    "Novel, play, video game…": { sv: "Roman, pjäs, tv-spel…" },
    "Noir, courtroom drama, rewatch": { sv: "Noir, rättssaldrama, omsedd" },
    "Comma-separated names": { sv: "Kommaseparerade namn" },
    "Full order": { sv: "Full ordning" },
    "Full rankings": { sv: "Full rankning" },
    "Global ranks": { sv: "Globala rankningar" },
    "Global rank": { sv: "Global rankning" },
    Includes: { sv: "Innehåller" },
    Interest: { sv: "Intresse" },
    "Interest order": { sv: "Intresseordning" },
    Known: { sv: "Kända" },
    Last: { sv: "Sist" },
    "Last ranked first": { sv: "Sist rankad först" },
    "First ranked first": { sv: "Först rankad först" },
    "Let the archive choose something for you.": {
      sv: "Låt arkivet välja något åt dig.",
    },
    "Loading posters...": { sv: "Hämtar posters..." },
    "Grid view": { sv: "Rutnätsvy" },
    "Hide awards": { sv: "Dölj priser" },
    "Show awards": { sv: "Visa priser" },
    Highlights: { sv: "Höjdpunkter" },
    Hybrid: { sv: "Hybrid" },
    Images: { sv: "Bilder" },
    "Imported posters out of films": { sv: "Importerade posters av filmer" },
    "Imported portraits out of people": {
      sv: "Importerade porträtt av personer",
    },
    "Live action": { sv: "Live action" },
    "List view": { sv: "Listvy" },
    Links: { sv: "Länkar" },
    "Make active": { sv: "Gör aktivt" },
    Medium: { sv: "Medium" },
    "Medium & screenplay": { sv: "Medium och manus" },
    Measure: { sv: "Mått" },
    "Metadata overlap": { sv: "Metadataöverlapp" },
    "Metadata entries": { sv: "Metadata-poster" },
    Metrics: { sv: "Mått" },
    Missing: { sv: "Saknas" },
    "Missing references": { sv: "Saknade referenser" },
    "Move to": { sv: "Flytta till" },
    "Move {title} to placement": {
      sv: "Flytta {title} till placering",
    },
    "Move to placement #{placement}": {
      sv: "Flytta till placering #{placement}",
    },
    "Move through the award brackets and film views at every scale.": {
      sv: "Gå genom prisklasser och filmvyer på varje nivå.",
    },
    "My score": { sv: "Mitt betyg" },
    Name: { sv: "Namn" },
    "Name or alias": { sv: "Namn eller alias" },
    "Newest added within tiers": { sv: "Senast tillagd inom tiers" },
    "Newest first": { sv: "Nyaste först" },
    "Reverse order": { sv: "Vänd ordning" },
    Next: { sv: "Nästa" },
    "Next unwatched": { sv: "Nästa osedda" },
    Nominee: { sv: "Nominerad" },
    "Up next": { sv: "Näst på tur" },
    "To watch": { sv: "Att se" },
    "In progress only": { sv: "Endast pågående" },
    "Directors in progress": { sv: "Regissörer pågående" },
    "Franchises in progress": { sv: "Franchises pågående" },
    "Projects in progress": { sv: "Projekt pågående" },
    "Complete (known films)": { sv: "Klart (kända filmer)" },
    "Bracket slots filled": { sv: "Fyllda bracketplatser" },
    "Watch goals reached": { sv: "Nådda titt-mål" },
    "Oscar completion": { sv: "Oscar-färdigställande" },
    "Oscar film completion": { sv: "Oscarfilmer sedda" },
    "Best Picture winners watched": {
      sv: "Sedda vinnare av Bästa film",
    },
    "Oscar-winning films watched": { sv: "Sedda Oscarsvinnare" },
    "Oscar-nominated films watched": { sv: "Sedda Oscarsnominerade filmer" },
    "Oscar completion covers every imported official nominee. Director, franchise, and project completion covers known films in the archive and watchlist.":
      {
        sv: "Oscar-färdigställande omfattar varje importerad officiell nominering. Färdigställande för regissörer, franchises och projekt omfattar kända filmer i arkivet och watchlisten.",
      },
    "Films watched from the imported official Academy Awards winners and nominees — overall, by year, and by category.":
      {
        sv: "Sedda filmer bland importerade officiella Oscarsvinnare och nominerade — totalt, per år och per kategori.",
      },
    "The headline Oscar watch-through.": {
      sv: "Den främsta Oscar-utmaningen.",
    },
    "Distinct films that won at least one imported category.": {
      sv: "Unika filmer som vann minst en importerad kategori.",
    },
    "Distinct nominated films, including winners.": {
      sv: "Unika nominerade filmer, inklusive vinnare.",
    },
    "Based on {count} imported Academy Awards periods, {first}–{last}.": {
      sv: "Baserat på {count} importerade Oscarsperioder, {first}–{last}.",
    },
    "{count} more official periods already fully watched.": {
      sv: "Ytterligare {count} officiella perioder är redan helt sedda.",
    },
    "Every official Oscar period is fully watched.": {
      sv: "Varje officiell Oscarsperiod är helt sedd.",
    },
    "Every film in this collection has been watched.": {
      sv: "Alla filmer i den här samlingen är sedda.",
    },
    "and {count} more": { sv: "och {count} till" },
    "Collection project": { sv: "Samlingsprojekt" },
    "By category": { sv: "Per kategori" },
    "Winners watched": { sv: "Sedda vinnare" },
    "Nominees watched": { sv: "Sedda nominerade" },
    "No official Academy Awards data imported yet.": {
      sv: "Ingen officiell Oscarsdata har importerats ännu.",
    },
    "Oscar collection": { sv: "Oscar-samling" },
    "known films": { sv: "kända filmer" },
    "Directors with at least 3 known films and something left to watch.": {
      sv: "Regissörer med minst 3 kända filmer och något kvar att se.",
    },
    "Multi-film franchises with unwatched entries, ranked by progress.": {
      sv: "Flerfilmsfranchises med osedda filmer, rankade efter framsteg.",
    },
    "Open watch projects ranked by progress.": {
      sv: "Öppna projekt rankade efter framsteg.",
    },
    "Browse incomplete franchises": {
      sv: "Bläddra bland ofullständiga franchises",
    },
    "Showing {shown} of {total} in progress.": {
      sv: "Visar {shown} av {total} pågående.",
    },
    "{count} more already at 100% of known films.": {
      sv: "{count} till redan på 100% av kända filmer.",
    },
    "Nothing in progress.": { sv: "Inget pågående." },
    "No director watchlist data yet.": {
      sv: "Ingen watchlist-data för regissörer ännu.",
    },
    "No franchise watchlist data yet.": {
      sv: "Ingen watchlist-data för franchises ännu.",
    },
    "Import a watchlist or start a project to track completion.": {
      sv: "Importera en watchlist eller starta ett projekt för att följa färdigställandet.",
    },
    "Progress counts known films only — the archive plus the watchlist. If a filmography or franchise is missing films, add them to the watchlist to make these numbers honest.":
      {
        sv: "Framsteg räknar endast kända filmer — arkivet plus watchlisten. Om en filmografi eller franchise saknar filmer, lägg till dem i watchlisten så blir siffrorna ärliga.",
      },
    "All known films watched. Completion counts known films only — add missing entries to the watchlist to track true coverage.":
      {
        sv: "Alla kända filmer sedda. Färdigställandet räknar endast kända filmer — lägg till saknade filmer i watchlisten för att följa verklig täckning.",
      },
    "Award brackets": { sv: "Prisbrackets" },
    "How much of each imported award period's category slots are filled in — data entry, not watch progress.":
      {
        sv: "Hur mycket av varje importerad prisperiods kategoriplatser som är ifyllda — datainmatning, inte tittarframsteg.",
      },
    "No award bracket data imported yet.": {
      sv: "Ingen prisbracket-data importerad ännu.",
    },
    "{count} more already fully filled.": {
      sv: "{count} till redan helt ifyllda.",
    },
    "All imported brackets are fully filled.": {
      sv: "Alla importerade brackets är helt ifyllda.",
    },
    Data: { sv: "Data" },
    "Watch goals": { sv: "Titt-mål" },
    "Coverage targets per period — {yearGoal} films per year, {decadeGoal} per decade, {centuryGoal} per century — separate from award nominee coverage.":
      {
        sv: "Täckningsmål per period — {yearGoal} filmer per år, {decadeGoal} per årtionde, {centuryGoal} per århundrade — separat från priskandidattäckning.",
      },
    "No watched films yet.": { sv: "Inga sedda filmer ännu." },
    "{count} more already at or past the goal.": {
      sv: "{count} till redan vid eller över målet.",
    },
    "Every period has reached its goal.": {
      sv: "Alla perioder har nått sitt mål.",
    },
    "Next up from the watchlist": { sv: "Näst på tur från watchlisten" },
    "Nothing to show yet": { sv: "Inget att visa ännu" },
    "Import some films first, then come back for the tour.": {
      sv: "Importera några filmer först och kom sedan tillbaka för rundturen.",
    },
    "Most awarded people": { sv: "Mest prisbelönta personer" },
    "One defining film for every decade watched.": {
      sv: "En definierande film för varje sett årtionde.",
    },
    "No projects yet": { sv: "Inga projekt ännu" },
    "No {view} projects": { sv: "Inga {view}-projekt" },
    No: { sv: "Nej" },
    "Not same": { sv: "Inte samma" },
    "No actionable findings": { sv: "Inga åtgärdbara fynd" },
    "No all-time match": { sv: "Ingen all-time-matchning" },
    "No annual people data": { sv: "Ingen årsdata om personer" },
    "No annual award data": { sv: "Ingen årsdata om priser" },
    "No annual nominations to trace.": {
      sv: "Inga årsnomineringar att spåra.",
    },
    "No ranked films": { sv: "Inga rankade filmer" },
    "No confirmed aliases": { sv: "Inga bekräftade alias" },
    "Nothing outstanding": { sv: "Inget att åtgärda" },
    "No eligibility metadata gaps": { sv: "Inga behörighetsluckor i metadata" },
    "No entries": { sv: "Inga poster" },
    "No films": { sv: "Inga filmer" },
    "No film tags yet. Add them from a film’s Edit mode.": {
      sv: "Inga filmtaggar ännu. Lägg till dem från en filmsidas redigeringsläge.",
    },
    "No franchise metadata yet": { sv: "Ingen franchise-metadata ännu" },
    "No franchises match these filters.": {
      sv: "Inga franchises matchar dessa filter.",
    },
    "No films for {year}": { sv: "Inga filmer för {year}" },
    "No filtered films need that interest change.": {
      sv: "Inga filtrerade filmer behöver den intresseändringen.",
    },
    "No matching watchlist films.": { sv: "Inga matchande watchlist-filmer." },
    "No tiers": { sv: "Inga tiers" },
    "No maximum": { sv: "Inget maximum" },
    "No minimum": { sv: "Inget minimum" },
    "No films are marked for rewatch yet.": {
      sv: "Inga filmer är markerade för omtitt ännu.",
    },
    "No note yet.": { sv: "Ingen anteckning än." },
    "Not marked": { sv: "Inte markerad" },
    Nominees: { sv: "Nominerade" },
    "No people match these filters.": {
      sv: "Inga personer matchar dessa filter.",
    },
    "No nominations": { sv: "Inga nomineringar" },
    "No matches": { sv: "Inga träffar" },
    "No obvious shared metadata.": { sv: "Ingen tydlig gemensam metadata." },
    "No nominations for the selected competitions": {
      sv: "Inga nomineringar för de valda tävlingarna",
    },
    "No winner progression for this category.": {
      sv: "Ingen vinnarprogression för den här kategorin.",
    },
    "No official Academy Awards data for this category.": {
      sv: "Ingen officiell Oscarsdata för den här kategorin.",
    },
    "No winners for the selected competitions": {
      sv: "Inga vinnare för de valda tävlingarna",
    },
    "No poster was found.": { sv: "Ingen poster hittades." },
    "No TMDB match was found.": { sv: "Ingen TMDB-matchning hittades." },
    "No TMDB poster options were found.": {
      sv: "Inga TMDB-posteralternativ hittades.",
    },
    "No unwatched films left": { sv: "Inga osedda filmer kvar" },
    "No unwatched films left.": { sv: "Inga osedda filmer kvar." },
    "No unwatched or rewatch-marked films in this project.": {
      sv: "Inga osedda eller omtittningsmarkerade filmer i det här projektet.",
    },
    "No watched films in this project yet.": {
      sv: "Inga sedda filmer i det här projektet ännu.",
    },
    "No year": { sv: "Inget år" },
    "No local edits tracked yet.": {
      sv: "Inga lokala ändringar spårade ännu.",
    },
    "No items in this queue.": { sv: "Inga poster i den här kön." },
    "No watchlist loaded": { sv: "Ingen watchlist laddad" },
    "No watchlist films in this period.": {
      sv: "Inga watchlist-filmer i den här perioden.",
    },
    "No watched films use this tag.": {
      sv: "Inga sedda filmer använder den här taggen.",
    },
    Nominations: { sv: "Nomineringar" },
    Nomination: { sv: "Nominering" },
    "Nomination added. {count} nominee(s) moved down.": {
      sv: "Nominering tillagd. {count} nominerad(e) flyttades ner.",
    },
    "{title} ({year}) was added.": { sv: "{title} ({year}) lades till." },
    Noms: { sv: "Nom." },
    "Oldest added within tiers": { sv: "Äldst tillagd inom tiers" },
    "Oldest first": { sv: "Äldsta först" },
    Open: { sv: "Öppen" },
    "Open page": { sv: "Öppna sida" },
    "Open source pages, share this comparison, or continue collection-like targets as projects.":
      {
        sv: "Öppna källsidor, dela jämförelsen eller fortsätt samlingsliknande mål som projekt.",
      },
    "Open editor": { sv: "Öppna editor" },
    "Open watched film page": { sv: "Öppna sedd filmsida" },
    Original: { sv: "Original" },
    "Original title": { sv: "Originaltitel" },
    Order: { sv: "Ordning" },
    "Other films": { sv: "Andra filmer" },
    "Part of": { sv: "Del av" },
    Page: { sv: "Sida" },
    Period: { sv: "Period" },
    "Period profile": { sv: "Periodprofil" },
    "Period type": { sv: "Periodtyp" },
    Position: { sv: "Position" },
    "Period film display": { sv: "Periodfilmvisning" },
    "Period note": { sv: "Periodanteckning" },
    "Period not found": { sv: "Perioden hittades inte" },
    "Period tables": { sv: "Periodtabeller" },
    Periods: { sv: "Perioder" },
    People: { sv: "Personer" },
    "People display": { sv: "Personvisning" },
    "People pages": { sv: "Personsidor" },
    "People profile": { sv: "Personprofil" },
    Person: { sv: "Person" },
    "Person not found": { sv: "Personen hittades inte" },
    "Person note": { sv: "Personanteckning" },
    "Personal scores": { sv: "Personliga poäng" },
    "Personal collections and themes across the film library.": {
      sv: "Personliga samlingar och teman i filmbiblioteket.",
    },
    Performer: { sv: "Utövare" },
    Performers: { sv: "Utövare" },
    Pinned: { sv: "Pinnad" },
    Pin: { sv: "Pinna" },
    Place: { sv: "Placering" },
    Platform: { sv: "Plattform" },
    Portraits: { sv: "Porträtt" },
    Previous: { sv: "Föregående" },
    "Primary country": { sv: "Primärt land" },
    "Progression table": { sv: "Progressionstabell" },
    Progression: { sv: "Progression" },
    Progress: { sv: "Framsteg" },
    Project: { sv: "Projekt" },
    "Project note": { sv: "Projektanteckning" },
    Projects: { sv: "Projekt" },
    "Project error": { sv: "Projektfel" },
    "Project film display": { sv: "Projektfilmvisning" },
    "Project not found": { sv: "Projektet hittades inte" },
    "Project name": { sv: "Projektnamn" },
    "Project name is required.": { sv: "Projektnamn krävs." },
    "Project order": { sv: "Projektordning" },
    "Project sort": { sv: "Projektsortering" },
    "Project view": { sv: "Projektvy" },
    "Could not create the project.": { sv: "Kunde inte skapa projektet." },
    "Create project": { sv: "Skapa projekt" },
    "Custom films": { sv: "Anpassade filmer" },
    "No films added yet.": { sv: "Inga filmer tillagda ännu." },
    "Add at least one film.": { sv: "Lägg till minst en film." },
    "Pick a film from the suggestions.": {
      sv: "Välj en film bland förslagen.",
    },
    "Pick a source from the suggestions.": {
      sv: "Välj en källa bland förslagen.",
    },
    "Picked because it is closest to finishing {name}.": {
      sv: "Valdes eftersom det är närmast att slutföra {name}.",
    },
    'Picked because it is tagged "{tag}".': {
      sv: 'Valdes eftersom det är taggat "{tag}".',
    },
    "Picked because it is top tier ({tier}).": {
      sv: "Valdes eftersom det har högsta tier ({tier}).",
    },
    "Picked because it is next in watchlist order.": {
      sv: "Valdes eftersom det är näst på tur i watchlist-ordningen.",
    },
    "Picked because it is tied with others at tier {tier}, so it was picked at random.":
      {
        sv: "Valdes eftersom det delar tier {tier} med andra och valdes slumpmässigt.",
      },
    "Picked because it is tied with others for last place, so it was picked at random.":
      {
        sv: "Valdes eftersom det delar sistaplatsen med andra och valdes slumpmässigt.",
      },
    "Paired because both are by {name}.": {
      sv: "Ihopparade eftersom båda är av {name}.",
    },
    'Paired because both belong to the "{name}" franchise.': {
      sv: 'Ihopparade eftersom båda tillhör franchisen "{name}".',
    },
    'Paired because both are tagged "{tag}".': {
      sv: 'Ihopparade eftersom båda är taggade "{tag}".',
    },
    "Paired for historical context - both are from the {decade}.": {
      sv: "Ihopparade för historisk kontext - båda är från {decade}.",
    },
    "Paired for contrast: {mediumA} against {mediumB}.": {
      sv: "Ihopparade för kontrast: {mediumA} mot {mediumB}.",
    },
    "No strong connection found between these two — paired from the same filtered set.":
      {
        sv: "Ingen stark koppling hittades mellan dessa två - ihopparade från samma filtrerade urval.",
      },
    "Start typing…": { sv: "Börja skriva…" },
    Profession: { sv: "Yrke" },
    Professions: { sv: "Yrken" },
    Filmography: { sv: "Filmografi" },
    "Filmography display": { sv: "Filmografivisning" },
    "Filmography order": { sv: "Filmografiordning" },
    Queue: { sv: "Kö" },
    Possible: { sv: "Möjlig" },
    "Possible archive matches are shown for review only.": {
      sv: "Möjliga arkivmatchningar visas bara för granskning.",
    },
    "Random film": { sv: "Slumpa film" },
    "Random person": { sv: "Slumpa person" },
    "Surprise me": { sv: "Överraska mig" },
    "Double feature": { sv: "Dubbelfeature" },
    Rank: { sv: "Rankning" },
    Ranked: { sv: "Rankade" },
    "Rank order": { sv: "Rankningsordning" },
    "Rank / Tier": { sv: "Rankning / Tier" },
    Rating: { sv: "Betyg" },
    "Rate slightly lower": { sv: "Betygsätt något lägre" },
    "Rate exactly": { sv: "Betygsätt exakt" },
    "Rate slightly higher": { sv: "Betygsätt något högre" },
    "Ratings histogram": { sv: "Betygshistogram" },
    "{count} rated films": { sv: "{count} betygsatta filmer" },
    Confidence: { sv: "Säkerhet" },
    "Confirmed person aliases": { sv: "Bekräftade personalias" },
    Exact: { sv: "Exakt" },
    "Exact rating": { sv: "Exakt betyg" },
    Errors: { sv: "Fel" },
    "Eligibility metadata": { sv: "Behörighetsmetadata" },
    "Eligibility violation": { sv: "Behörighetsfel" },
    "Eligibility review queues": { sv: "Granskningsköer för behörighet" },
    "Animated nominees with unknown or non-animation medium": {
      sv: "Animationsnominerade med okänt eller icke-animerat medium",
    },
    "International nominees with missing or US/UK country": {
      sv: "Internationellt nominerade med saknat eller USA/UK-land",
    },
    "Screenplay nominees with unknown screenplay type": {
      sv: "Manusnominerade med okänd manustyp",
    },
    "Best Animated Picture requires animation. Correct the ranked-list Medium column in Google Sheets.":
      {
        sv: "Bästa animerade film kräver animation. Rätta ranked-listans Medium-kolumn i Google Sheets.",
      },
    "Best International Picture requires a non-US/UK primary country. Correct the Country column or fetch from TMDB.":
      {
        sv: "Bästa internationella film kräver ett primärt land utanför USA/UK. Rätta Country-kolumnen eller hämta från TMDB.",
      },
    "Screenplay eligibility needs an original/adapted status. Correct the ranked-list Screenplay column in Google Sheets.":
      {
        sv: "Manusbehörighet behöver status original/adapterat. Rätta ranked-listans Screenplay-kolumn i Google Sheets.",
      },
    "External IDs and media types": { sv: "Externa ID:n och medietyper" },
    "Watched films with TMDB ID": { sv: "Sedda filmer med TMDB-ID" },
    "Watchlist films with TMDB ID": { sv: "Watchlist-filmer med TMDB-ID" },
    "Watched films with Letterboxd link": {
      sv: "Sedda filmer med Letterboxd-länk",
    },
    "Watchlist films with Letterboxd link": {
      sv: "Watchlist-filmer med Letterboxd-länk",
    },
    "Watched films missing Letterboxd link": {
      sv: "Sedda filmer utan Letterboxd-länk",
    },
    "Watchlist films missing Letterboxd link": {
      sv: "Watchlist-filmer utan Letterboxd-länk",
    },
    "Watchlist films missing TMDB ID": { sv: "Watchlist-filmer utan TMDB-ID" },
    "Watched films with a non-Film type": {
      sv: "Sedda filmer med annan typ än Film",
    },
    "Letterboxd links come from the ranked-list letterboxd column in Google Sheets.":
      {
        sv: "Letterboxd-länkar kommer från ranked-listans letterboxd-kolumn i Google Sheets.",
      },
    "Watchlist Letterboxd links come from the Letterboxd URI column in the watchlist sheet.":
      {
        sv: "Watchlistans Letterboxd-länkar kommer från Letterboxd URI-kolumnen i watchlist-sheeten.",
      },
    "TMDB IDs unlock watchlist metadata/poster fetches. Fetchable from TMDB.": {
      sv: "TMDB-ID:n låser upp hämtning av watchlist-metadata/posters. Hämtningsbart från TMDB.",
    },
    "Rows whose ranked-list Type is not Film (TV films, miniseries). Review whether they belong in the archive.":
      {
        sv: "Rader vars Type i ranked-listan inte är Film (TV-filmer, miniserier). Granska om de hör hemma i arkivet.",
      },
    "{count} Letterboxd link(s) can be inferred from existing film URLs.": {
      sv: "{count} Letterboxd-länk(ar) kan härledas från befintliga film-URL:er.",
    },
    "Apply inferred Letterboxd links": {
      sv: "Använd härledda Letterboxd-länkar",
    },
    Apply: { sv: "Använd" },
    "Check TMDB media types": { sv: "Kontrollera TMDB-medietyper" },
    "Checking...": { sv: "Kontrollerar..." },
    "Probes stored TMDB IDs in explicit batches; flags IDs that resolve as TV or are missing.":
      {
        sv: "Kontrollerar lagrade TMDB-ID:n i uttryckliga batchar; flaggar ID:n som är TV-serier eller saknas.",
      },
    "TMDB media type issues (this session)": {
      sv: "TMDB-medietypsproblem (denna session)",
    },
    "No media type mismatches found in {count} checked film(s) this session.": {
      sv: "Inga medietypsavvikelser i {count} kontrollerade filmer denna session.",
    },
    "Local type": { sv: "Lokal typ" },
    "TMDB ID": { sv: "TMDB-ID" },
    Result: { sv: "Resultat" },
    "Save a TMDB credential before checking media types.": {
      sv: "Spara en TMDB-nyckel innan medietyper kontrolleras.",
    },
    "Checked {attempted}: {ok} OK, {issues} issue(s), {failed} failed. {remaining} film(s) unchecked.":
      {
        sv: "Kontrollerade {attempted}: {ok} OK, {issues} problem, {failed} misslyckades. {remaining} filmer okontrollerade.",
      },
    Fetch: { sv: "Hämta" },
    "Minimum rating": { sv: "Minsta betyg" },
    "Maximum rating": { sv: "Högsta betyg" },
    "Minimum runtime (minutes)": { sv: "Kortaste speltid (minuter)" },
    "Maximum runtime (minutes)": { sv: "Längsta speltid (minuter)" },
    "over {minutes} min": { sv: "över {minutes} min" },
    "under {minutes} min": { sv: "under {minutes} min" },
    Reference: { sv: "Referens" },
    "Release year": { sv: "Premiärår" },
    "Refresh poster": { sv: "Uppdatera poster" },
    "Refresh portrait": { sv: "Uppdatera porträtt" },
    "Refresh from source": { sv: "Uppdatera från källa" },
    "Related periods": { sv: "Relaterade perioder" },
    "Reverse current order": { sv: "Vänd nuvarande ordning" },
    "Reload poster options": { sv: "Ladda om poster-val" },
    Remove: { sv: "Ta bort" },
    "Remove {title}": { sv: "Ta bort {title}" },
    Reorder: { sv: "Ordna" },
    Reopen: { sv: "Öppna igen" },
    "Return home": { sv: "Tillbaka hem" },
    "Return to watchlist": { sv: "Tillbaka till watchlist" },
    "Mark as watched": { sv: "Markera som sedd" },
    "Mark {title} as watched": { sv: "Markera {title} som sedd" },
    "Add known viewing facts, then confirm.": {
      sv: "Lägg till kända tittningsuppgifter och bekräfta sedan.",
    },
    Back: { sv: "Tillbaka" },
    "Viewing facts": { sv: "Tittningsuppgifter" },
    "Date watched": { sv: "Sedd datum" },
    Views: { sv: "Visningar" },
    "Any unfinished rating, ranking, and awards work will remain in the intake queue.": {
      sv: "Ofärdigt arbete med betyg, rankning och priser ligger kvar i intagskön.",
    },
    "Mark as watched? This will become {target}.": {
      sv: "Markera som sedd? Detta blir {target}.",
    },
    "the existing archive film": { sv: "den befintliga arkivfilmen" },
    "the existing watched film": { sv: "den befintliga sedda filmen" },
    "a new watched film": { sv: "en ny sedd film" },
    "Still to do": { sv: "Återstår" },
    "Continue intake": { sv: "Fortsätt intag" },
    "The data changed after preview. Try again.": {
      sv: "Datan ändrades efter förhandsgranskningen. Försök igen.",
    },
    "The watchlist transition could not be applied.": {
      sv: "Watchlist-övergången kunde inte genomföras.",
    },
    "Watched-film intake is open": { sv: "Intag för sedd film är öppet" },
    "Rating, global ranking, or awards review still needs an explicit decision.": {
      sv: "Betyg, global rankning eller prisgranskning behöver fortfarande ett uttryckligt beslut.",
    },
    "Rating and viewing facts": { sv: "Betyg och tittningsuppgifter" },
    "Global ranking": { sv: "Global rankning" },
    "{level} awards": { sv: "Priser: {level}" },
    "Reviewed; none": { sv: "Granskad; inga" },
    "Not applicable": { sv: "Ej tillämpligt" },
    "The watched film for this intake no longer exists.": {
      sv: "Den sedda filmen för detta intag finns inte längre.",
    },
    "Completed intake": { sv: "Slutfört intag" },
    "No completion summary recorded.": { sv: "Ingen slutsammanfattning registrerad." },
    "Reopen intake": { sv: "Öppna intag igen" },
    "Next: confirm rating and viewing facts": {
      sv: "Nästa: bekräfta betyg och tittningsuppgifter",
    },
    "Confirm rating": { sv: "Bekräfta betyg" },
    "Drag {title} to its year position": {
      sv: "Dra {title} till sin årsplacering",
    },
    "Drag {title} to its {level} position": {
      sv: "Dra {title} till sin placering för {level}",
    },
    "New film": { sv: "Ny film" },
    "Place here": { sv: "Placera här" },
    "Place {title} before {target}": {
      sv: "Placera {title} före {target}",
    },
    "Year ranking display": { sv: "Visning av årsrankning" },
    "{level} ranking display": { sv: "Visning av rankning för {level}" },
    "Year ranking": { sv: "Årsrankning" },
    "Decade ranking": { sv: "Årtiondesrankning" },
    "{level} ranking": { sv: "Rankning för {level}" },
    "The recorded {level} anchor is no longer available": {
      sv: "Den registrerade referensen för {level} är inte längre tillgänglig",
    },
    "Restore the referenced film or reopen the intake from the {level} step before continuing.": {
      sv: "Återställ den refererade filmen eller öppna intaget igen från steget för {level} innan du fortsätter.",
    },
    "The recorded year anchor is no longer available": {
      sv: "Den registrerade årsreferensen är inte längre tillgänglig",
    },
    "Restore the referenced film or reopen the intake from the year step before continuing.": {
      sv: "Återställ den refererade filmen eller öppna intaget igen från årssteget innan du fortsätter.",
    },
    "Place {title} among the {rating} films of {year}": {
      sv: "Placera {title} bland filmerna från {year} med betyget {rating}",
    },
    "Place {title} among the {rating} films of the {decade}": {
      sv: "Placera {title} bland filmerna från {decade} med betyget {rating}",
    },
    "Place {title} among the {rating} films of {period}": {
      sv: "Placera {title} bland filmerna från {period} med betyget {rating}",
    },
    "Place {title} among the {rating} films of the {period}": {
      sv: "Placera {title} bland filmerna från {period} med betyget {rating}",
    },
    "Place {title} among all {rating} films": {
      sv: "Placera {title} bland alla filmer med betyget {rating}",
    },
    "The new film starts at the bottom. Drag it upward or use Place here, then continue when the order feels right.": {
      sv: "Den nya filmen börjar längst ned. Dra den uppåt eller använd Placera här och fortsätt när ordningen känns rätt.",
    },
    "Nearest higher rating": { sv: "Närmaste högre betyg" },
    "Nearest lower rating": { sv: "Närmaste lägre betyg" },
    "Place at bottom": { sv: "Placera längst ned" },
    "Year anchor": { sv: "Årsreferens" },
    "Locked by year decision": { sv: "Låst av årsbeslutet" },
    "{level} anchor": { sv: "Referens för {level}" },
    "Locked by {level} decision": { sv: "Låst av beslutet för {level}" },
    "No {source} comparator existed, so the full {target} range is available.": {
      sv: "Det fanns ingen jämförelsefilm för {source}, så hela intervallet för {target} är tillgängligt.",
    },
    "{source} decision: {title} must stay before {anchor}. Only positions through that anchor are available.": {
      sv: "Beslut för {source}: {title} måste ligga före {anchor}. Endast placeringar fram till den referensen är tillgängliga.",
    },
    "{source} decision: {title} must stay after {anchor}. Only positions after that anchor are available.": {
      sv: "Beslut för {source}: {title} måste ligga efter {anchor}. Endast placeringar efter den referensen är tillgängliga.",
    },
    "No year comparator existed, so the full decade range is available.": {
      sv: "Det fanns ingen jämförelsefilm för året, så hela årtiondets intervall är tillgängligt.",
    },
    "Year decision: {title} must stay before {anchor}. Only positions through that anchor are available.": {
      sv: "Årsbeslut: {title} måste ligga före {anchor}. Endast placeringar fram till den referensen är tillgängliga.",
    },
    "Year decision: {title} must stay after {anchor}. Only positions after that anchor are available.": {
      sv: "Årsbeslut: {title} måste ligga efter {anchor}. Endast placeringar efter den referensen är tillgängliga.",
    },
    "Place at bottom of allowed range": {
      sv: "Placera längst ned i det tillåtna intervallet",
    },
    "Overall bottom locked by year decision": {
      sv: "Den nedersta placeringen är låst av årsbeslutet",
    },
    "Overall bottom locked by {level} decision": {
      sv: "Den nedersta placeringen är låst av beslutet för {level}",
    },
    "Selected position: {position} of {count}": {
      sv: "Vald placering: {position} av {count}",
    },
    "Your year decision narrows the next decade board.": {
      sv: "Ditt årsbeslut avgränsar nästa årtiondebräde.",
    },
    "No same-rating films exist in this year, so this step will be marked not applicable.": {
      sv: "Det finns inga filmer med samma betyg detta år, så steget markeras som ej tillämpligt.",
    },
    "Continue to decade": { sv: "Fortsätt till årtionde" },
    "Your decade decision narrows the next century board.": {
      sv: "Ditt årtiondesbeslut avgränsar nästa århundradesbräde.",
    },
    "No same-rating films exist in this decade, so this step will be marked not applicable.": {
      sv: "Det finns inga filmer med samma betyg detta årtionde, så steget markeras som ej tillämpligt.",
    },
    "Continue to century": { sv: "Fortsätt till århundrade" },
    "Your {level} decision narrows the next {next} board.": {
      sv: "Ditt beslut för {level} avgränsar nästa bräde för {next}.",
    },
    "No same-rating films exist in this {level}, so this step will be marked not applicable.": {
      sv: "Det finns inga filmer med samma betyg i denna {level}, så steget markeras som ej tillämpligt.",
    },
    "Continue to {level}": { sv: "Fortsätt till {level}" },
    "Annual awards": { sv: "Årliga priser" },
    "Nominate {title} before {target}": {
      sv: "Nominera {title} före {target}",
    },
    "{level} awards review is unavailable": {
      sv: "Granskningen av priser för {level} är inte tillgänglig",
    },
    "Restore the film year or ranking decision before continuing.": {
      sv: "Återställ filmens år eller rankningsbeslut innan du fortsätter.",
    },
    "{level} awards review is ready to finish": {
      sv: "Granskningen av priser för {level} är redo att slutföras",
    },
    "Every eligible category has been reviewed.": {
      sv: "Varje valbar kategori har granskats.",
    },
    "Continue to {level} awards": { sv: "Fortsätt till priser för {level}" },
    "Finish awards review": { sv: "Slutför prisgranskning" },
    "{level} awards": { sv: "Priser för {level}" },
    "Placed #{placement} of {capacity} at {level} level.": {
      sv: "Placerad #{placement} av {capacity} på {level}-nivå.",
    },
    "Open full {level} bracket": { sv: "Öppna hela bracket för {level}" },
    "Drag {title} to its {category} position": {
      sv: "Dra {title} till sin placering i {category}",
    },
    "Drag {title} onto a nominee below to nominate it in that position": {
      sv: "Dra {title} till en nominerad nedan för att nominera i den positionen",
    },
    "New nominee": { sv: "Ny nominerad" },
    "New nominee — not yet placed": { sv: "Ny nominerad — inte placerad än" },
    "Drops out": { sv: "Faller ur" },
    "Not nominating": { sv: "Nominerar inte" },
    "Don't nominate": { sv: "Nominera inte" },
    "{category} is full ({capacity}/{capacity}). Drag the new nominee onto a film below, or use “Place here” or “Place at bottom” - the nominee it displaces will drop out.":
      {
        sv: "{category} är full ({capacity}/{capacity}). Dra den nya nomineringen till en film nedan, eller använd ”Placera här” eller ”Placera sist” - den nominerade som trängs undan faller ur.",
      },
    "Not nominating {title} for {category}. Choose a position to change your mind.": {
      sv: "Nominerar inte {title} i {category}. Välj en placering för att ändra dig.",
    },
    "Place the watched film in this bracket, or move to the next category without nominating it.": {
      sv: "Placera den sedda filmen i denna bracket eller gå vidare till nästa kategori utan att nominera den.",
    },
    "Add another nominee for this category, or move to the next category.": {
      sv: "Lägg till ytterligare en nominerad i denna kategori, eller gå vidare till nästa kategori.",
    },
    "Song title": { sv: "Låttitel" },
    "Selected nomination: #{position} of {capacity}": {
      sv: "Vald nominering: #{position} av {capacity}",
    },
    "Recipient(s)": { sv: "Mottagare" },
    "The nomination could not be applied.": {
      sv: "Nomineringen kunde inte genomföras.",
    },
    "Continue applies this position as the canonical global rank.": {
      sv: "Fortsätt använder denna placering som den kanoniska globala rankningen.",
    },
    "Next: {level} ranking comparison": { sv: "Nästa: rankningsjämförelse för {level}" },
    "Only films with the exact same rating are eligible. Earlier cohort decisions narrow the final global insertion.": {
      sv: "Endast filmer med exakt samma betyg är valbara. Tidigare gruppbeslut avgränsar den slutliga globala placeringen.",
    },
    "Comparison film": { sv: "Jämförelsefilm" },
    "Place watched film": { sv: "Placera den sedda filmen" },
    "Before comparison": { sv: "Före jämförelsefilmen" },
    "After comparison": { sv: "Efter jämförelsefilmen" },
    "No exact-rating films exist in this cohort; mark it not applicable.": {
      sv: "Det finns inga filmer med exakt samma betyg i gruppen; markera den som ej tillämplig.",
    },
    "Record comparison": { sv: "Registrera jämförelse" },
    "Mark not applicable": { sv: "Markera ej tillämpligt" },
    "Ready to complete": { sv: "Redo att slutföra" },
    "Complete intake": { sv: "Slutför intag" },
    "Fresh watched film": { sv: "Ny sedd film" },
    "From watchlist": { sv: "Från watchlist" },
    "Watched-film intake": { sv: "Intag för sedda filmer" },
    "Finish rating, one progressive global rank, and explicit awards review for every newly watched film.": {
      sv: "Slutför betyg, en progressiv global rankning och uttrycklig prisgranskning för varje nyss sedd film.",
    },
    "Add watched film": { sv: "Lägg till sedd film" },
    "Preview and add": { sv: "Förhandsgranska och lägg till" },
    "No watched-film intakes yet.": { sv: "Inga intag för sedda filmer ännu." },
    "A valid rating is required before ranking.": {
      sv: "Ett giltigt betyg krävs före rankning.",
    },
    "The intake step could not be saved. Refresh and try again.": {
      sv: "Intagssteget kunde inte sparas. Uppdatera och försök igen.",
    },
    "You opened this bracket from a watched-film intake.": {
      sv: "Du öppnade denna bracket från ett intag för sedd film.",
    },
    "Return to intake": { sv: "Tillbaka till intag" },
    "Reverse within tiers": { sv: "Bakåt inom tiers" },
    "Reset {count} dismissed": { sv: "Återställ {count} avfärdade" },
    Role: { sv: "Roll" },
    Review: { sv: "Text" },
    "Review / comment": { sv: "Text / kommentar" },
    Rewatchlist: { sv: "Omtittningslista" },
    Ranks: { sv: "Rankningar" },
    Runtime: { sv: "Speltid" },
    "Runtime (minutes)": { sv: "Speltid (minuter)" },
    Save: { sv: "Spara" },
    "Save changes": { sv: "Spara ändringar" },
    "Separate tags with commas.": { sv: "Separera taggar med kommatecken." },
    "A short personal note about the film.": {
      sv: "En kort personlig anteckning om filmen.",
    },
    Score: { sv: "Poäng" },
    "Score divided by the maximum attainable score": {
      sv: "Poäng delat med maximal möjlig poäng",
    },
    Screenplay: { sv: "Manus" },
    "Screenplay type": { sv: "Manustyp" },
    Screenplays: { sv: "Manus" },
    Search: { sv: "Sök" },
    Screenwriter: { sv: "Manusförfattare" },
    "Set batch": { sv: "Välj batch" },
    "Set filtered interest": { sv: "Sätt filtrerat intresse" },
    "Set filtered interest to {tier}?": {
      sv: "Sätt filtrerat intresse till {tier}?",
    },
    Severity: { sv: "Allvar" },
    Sheet: { sv: "Sheet" },
    "Sheet metadata coverage": { sv: "Metadata-täckning från sheet" },
    "Share URL": { sv: "Dela URL" },
    "Share of all nominations in this period bracket.": {
      sv: "Andel av alla nomineringar i den här periodbracketen.",
    },
    "Shared categories": { sv: "Gemensamma kategorier" },
    "Shared collaborators": { sv: "Gemensamma medarbetare" },
    "Shared films": { sv: "Gemensamma filmer" },
    "Shared traits": { sv: "Gemensamma drag" },
    "Show watched and watchlist separately": {
      sv: "Visa sedda och watchlist separat",
    },
    Showing: { sv: "Visar" },
    "Side-by-side comparison across films, people, periods, franchises, tags, projects, categories, roles, and songs.":
      {
        sv: "Jämförelse sida vid sida mellan filmer, personer, perioder, franchises, taggar, projekt, kategorier, roller och låtar.",
      },
    "Side-by-side film rankings, scores, metadata, and award overlap.": {
      sv: "Filmrankningar, poäng, metadata och prisöverlapp sida vid sida.",
    },
    Showcase: { sv: "Utställning" },
    Shuffle: { sv: "Slumpa" },
    "Shuffle again": { sv: "Slumpa igen" },
    "The archive, on display": { sv: "Arkivet på utställning" },
    "The collections with the deepest footprint.": {
      sv: "Samlingarna med djupast avtryck.",
    },
    "The names that keep coming back.": {
      sv: "Namnen som ständigt återkommer.",
    },
    "The ten highest-ranked films in the archive.": {
      sv: "De tio högst rankade filmerna i arkivet.",
    },
    "Through the decades": { sv: "Genom årtiondena" },
    "Top-tier films still waiting to be watched.": {
      sv: "Toppfilmer som ännu väntar på att ses.",
    },
    "Sample films": { sv: "Exempelfilmer" },
    "Sample periods": { sv: "Exempelperioder" },
    Samples: { sv: "Exempel" },
    Sort: { sv: "Sortera" },
    "Sort ascending": { sv: "Sortera stigande" },
    "Sort descending": { sv: "Sortera fallande" },
    Song: { sv: "Låt" },
    Songwriter: { sv: "Låtskrivare" },
    Songwriters: { sv: "Låtskrivare" },
    "Sort films": { sv: "Sortera filmer" },
    "Slots filled": { sv: "Fyllda platser" },
    Source: { sv: "Källa" },
    Start: { sv: "Starta" },
    "Start project": { sv: "Starta projekt" },
    "Start one from a director or franchise page.": {
      sv: "Starta ett från en regissörs- eller franchise-sida.",
    },
    Status: { sv: "Status" },
    Shared: { sv: "Gemensamt" },
    Sub: { sv: "Sub" },
    Subfranchises: { sv: "Subfranchises" },
    "Swedish title": { sv: "Svensk titel" },
    "Same title, different year": { sv: "Samma titel, annat år" },
    "Same title, year unknown": { sv: "Samma titel, okänt år" },
    Tags: { sv: "Taggar" },
    Tag: { sv: "Tagg" },
    "Tag note": { sv: "Tagganteckning" },
    Target: { sv: "Mål" },
    "Tag film display": { sv: "Taggfilmvisning" },
    "Tag not found": { sv: "Taggen hittades inte" },
    Tier: { sv: "Tier" },
    Title: { sv: "Titel" },
    "This project is marked complete. Reopen it to put it back in the open queue.":
      {
        sv: "Det här projektet är markerat som klart. Öppna det igen för att lägga tillbaka det i den öppna kön.",
      },
    "This project is paused and hidden from the default project hub.": {
      sv: "Det här projektet är pausat och dolt från standardvyn för projekt.",
    },
    "Title and year match": { sv: "Titel och år matchar" },
    "TMDB ID match": { sv: "TMDB-ID matchar" },
    "TMDB IDs": { sv: "TMDB-ID:n" },
    "Top films": { sv: "Toppfilmer" },
    "Top categories": { sv: "Toppkategorier" },
    "Top 250": { sv: "Topp 250" },
    "Top 250 all-time film": { sv: "Topp 250 all-time-film" },
    Total: { sv: "Totalt" },
    "Total nominations": { sv: "Totala nomineringar" },
    "Total wins": { sv: "Totala vinster" },
    Type: { sv: "Typ" },
    "Try another project filter.": { sv: "Prova ett annat projektfilter." },
    "Try relaxing one or two filters.": {
      sv: "Prova att släppa ett eller två filter.",
    },
    "Visual effects": { sv: "Visuella effekter" },
    Unarchive: { sv: "Avarkivera" },
    Unpin: { sv: "Avpinna" },
    Unranked: { sv: "Orankad" },
    unresolved: { sv: "olösta" },
    Unset: { sv: "Ej satt" },
    URL: { sv: "URL" },
    "Poster URL": { sv: "Poster-URL" },
    Unknown: { sv: "Okänt" },
    "Unknown year": { sv: "okänt år" },
    "Use {name}": { sv: "Använd {name}" },
    View: { sv: "Vy" },
    "View all": { sv: "Visa alla" },
    "View project": { sv: "Visa projekt" },
    Views: { sv: "Visningar" },
    "Want to rewatch": { sv: "Vill se om" },
    "Want to rewatch ({tier})": { sv: "Vill se om ({tier})" },
    "Rewatch tier": { sv: "Rewatch-tier" },
    Rewatch: { sv: "Omtittning" },
    Watchlist: { sv: "Watchlist" },
    "Remove from rewatchlist": { sv: "Ta bort från omtittningslistan" },
    Unwatched: { sv: "Osedda" },
    "Watchlist film not found": { sv: "Watchlist-film hittades inte" },
    "Watchlist film display": { sv: "Watchlist-filmvisning" },
    "Watchlist filters": { sv: "Watchlist-filter" },
    "Rewatchlist filters": { sv: "Rewatchlist-filter" },
    "Watchlist order": { sv: "Watchlist-ordning" },
    "Watchlist pages": { sv: "Watchlist-sidor" },
    "Watchlist tier": { sv: "Watchlist-tier" },
    watchlist: { sv: "watchlist" },
    Watched: { sv: "Sedd" },
    watched: { sv: "sedda" },
    "Watched film": { sv: "Sedd film" },
    Warnings: { sv: "Varningar" },
    "Warning: {warnings}": { sv: "Varning: {warnings}" },
    "Removed: {titles}.": { sv: "Borttagna: {titles}." },
    Wins: { sv: "Vinster" },
    "Work queues": { sv: "Arbetsköer" },
    Winner: { sv: "Vinnare" },
    Winners: { sv: "Vinnare" },
    "Recipients, filmmakers, performers, and other credited contributors.": {
      sv: "Mottagare, filmskapare, skådespelare och andra krediterade medarbetare.",
    },
    Recipients: { sv: "Mottagare" },
    "Recipients for {category}": { sv: "Mottagare för {category}" },
    Year: { sv: "År" },
    "Year winners": { sv: "Årsvinnare" },
    "Year rank": { sv: "Årsrankning" },
    "Rollup winners": { sv: "Vidare vinnare" },
    "Year score": { sv: "Årspoäng" },
    Years: { sv: "År" },
    "Years in this decade": { sv: "År i detta årtionde" },
    "{percent} percent complete": { sv: "{percent} procent klart" },
    "{percent}% present · {missing} missing": {
      sv: "{percent}% finns · {missing} saknas",
    },
    "{count} bracket nomination(s)": { sv: "{count} bracketnominering(ar)" },
    "{count} failed import attempt(s)": {
      sv: "{count} misslyckade importförsök",
    },
    "{count} item(s) in queue.": { sv: "{count} poster i kön." },
    "{year}, no films": { sv: "{year}, inga filmer" },
    "all-time rank": { sv: "all-time-rankning" },
    "all-time score": { sv: "all-time-poäng" },
    "all watchlist": { sv: "hela watchlisten" },
    by: { sv: "av" },
    complete: { sv: "klart" },
    "century score": { sv: "århundradepoäng" },
    "decade score": { sv: "årtiondepoäng" },
    film: { sv: "film" },
    films: { sv: "filmer" },
    "Import a Letterboxd watchlist CSV in the editor, or serve the repository so the bundled CSV can load.":
      {
        sv: "Importera en Letterboxd-watchlist CSV i editorn, eller kör repot via server så den bundlade CSV-filen kan laddas.",
      },
    nominations: { sv: "nomineringar" },
    noms: { sv: "nom." },
    normalized: { sv: "normaliserat" },
    of: { sv: "av" },
    people: { sv: "personer" },
    rating: { sv: "betyg" },
    search: { sv: "sökning" },
    score: { sv: "poäng" },
    "sorted by": { sv: "sorterat efter" },
    "to watch": { sv: "att se" },
    via: { sv: "via" },
    wins: { sv: "vinster" },
    winner: { sv: "vinnare" },
    winners: { sv: "vinnare" },
    Batch: { sv: "Batch" },
    "Brackets checked": { sv: "Kontrollerade brackets" },
    Countries: { sv: "Länder" },
    "Countries are used for International eligibility and country filters. Fetch from TMDB or correct the sheet.":
      {
        sv: "Länder används för internationell behörighet och landsfilter. Hämta från TMDB eller rätta sheeten.",
      },
    "Directors power person pages, project sources, and credits. Fetch from TMDB or correct the sheet.":
      {
        sv: "Regissörer driver personsidor, projektkällor och credits. Hämta från TMDB eller rätta sheeten.",
      },
    "Fetchable, but now also read from Google Sheets.": {
      sv: "Kan hämtas, men läses nu också från Google Sheets.",
    },
    Issue: { sv: "Problem" },
    "Medium drives Animated eligibility. Correct the ranked-list Medium column in Google Sheets.":
      {
        sv: "Medium styr behörighet för animation. Rätta ranked-listans Medium-kolumn i Google Sheets.",
      },
    None: { sv: "Inga" },
    "People missing portrait": { sv: "Personer utan porträtt" },
    Placement: { sv: "Placering" },
    "Placement gap": { sv: "Placeringslucka" },
    "Placement out of range": { sv: "Placering utanför intervallet" },
    "Placements #{first}–#{last}": {
      sv: "Placeringar #{first}–#{last}",
    },
    "Portraits improve person pages and comparison views. Fetchable from TMDB.":
      {
        sv: "Porträtt förbättrar personsidor och jämförelsevyer. Kan hämtas från TMDB.",
      },
    Posters: { sv: "Posters" },
    "Posters improve card/grid views. Fetchable from TMDB/Wikimedia.": {
      sv: "Posters förbättrar kort- och rutnätsvyer. Kan hämtas från TMDB/Wikimedia.",
    },
    "Ranked-list films missing medium": {
      sv: "Ranked-list-filmer utan medium",
    },
    "Ranked-list films missing runtime": {
      sv: "Ranked-list-filmer utan speltid",
    },
    "Ranked-list films missing screenplay type": {
      sv: "Ranked-list-filmer utan manustyp",
    },
    "Read from ranked list A:T.": { sv: "Läses från ranked list A:T." },
    "Runtime is sheet-owned ranked-list metadata. Fill it in Google Sheets when useful.":
      {
        sv: "Speltid är ranked-list-metadata som ägs av sheeten. Fyll i Google Sheets när det är användbart.",
      },
    "Screenplay type drives screenplay eligibility. Correct the ranked-list Screenplay column in Google Sheets.":
      {
        sv: "Manustyp styr manusbehörighet. Rätta ranked-listans Screenplay-kolumn i Google Sheets.",
      },
    "TMDB IDs unlock metadata/poster refreshes. Usually fetchable from TMDB.": {
      sv: "TMDB-ID:n låser upp metadata- och posteruppdateringar. Kan oftast hämtas från TMDB.",
    },
    "Used by Animated eligibility.": {
      sv: "Används för animationsbehörighet.",
    },
    "Used by International eligibility.": {
      sv: "Används för internationell behörighet.",
    },
    "Used by screenplay eligibility.": { sv: "Används för manusbehörighet." },
    Variant: { sv: "Variant" },
    "Watched films missing country": { sv: "Sedda filmer utan land" },
    "Watched films missing director": { sv: "Sedda filmer utan regissör" },
    "Watched films missing poster": { sv: "Sedda filmer utan poster" },
    "Watched films missing TMDB ID": { sv: "Sedda filmer utan TMDB-ID" },
    "Watchlist films missing poster": { sv: "Watchlist-filmer utan poster" },
    "Watchlist films missing TMDB/director": {
      sv: "Watchlist-filmer utan TMDB/regissör",
    },
    "Watchlist film could not be updated.": {
      sv: "Watchlist-filmen kunde inte uppdateras.",
    },
    "Watchlist metadata": { sv: "Watchlist-metadata" },
    "Watchlist metadata helps director/franchise/project pages include unwatched films correctly.":
      {
        sv: "Watchlist-metadata hjälper regissörs-, franchise- och projektsidor att inkludera osedda filmer korrekt.",
      },
    "Watchlist posters keep large watchlist grids scannable. Fetchable from TMDB/Wikimedia.":
      {
        sv: "Watchlist-posters gör stora watchlist-rutnät lättare att skanna. Kan hämtas från TMDB/Wikimedia.",
      },
    "Watchlist/watched overlap": { sv: "Watchlist/sedda överlappar" },
    "year score": { sv: "årspoäng" },

    // Import report (src/editor/import-report.js)
    "Already watched": { sv: "Redan sedda" },
    "Awards added to existing films": {
      sv: "Priser tillagda på befintliga filmer",
    },
    "Cross-source rating and interest conflicts": {
      sv: "Betygs- och intressekonflikter mellan källor",
    },
    "Cross-source conflicts": { sv: "Konflikter mellan källor" },
    "No cross-source conflicts recorded by the last import.": {
      sv: "Inga källkonflikter noterade av senaste importen.",
    },
    "Showing {shown} of {total} cross-source conflicts.": {
      sv: "Visar {shown} av {total} källkonflikter.",
    },
    Existing: { sv: "Befintligt" },
    Incoming: { sv: "Inkommande" },
    "Import activity": { sv: "Importaktivitet" },
    "Import notes": { sv: "Importnoteringar" },
    "Import preview": { sv: "Importförhandsgranskning" },
    "Official results": { sv: "Officiella resultat" },
    "Official nominee": { sv: "Officiellt nominerad" },
    "Official nominations": { sv: "Officiella nomineringar" },
    "Official winner": { sv: "Officiell vinnare" },
    "Official winners": { sv: "Officiella vinnare" },
    "Oskars–Oscars agreement": { sv: "Oskars–Oscars-överensstämmelse" },
    "Real Oscars": { sv: "Riktiga Oscars" },
    "Not nominated": { sv: "Inte nominerad" },
    Match: { sv: "Match" },
    Different: { sv: "Olika" },
    "Your pick": { sv: "Ditt val" },
    "Your pick matches the Oscar winner": {
      sv: "Ditt val matchar Oscarsvinnaren",
    },
    "Your pick differs from the Oscar winner": {
      sv: "Ditt val skiljer sig från Oscarsvinnaren",
    },
    "Your Oskars winner": { sv: "Din Oskars-vinnare" },
    "Your Oskars nominee": { sv: "Din Oskars-nominerade" },
    "Matched from imported Academy Awards results.": {
      sv: "Matchat från importerade Academy Awards-resultat.",
    },
    "Matches your Oskars result": { sv: "Matchar ditt Oskars-resultat" },
    "Differs from your Oskars result": {
      sv: "Skiljer sig från ditt Oskars-resultat",
    },
    Win: { sv: "Vinst" },
    Ceremony: { sv: "Gala" },
    Winner: { sv: "Vinnare" },
    Winners: { sv: "Vinnare" },
    "Skipped source categories": { sv: "Överhoppade källkategorier" },
    "Official-results findings": { sv: "Fynd i officiella resultat" },
    Finding: { sv: "Fynd" },
    "Reading and validating official results...": {
      sv: "Läser och validerar officiella resultat...",
    },
    "Official-results refresh is ready. No local data changed; review the report before applying.": {
      sv: "Uppdateringen av officiella resultat är klar. Inga lokala data har ändrats; granska rapporten innan du tillämpar den.",
    },
    "Official results refreshed in the local draft. Publish canonical JSON separately.": {
      sv: "Officiella resultat har uppdaterats i det lokala utkastet. Publicera kanonisk JSON separat.",
    },
    Kept: { sv: "Behållet" },
    tier: { sv: "tier" },
    Field: { sv: "Fält" },
    "Ignored (incoming)": { sv: "Ignorerat (inkommande)" },
    "Kept (local)": { sv: "Behållet (lokalt)" },
    "Local values kept over a differing import value": {
      sv: "Lokala värden behållna över ett avvikande importvärde",
    },
    "Last import report": { sv: "Senaste importrapport" },
    "Last import": { sv: "Senaste import" },
    "Needs attention": { sv: "Behöver granskas" },
    "New films": { sv: "Nya filmer" },
    "No import issues were reported.": {
      sv: "Inga importproblem rapporterades.",
    },
    "Rank changes": { sv: "Rankändringar" },
    "Run:": { sv: "Körd:" },
    "Showing {shown} of {total} awards added to existing films.": {
      sv: "Visar {shown} av {total} priser tillagda på befintliga filmer.",
    },
    "Showing {shown} of {total} new films.": {
      sv: "Visar {shown} av {total} nya filmer.",
    },
    "Showing {shown} of {total} preserved local values.": {
      sv: "Visar {shown} av {total} behållna lokala värden.",
    },
    "Showing {shown} of {total} rank changes.": {
      sv: "Visar {shown} av {total} rankändringar.",
    },
    "Ambiguous no-year franchise rows": {
      sv: "Tvetydiga franchise-rader utan år",
    },
    "Archive matches": { sv: "Arkivmatchningar" },
    "Archive updates": { sv: "Arkivuppdateringar" },
    "Bracket films missing from all-time ranked list": {
      sv: "Prisklassfilmer som saknas i all-time-listan",
    },
    Directors: { sv: "Regissörer" },
    "Directors rows without recognized tier": {
      sv: "Regissörsrader utan igenkänd tier",
    },
    "Directors sheet": { sv: "Regissörssheet" },
    "Duplicates removed": { sv: "Dubbletter borttagna" },
    "Eligibility checks": { sv: "Behörighetskontroller" },
    "Franchise sheet": { sv: "Franchise-sheet" },
    "Franchise rows without recognized rating or tier": {
      sv: "Franchiserader utan igenkänt betyg eller tier",
    },
    Headers: { sv: "Rubriker" },
    Import: { sv: "Import" },
    "Import consistency": { sv: "Importkonsistens" },
    "In sheet": { sv: "I sheet" },
    "Restored from backup": { sv: "Återställt från backup" },
    "Kept local data": { sv: "Behållen lokal data" },
    Section: { sv: "Sektion" },
    "In backup": { sv: "I backupen" },
    "Local before": { sv: "Lokalt innan" },
    "This file also contains sections merge mode does not restore: {sections}. Local versions were kept; choose the Replace restore mode to bring them back from a backup.":
      {
        sv: "Filen innehåller också sektioner som sammanfogningsläget inte återställer: {sections}. Lokala versioner behölls; välj återställningsläget Ersätt för att ta tillbaka dem från en backup.",
      },
    'Replace all locally stored The Oskars data with "{name}"? Local work missing from the backup is lost.':
      {
        sv: 'Ersätt all lokalt lagrad The Oskars-data med "{name}"? Lokalt arbete som saknas i backupen går förlorat.',
      },
    "Backup restored": { sv: "Backup återställd" },
    "Backup restored using fallback storage": {
      sv: "Backup återställd med reservlagring",
    },
    "Watchlist films": { sv: "Watchlist-filmer" },
    "Watched (other) entries": { sv: "Sedda (annat)-poster" },
    "Watch projects": { sv: "Projekt" },
    "Project source links": { sv: "Projektkällänkar" },
    "People aliases": { sv: "Personalias" },
    "Rejected alias pairs": { sv: "Avvisade aliaspar" },
    "Entity notes": { sv: "Anteckningar" },
    "Edit log entries": { sv: "Redigeringsloggposter" },
    "Source conflicts": { sv: "Källkonflikter" },
    "Import consistency snapshot": { sv: "Importkonsistens-ögonblicksbild" },
    "Missing after import": { sv: "Saknas efter import" },
    "Sample rows": { sv: "Exempelrader" },
    "All checked source-row fields are present after import.": {
      sv: "Alla kontrollerade källradsfält finns kvar efter import.",
    },
    row: { sv: "rad" },
    "Run a Google import to populate import consistency checks.": {
      sv: "Kör en Google-import för att fylla i importkonsistenskontrollerna.",
    },
    "No missing source fields detected by the last import ({time}).": {
      sv: "Inga saknade källfält upptäckta av senaste importen ({time}).",
    },
    "Film row": { sv: "Filmrad" },
    "Watchlist row": { sv: "Watchlist-rad" },
    "Letterboxd link": { sv: "Letterboxd-länk" },
    Lanes: { sv: "Banor" },
    "No visible values": { sv: "Inga synliga värden" },
    "Periods:": { sv: "Perioder:" },
    Range: { sv: "Intervall" },
    Ranges: { sv: "Intervall" },
    "Rated / tiered": { sv: "Betygsatt / tier" },
    "Rated / tiered / untiered": { sv: "Betygsatt / tier / utan tier" },
    "Rated director rows stored as watched (unmatched in archive)": {
      sv: "Betygsatta regissörsrader lagrade som sedda (ej matchade i arkivet)",
    },
    "Rated franchise rows stored as watched (unmatched in archive)": {
      sv: "Betygsatta franchise-rader lagrade som sedda (ej matchade i arkivet)",
    },
    Reason: { sv: "Anledning" },
    Row: { sv: "Rad" },
    Rows: { sv: "Rader" },
    "Rule violations": { sv: "Regelbrott" },
    "Showing {shown} of {total} bracket films missing from the all-time ranked list.":
      {
        sv: "Visar {shown} av {total} prisklassfilmer som saknas i all-time-listan.",
      },
    "Showing {shown} of {total} eligibility groups.": {
      sv: "Visar {shown} av {total} behörighetsgrupper.",
    },
    "Showing {shown} of {total} skipped row details.": {
      sv: "Visar {shown} av {total} överhoppade raddetaljer.",
    },
    Skipped: { sv: "Överhoppad" },
    "Skipped rows": { sv: "Överhoppade rader" },
    "Source:": { sv: "Källa:" },
    "Title variants resolved": { sv: "Titelvarianter matchade" },
    Values: { sv: "Värden" },
    "Watched (other) added / merged": {
      sv: "Sedda (annat) tillagda / sammanslagna",
    },
    "Watchlist adds": { sv: "Watchlist-tillägg" },
    "Watchlist merges": { sv: "Watchlist-sammanslagningar" },
    "With / without year": { sv: "Med / utan år" },
    "With subfranchises only": { sv: "Endast med subfranchises" },
    added: { sv: "tillagda" },
    "awards added": { sv: "priser tillagda" },
    "awards rejected": { sv: "priser avvisade" },
    merged: { sv: "sammanslagna" },
    more: { sv: "till" },
    parsed: { sv: "tolkade" },
    skipped: { sv: "överhoppade" },
    "{added} added, {rejected} rejected": {
      sv: "{added} tillagda, {rejected} avvisade",
    },
    "{parsed} parsed, {added} added, {merged} merged": {
      sv: "{parsed} tolkade, {added} tillagda, {merged} sammanslagna",
    },

    // Metadata batch controls (src/data/metadata-batch.js)
    "watched film metadata": { sv: "sedd filmmetadata" },
    "watchlist metadata": { sv: "watchlist-metadata" },
    "watched film posters": { sv: "sedda filmposters" },
    "watchlist posters": { sv: "watchlist-posters" },
    "not-watched film metadata": { sv: "osedd filmmetadata" },
    "not-watched film posters": { sv: "osedda filmposters" },
    "person portraits": { sv: "personporträtt" },
    metadata: { sv: "metadata" },
    item: { sv: "objekt" },
    items: { sv: "objekt" },
    queue: { sv: "kö" },
    queues: { sv: "köer" },
    "not-watched metadata item": { sv: "osett metadata-objekt" },
    "not-watched metadata items": { sv: "osedda metadata-objekt" },
    Reason: { sv: "Anledning" },
    ", {count} skipped": { sv: ", {count} överhoppade" },
    "Done: {attempted} attempted, {found} updated, {failed} failed{skippedNote}.":
      {
        sv: "Klart: {attempted} försök, {found} uppdaterade, {failed} misslyckade{skippedNote}.",
      },
    "Failed lookups": { sv: "Misslyckade uppslag" },
    "Fetch all missing": { sv: "Hämta allt saknat" },
    "Fetch not-watched missing": { sv: "Hämta osett saknat" },
    "Fetch {items} across {queues}? This can take several minutes.": {
      sv: "Hämta {items} över {queues}? Detta kan ta flera minuter.",
    },
    "Fetch {items}? This can take several minutes.": {
      sv: "Hämta {items}? Detta kan ta flera minuter.",
    },
    "Fetching...": { sv: "Hämtar..." },
    Item: { sv: "Objekt" },
    "No metadata queues need fetching.": {
      sv: "Inga metadata-köer behöver hämtas.",
    },
    "No not-watched watchlist films need fetching.": {
      sv: "Inga osedda watchlist-filmer behöver hämtas.",
    },
    "No {label} items need fetching.": {
      sv: "Inga {label}-objekt behöver hämtas.",
    },
    "Queue {index} / {total}:": { sv: "Kö {index} / {total}:" },
    "Queue {index} / {total}: {label} ({remaining})": {
      sv: "Kö {index} / {total}: {label} ({remaining})",
    },
    "Retry this batch with previous attempts included": {
      sv: "Försök igen med tidigare försök inkluderade",
    },
    "Session retry queues": { sv: "Sessionens omförsöksköer" },
    "No metadata lookups have run this session.": {
      sv: "Inga metadata-uppslag har körts denna session.",
    },
    Attempted: { sv: "Försökta" },
    Failed: { sv: "Misslyckade" },
    Failures: { sv: "Misslyckanden" },
    "Retry {count} failed": { sv: "Försök igen med {count} misslyckade" },
    "No failed {label} lookups this session.": {
      sv: "Inga misslyckade {label}-uppslag denna session.",
    },
    "Retrying {count} failed {label} lookup(s).": {
      sv: "Försöker igen med {count} misslyckade {label}-uppslag.",
    },
    "No TMDB match found.": { sv: "Ingen TMDB-träff hittades." },
    "No poster found.": { sv: "Ingen poster hittades." },
    "No portrait found.": { sv: "Inget porträtt hittades." },
    "Already attempted this session.": { sv: "Redan försökt denna session." },
    "Running...": { sv: "Kör..." },
    "Save a TMDB credential before fetching every missing metadata queue.": {
      sv: "Spara ett TMDB-nyckel innan alla saknade metadata-köer hämtas.",
    },
    "Save a TMDB credential before fetching not-watched films.": {
      sv: "Spara ett TMDB-nyckel innan osedda filmer hämtas.",
    },
    "Save a TMDB credential before fetching this batch.": {
      sv: "Spara ett TMDB-nyckel innan denna batch hämtas.",
    },
    "Showing {shown} of {total} failures.": {
      sv: "Visar {shown} av {total} misslyckanden.",
    },
    "Showing {shown} of {total} skipped items.": {
      sv: "Visar {shown} av {total} överhoppade objekt.",
    },
    "Skipped this session": { sv: "Överhoppade denna session" },
    "Start batch": { sv: "Starta batch" },
    "Starting {count} {label}.": { sv: "Startar {count} {label}." },
    "Starting {items}.": { sv: "Startar {items}." },
    "Unknown metadata batch type.": { sv: "Okänd metadata-batchtyp." },

    // Data & backups page (src/pages/data.js)
    "(blank)": { sv: "(tomt)" },
    "Add googleClientId, googleSheets.spreadsheetId, and googleSheets.ranges in config.local.js.":
      {
        sv: "Lägg till googleClientId, googleSheets.spreadsheetId och googleSheets.ranges i config.local.js.",
      },
    "All types": { sv: "Alla typer" },
    "Applied to draft": { sv: "Tillämpat på utkast" },
    "Apply failed": { sv: "Tillämpning misslyckades" },
    "Applying...": { sv: "Tillämpar..." },
    Applied: { sv: "Tillämpad" },
    "Batch set to {label}.": { sv: "Batch inställd på {label}." },
    "Canonical proposal changes": { sv: "Kanoniska förslagsändringar" },
    "Changed records": { sv: "Ändrade poster" },
    Before: { sv: "Före" },
    After: { sv: "Efter" },
    Changes: { sv: "Ändringar" },
    "Clear all data": { sv: "Rensa all data" },
    "Clear all locally stored The Oskars data?": {
      sv: "Rensa all lokalt lagrad The Oskars-data?",
    },
    "Clear failed": { sv: "Rensning misslyckades" },
    "Clear log": { sv: "Rensa logg" },
    "Proposal blocked.": { sv: "Förslaget blockerades." },
    "Proposal ready.": { sv: "Förslaget är klart." },
    "Proposal applied to the local draft. Publish canonical JSON separately.": {
      sv: "Förslaget har tillämpats på det lokala utkastet. Publicera kanonisk JSON separat.",
    },
    "Sheets foundation recorded from {revision}. Further runs create explicit follow-up proposals.": {
      sv: "Sheets-grunden registrerades från {revision}. Fortsatta körningar skapar uttryckliga uppföljningsförslag.",
    },
    "Clear the local sheet edit log?": {
      sv: "Rensa den lokala sheet-ändringsloggen?",
    },
    Cleared: { sv: "Rensad" },
    "Clearing...": { sv: "Rensar..." },
    Copied: { sv: "Kopierad" },
    "Copy failed": { sv: "Kopiering misslyckades" },
    "Copy grouped TSV": { sv: "Kopiera grupperad TSV" },
    "Copy shown": { sv: "Kopiera visade" },
    "Download failed": { sv: "Nedladdning misslyckades" },
    "Download grouped TSV": { sv: "Ladda ner grupperad TSV" },
    Downloaded: { sv: "Nedladdad" },
    "Recent project picks": { sv: "Senaste projektval" },
    "Could not load data tools": { sv: "Kunde inte ladda dataverktyg" },
    "Import failed": { sv: "Import misslyckades" },
    "Import from Google Sheets": { sv: "Importera från Google Sheets" },
    Imported: { sv: "Importerad" },
    "Importing...": { sv: "Importerar..." },
    "Local data replaced.": { sv: "Lokal data ersatt." },
    "Local metadata preserved.": { sv: "Lokal metadata bevarad." },
    "Mark selected applied": { sv: "Markera valda som tillämpade" },
    "Mark shown applied": { sv: "Markera visade som tillämpade" },
    "No edits match the current filters.": {
      sv: "Inga ändringar matchar aktuella filter.",
    },
    "No local data changed.": { sv: "Ingen lokal data ändrades." },
    "Preview failed": { sv: "Förhandsgranskning misslyckades" },
    "Preview import": { sv: "Förhandsgranska import" },
    Previewed: { sv: "Förhandsgranskad" },
    "Previewing...": { sv: "Förhandsgranskar..." },
    "Read {ranges} configured range(s); parsed {parsed}.": {
      sv: "Läste {ranges} konfigurerade intervall; tolkade {parsed}.",
    },
    "Save image settings": { sv: "Spara bildinställningar" },
    Saved: { sv: "Sparad" },
    "Sheet edit log": { sv: "Sheet-ändringslogg" },
    "Sheet hint": { sv: "Sheet-ledtråd" },
    "Showing 80 newest edits. Export includes all {count} matching edits.": {
      sv: "Visar 80 senaste ändringarna. Exporten inkluderar alla {count} matchande ändringar.",
    },
    Time: { sv: "Tid" },
    "Waiting for Google sign-in.": { sv: "Väntar på Google-inloggning." },
    "{open} open · {applied} applied · {total} total.": {
      sv: "{open} öppna · {applied} tillämpade · {total} totalt.",
    },
    // Set up a year (src/pages/setup-year.js)
    "Set up a year": { sv: "Sätt upp ett år" },
    "Year not found": { sv: "Året hittades inte" },
    "Set up {year}": { sv: "Sätt upp {year}" },
    "{year} isn't fully set up yet.": {
      sv: "{year} är inte helt uppsatt än.",
    },
    "View {year}": { sv: "Visa {year}" },
    Ranking: { sv: "Rankning" },
    Bracket: { sv: "Bracket" },
    "No rated films yet for {year}.": {
      sv: "Inga betygsatta filmer ännu för {year}.",
    },
    "{count} tie(s) to resolve.": { sv: "{count} oavgjord(a) att lösa." },
    "Every rating tier is already in a single order.": {
      sv: "Varje betygsnivå har redan en entydig ordning.",
    },
    Fill: { sv: "Fyll i" },
    Collapse: { sv: "Fäll ihop" },
    "No more of {year}'s watched films are eligible for this category.": {
      sv: "Inga fler av {year}s sedda filmer är berättigade till denna kategori.",
    },
    "{category} is full. Drop a film onto a nominee above to bump it in, or remove one first.":
      {
        sv: "{category} är fullsatt. Släpp en film på en nominerad ovan för att knuffa in den, eller ta bort en först.",
      },
    "No nominees yet.": { sv: "Inga nominerade ännu." },
    "Eligible films from {year}": { sv: "Berättigade filmer från {year}" },
    "Not a contender - hide from this pool": {
      sv: "Inte aktuell - dölj från denna pool",
    },
    "Show {count} hidden": { sv: "Visa {count} dolda" },
    NR: { sv: "NR" },
    "Add credit": { sv: "Lägg till credit" },
    "Nominate {title} for {category}": {
      sv: "Nominera {title} till {category}",
    },
    "Could not update the recipient.": {
      sv: "Kunde inte uppdatera mottagaren.",
    },
    // Scoped ranking reset and award removal (src/pages/data.js)
    "Reset rankings": { sv: "Återställ rankningar" },
    "Resetting...": { sv: "Återställer..." },
    Reset: { sv: "Återställd" },
    "Reset the all-time order for {scope} to the rating / release-year / title default? Ratings and awards are untouched. A backup downloads first.":
      {
        sv: "Återställ all-time-ordningen för {scope} till standarden betyg / utgivningsår / titel? Betyg och priser påverkas inte. En backup laddas ner först.",
      },
    "Reset {count} film rank(s).": {
      sv: "Återställde {count} filmrankning(ar).",
    },
    "Remove awards": { sv: "Ta bort priser" },
    "Removing...": { sv: "Tar bort..." },
    "Choose at least one period type.": {
      sv: "Välj minst en periodtyp.",
    },
    "Remove awards for {scope}? Ratings, ranks, and everything else are untouched. A backup downloads first.":
      {
        sv: "Ta bort priser för {scope}? Betyg, rankningar och allt annat påverkas inte. En backup laddas ner först.",
      },
    "Removed {count} nomination(s).": {
      sv: "Tog bort {count} nominering(ar).",
    },
    "every film": { sv: "alla filmer" },
    "{from}–{to}": { sv: "{from}–{to}" },
    "{from} onward": { sv: "{from} och framåt" },
    "through {to}": { sv: "till och med {to}" },
    "Welcome to The Oskars": { sv: "Välkommen till The Oskars" },
    "This copy runs entirely in your browser — nothing is uploaded, and no one else can see it. Your archive saves automatically to this browser only. Back it up anytime from the Data page, and you can clear it there to start over.":
      {
        sv: "Den här kopian körs helt i din webbläsare — inget laddas upp, och ingen annan kan se den. Ditt arkiv sparas automatiskt bara i den här webbläsaren. Säkerhetskopiera när som helst från Data-sidan, där du också kan rensa det för att börja om.",
      },
    "Start with an empty archive": { sv: "Börja med ett tomt arkiv" },
    "Build your own archive from scratch — add films and awards yourself.": {
      sv: "Bygg ditt eget arkiv från grunden — lägg till filmer och priser själv.",
    },
    "Start empty": { sv: "Börja tomt" },
    "Start with sample data": { sv: "Börja med exempeldata" },
    "A few made-up films and awards, so you can see how everything works before adding your own.":
      {
        sv: "Några påhittade filmer och priser, så att du kan se hur allt fungerar innan du lägger till dina egna.",
      },
    "Load sample archive": { sv: "Ladda exempelarkiv" },
    "Import an existing backup": { sv: "Importera en befintlig säkerhetskopia" },
    "Already have an exported backup or canonical file? Import it on the Data page.":
      {
        sv: "Har du redan en exporterad säkerhetskopia eller kanonisk fil? Importera den på Data-sidan.",
      },
    "Go to Data page": { sv: "Gå till Data-sidan" },
    "Your empty archive is ready.": { sv: "Ditt tomma arkiv är klart." },
    "Add your first film": { sv: "Lägg till din första film" },
    "Skip for now": { sv: "Hoppa över för nu" },
  };

  let categoryTranslations = {
    "Best Picture": { sv: "Bästa film" },
    "Best Director": { sv: "Bästa regi" },
    "Best Cinematography": { sv: "Bästa foto" },
    "Best Original Screenplay": { sv: "Bästa originalmanus" },
    "Best Adapted Screenplay": { sv: "Bästa manus efter förlaga" },
    "Best Lead Actor": { sv: "Bästa manliga huvudroll" },
    "Best Lead Actress": { sv: "Bästa kvinnliga huvudroll" },
    "Best Supporting Actor": { sv: "Bästa manliga biroll" },
    "Best Supporting Actress": { sv: "Bästa kvinnliga biroll" },
    "Best International Picture": { sv: "Bästa internationella film" },
    "Best Animated Picture": { sv: "Bästa animerade film" },
    "Best Score": { sv: "Bästa musik" },
    "Best Song": { sv: "Bästa låt" },
    "Best Casting": { sv: "Bästa rollbesättning" },
    "Best Editing": { sv: "Bästa klippning" },
    "Best Visual Effects": { sv: "Bästa visuella effekter" },
    "Best Production Design": { sv: "Bästa scenografi" },
    "Best Costume Design": { sv: "Bästa kostym" },
  };

  function readLocale() {
    try {
      let saved = localStorage.getItem(window.OSKARS_LOCALE_KEY);
      if (saved === "sv" || saved === "en") return saved;
    } catch (err) {}
    return "en";
  }

  function interpolate(text, values) {
    return String(text || "").replace(/\{([^}]+)\}/g, (match, key) =>
      values && Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : match,
    );
  }

  /**
   * Returns the persisted application locale.
   * @returns {'en'|'sv'}
   */
  window.oskarsLocale = function () {
    return readLocale();
  };

  function emitLocaleChange(locale, previousLocale) {
    if (
      locale === previousLocale ||
      typeof window === "undefined" ||
      !window.dispatchEvent
    )
      return;
    let detail = { locale, previousLocale };
    try {
      let event =
        typeof CustomEvent === "function"
          ? new CustomEvent("oskars:localechange", { detail })
          : { type: "oskars:localechange", detail };
      window.dispatchEvent(event);
    } catch (err) {}
  }

  /**
   * Persists and applies an application locale and emits its change event.
   * @param {string} locale Requested locale.
   * @returns {'en'|'sv'}
   */
  window.setOskarsLocale = function (locale) {
    let previous = readLocale();
    let next = locale === "sv" ? "sv" : "en";
    try {
      localStorage.setItem(window.OSKARS_LOCALE_KEY, next);
    } catch (err) {}
    if (typeof document !== "undefined" && document.documentElement)
      document.documentElement.lang = next;
    emitLocaleChange(next, previous);
    return next;
  };

  /**
   * Switches between the supported application locales.
   * @returns {'en'|'sv'}
   */
  window.toggleOskarsLocale = function () {
    return window.setOskarsLocale(window.oskarsLocale() === "sv" ? "en" : "sv");
  };

  /**
   * Translates a registered key and interpolates supplied values.
   * @param {string} key Translation key.
   * @param {string} fallback English fallback text.
   * @param {Object} [values] Interpolation values.
   * @returns {string}
   */
  window.t = function (key, fallback, values) {
    let locale = window.oskarsLocale();
    let text =
      locale === "en" ? fallback : translations[key]?.[locale] || fallback;
    return interpolate(text, values);
  };

  /**
   * Translates literal UI text and interpolates supplied values.
   * @param {string} fallback English UI text.
   * @param {Object} [values] Interpolation values.
   * @returns {string}
   */
  window.uiText = function (fallback, values) {
    let locale = window.oskarsLocale();
    let text =
      locale === "en"
        ? fallback
        : literalTranslations[fallback]?.[locale] || fallback;
    return interpolate(text, values);
  };

  /**
   * Formats a count with a localized singular or plural noun.
   * @param {number} count Count to format.
   * @param {string} singular Singular noun.
   * @param {string} [plural] Plural noun.
   * @returns {string}
   */
  window.uiCount = function (count, singular, plural) {
    return `${count} ${Number(count) === 1 ? window.uiText(singular) : window.uiText(plural || singular)}`;
  };

  /**
   * Returns a category's localized display name.
   * @param {string} category Canonical category name.
   * @returns {string}
   */
  window.localizedCategoryName = function (category) {
    let value = String(category || "").trim();
    let locale = window.oskarsLocale();
    return locale === "en"
      ? value
      : categoryTranslations[value]?.[locale] || value;
  };

  /**
   * Returns the locale-appropriate title for a film.
   * @param {FilmRecord} film Film record.
   * @returns {string}
   */
  window.localizedFilmTitle = function (film) {
    let title = String(film?.title || "").trim();
    let swedishTitle = String(film?.swedishTitle || "").trim();
    return window.oskarsLocale() === "sv" && swedishTitle
      ? swedishTitle
      : title;
  };

  /**
   * Reports whether the current locale provides a distinct film title.
   * @param {FilmRecord} film Film record.
   * @returns {boolean|string}
   */
  window.hasLocalizedFilmTitle = function (film) {
    return (
      window.oskarsLocale() === "sv" &&
      String(film?.swedishTitle || "").trim() &&
      window.normalizeTitle?.(film.swedishTitle) !==
        window.normalizeTitle?.(film.title)
    );
  };

  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = window.oskarsLocale();
  }
})();
