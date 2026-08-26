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
    "nav.profile": { sv: "Konto" },
    "nav.intake": { sv: "Intag" },
    "nav.build": { sv: "Bygg dina Oskars" },
    "nav.rateWatched": { sv: "Betygsätt sedda" },
    "action.view": { sv: "Visa" },
    "search.placeholder": { sv: "Sök" },
    "search.aria": { sv: "Sök i The Oskars" },
    "search.type.film": { sv: "Film" },
    "search.type.otherwatched": { sv: "Övrigt sett" },
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
    "search.type.sharedfilm": { sv: "Delad film" },
    "search.meta.tier": { sv: "Tier" },
    "search.meta.inArchive": { sv: "Sedd" },
    "search.meta.watchlist": { sv: "Watchlist" },
    "search.meta.watched": { sv: "sedda" },
    "search.meta.open": { sv: "Öppet" },
    "search.meta.complete": { sv: "Klart" },
    "search.meta.archived": { sv: "Arkiverat" },
    "search.meta.sharedArchive": { sv: "Delat arkiv" },
    "menu.categories": { sv: "Kategorier" },
    "menu.periods": { sv: "Perioder" },
    "menu.browsePeriods": { sv: "Bläddra bland alla perioder" },
    "menu.elsewhere": { sv: "Annat" },
    "menu.community": { sv: "Gemenskap" },
    "menu.discover": { sv: "Upptäck" },
    "menu.showcase": { sv: "Utställning" },
    "menu.browseCategories": { sv: "Bläddra bland alla kategorier" },
    "menu.tags": { sv: "Taggar" },
    "menu.people": { sv: "Personer" },
    "menu.directors": { sv: "Regissörer" },
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
    "posterBackdrop.switchOn": { sv: "Visa affischbakgrund" },
    "posterBackdrop.switchOff": { sv: "Dölj affischbakgrund" },
    "language.switchTo": { sv: "Switch to English" },
    "language.current": { sv: "Svenska" },
    "language.next": { sv: "EN" },
    "period.allTime": { sv: "All-time" },
    "auth.signOut": { sv: "Logga ut" },
    "auth.confirmSignOut": {
      sv: "Sluta molnsynka och fortsätt lokalt? Du kan logga in igen när som helst.",
    },
    "auth.confirmSignOutRequired": {
      sv: "Logga ut och lås webbläsarens privata arkiv? Ingenting raderas; samma konto kan öppna det igen senare.",
    },
  };

  let literalTranslations = {
    "{count} winners": { sv: "{count} vinnare" },
    "Latest winner": { sv: "Senaste vinnare" },
    "No winner selected yet": { sv: "Ingen vinnare vald ännu" },
    "The award board": { sv: "Pristavlan" },
    "Choose a category": { sv: "Välj en kategori" },
    "Open category": { sv: "Öppna kategori" },
    "Browse the winners that have shaped each category, then open its complete history.":
      {
        sv: "Bläddra bland vinnarna som har format varje kategori och öppna sedan hela dess historia.",
      },
    "See the latest personal winner, then follow the category across the archive.":
      {
        sv: "Se den senaste personliga vinnaren och följ sedan kategorin genom arkivet.",
      },
    "Enter the archive": { sv: "Kliv in i arkivet" },
    "Choose an era": { sv: "Välj en era" },
    "The whole archive": { sv: "Hela arkivet" },
    "Open period": { sv: "Öppna period" },
    "Move through the archive one cinematic era at a time.": {
      sv: "Rör dig genom arkivet en filmisk era i taget.",
    },
    "Big picture": { sv: "Helhetsbilden" },
    "Open a century to see its films, brackets, and watchlist together.": {
      sv: "Öppna ett århundrade för att se dess filmer, prisklasser och watchlist tillsammans.",
    },
    "Era by era": { sv: "Era för era" },
    "Each deck is drawn from the strongest ranked films in that decade.": {
      sv: "Varje kortlek hämtas från årtiondets högst rankade filmer.",
    },
    "Start with a chapter shaped by the films and ceremonies already in your archive.":
      {
        sv: "Börja med ett kapitel format av filmerna och ceremonierna som redan finns i ditt arkiv.",
      },
    "Latest chapter": { sv: "Senaste kapitlet" },
    "Richest ceremony": { sv: "Rikaste ceremonin" },
    "Where it begins": { sv: "Där det börjar" },
    "Exact navigation": { sv: "Exakt navigering" },
    "Jump to a period": { sv: "Hoppa till en period" },
    "Open all-time, a century, a decade, or any populated year.": {
      sv: "Öppna alla tider, ett århundrade, ett årtionde eller valfritt år med innehåll.",
    },
    "Build your Oskars": { sv: "Bygg dina Oskars" },
    "Your film journey": { sv: "Din filmresa" },
    "Rate, rank, and celebrate your watched history one release year at a time.": {
      sv: "Betygsätt, ranka och fira din filmhistorik ett premiärår i taget.",
    },
    "Journey progress": { sv: "Resans framsteg" },
    "films rated": { sv: "filmer betygsatta" },
    "ranking groups arranged": { sv: "rankningsgrupper ordnade" },
    "award slots filled": { sv: "prisplatser fyllda" },
    "years complete": { sv: "år klara" },
    "Continue your journey": { sv: "Fortsätt din resa" },
    "Needs ratings": { sv: "Behöver betyg" },
    "Ready to rank": { sv: "Redo att rankas" },
    "Build the ceremony": { sv: "Bygg ceremonin" },
    "Year complete": { sv: "Året är klart" },
    "Rate this year": { sv: "Betygsätt året" },
    "Rank this year": { sv: "Ranka året" },
    "View year": { sv: "Visa året" },
    Ceremonies: { sv: "Ceremonier" },
    "Filter years by next stage": { sv: "Filtrera år efter nästa steg" },
    "No years at this stage.": { sv: "Inga år befinner sig i detta steg." },
    "Ranking groups": { sv: "Rankningsgrupper" },
    "Award slots": { sv: "Prisplatser" },
    "{count} rating-only standalone work(s)": {
      sv: "{count} fristående verk som endast betygsätts",
    },
    "Rate watched": { sv: "Betygsätt sedda" },
    "Back to Intake": { sv: "Tillbaka till intag" },
    "Back to Build your Oskars": { sv: "Tillbaka till Bygg dina Oskars" },
    "Give unrated watched entries their exact personal rating, one release year at a time.": {
      sv: "Ge sedda poster utan betyg deras exakta personliga betyg, ett premiärår i taget.",
    },
    "Everything watched is rated": { sv: "Allt sett är betygsatt" },
    "There are no unrated watched entries with a release year.": {
      sv: "Det finns inga sedda poster med premiärår som saknar betyg.",
    },
    "{count} remaining": { sv: "{count} återstår" },
    "Unrated years": { sv: "År med poster utan betyg" },
    "{count} unrated": { sv: "{count} utan betyg" },
    "Your rating": { sv: "Ditt betyg" },
    "Save & next": { sv: "Spara och fortsätt" },
    "Undo last rating": { sv: "Ångra senaste betyget" },
    "Rating only": { sv: "Endast betyg" },
    "Rating mode": { sv: "Betygsläge" },
    Focus: { sv: "Fokus" },
    Grid: { sv: "Rutnät" },
    "Films in this year": { sv: "Verk under året" },
    "Keys 1–5 set whole stars · − / . / + choose the shade · Enter saves": {
      sv: "Tangenterna 1–5 väljer hela stjärnor · − / . / + väljer nyans · Enter sparar",
    },
    "{current} of {total} left in {year}": {
      sv: "{current} av {total} kvar från {year}",
    },
    "Year rated": { sv: "Året betygsatt" },
    "is ready": { sv: "är redo" },
    "You rated all {count} watched work(s) from this year.": {
      sv: "Du har betygsatt alla {count} sedda verk från året.",
    },
    "Return to Build your Oskars": { sv: "Tillbaka till Bygg dina Oskars" },
    "Choose another year": { sv: "Välj ett annat år" },
    "Archive milestone": { sv: "Arkivmilstolpe" },
    "Your Oskars are complete": { sv: "Dina Oskars är klara" },
    "Every watched year is rated, ranked, and celebrated.": {
      sv: "Varje sett år är betygsatt, rankat och firat.",
    },
    "Open the showcase": { sv: "Öppna utställningen" },
    "Decade milestone": { sv: "Decenniemilstolpe" },
    "{scope} is complete": { sv: "{scope} är klart" },
    "Every watched year in this decade has completed its creative journey.": {
      sv: "Varje sett år under decenniet har avslutat sin kreativa resa.",
    },
    "View the decade": { sv: "Visa decenniet" },
    "Ceremony complete": { sv: "Ceremonin klar" },
    "The ballot is sealed and ready to present.": {
      sv: "Röstsedeln är förseglad och redo att presenteras.",
    },
    "Year ranked": { sv: "Året rankat" },
    "{scope} has its order": { sv: "{scope} har fått sin ordning" },
    "The year's same-rating shelves are deliberately arranged.": {
      sv: "Årets hyllor med samma betyg är medvetet ordnade.",
    },
    "{scope} is rated": { sv: "{scope} är betygsatt" },
    "Every watched work from the year now has your grade.": {
      sv: "Varje sett verk från året har nu ditt betyg.",
    },
    "Dismiss milestone": { sv: "Dölj milstolpe" },
    "Start rebuilding": { sv: "Börja bygga upp igen" },
    "Your creative journey": { sv: "Din kreativa resa" },
    "Your archive is ready to make yours": { sv: "Ditt arkiv är redo att bli ditt" },
    "{count} watched work(s) need your personal rating. Import diagnostics can wait while you start with the films.": {
      sv: "{count} sedda verk behöver ditt personliga betyg. Importdiagnostiken kan vänta medan du börjar med filmerna.",
    },
    "Start building your Oskars": { sv: "Börja bygga dina Oskars" },
    "Other watched": { sv: "Övrigt sett" },
    "Not yet ranked": { sv: "Ännu inte rangordnad" },
    "In the shared archive": { sv: "I det delade arkivet" },
    "Add to watchlist": { sv: "Lägg till i att se-listan" },
    "Add to watched": { sv: "Lägg till som sedd" },
    "Adding…": { sv: "Lägger till…" },
    "Shared film": { sv: "Delad film" },
    "This shared film could not be found.": {
      sv: "Den delade filmen kunde inte hittas.",
    },
    "View on TMDB": { sv: "Visa på TMDB" },
    "This film is known to the shared archive but hasn't been added to your own collection yet.": {
      sv: "Filmen finns i det delade arkivet men har inte lagts till i din egen samling än.",
    },
    works: { sv: "verk" },
    "No other watched entries in this period.": {
      sv: "Inga övriga sedda poster under denna period.",
    },
    "{count} changes": { sv: "{count} ändringar" },
    "1 change": { sv: "1 ändring" },
    Aliases: { sv: "Alias" },
    "Applied time": { sv: "Tillämpningstid" },
    "All targets": { sv: "Alla mål" },
    "Entry id": { sv: "Post-id" },
    "Film metadata": { sv: "Filmmetadata" },
    Imports: { sv: "Importer" },
    Inspect: { sv: "Granska" },
    "No context recorded.": { sv: "Ingen kontext registrerad." },
    "No recorded changes.": { sv: "Inga registrerade ändringar." },
    Notes: { sv: "Anteckningar" },
    Other: { sv: "Övrigt" },
    "Target id": { sv: "Mål-id" },
    "Technical details": { sv: "Tekniska detaljer" },
    Undo: { sv: "Ångra" },
    Undone: { sv: "Ångrad" },
    Undoable: { sv: "Kan ångras" },
    "Not undoable": { sv: "Kan inte ångras" },
    "Undo of": { sv: "Ångrar post" },
    "Undo preview": { sv: "Förhandsgranska ångring" },
    "Confirm undo": { sv: "Bekräfta ångring" },
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
    "Auteurs through their known films.": {
      sv: "Auteurregissörer genom sina kända filmer.",
    },
    "All people": { sv: "Alla personer" },
    "Browse directors": { sv: "Bläddra bland regissörer" },
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
    "All countries": { sv: "Alla länder" },
    "All professions": { sv: "Alla yrken" },
    "All ratings": { sv: "Alla betyg" },
    "All sources": { sv: "Alla källor" },
    "All tiers": { sv: "Alla tiers" },
    "All centuries": { sv: "Alla århundraden" },
    "All decades": { sv: "Alla årtionden" },
    "Narrow period": { sv: "Begränsa period" },
    "Delete opinions": { sv: "Radera åsikter" },
    "Your ratings, rankings, and awards": {
      sv: "Dina betyg, rankningar och priser",
    },
    "Opinion tools": { sv: "Verktyg för dina åsikter" },
    "Rebuild everything blindly, or make one smaller change. Film facts and watch history stay in your archive.": {
      sv: "Bygg om allt blint eller gör en mindre ändring. Filmfakta och tittarhistorik finns kvar i arkivet.",
    },
    "Finish, restore, or close your blind rebuild before changing film order or award ballots.": {
      sv: "Slutför, återställ eller stäng den blinda ombyggnaden innan du ändrar filmordning eller prisplaceringar.",
    },
    "Reset film order": { sv: "Återställ filmordning" },
    "Put films in a release-year range back into the standard rating, release year, and title order. Ratings and award ballots stay untouched. A backup downloads first.": {
      sv: "Lägg tillbaka filmer inom ett intervall av utgivningsår i standardordningen betyg, utgivningsår och titel. Betyg och prisplaceringar påverkas inte. En säkerhetskopia laddas ned först.",
    },
    "Remove award ballots": { sv: "Ta bort prisplaceringar" },
    "Remove your award placements for selected periods and years. Ratings, film order, and other opinions stay untouched. A backup downloads first.": {
      sv: "Ta bort dina prisplaceringar för valda perioder och år. Betyg, filmordning och andra åsikter påverkas inte. En säkerhetskopia laddas ned först.",
    },
    "Permanently erase all opinions": {
      sv: "Radera alla åsikter permanent",
    },
    "Remove ratings, rankings, award ballots, reviews, interest tiers, notes, and any saved blind-rebuild originals. Films, watch history, credits, and other facts stay. A backup downloads first.": {
      sv: "Ta bort betyg, rankningar, prisplaceringar, recensioner, intressenivåer, anteckningar och sparade original från en blind ombyggnad. Filmer, tittarhistorik, medverkande och andra fakta finns kvar. En säkerhetskopia laddas ned först.",
    },
    "Erase all opinions": { sv: "Radera alla åsikter" },
    Erased: { sv: "Raderade" },
    "Permanently erase all opinions, including the saved originals from this blind rebuild? The rebuild will end, and those originals cannot be restored. Films, watch history, and other facts stay. A backup downloads first.": {
      sv: "Radera alla åsikter permanent, även de sparade originalen från den blinda ombyggnaden? Ombyggnaden avslutas och originalen kan inte återställas. Filmer, tittarhistorik och andra fakta finns kvar. En säkerhetskopia laddas ned först.",
    },
    "Permanently erase all opinions? Ratings, rankings, award ballots, reviews, interest tiers, and notes will be removed. Films, watch history, and other facts stay. A backup downloads first.": {
      sv: "Radera alla åsikter permanent? Betyg, rankningar, prisplaceringar, recensioner, intressenivåer och anteckningar tas bort. Filmer, tittarhistorik och andra fakta finns kvar. En säkerhetskopia laddas ned först.",
    },
    "Erased {ratings} ratings, {awards} award placements, and your other saved opinions. {watched} watched work(s) and their facts remain.": {
      sv: "Raderade {ratings} betyg, {awards} prisplaceringar och dina andra sparade åsikter. {watched} sedda verk och deras fakta finns kvar.",
    },
    "Stored on this device": { sv: "Lagrat på den här enheten" },
    "This browser": { sv: "Den här webbläsaren" },
    "Remove this browser's private archive without changing the synced cloud copy or a published profile.": {
      sv: "Ta bort webbläsarens privata arkiv utan att ändra den synkade molnkopian eller en publicerad profil.",
    },
    "Remove archive from this browser": {
      sv: "Ta bort arkivet från webbläsaren",
    },
    "Download a backup, empty this browser, disconnect cloud syncing, and sign out. Your synced cloud copy and published profile stay as they are.": {
      sv: "Ladda ned en säkerhetskopia, töm webbläsaren, koppla från molnsynkningen och logga ut. Din synkade molnkopia och publicerade profil förblir oförändrade.",
    },
    "Remove from this browser": { sv: "Ta bort från webbläsaren" },
    "Remove this archive from this browser? A backup downloads first, then this browser is emptied, disconnected from cloud syncing, and signed out. Your synced cloud copy and published profile are not deleted.": {
      sv: "Ta bort arkivet från den här webbläsaren? En säkerhetskopia laddas ned först. Sedan töms webbläsaren, kopplas från molnsynkningen och loggas ut. Din synkade molnkopia och publicerade profil raderas inte.",
    },
    "Remove failed": { sv: "Borttagningen misslyckades" },
    "The archive could not be removed. This browser and your other copies were not changed.": {
      sv: "Arkivet kunde inte tas bort. Den här webbläsaren och dina andra kopior ändrades inte.",
    },
    "This browser now has an empty archive and is disconnected. Your synced cloud copy and published profile were not changed.": {
      sv: "Den här webbläsaren har nu ett tomt arkiv och är frånkopplad. Din synkade molnkopia och publicerade profil ändrades inte.",
    },
    "The archive was removed, but this browser could not disconnect from the account. Sign out before using it again.": {
      sv: "Arkivet togs bort, men webbläsaren kunde inte kopplas från kontot. Logga ut innan du använder den igen.",
    },
    "The archive was removed and disconnected, but sign-out did not finish. Try signing out again.": {
      sv: "Arkivet togs bort och kopplades från, men utloggningen slutfördes inte. Försök logga ut igen.",
    },
    "Blind opinion rebuild": { sv: "Blind ombyggnad av åsikter" },
    "Hide your current ratings, rankings, personal awards, and other opinions while you rebuild them from scratch. The originals stay private and can be restored or deliberately compared at any time.": {
      sv: "Dölj dina nuvarande betyg, rankningar, personliga priser och andra åsikter medan du bygger om dem från grunden. Originalen förblir privata och kan återställas eller jämföras medvetet när som helst.",
    },
    "Start blind rebuild": { sv: "Starta blind ombyggnad" },
    "Blind rebuild active": { sv: "Blind ombyggnad aktiv" },
    "Blind rebuild complete": { sv: "Blind ombyggnad slutförd" },
    "Your original opinions are hidden": {
      sv: "Dina ursprungliga åsikter är dolda",
    },
    "Compare your original and rebuilt opinions": {
      sv: "Jämför dina ursprungliga och ombyggda åsikter",
    },
    "The rebuilt opinions are now active. Your private baseline remains available here until you close this comparison.": {
      sv: "De ombyggda åsikterna är nu aktiva. Din privata baslinje finns kvar här tills du stänger jämförelsen.",
    },
    "Started {date}. Ordinary pages use only the opinions you add during this rebuild.": {
      sv: "Startad {date}. Vanliga sidor använder bara de åsikter du lägger till under den här ombyggnaden.",
    },
    "Continue rebuilding": { sv: "Fortsätt bygga om" },
    "ratings rebuilt": { sv: "betyg ombyggda" },
    "ranks comparable": { sv: "rankningar jämförbara" },
    "award placements rebuilt": { sv: "prisplaceringar ombyggda" },
    "The baseline contains {ratings} ratings and {awards} award placements.": {
      sv: "Baslinjen innehåller {ratings} betyg och {awards} prisplaceringar.",
    },
    "Hide comparison": { sv: "Dölj jämförelse" },
    "Compare progress": { sv: "Jämför framsteg" },
    "Restore original opinions": { sv: "Återställ ursprungliga åsikter" },
    "Finish and compare": { sv: "Slutför och jämför" },
    "Close comparison": { sv: "Stäng jämförelsen" },
    "Biggest rating changes": { sv: "Största betygsförändringarna" },
    "Biggest ranking moves": { sv: "Största rankningsförflyttningarna" },
    "Award placement changes": { sv: "Förändringar av prisplaceringar" },
    "No rebuilt rating changes to compare yet.": {
      sv: "Inga ombyggda betygsförändringar att jämföra ännu.",
    },
    "No confirmed rebuilt ranks to compare yet.": {
      sv: "Inga bekräftade ombyggda rankningar att jämföra ännu.",
    },
    "No award placement changes to compare yet.": {
      sv: "Inga förändringar av prisplaceringar att jämföra ännu.",
    },
    removed: { sv: "borttagen" },
    "Start a blind opinion rebuild? Your current opinions will be stored privately and hidden from ordinary pages while you rebuild. A backup downloads first.": {
      sv: "Starta en blind ombyggnad av åsikter? Dina nuvarande åsikter lagras privat och döljs från vanliga sidor medan du bygger om. En säkerhetskopia laddas ner först.",
    },
    "Restore the original opinions? Opinions added during this rebuild will be discarded, while factual archive changes stay. A backup of the current rebuild downloads first.": {
      sv: "Återställ de ursprungliga åsikterna? Åsikter som lagts till under ombyggnaden tas bort, medan faktiska arkivändringar behålls. En säkerhetskopia av den aktuella ombyggnaden laddas ner först.",
    },
    "Finish the blind rebuild and compare with the originals? Rebuilt opinions become final, while the private baseline stays available until you close the comparison. A backup downloads first.": {
      sv: "Slutför den blinda ombyggnaden och jämför med originalen? De ombyggda åsikterna blir slutgiltiga, medan den privata baslinjen finns kvar tills du stänger jämförelsen. En säkerhetskopia laddas ner först.",
    },
    "Close this comparison? The rebuilt opinions stay, but the original baseline will be removed after a backup downloads.": {
      sv: "Stäng den här jämförelsen? De ombyggda åsikterna behålls, men den ursprungliga baslinjen tas bort efter att en säkerhetskopia laddats ner.",
    },
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
    "Removed {awards} award placements, {ratings} ratings, {scores} scores, {reviews} reviews, {rewatches} rewatch marks, {tiers} interest tiers, and {notes} notes, and reset {ranks} film rank(s) to the default order. {watched} watched work(s) remain ready to rebuild.":
      {
        sv: "Tog bort {awards} prisplaceringar, {ratings} betyg, {scores} musikpoäng, {reviews} recensioner, {rewatches} omtittningsmarkeringar, {tiers} intressenivåer och {notes} anteckningar, och återställde {ranks} filmrankningar till standardordningen. {watched} sedda verk finns kvar och är redo att byggas upp igen.",
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
    "Award stories": { sv: "Prisberättelser" },
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
    "TMDB is unavailable right now. Try again later.": {
      sv: "TMDB är inte tillgängligt just nu. Försök igen senare.",
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
    Sweep: { sv: "Storslam" },
    "Near sweep": { sv: "Nära storslam" },
    "Most wins": { sv: "Flest vinster" },
    Shutout: { sv: "Utan vinst" },
    "Recurring rivalry": { sv: "Återkommande rivalitet" },
    "{count} shared categories · {firstWins}–{secondWins} wins": {
      sv: "{count} gemensamma kategorier · {firstWins}–{secondWins} vinster",
    },
    "{nominations} nominations · no wins": {
      sv: "{nominations} nomineringar · inga vinster",
    },
    "Won all {wins} nominations": {
      sv: "Vann alla {wins} nomineringar",
    },
    "{wins} wins from {nominations} nominations · one short": {
      sv: "{wins} vinster från {nominations} nomineringar · en ifrån",
    },
    "{wins} wins from {nominations} nominations": {
      sv: "{wins} vinster från {nominations} nomineringar",
    },
    "The strongest patterns supported by this bracket.": {
      sv: "De tydligaste mönstren som stöds av den här prisklassen.",
    },
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
    "Collection view": { sv: "Samlingsvy" },
    "Collection awards": { sv: "Samlingspriser" },
    "No collection awards have been imported yet.": {
      sv: "Inga samlingspriser har importerats ännu.",
    },
    "This collection is open for a future Oskars bracket.": {
      sv: "Den här samlingen är öppen för en framtida Oskars-tabell.",
    },
    "Not matched to collection": { sv: "Inte matchad mot samlingen" },
    "Ambiguous collection match": { sv: "Tvetydig samlingsmatchning" },
    "{count} nomination films are not uniquely matched to this collection.": {
      sv: "{count} nominerade filmer är inte unikt matchade mot denna samling.",
    },
    "The Oskars": { sv: "The Oskars" },
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
    "Could not add this film.": { sv: "Det gick inte att lägga till filmen." },
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
    "Manual nomination creation. Adding a new watched film happens through Intake's guided workflow; contextual edits (film metadata, awards, rankings) happen on their own detail pages.":
      {
        sv: "Manuellt skapande av nomineringar. Att lägga till en ny sedd film sker via Intags guidade flöde; kontextuella ändringar (filmmetadata, priser, rankningar) sker på deras egna detaljsidor.",
      },
    "Duplicate placement": { sv: "Duplicerad placering" },
    Direct: { sv: "Direkt" },
    "Direct competition among compared films": {
      sv: "Direkt konkurrens mellan jämförda filmer",
    },
    Director: { sv: "Regissör" },
    "Director(s)": { sv: "Regissör(er)" },
    "Director display": { sv: "Regissörsvisning" },
    "Director pages": { sv: "Regissörssidor" },
    "Directors appear when films or watchlist entries name them.": {
      sv: "Regissörer visas när filmer eller watchlistposter namnger dem.",
    },
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
    "{count} reviewed · {remaining} pairs remain": {
      sv: "{count} granskade · {remaining} par kvar",
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
    "Choosing the lower film moves any tied films with it.": {
      sv: "Om du väljer den lägre filmen följer eventuella filmer med delad placering med.",
    },
    'Move "{below}" to rank {aboveRank}, directly above "{above}".': {
      sv: 'Flytta "{below}" till plats {aboveRank}, direkt ovanför "{above}".',
    },
    "One of these films shares its rank with other tied films, which will move together.":
      {
        sv: "En av dessa filmer delar sin plats med andra filmer i samma delning, som flyttas tillsammans.",
      },
    "Apply swap": { sv: "Använd bytet" },
    'Moved "{below}" above "{above}".': {
      sv: 'Flyttade "{below}" över "{above}".',
    },
    "Swap undone.": { sv: "Bytet ångrades." },
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
    "Use this order": { sv: "Använd den här ordningen" },
    "Use these changes": { sv: "Använd ändringarna" },
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
    "Reveal ranking": { sv: "Visa rankning" },
    "Placement {placement}": { sv: "Placering {placement}" },
    "Run ceremony": { sv: "Kör ceremoni" },
    "Section navigation": { sv: "Sektionsnavigering" },
    "Step through {year}'s categories, revealing the full ranking category by category.":
      {
        sv: "Gå igenom {year}s kategorier och visa hela rankningen kategori för kategori.",
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
    tags: { sv: "taggar" },
    "Franchise not found": { sv: "Franchise hittades inte" },
    "Franchise pages": { sv: "Franchise-sidor" },
    "Tag pages": { sv: "Taggsidor" },
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
    "Showing all films": { sv: "Visar alla filmer" },
    "Showing nominees only": { sv: "Visar endast nominerade" },
    "Toggle films shown": { sv: "Växla filmer som visas" },
    Highlights: { sv: "Höjdpunkter" },
    Hybrid: { sv: "Hybrid" },
    Images: { sv: "Bilder" },
    "Imported posters out of films": { sv: "Importerade posters av filmer" },
    "Imported posters out of watched films": {
      sv: "Importerade posters av sedda filmer",
    },
    "Imported posters out of watchlist films": {
      sv: "Importerade posters av watchlist-filmer",
    },
    "Imported portraits out of people": {
      sv: "Importerade porträtt av personer",
    },
    "Live action": { sv: "Live action" },
    "List view": { sv: "Listvy" },
    Links: { sv: "Länkar" },
    "Make active": { sv: "Gör aktivt" },
    Manage: { sv: "Hantera" },
    "Manage films": { sv: "Hantera filmer" },
    "Finish managing": { sv: "Avsluta hantering" },
    "Finish managing films": { sv: "Avsluta filmhantering" },
    "Film management is on. Remove controls are visible.": {
      sv: "Filmhantering är aktiv. Kontroller för borttagning visas.",
    },
    "Project management": { sv: "Projekthantering" },
    "Refresh, lifecycle, films, and deletion": {
      sv: "Uppdatering, livscykel, filmer och radering",
    },
    "Delete project": { sv: "Radera projekt" },
    "Delete project?": { sv: "Radera projekt?" },
    'Delete "{name}" permanently?': { sv: 'Radera "{name}" permanent?' },
    "The project, its note, local order, and dismissed-film history will be removed. Films, ratings, awards, and watchlist entries will not be changed.":
      {
        sv: "Projektet, dess anteckning, lokala ordning och historik över borttagna filmer raderas. Filmer, betyg, priser och watchlist-poster ändras inte.",
      },
    "Open film": { sv: "Öppna film" },
    queued: { sv: "i kö" },
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
    "Music score": { sv: "Musikpoäng" },
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
    "In progress": { sv: "Pågående" },
    "Known completion": { sv: "Känd färdigställandegrad" },
    "known completion": { sv: "känd färdigställandegrad" },
    "Known films": { sv: "Kända filmer" },
    "No directors match this filter.": {
      sv: "Inga regissörer matchar filtret.",
    },
    "No directors yet": { sv: "Inga regissörer ännu" },
    "Directors in progress": { sv: "Regissörer pågående" },
    "Franchises in progress": { sv: "Franchises pågående" },
    "Projects in progress": { sv: "Projekt pågående" },
    "Complete (known films)": { sv: "Klart (kända filmer)" },
    "Bracket slots filled": { sv: "Fyllda bracketplatser" },
    "Watch goals reached": { sv: "Nådda titt-mål" },
    "Oscar completion": { sv: "Oscar-färdigställande" },
    "Oscar film completion": { sv: "Oscarfilmer sedda" },
    "{source} completion": { sv: "{source}-färdigställande" },
    "{source} film completion": { sv: "{source}-filmer sedda" },
    "Add unseen": { sv: "Lägg till osedda" },
    "Add {count} unseen": { sv: "Lägg till {count} osedda" },
    "Review {count}": { sv: "Granska {count}" },
    "{ready} ready; {review} need year review": {
      sv: "{ready} klara; {review} behöver årsgranskning",
    },
    "Add unseen films to tier {tier}": {
      sv: "Lägg till osedda filmer i tier {tier}",
    },
    "Add unseen to interest tier": { sv: "Lägg osedda i intressetier" },
    "Unambiguous scopes add immediately.": {
      sv: "Entydiga urval läggs till direkt.",
    },
    "{count} films need year review": {
      sv: "{count} filmer behöver årsgranskas",
    },
    "Multi-year ceremonies stay out of the watchlist until their release year is known.":
      {
        sv: "Ceremonier som omfattar flera år hålls utanför watchlisten tills utgivningsåret är känt.",
      },
    "Possible years": { sv: "Möjliga år" },
    "Add unseen Oscar films?": { sv: "Lägg till osedda Oscarfilmer?" },
    "Add unseen films?": { sv: "Lägg till osedda filmer?" },
    "{ready} films are ready for tier {tier}. {review} need year review and will be skipped.":
      {
        sv: "{ready} filmer är klara för tier {tier}. {review} behöver årsgranskas och hoppas över.",
      },
    "Needs review": { sv: "Behöver granskas" },
    "Add {count} films": { sv: "Lägg till {count} filmer" },
    "Fetching metadata for {count} films…": {
      sv: "Hämtar metadata för {count} filmer…",
    },
    "Fetching metadata: {done}/{total}": {
      sv: "Hämtar metadata: {done}/{total}",
    },
    "Fetching posters for {count} films…": {
      sv: "Hämtar affischer för {count} filmer…",
    },
    "Fetching posters: {done}/{total}": {
      sv: "Hämtar affischer: {done}/{total}",
    },
    "Added {count} films. Found metadata for {metadata} and posters for {posters}.":
      {
        sv: "Lade till {count} filmer. Hittade metadata för {metadata} och affischer för {posters}.",
      },
    "Adding {count} films…": { sv: "Lägger till {count} filmer…" },
    "Films could not be added.": { sv: "Filmerna kunde inte läggas till." },
    "Added {count} films to tier {tier}.": {
      sv: "Lade till {count} filmer i tier {tier}.",
    },
    "No new films to add.": { sv: "Inga nya filmer att lägga till." },
    "Removed {count} recently added films.": {
      sv: "Tog bort {count} nyligen tillagda filmer.",
    },
    "Undo failed.": { sv: "Ångringen misslyckades." },
    "Best Picture winners watched": {
      sv: "Sedda vinnare av Bästa film",
    },
    "Oscar-winning films watched": { sv: "Sedda Oscarsvinnare" },
    "Oscar-nominated films watched": { sv: "Sedda Oscarsnominerade filmer" },
    "{source}-winning films watched": { sv: "Sedda {source}-vinnare" },
    "{source}-nominated films watched": {
      sv: "Sedda {source}-nominerade filmer",
    },
    "Oscar completion covers every imported official nominee. Director, franchise, and project completion covers known films in the archive and watchlist.":
      {
        sv: "Oscar-färdigställande omfattar varje importerad officiell nominering. Färdigställande för regissörer, franchises och projekt omfattar kända filmer i arkivet och watchlisten.",
      },
    "Official completion covers every imported official nominee, per source. Director, franchise, and project completion covers known films in the archive and watchlist.":
      {
        sv: "Officiellt färdigställande omfattar varje importerad officiell nominering, per källa. Färdigställande för regissörer, franchises och projekt omfattar kända filmer i arkivet och watchlisten.",
      },
    "Films watched from the imported official Academy Awards winners and nominees — overall, by year, and by category.":
      {
        sv: "Sedda filmer bland importerade officiella Oscarsvinnare och nominerade — totalt, per år och per kategori.",
      },
    "Films watched from the imported official {source} winners and nominees — overall, by year, and by category.":
      {
        sv: "Sedda filmer bland importerade officiella {source}-vinnare och nominerade — totalt, per år och per kategori.",
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
    "Based on {count} imported {source} periods, {first}–{last}.": {
      sv: "Baserat på {count} importerade {source}-perioder, {first}–{last}.",
    },
    "{count} more official periods already fully watched.": {
      sv: "Ytterligare {count} officiella perioder är redan helt sedda.",
    },
    "Every official Oscar period is fully watched.": {
      sv: "Varje officiell Oscarsperiod är helt sedd.",
    },
    "Every official period is fully watched.": {
      sv: "Varje officiell period är helt sedd.",
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
    "No official data imported yet for this source.": {
      sv: "Ingen officiell data har importerats ännu för denna källa.",
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
    "No shared archive films match this search.": {
      sv: "Inga filmer i det delade arkivet matchar sökningen.",
    },
    "No shared-only films in this period.": {
      sv: "Inga nya filmer från det delade arkivet i den här perioden.",
    },
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
    "No official results data for this category.": {
      sv: "Inga officiella resultat för den här kategorin.",
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
    "Open local owner tools": { sv: "Öppna lokala ägarverktyg" },
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
    "Watched posters": { sv: "Posters för sedda filmer" },
    "Watchlist posters": { sv: "Watchlist-posters" },
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
    Eligibility: { sv: "Behörighet" },
    "Metadata coverage": { sv: "Metadatatäckning" },
    "Missing metadata": { sv: "Saknad metadata" },
    "External media types": { sv: "Externa medietyper" },
    "Import diagnostics": { sv: "Importdiagnostik" },
    "Metadata retries": { sv: "Nya metadataförsök" },
    Coverage: { sv: "Täckning" },
    "Watchlist films missing director": {
      sv: "Watchlist-filmer som saknar regissör",
    },
    "No watched-film metadata lookups have run this session.": {
      sv: "Inga metadatauppslag för sedda filmer har körts denna session.",
    },
    "No watchlist metadata lookups have run this session.": {
      sv: "Inga metadatauppslag för watchlist har körts denna session.",
    },
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
    "Check TMDB links": { sv: "Kontrollera TMDB-länkar" },
    "Checking...": { sv: "Kontrollerar..." },
    "Checks watched-film TMDB IDs in explicit batches; lists every title, release year, runtime, media type, or missing-record difference.":
      {
        sv: "Kontrollerar sedda filmers TMDB-ID:n i uttryckliga batchar; listar alla skillnader i titel, premiärår, speltid, medietyp eller saknad post.",
      },
    "TMDB link verification": {
      sv: "Verifiering av TMDB-länkar",
    },
    "No TMDB link issues found in {count} checked film(s) this session.": {
      sv: "Inga TMDB-länkproblem hittades i {count} kontrollerade filmer denna session.",
    },
    "Local type": { sv: "Lokal typ" },
    "TMDB ID": { sv: "TMDB-ID" },
    Result: { sv: "Resultat" },
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
    "{minutes} min": { sv: "{minutes} min" },
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
    "Remove from watchlist": { sv: "Ta bort från watchlist" },
    "Removed from watchlist": { sv: "Borttagen från watchlist" },
    'Removed "{title}" from your watchlist.': {
      sv: 'Tog bort "{title}" från din watchlist.',
    },
    "Remove {title} from the watchlist? This can't be undone here.": {
      sv: "Ta bort {title} från watchlisten? Det går inte att ångra här.",
    },
    Reorder: { sv: "Ordna" },
    Reopen: { sv: "Öppna igen" },
    "Return home": { sv: "Tillbaka hem" },
    "Return to watchlist": { sv: "Tillbaka till watchlist" },
    "Mark as watched": { sv: "Markera som sedd" },
    "Mark {title} as watched": { sv: "Markera {title} som sedd" },
    "Add known viewing facts, then confirm.": {
      sv: "Lägg till kända tittningsuppgifter och bekräfta sedan.",
    },
    "Add any viewing facts you know, then mark it watched.": {
      sv: "Lägg till de tittningsuppgifter du känner till och markera sedan filmen som sedd.",
    },
    Back: { sv: "Tillbaka" },
    "Viewing facts": { sv: "Tittningsuppgifter" },
    "Date watched": { sv: "Sedd datum" },
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
    "Next: rating and viewing facts": {
      sv: "Nästa: betyg och tittningsuppgifter",
    },
    "Confirm rating": { sv: "Bekräfta betyg" },
    "Save rating": { sv: "Spara betyg" },
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
    "This final choice sets the film's all-time position.": {
      sv: "Det här sista valet bestämmer filmens all-time-position.",
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
    Review: { sv: "Granska" },
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
    "Search shared archive": { sv: "Sök i delat arkiv" },
    Screenwriter: { sv: "Manusförfattare" },
    "Set batch": { sv: "Välj batch" },
    "Set filtered interest": { sv: "Sätt filtrerat intresse" },
    "Update interest": { sv: "Uppdatera intresse" },
    "Set filtered interest to {tier}?": {
      sv: "Sätt filtrerat intresse till {tier}?",
    },
    "Updated interest for {count} film(s).": {
      sv: "Uppdaterade intresset för {count} film(er).",
    },
    "Interest changes undone.": { sv: "Intresseändringarna ångrades." },
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
    "Shared archive": { sv: "Delat arkiv" },
    "Shared-only films": { sv: "Nya filmer från delat arkiv" },
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
    "Loading shared archive films…": {
      sv: "Laddar filmer från det delade arkivet…",
    },
    "Not watched or watchlisted": { sv: "Inte sedd eller i watchlist" },
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
    "Title or director": { sv: "Titel eller regissör" },
    "The shared archive could not be loaded.": {
      sv: "Det delade arkivet kunde inte laddas.",
    },
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
    Retry: { sv: "Försök igen" },
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
    "{posters} poster and {portraits} portrait import attempt(s) have failed.": {
      sv: "{posters} poster- och {portraits} porträttimportförsök har misslyckats.",
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
    "Other watched entries with no franchise or director link": {
      sv: "Övrigt sett utan franchise- eller regissörskoppling",
    },
    "Otherwise only findable through search - link a franchise or director in the source sheet.":
      {
        sv: "Annars bara hittbart via sökning - länka en franchise eller regissör i källarket.",
      },
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
    "Posters improve card/grid views. Fetchable from TMDB.": {
      sv: "Posters förbättrar kort- och rutnätsvyer. Kan hämtas från TMDB.",
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
    "Watchlist posters keep large watchlist grids scannable. Fetchable from TMDB.":
      {
        sv: "Watchlist-posters gör stora watchlist-rutnät lättare att skanna. Kan hämtas från TMDB.",
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
    "Letterboxd jumpstart": { sv: "Letterboxd-start" },
    "Awards and rankings are not part of this import.": {
      sv: "Priser och rankningar ingår inte i den här importen.",
    },
    "Awards are not part of this import. Newly added films have no rank yet - rank each year to include them in that year's awards.":
      {
        sv: "Priser ingår inte i den här importen. Nytillagda filmer saknar ännu rankning - rangordna varje år för att inkludera dem i det årets priser.",
      },
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
    "Next: fetching details for the films you just imported. This can take a while - already-fetched films are saved as it goes, but leaving this page pauses whatever's left until you come back.":
      {
        sv: "Nästa: hämtar detaljer för filmerna du precis importerade. Detta kan ta ett tag - redan hämtade filmer sparas allt eftersom, men lämnar du sidan pausas resten tills du kommer tillbaka.",
      },
    "Failed lookups": { sv: "Misslyckade uppslag" },
    "Fetch all missing": { sv: "Hämta allt saknat" },
    "Fetch not-watched missing": { sv: "Hämta osett saknat" },
    "Sharing...": { sv: "Delar..." },
    "Checking your archive for anything not yet shared...": {
      sv: "Kontrollerar ditt arkiv efter sådant som inte delats än...",
    },
    "{done} / {total} checked...": { sv: "{done} / {total} kontrollerade..." },
    "Shared {created} new film(s) ({alreadyShared} were already shared). Today's sharing quota is reached — the rest will pick up if you run this again tomorrow.":
      {
        sv: "Delade {created} ny(a) film(er) ({alreadyShared} var redan delade). Dagens delningskvot är nådd — resten fortsätter om du kör detta igen imorgon.",
      },
    "Shared {created} new film(s) ({alreadyShared} were already shared). The shared archive is at capacity, so nothing more can be added right now.":
      {
        sv: "Delade {created} ny(a) film(er) ({alreadyShared} var redan delade). Det delade arkivet är fullt, så inget mer kan läggas till just nu.",
      },
    "Nothing shared — sign in with an eligible Shared Edition account to use this.":
      {
        sv: "Inget delades — logga in med ett behörigt Shared Edition-konto för att använda detta.",
      },
    "Done: {created} new film(s) shared, {alreadyShared} already shared{failedNote}.":
      {
        sv: "Klart: {created} ny(a) film(er) delade, {alreadyShared} redan delade{failedNote}.",
      },
    ", {count} failed": { sv: ", {count} misslyckades" },
    "Push existing films": { sv: "Dela befintliga filmer" },
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
    "Image retry queues": { sv: "Omförsöksköer för bilder" },
    "Missing images": { sv: "Saknade bilder" },
    "No image lookups have run this session.": {
      sv: "Inga bilduppslag har körts denna session.",
    },
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
    "Showing {shown} of {total} failures.": {
      sv: "Visar {shown} av {total} misslyckanden.",
    },
    "Showing {shown} of {total} skipped items.": {
      sv: "Visar {shown} av {total} överhoppade objekt.",
    },
    "Skipped this session": { sv: "Överhoppade denna session" },
    "Start batch": { sv: "Starta batch" },
    "Fetch all missing ({count})": { sv: "Hämta allt som saknas ({count})" },
    "Fetch watchlist-only missing ({count})": {
      sv: "Hämta det som saknas endast i watchlist ({count})",
    },
    "Starting {count} {label}.": { sv: "Startar {count} {label}." },
    "Starting {items}.": { sv: "Startar {items}." },
    "Unknown metadata batch type.": { sv: "Okänd metadata-batchtyp." },
    "Film details could not be fetched. Check your connection, then try the batch again.": {
      sv: "Filmuppgifterna kunde inte hämtas. Kontrollera anslutningen och försök sedan köra hämtningen igen.",
    },

    // Data & backups page (src/pages/data.js)
    "(blank)": { sv: "(tomt)" },
    "Add googleClientId, googleSheets.spreadsheetId, and googleSheets.ranges in config.local.js.":
      {
        sv: "Lägg till googleClientId, googleSheets.spreadsheetId och googleSheets.ranges i config.local.js.",
      },
    "All types": { sv: "Alla typer" },
    "Applied to draft": { sv: "Tillämpat på utkast" },
    "Changes added": { sv: "Ändringarna har lagts till" },
    "Apply failed": { sv: "Tillämpning misslyckades" },
    "Applying...": { sv: "Tillämpar..." },
    Applied: { sv: "Tillämpad" },
    "Batch set to {label}.": { sv: "Batch inställd på {label}." },
    "Canonical proposal changes": { sv: "Kanoniska förslagsändringar" },
    "Changes to your archive": { sv: "Ändringar i ditt arkiv" },
    "Part of archive": { sv: "Del av arkivet" },
    "Changed records": { sv: "Ändrade poster" },
    Before: { sv: "Före" },
    After: { sv: "Efter" },
    Changes: { sv: "Ändringar" },
    "Clear all data": { sv: "Rensa all data" },
    "Clear all locally stored The Oskars data?": {
      sv: "Rensa all lokalt lagrad The Oskars-data?",
    },
    "Delete all The Oskars data stored in this browser? This cannot be undone here. Download a backup first if you may want to restore it. Published and cloud copies are not deleted.": {
      sv: "Radera all The Oskars-data som lagras i den här webbläsaren? Det går inte att ångra här. Hämta först en säkerhetskopia om du kan vilja återställa datan. Publicerade kopior och molnkopior raderas inte.",
    },
    "Clear failed": { sv: "Rensning misslyckades" },
    "Clear log": { sv: "Rensa logg" },
    "Proposal blocked.": { sv: "Förslaget blockerades." },
    "Review ready: {count} part(s) of your archive would change. Nothing has changed yet.": {
      sv: "Granskningen är klar: {count} del(ar) av ditt arkiv skulle ändras. Inget har ändrats än.",
    },
    "This import cannot be used yet. Review the problems below, fix the Sheets data, and try again.": {
      sv: "Importen kan inte användas än. Granska problemen nedan, rätta Sheets-datan och försök igen.",
    },
    "The Sheets preview could not be prepared. Check your connection and sign-in, then try again.": {
      sv: "Sheets-granskningen kunde inte förberedas. Kontrollera anslutningen och inloggningen och försök igen.",
    },
    "The reviewed Sheets changes are now in this browser. Publishing remains a separate action.": {
      sv: "De granskade Sheets-ändringarna finns nu i den här webbläsaren. Publicering är fortfarande ett separat steg.",
    },
    "The first Sheets import is complete. Future previews will update this browser while keeping local film details.": {
      sv: "Den första Sheets-importen är klar. Framtida granskningar uppdaterar den här webbläsaren och behåller lokala filmuppgifter.",
    },
    "The archive could not be shared. Check your connection and account access, then try again.": {
      sv: "Arkivet kunde inte delas. Kontrollera anslutningen och kontobehörigheten och försök igen.",
    },

    // Account page: sign-in and cloud sync (issue #248, src/pages/profile.js)
    "Sign in": { sv: "Logga in" },
    "Cloud sync isn't set up for this deployment yet.": {
      sv: "Molnsynkronisering är inte konfigurerad för den här driftsättningen än.",
    },
    "Signed in as {name}.": { sv: "Inloggad som {name}." },
    "your Google account": { sv: "ditt Google-konto" },
    "Sign out": { sv: "Logga ut" },
    "Sign in with Google to sync this workspace across your devices.": {
      sv: "Logga in med Google för att synkronisera denna arbetsyta mellan dina enheter.",
    },
    "{count} item(s) changed on this device and elsewhere - choose which version to keep for each:":
      {
        sv: "{count} objekt har ändrats på den här enheten och någon annanstans - välj vilken version som ska behållas för varje:",
      },
    "Keep this device's version": { sv: "Behåll den här enhetens version" },
    "Use the other device's version": { sv: "Använd den andra enhetens version" },
    "Preview changes": { sv: "Förhandsgranska ändringar" },
    "Loading preview...": { sv: "Laddar förhandsgranskning..." },
    "Could not load preview. Try again.": {
      sv: "Kunde inte ladda förhandsgranskning. Försök igen.",
    },
    "This section's content differs between devices. Individual changes can't be previewed for this data type.":
      {
        sv: "Innehållet i den här sektionen skiljer sig mellan enheter. Enskilda ändringar kan inte förhandsgranskas för denna datatyp.",
      },
    "No content differences found.": {
      sv: "Inga innehållsskillnader hittades.",
    },
    "Content differs, but no individual record changes were found (a field outside per-record tracking may differ).":
      {
        sv: "Innehållet skiljer sig, men inga enskilda postförändringar hittades (ett fält utanför per-post-spårning kan skilja sig).",
      },
    "The other device's version would add": {
      sv: "Den andra enhetens version skulle lägga till",
    },
    "Using the other device's version would discard": {
      sv: "Att använda den andra enhetens version skulle förkasta",
    },
    "The other device's version would change": {
      sv: "Den andra enhetens version skulle ändra",
    },
    "+{count} more": { sv: "+{count} till" },
    "(+{count} more not shown)": { sv: "(+{count} till visas inte)" },
    "Use the other device's version? This device's current version will be retained for recovery.":
      {
        sv: "Använd den andra enhetens version? Den här enhetens nuvarande version kommer att behållas för återställning.",
      },
    "Resolved.": { sv: "Löst." },
    "Restore previous": { sv: "Återställ föregående" },
    "Restore the workspace content retained before this conflict was resolved?":
      {
        sv: "Återställ arbetsytans innehåll som behölls innan den här konflikten löstes?",
      },
    "Restore the version saved before this conflict was resolved? It replaces this browser's current archive. Download a backup first if you may want to return to the current version.": {
      sv: "Återställ versionen som sparades innan konflikten löstes? Den ersätter den här webbläsarens nuvarande arkiv. Hämta först en säkerhetskopia om du kan vilja återgå till den nuvarande versionen.",
    },
    "Restored.": { sv: "Återställd." },
    "Nothing to restore.": { sv: "Inget att återställa." },
    "Sync now": { sv: "Synkronisera nu" },
    "Syncing...": { sv: "Synkroniserar..." },
    "{count} item(s) changed on this device and elsewhere - see below to choose which version to keep.":
      {
        sv: "{count} objekt har ändrats på den här enheten och någon annanstans - se nedan för att välja vilken version som ska behållas.",
      },
    "Cloud sync hit an error - it will retry automatically.": {
      sv: "Molnsynkroniseringen stötte på ett fel - den försöker igen automatiskt.",
    },
    "This account isn't authorized for cloud sync on this deployment. Changes stay saved locally on this device.":
      {
        sv: "Det här kontot är inte auktoriserat för molnsynkronisering på den här driftsättningen. Ändringar sparas lokalt på den här enheten.",
      },
    "Synced: {pushed} shard(s) uploaded, {pulled} shard(s) downloaded.": {
      sv: "Synkroniserat: {pushed} del(ar) uppladdade, {pulled} del(ar) nedladdade.",
    },
    "Already up to date.": { sv: "Redan uppdaterad." },
    "Load complete archive from cloud": { sv: "Läs in fullständigt arkiv från molnet" },
    "Loading from cloud...": { sv: "Läser in från molnet..." },
    "Could not load the cloud archive: {error}": {
      sv: "Kunde inte läsa in molnarkivet: {error}",
    },
    "The cloud version could not be loaded. Check your connection and sign-in, then try again.": {
      sv: "Molnversionen kunde inte läsas in. Kontrollera anslutningen och inloggningen och försök igen.",
    },
    "Previewed below as a replace proposal - review, then apply the reviewed archive to draft it locally.":
      {
        sv: "Förhandsgranskad nedan som ett ersättningsförslag - granska och tillämpa sedan det granskade arkivet för att skapa ett lokalt utkast.",
      },
    "The cloud version is ready to review below. Nothing has changed yet; use the reviewed version when it looks right.": {
      sv: "Molnversionen är klar att granska nedan. Inget har ändrats än; använd den granskade versionen när den ser rätt ut.",
    },
    "Cloud version restored": { sv: "Molnversionen har återställts" },
    "Could not preview the cloud archive: {error}": {
      sv: "Kunde inte förhandsgranska molnarkivet: {error}",
    },
    "The cloud version could not be reviewed. Try loading it again.": {
      sv: "Molnversionen kunde inte granskas. Försök läsa in den igen.",
    },

    // Account page: cloud account deletion (issue #254, src/pages/profile.js)
    "Stop cloud sync and continue locally? You can sign in again anytime - nothing local is lost either way.":
      {
        sv: "Sluta molnsynka och fortsätt lokalt? Du kan logga in igen när som helst - inget lokalt går förlorat oavsett.",
      },
    "Signing out locks this private archive immediately. Sign back into the same account to reopen it.": {
      sv: "Utloggning låser det privata arkivet omedelbart. Logga in med samma konto för att öppna det igen.",
    },
    "Sign out and lock": { sv: "Logga ut och lås" },
    "Sign out and lock this browser's private archive? Nothing is deleted; the same account can reopen it later.": {
      sv: "Logga ut och lås webbläsarens privata arkiv? Ingenting raderas; samma konto kan öppna det igen senare.",
    },
    "Switch accounts safely": { sv: "Byt konto säkert" },
    "Switch accounts? A full backup downloads first, an account-bound recovery is retained, and this archive is removed from the active browser before sign-out. Cloud data is not deleted.": {
      sv: "Byta konto? En fullständig säkerhetskopia laddas först ned, en kontobunden återställning sparas och arkivet tas bort från den aktiva webbläsaren före utloggning. Molndata raderas inte.",
    },
    "Preparing safe switch...": { sv: "Förbereder säkert kontobyte..." },
    "Could not prepare account switch: {reason}": {
      sv: "Kunde inte förbereda kontobytet: {reason}",
    },
    "Backup retained. Locking this browser and signing out...": {
      sv: "Säkerhetskopian är sparad. Låser webbläsaren och loggar ut...",
    },
    "This local workspace is not attached to a cloud account yet. Connect it explicitly before any upload or download.": {
      sv: "Den lokala arbetsytan är ännu inte kopplad till ett molnkonto. Anslut den uttryckligen före uppladdning eller nedladdning.",
    },
    "Connect this workspace to this account": {
      sv: "Anslut arbetsytan till detta konto",
    },
    "Could not connect this workspace: {reason}": {
      sv: "Kunde inte ansluta arbetsytan: {reason}",
    },
    "Cloud actions are locked because this workspace belongs to another account.": {
      sv: "Molnåtgärder är låsta eftersom arbetsytan tillhör ett annat konto.",
    },
    "Cloud sync is locked until this workspace is attached to the signed-in account.": {
      sv: "Molnsynkronisering är låst tills arbetsytan har kopplats till det inloggade kontot.",
    },
    "Delete cloud account data": { sv: "Radera molnkontodata" },
    "Cloud storage": { sv: "Molnlagring" },
    "Delete synced cloud copy": { sv: "Radera synkad molnkopia" },
    "Deletes the private sync copy stored online, then signs this browser out. The archive in this browser, your Google login, and any published profile stay. Signing in again from a browser that still has the archive can upload it again. A full backup downloads first.": {
      sv: "Raderar den privata synkkopian som lagras online och loggar sedan ut webbläsaren. Arkivet i webbläsaren, din Google-inloggning och publicerade profiler finns kvar. Om du loggar in igen från en webbläsare som har kvar arkivet kan det laddas upp på nytt. En fullständig säkerhetskopia laddas ned först.",
    },
    "A public profile ({name}) may still be published. This does not take it down. ": {
      sv: "En offentlig profil ({name}) kan fortfarande vara publicerad. Den tas inte ner av detta. ",
    },
    "Delete the synced cloud copy? A backup downloads first. The archive in this browser stays, and you will be signed out. Any browser with a retained archive can upload it again.": {
      sv: "Radera den synkade molnkopian? En säkerhetskopia laddas ned först. Arkivet i den här webbläsaren finns kvar och du loggas ut. Alla webbläsare som har kvar arkivet kan ladda upp det igen.",
    },
    "Deleted the synced cloud copy and verified {count} part(s). Signing out now. This browser's archive was not changed.": {
      sv: "Raderade den synkade molnkopian och verifierade {count} del(ar). Loggar ut nu. Arkivet i den här webbläsaren ändrades inte.",
    },
    "Permanently deletes every document Firestore holds for this account - every synced section and this device's sync history. A full backup downloads first. This is final; there is no admin-side recovery once it verifies removal.":
      {
        sv: "Raderar permanent alla dokument Firestore lagrar för det här kontot - varje synkroniserad sektion och den här enhetens synkroniseringshistorik. En fullständig säkerhetskopia laddas ned först. Detta är slutgiltigt; det finns ingen återställning från administratörssidan efter att raderingen har verifierats.",
      },
    "A public profile ({name}) may currently be published. Deleting your cloud account data does NOT take it down - that needs the separate revocation step on the Data page's publish panel. ":
      {
        sv: "En offentlig profil ({name}) kan för närvarande vara publicerad. Att radera dina molnkontodata tar INTE ner den - det kräver det separata återkallningssteget på datasidans publiceringspanel. ",
      },
    "This downloads a full backup, then permanently deletes every document Firestore holds for this account. It cannot be undone. Continue?":
      {
        sv: "Detta laddar ned en fullständig säkerhetskopia och raderar sedan permanent alla dokument Firestore lagrar för det här kontot. Det kan inte ångras. Fortsätta?",
      },
    "Deleted and verified {count} section(s). Signing out - your local archive is untouched.":
      {
        sv: "Raderade och verifierade {count} sektion(er). Loggar ut - ditt lokala arkiv är orört.",
      },
    "Could not verify deletion for: {sections}. Nothing was signed out - try again.": {
      sv: "Kunde inte verifiera radering för: {sections}. Ingen utloggning gjordes - försök igen.",
    },
    "Deletion failed. Nothing was signed out - try again.": {
      sv: "Raderingen misslyckades. Ingen utloggning gjordes - försök igen.",
    },

    "Public profile name": { sv: "Namn för offentlig profil" },
    "Used as your public profile's display name and URL slug when you publish one (see the Data page's “Publish a public profile” panel).":
      {
        sv: "Används som visningsnamn och URL-slug för din offentliga profil när du publicerar en (se panelen “Publicera en offentlig profil” på datasidan).",
      },
    "URL slug: {slug}": { sv: "URL-slug: {slug}" },
    "Enter a name to see its URL slug.": {
      sv: "Ange ett namn för att se dess URL-slug.",
    },
    "Saved.": { sv: "Sparat." },
    "More columns": { sv: "Fler kolumner" },
    "Scroll left": { sv: "Rulla åt vänster" },
    "Scroll right": { sv: "Rulla åt höger" },
    "Cleared.": { sv: "Rensat." },
    "Choose the original .zip file exported by Letterboxd.": {
      sv: "Välj den ursprungliga .zip-filen som exporterades av Letterboxd.",
    },
    "The Letterboxd review could not be prepared. Choose the original export ZIP and try again.": {
      sv: "Letterboxd-granskningen kunde inte förberedas. Välj den ursprungliga exportens ZIP-fil och försök igen.",
    },
    "Reading and validating the Letterboxd export locally...": {
      sv: "Läser och validerar Letterboxd-exporten lokalt...",
    },
    "Letterboxd jumpstart is ready. No local data changed; review the report before applying.":
      {
        sv: "Letterboxd-starten är klar. Ingen lokal data har ändrats; granska rapporten före tillämpning.",
      },
    "Your Letterboxd review is ready. Nothing has changed yet; check the report, then use the reviewed changes.": {
      sv: "Din Letterboxd-granskning är klar. Inget har ändrats än; kontrollera rapporten och använd sedan de granskade ändringarna.",
    },
    "This Letterboxd import cannot be used yet. Review the problems below and try again with a corrected export.": {
      sv: "Letterboxd-importen kan inte användas än. Granska problemen nedan och försök igen med en rättad export.",
    },
    "Letterboxd data applied to the local draft. Awards and rankings were kept unchanged.":
      {
        sv: "Letterboxd-data har tillämpats på det lokala utkastet. Priser och rankningar lämnades oförändrade.",
      },
    "The reviewed Letterboxd changes are now in this browser. Awards and rankings were left unchanged.": {
      sv: "De granskade Letterboxd-ändringarna finns nu i den här webbläsaren. Priser och rankningar lämnades oförändrade.",
    },
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
    "Clear the local edit history? This cannot be undone, but it does not change any films, ratings, rankings, awards, or watch history.": {
      sv: "Rensa den lokala ändringshistoriken? Det går inte att ångra, men inga filmer, betyg, rankningar, priser eller tittningar ändras.",
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
    // Year ranking and annual awards
    "Set up a year": { sv: "Sätt upp ett år" },
    "Year not found": { sv: "Året hittades inte" },
    "Set up {year}": { sv: "Sätt upp {year}" },
    "{year} isn't fully set up yet.": {
      sv: "{year} är inte helt uppsatt än.",
    },
    "View {year}": { sv: "Visa {year}" },
    "Rank a year": { sv: "Ranka ett år" },
    "Rank {year}": { sv: "Ranka {year}" },
    "Ranking shelves": { sv: "Rankningshyllor" },
    "Arrange films only against others with the same exact rating.": {
      sv: "Ordna filmer endast mot andra med exakt samma betyg.",
    },
    "Build annual awards": { sv: "Bygg årets priser" },
    "Build {year} awards": { sv: "Bygg {year}s priser" },
    "Build the ballot category by category, then run the ceremony.": {
      sv: "Bygg röstsedeln kategori för kategori och kör sedan ceremonin.",
    },
    "Annual ballot": { sv: "Årlig röstsedel" },
    "{year} isn't fully built yet.": {
      sv: "{year} är inte helt byggt än.",
    },
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
    "Finish category": { sv: "Avsluta kategorin" },
    "No award this year": { sv: "Inget pris i år" },
    "Ballot categories": { sv: "Röstsedelns kategorier" },
    "Next: {category}": { sv: "Nästa: {category}" },
    reviewed: { sv: "granskade" },
    "The envelope is sealed": { sv: "Kuvertet är förseglat" },
    "Your {year} ceremony is ready": { sv: "Din {year}-ceremoni är klar" },
    "Run the ceremony": { sv: "Starta ceremonin" },
    "Continue to decade awards": { sv: "Fortsätt till decenniets priser" },
    "award categories reviewed": { sv: "priskategorier granskade" },
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
    Settled: { sv: "Avgjord" },
    Reviewed: { sv: "Granskad" },
    "Mechanical order": { sv: "Mekanisk ordning" },
    "Confirm this order": { sv: "Bekräfta ordningen" },
    "Keep this order": { sv: "Behåll ordningen" },
    "Compare two at a time": { sv: "Jämför två i taget" },
    "Compare this year two at a time": { sv: "Jämför året två i taget" },
    "Year heat complete": { sv: "Årets heat är klart" },
    "Continue to {scope} finals": { sv: "Fortsätt till {scope}-finalen" },
    "{scope} year heat": { sv: "{scope} årsheat" },
    "{scope} finals": { sv: "{scope}-final" },
    "All-time final": { sv: "All-time-final" },
    "Ranking heat": { sv: "Rankningsheat" },
    "Final settled": { sv: "Finalen avgjord" },
    "Only comparisons that cross the already-settled narrower scope are shown in later finals.": {
      sv: "Senare finaler visar bara jämförelser som korsar den redan avgjorda smalare perioden.",
    },
    "Every relevant same-rating comparison in this scope is settled, or there are not two films to compare yet.": {
      sv: "Alla relevanta jämförelser med samma betyg i perioden är avgjorda, eller så finns ännu inte två filmer att jämföra.",
    },
    "Continue to {scope}": { sv: "Fortsätt till {scope}" },
    "all-time final": { sv: "all-time-finalen" },
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
    "Reset the order for {count} film(s). Ratings and awards stayed the same.": {
      sv: "Återställde ordningen för {count} film(er). Betyg och priser förblev oförändrade.",
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
    "Removed {count} award placement(s). Your other opinions stayed the same.": {
      sv: "Tog bort {count} prisplacering(ar). Dina andra åsikter förblev oförändrade.",
    },
    "every film": { sv: "alla filmer" },
    "{from}–{to}": { sv: "{from}–{to}" },
    "{from} onward": { sv: "{from} och framåt" },
    "through {to}": { sv: "till och med {to}" },
    "Welcome to The Oskars": { sv: "Välkommen till The Oskars" },
    "Your archive saves automatically to this browser and syncs to your signed-in account. Back it up anytime from the Data page, and you can clear it there to start over.":
      {
        sv: "Ditt arkiv sparas automatiskt i den här webbläsaren och synkas till ditt inloggade konto. Säkerhetskopiera när som helst från Data-sidan, där du också kan rensa det för att börja om.",
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
    "Recommended if you already track films elsewhere": {
      sv: "Rekommenderas om du redan har koll på filmer någon annanstans",
    },
    "Import your Letterboxd export": {
      sv: "Importera din Letterboxd-export",
    },
    "Bring in watched films, ratings, diary dates, tags, and your watchlist in one step. Awards and rankings stay yours to set up here.":
      {
        sv: "Ta in sedda filmer, betyg, dagboksdatum, taggar och din önskelista i ett steg. Priser och rankningar sätter du upp själv här.",
      },
    "Import Letterboxd export": { sv: "Importera Letterboxd-export" },
    "Restoring a previous Oskars backup or canonical file instead? ": {
      sv: "Återställer du istället en tidigare Oskars-säkerhetskopia eller kanonisk fil? ",
    },
    "Go to the Data page.": { sv: "Gå till Data-sidan." },
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
